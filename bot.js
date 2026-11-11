import { ChessGame } from './actions.js';

const FILES = 'abcdefgh';
const DEFAULT_CASTLING = {
    w: { kingSide: true, queenSide: true },
    b: { kingSide: true, queenSide: true }
};



export class Bot {
    constructor(options = {}) {
        this.values = {
            p: 100,
            n: 320,
            b: 330,
            r: 500,
            q: 900,
            k: 20000
        };

        this.MATE_SCORE = options.mateScore ?? 1000000;
        this.quiescenceDepth = options.quiescenceDepth ?? 4;

        // These are deliberately modest starting weights. Tune them by
        // testing games; material and forced mate remain dominant.
        this.weights = {
            development: options.developmentWeight ?? 1.0,
            kingSafety: options.kingSafetyWeight ?? 1.0,
            vulnerability: options.vulnerabilityWeight ?? 0.22,
            mobility: options.mobilityWeight ?? 0.65
        };

        this.nodes = 0;
        this.lastSearchStats = null;
    }

    // ================================================================
    // PUBLIC API
    // ================================================================

    /**
     * Evaluate a board. By default the result is from White's perspective.
     * Pass 'b' to receive the same evaluation from Black's perspective.
     */
    evaluate(board, perspective = 'w') {
        return this.evaluateBreakdown(board, perspective).total;
    }

    /**
     * Return the individual evaluation factors from the requested side's
     * perspective. X = king pressure/support, Y = development, Z = weakness.
     * The combined score follows: material + X + Y - Z.
     */
    evaluateBreakdown(board, perspective = 'w') {
        if (!Array.isArray(board) || board.length !== 8) {
            return { material: 0, X: 0, Y: 0, Z: 0, total: 0 };
        }

        const whiteKing = this.findKing(board, 'w');
        const blackKing = this.findKing(board, 'b');
        if (!whiteKing && !blackKing) {
            return { material: 0, X: 0, Y: 0, Z: 0, total: 0 };
        }
        if (!whiteKing) {
            const total = -this.MATE_SCORE;
            return perspective === 'w'
                ? { material: 0, X: 0, Y: 0, Z: 0, total }
                : { material: 0, X: 0, Y: 0, Z: 0, total: -total };
        }
        if (!blackKing) {
            const total = this.MATE_SCORE;
            return perspective === 'w'
                ? { material: 0, X: 0, Y: 0, Z: 0, total }
                : { material: 0, X: 0, Y: 0, Z: 0, total: -total };
        }

        // The 20,000 king values are included as requested. Since both kings
        // are normally present, they cancel in the material difference.
        const material = this._materialFor(board, 'w') - this._materialFor(board, 'b');

        // X: pressure on Black's king + support for White's king,
        // minus pressure on White's king + support for Black's king.
        const whiteKingSafety = this._kingSafetyScore(board, 'w');
        const blackKingSafety = this._kingSafetyScore(board, 'b');
        const X = whiteKingSafety - blackKingSafety;

        // Y: mobility, development, central control and rook activity.
        const Y =
            this._developmentScore(board, 'w') -
            this._developmentScore(board, 'b');

        // Z: White's own vulnerability minus Black's vulnerability.
        // A positive Z is bad for White; a negative Z is good for White.
        const Z =
            this._vulnerabilityScore(board, 'w') -
            this._vulnerabilityScore(board, 'b');

        const whiteTotal =
            material +
            X * this.weights.kingSafety +
            Y * this.weights.development -
            Z * this.weights.vulnerability;

        const sign = perspective === 'b' ? -1 : 1;
        return {
            material: material * sign,
            X: X * sign,
            Y: Y * sign,
            Z: Z * sign,
            total: whiteTotal * sign
        };
    }

    /**
     * Return the best legal move for game.turn.
     * depth is measured in plies (one individual move by either side).
     */
    findBestMove(game, depth = 2) {
        this._assertGame(game);

        const searchDepth = Math.max(1, Math.floor(Number(depth) || 1));
        const color = game.turn;
        const legalMoves = game.getAllLegalMoves(color);

        if (!Array.isArray(legalMoves) || legalMoves.length === 0) {
            this.lastSearchStats = {
                depth: searchDepth,
                nodes: 0,
                score: null,
                bestMove: null
            };
            return null;
        }

        this.nodes = 0;
        const maximizing = color === 'w';
        const orderedMoves = this._orderMoves(game, legalMoves);

        let bestMove = orderedMoves[0].move;
        let bestScore = maximizing ? -Infinity : Infinity;
        let alpha = -Infinity;
        let beta = Infinity;

        for (const item of orderedMoves) {
            const child = this.cloneGame(game);
            this._applyMove(child, item.move);

            const score = this.minimax(
                child,
                searchDepth - 1,
                alpha,
                beta,
                !maximizing,
                1
            );

            if (
                (maximizing && score > bestScore) ||
                (!maximizing && score < bestScore)
            ) {
                bestScore = score;
                bestMove = item.move;
            }

            if (maximizing) alpha = Math.max(alpha, bestScore);
            else beta = Math.min(beta, bestScore);
        }

        this.lastSearchStats = {
            depth: searchDepth,
            nodes: this.nodes,
            score: bestScore,
            bestMove
        };

        return bestMove;
    }

    /**
     * Find the best promotion piece for a pawn move.
     *
     * Tests queen, rook, bishop and knight promotions using
     * the same minimax and alpha-beta search as findBestMove().
     *
     * @param {Object} game - Current ChessGame instance.
     * @param {Object|string} promotionMove - Legal pawn move to promote.
     * @param {number} depth - Search depth in plies.
     * @returns {'q'|'r'|'b'|'n'|null} Best promotion piece.
     */
    findBestPromote(game, promotionMove, depth = 2) {

        const searchDepth = Math.max(1, Math.floor(Number(depth) || 1));
        const color = game.turn;
        const maximizing = color === 'w';

        // Normalize the supplied promotion move.
        const move = this._normalizeMove(promotionMove);

        if (!move) {
            return null;
        }

        const promotionPieces = ['q', 'r', 'b', 'n'];

        let bestPromotion = null;
        let bestScore = maximizing ? -Infinity : Infinity;

        const promotionScores = {};

        this.nodes = 0;

        for (const promotion of promotionPieces) {
            // Create a separate game state for each promotion.
            const child = this.cloneGame(game);

            // Apply the candidate promotion.
            const candidateMove = { ...move, promotion };

            this._applyMove(child, candidateMove);

            // Evaluate this promotion independently.
            const score = this.minimax(
                child,
                searchDepth - 1,
                -Infinity,
                Infinity,
                !maximizing,
                1
            );

            promotionScores[promotion] = score;

            if (
                (maximizing && score > bestScore) ||
                (!maximizing && score < bestScore)
            ) {
                bestScore = score;
                bestPromotion = promotion;
            }
        }

        this.lastSearchStats = {
            depth: searchDepth,
            nodes: this.nodes,
            score: bestScore,
            bestMove: {
                ...move,
                promotion: bestPromotion
            },
            promotionScores
        };

        return bestPromotion;
    }


    /**
     * Minimax with alpha-beta pruning.
     * Scores are always from White's perspective.
     */
    minimax(game, depth, alpha, beta, maximizing, ply = 0) {
        this.nodes++;

        const terminalKingScore = this._missingKingScore(game.board, ply);
        if (terminalKingScore !== null) return terminalKingScore;
        const sideToMove = game.turn;
        const legalMoves = game.getAllLegalMoves(sideToMove);

        if (!Array.isArray(legalMoves) || legalMoves.length === 0) {
            if (this.isKingInCheck(game.board, sideToMove)) {
                return sideToMove === 'w'
                    ? -this.MATE_SCORE + ply
                    : this.MATE_SCORE - ply;
            }
            return 0; // Stalemate.
        }

        if (game.isDraw(game)) return 0;

        if (depth <= 0) {
            return this._quiescence(
                game,
                alpha,
                beta,
                ply,
                this.quiescenceDepth
            );
        }

        // Derive the side from the position. This prevents a caller passing
        // an inconsistent maximizing flag from corrupting the search.
        const isMaximizing = maximizing === (sideToMove === 'w')
            ? maximizing
            : sideToMove === 'w';
        const orderedMoves = this._orderMoves(game, legalMoves);

        if (isMaximizing) {
            let best = -Infinity;

            for (const item of orderedMoves) {
                const child = this.cloneGame(game);
                this._applyMove(child, item.move);

                const score = this.minimax(
                    child, depth - 1, alpha, beta, false, ply + 1
                );

                best = Math.max(best, score);
                alpha = Math.max(alpha, best);
                if (alpha >= beta) break;
            }

            return best;
        }

        let best = Infinity;

        for (const item of orderedMoves) {
            const child = this.cloneGame(game);
            this._applyMove(child, item.move);

            const score = this.minimax(
                child, depth - 1, alpha, beta, true, ply + 1
            );

            best = Math.min(best, score);
            beta = Math.min(beta, best);
            if (alpha >= beta) break;
        }

        return best;
    }

    /**
     * Analyze vulnerable enemy pieces, ordered by target priority.
     * Useful for debugging and displaying the AI's intended targets.
     */
    analyzeTargets(board, attackerColor) {
        const targetColor = this.oppositeColor(attackerColor);
        const targets = [];

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (!piece || piece.color !== targetColor || piece.type === 'k') continue;

                const attackers = this.getAttackers(board, row, col, attackerColor);
                if (attackers.length === 0) continue;

                const defenders = this.getAttackers(board, row, col, targetColor);
                const value = this.values[piece.type] ?? 0;
                const cheapestAttacker = Math.min(
                    ...attackers.map(item => this.values[item.type] ?? 0)
                );

                let vulnerability;
                if (defenders.length === 0) vulnerability = 1.0;
                else if (attackers.length > defenders.length) vulnerability = 0.75;
                else if (attackers.length === defenders.length) vulnerability = 0.35;
                else vulnerability = 0.12;

                // Prefer a cheap attacker against an expensive target, but
                // cap the adjustment so piece value remains the main factor.
                const efficiency = this._clamp(
                    1 + (value - cheapestAttacker) / 4000,
                    0.85,
                    1.15
                );

                targets.push({
                    square: this.squareName(row, col),
                    row,
                    col,
                    type: piece.type,
                    color: piece.color,
                    value,
                    attackers: attackers.map(item => ({
                        square: this.squareName(item.row, item.col),
                        type: item.type,
                        value: this.values[item.type]
                    })),
                    defenders: defenders.map(item => ({
                        square: this.squareName(item.row, item.col),
                        type: item.type,
                        value: this.values[item.type]
                    })),
                    attackerCount: attackers.length,
                    defenderCount: defenders.length,
                    vulnerability,
                    attackerEfficiency: efficiency,
                    priority: Math.round(value * vulnerability * efficiency)
                });
            }
        }

        return targets.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Static Exchange Evaluation for a move. Positive = likely material gain;
     * negative = likely material loss. This is an ordering/evaluation aid,
     * not a full legal exchange search (pinned attackers are approximated).
     */
    staticExchangeEvaluation(board, move, enPassantSquare = null) {
        const info = this._normalizeMove(move);
        const movingPiece = board[info.from.row]?.[info.from.col];
        if (!movingPiece) return 0;

        if (movingPiece.type === 'k' && Math.abs(info.to.col - info.from.col) === 2) {
            return 0; // Castling is not an exchange on the king's destination.
        }

        const working = this.cloneBoard(board);
        const destinationPiece = working[info.to.row][info.to.col];
        const isEnPassant = this._isEnPassantMove(
            board, info, movingPiece, enPassantSquare, move
        );

        let capturedPiece = destinationPiece;
        if (isEnPassant) {
            capturedPiece = working[info.from.row][info.to.col];
            working[info.from.row][info.to.col] = null;
        }

        working[info.from.row][info.from.col] = null;

        const promotion = this._promotionType(move, movingPiece, info.to.row);
        const placedPiece = promotion
            ? { type: promotion, color: movingPiece.color }
            : { ...movingPiece };

        working[info.to.row][info.to.col] = placedPiece;

        const capturedValue = capturedPiece
            ? (this.values[capturedPiece.type] ?? 0)
            : 0;
        const promotionGain = promotion
            ? (this.values[promotion] - this.values.p)
            : 0;

        const gains = [capturedValue + promotionGain];
        let occupant = placedPiece;
        let side = this.oppositeColor(movingPiece.color);
        let exchangeDepth = 0;

        // Repeatedly find the least valuable geometric attacker of the target.
        // Rebuilding the attack list after each capture naturally reveals x-rays.
        while (exchangeDepth < 30) {
            const attackers = this.getAttackers(
                working, info.to.row, info.to.col, side
            ).filter(item => item.type !== 'k');

            if (attackers.length === 0) break;

            attackers.sort((a, b) =>
                (this.values[a.type] ?? 0) - (this.values[b.type] ?? 0)
            );

            const attacker = attackers[0];
            exchangeDepth++;
            gains[exchangeDepth] =
                (this.values[occupant.type] ?? 0) - gains[exchangeDepth - 1];

            working[attacker.row][attacker.col] = null;
            occupant = {
                type: attacker.type,
                color: attacker.color
            };
            working[info.to.row][info.to.col] = occupant;
            side = this.oppositeColor(side);
        }

        // Both sides may decline an unfavorable continuation.
        for (let index = exchangeDepth; index > 0; index--) {
            gains[index - 1] = -Math.max(
                -gains[index - 1],
                gains[index]
            );
        }

        return gains[0] ?? 0;
    }

    // ================================================================
    // ATTACK MAP / KING LOCATIONS
    // ================================================================

    oppositeColor(color) {
        return color === 'w' ? 'b' : 'w';
    }

    isInsideBoard(row, col) {
        return Number.isInteger(row) && Number.isInteger(col) &&
            row >= 0 && row < 8 && col >= 0 && col < 8;
    }

    squareName(row, col) {
        if (!this.isInsideBoard(row, col)) return '??';
        return `${FILES[col]}${8 - row}`;
    }

    findKing(board, color) {
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (piece?.type === 'k' && piece.color === color) {
                    return { row, col };
                }
            }
        }
        return null;
    }

    isKingInCheck(board, color) {
        const king = this.findKing(board, color);
        if (!king) return true;
        return this.isSquareAttacked(
            board,
            king.row,
            king.col,
            this.oppositeColor(color)
        );
    }

    isSquareAttacked(board, row, col, byColor) {
        return this.getAttackers(board, row, col, byColor).length > 0;
    }

    getAttackers(board, targetRow, targetCol, color) {
        const attackers = [];

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (
                    piece &&
                    piece.color === color &&
                    this._pieceAttacksSquare(board, row, col, targetRow, targetCol)
                ) {
                    attackers.push({
                        row,
                        col,
                        type: piece.type,
                        color: piece.color
                    });
                }
            }
        }

        return attackers;
    }

    _pieceAttacksSquare(board, fromRow, fromCol, toRow, toCol) {
        const piece = board[fromRow]?.[fromCol];
        if (!piece || (fromRow === toRow && fromCol === toCol)) return false;

        const dr = toRow - fromRow;
        const dc = toCol - fromCol;
        const absRow = Math.abs(dr);
        const absCol = Math.abs(dc);

        switch (piece.type) {
            case 'p': {
                const direction = piece.color === 'w' ? -1 : 1;
                return dr === direction && absCol === 1;
            }
            case 'n':
                return (absRow === 2 && absCol === 1) ||
                    (absRow === 1 && absCol === 2);
            case 'k':
                return Math.max(absRow, absCol) === 1;
            case 'b':
                return absRow === absCol && absRow > 0 &&
                    this._isPathClear(board, fromRow, fromCol, toRow, toCol);
            case 'r':
                return ((dr === 0 && dc !== 0) || (dc === 0 && dr !== 0)) &&
                    this._isPathClear(board, fromRow, fromCol, toRow, toCol);
            case 'q':
                return (
                    (absRow === absCol && absRow > 0) ||
                    (dr === 0 && dc !== 0) ||
                    (dc === 0 && dr !== 0)
                ) && this._isPathClear(board, fromRow, fromCol, toRow, toCol);
            default:
                return false;
        }
    }

    _isPathClear(board, fromRow, fromCol, toRow, toCol) {
        const rowStep = Math.sign(toRow - fromRow);
        const colStep = Math.sign(toCol - fromCol);
        let row = fromRow + rowStep;
        let col = fromCol + colStep;

        while (row !== toRow || col !== toCol) {
            if (board[row][col] !== null) return false;
            row += rowStep;
            col += colStep;
        }

        return true;
    }

    // ================================================================
    // EVALUATION FACTORS: MATERIAL, DEVELOPMENT, KING SAFETY, TARGETS
    // ================================================================

    _materialFor(board, color) {
        let score = 0;
        for (const row of board) {
            for (const piece of row) {
                if (piece?.color === color) {
                    score += this.values[piece.type] ?? 0;
                }
            }
        }
        return score;
    }

    _developmentScore(board, color) {
        let score = 0;
        const homeRow = color === 'w' ? 7 : 0;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (!piece || piece.color !== color) continue;

                if (piece.type === 'n' || piece.type === 'b') {
                    const mobility = this._pieceMobility(board, row, col);
                    score += mobility * this.weights.mobility;

                    const originalKnightSquare = piece.type === 'n' &&
                        row === homeRow && (col === 1 || col === 6);
                    const originalBishopSquare = piece.type === 'b' &&
                        row === homeRow && (col === 2 || col === 5);

                    if (!originalKnightSquare && !originalBishopSquare) {
                        score += 16;
                    }

                    // Minor pieces are especially useful when occupying or
                    // controlling central squares.
                    if ((row === 3 || row === 4) && (col === 3 || col === 4)) {
                        score += 7;
                    }
                } else if (piece.type === 'r') {
                    score += this._pieceMobility(board, row, col) * 0.30;

                    let friendlyPawnOnFile = false;
                    let enemyPawnOnFile = false;

                    for (let scanRow = 0; scanRow < 8; scanRow++) {
                        const filePiece = board[scanRow][col];
                        if (filePiece?.type !== 'p') continue;
                        if (filePiece.color === color) friendlyPawnOnFile = true;
                        else enemyPawnOnFile = true;
                    }

                    if (!friendlyPawnOnFile) score += enemyPawnOnFile ? 7 : 14;
                } else if (piece.type === 'q') {
                    // Queen activity is rewarded gently so the evaluator
                    // does not encourage premature queen development.
                    score += this._pieceMobility(board, row, col) * 0.12;
                } else if (piece.type === 'p') {
                    const advancement = color === 'w' ? 6 - row : row - 1;
                    score += Math.max(0, advancement) * 1.5;

                    if ((row === 3 || row === 4) && (col === 3 || col === 4)) {
                        score += 5;
                    }
                }
            }
        }

        // Central-square control (d4, e4, d5, e5).
        const centerSquares = [
            [3, 3], [3, 4], [4, 3], [4, 4]
        ];

        for (const [row, col] of centerSquares) {
            const controllers = this.getAttackers(board, row, col, color);
            score += Math.min(controllers.length, 2) * 3;

            if (board[row][col]?.color === color) score += 4;
        }

        // A king on c/g home square is a useful proxy for castling.
        const king = this.findKing(board, color);
        if (king && king.row === homeRow && (king.col === 2 || king.col === 6)) {
            score += 18;
        }

        return score;
    }

    _pieceMobility(board, row, col) {
        const piece = board[row]?.[col];
        if (!piece || piece.type === 'k') return 0;

        let mobility = 0;

        if (piece.type === 'p') {
            const direction = piece.color === 'w' ? -1 : 1;
            const oneStep = row + direction;

            if (this.isInsideBoard(oneStep, col) && !board[oneStep][col]) {
                mobility++;
                const startingRow = piece.color === 'w' ? 6 : 1;
                const twoStep = row + direction * 2;
                if (
                    row === startingRow &&
                    this.isInsideBoard(twoStep, col) &&
                    !board[twoStep][col]
                ) {
                    mobility++;
                }
            }

            for (const dc of [-1, 1]) {
                const targetCol = col + dc;
                if (!this.isInsideBoard(oneStep, targetCol)) continue;
                const target = board[oneStep][targetCol];
                if (target && target.color !== piece.color) mobility++;
                else if (!target) mobility += 0.5; // Potential pawn control.
            }

            return mobility;
        }

        for (let targetRow = 0; targetRow < 8; targetRow++) {
            for (let targetCol = 0; targetCol < 8; targetCol++) {
                if (targetRow === row && targetCol === col) continue;
                const target = board[targetRow][targetCol];
                if (target?.color === piece.color) continue;

                if (this._pieceAttacksSquare(
                    board, row, col, targetRow, targetCol
                )) {
                    mobility++;
                }
            }
        }

        return mobility;
    }

    /**
     * Higher result means the given side's king is safer.
     * Includes pawn shield, friendly support and enemy king-zone pressure.
     */
    _kingSafetyScore(board, color) {
        const pressure = this._kingPressure(board, color);
        const support = this._kingSupport(board, color);

        // King support matters much more when the king is under real pressure.
        // This helps a defensive developing move outrank a small free pawn
        // opportunity when the king zone is becoming dangerous.
        const urgency = pressure >= 90 ? 3.5
            : pressure >= 45 ? 2.5
                : pressure >= 20 ? 1.5
                    : 1.0;

        return support * urgency - pressure;
    }

    _kingPressure(board, color) {
        const king = this.findKing(board, color);
        if (!king) return this.MATE_SCORE;

        const enemy = this.oppositeColor(color);
        let pressure = 0;

        if (this.isSquareAttacked(board, king.row, king.col, enemy)) {
            pressure += 200;
        }

        const uniqueAttackers = new Set();
        const attackWeights = { p: 7, n: 10, b: 10, r: 12, q: 15, k: 8 };

        for (let row = king.row - 1; row <= king.row + 1; row++) {
            for (let col = king.col - 1; col <= king.col + 1; col++) {
                if (!this.isInsideBoard(row, col)) continue;
                if (row === king.row && col === king.col) continue;

                const attackers = this.getAttackers(board, row, col, enemy);
                const defenders = this.getAttackers(board, row, col, color)
                    .filter(item => item.type !== 'k');

                for (const attacker of attackers) {
                    const id = `${attacker.row},${attacker.col}`;
                    uniqueAttackers.add(id);
                    pressure += attackWeights[attacker.type] ?? 8;
                }

                if (attackers.length > 0 && defenders.length === 0) {
                    pressure += 5;
                }
            }
        }

        // A concentrated attack by several different pieces is more serious
        // than repeated attacks by one piece on several adjacent squares.
        pressure += uniqueAttackers.size * 4;

        // Penalize missing pawns in the king's immediate shield while the
        // king remains on its home rank (or has moved only one rank forward).
        const homeRow = color === 'w' ? 7 : 0;
        if (king.row === homeRow || king.row === (color === 'w' ? 6 : 1)) {
            const shieldRow = king.row + (color === 'w' ? -1 : 1);
            for (let col = king.col - 1; col <= king.col + 1; col++) {
                if (!this.isInsideBoard(shieldRow, col)) continue;
                const shieldPiece = board[shieldRow][col];
                if (!(shieldPiece?.type === 'p' && shieldPiece.color === color)) {
                    pressure += 7;
                }
            }
        }

        return pressure;
    }

    _kingSupport(board, color) {
        const king = this.findKing(board, color);
        if (!king) return 0;

        let support = 0;

        // Count friendly pieces controlling the king's adjacent squares.
        // A single well-placed bishop/knight can support several squares.
        for (let row = king.row - 1; row <= king.row + 1; row++) {
            for (let col = king.col - 1; col <= king.col + 1; col++) {
                if (!this.isInsideBoard(row, col)) continue;
                if (row === king.row && col === king.col) continue;

                const defenders = this.getAttackers(board, row, col, color)
                    .filter(item => item.type !== 'k');
                support += Math.min(defenders.length, 2) * 8;
            }
        }

        // The pawn shield contributes additional, direct king protection.
        const homeRow = color === 'w' ? 7 : 0;
        if (king.row === homeRow || king.row === (color === 'w' ? 6 : 1)) {
            const shieldRow = king.row + (color === 'w' ? -1 : 1);
            for (let col = king.col - 1; col <= king.col + 1; col++) {
                if (!this.isInsideBoard(shieldRow, col)) continue;
                const shieldPiece = board[shieldRow][col];
                if (shieldPiece?.type === 'p' && shieldPiece.color === color) {
                    support += 12;
                }
            }
        }

        // A castled king usually has a more defensible position.
        if (king.row === homeRow && (king.col === 2 || king.col === 6)) {
            support += 18;
        }

        return support;
    }

    /** Returns the total target priority of this color's attacked pieces. */
    _vulnerabilityScore(board, color) {
        const attackerColor = this.oppositeColor(color);
        return this.analyzeTargets(board, attackerColor)
            .reduce((total, target) => total + target.priority, 0);
    }

    // ================================================================
    // MOVE NORMALIZATION / SIMULATION
    // ================================================================

    _normalizeMove(move) {
        if (typeof move === 'string') {
            const match = move.trim().match(/^([a-h][1-8])[-x]?([a-h][1-8])([qrbn])?$/i);
            if (!match) throw new Error(`Unsupported move string: ${move}`);
            return {
                from: this._parseSquare(match[1]),
                to: this._parseSquare(match[2]),
                promotion: match[3]?.toLowerCase() ?? null
            };
        }

        if (!move || typeof move !== 'object') {
            throw new Error('Move must be an object or coordinate string.');
        }

        const fromValue = move.from ?? move.start ?? move.source ??
            move.fromSquare ?? {
            row: move.fromRow ?? move.startRow,
            col: move.fromCol ?? move.startCol
        };
        const toValue = move.to ?? move.end ?? move.target ??
            move.toSquare ?? {
            row: move.toRow ?? move.endRow,
            col: move.toCol ?? move.endCol
        };

        const from = this._parseSquare(fromValue);
        const to = this._parseSquare(toValue);

        if (!from || !to) {
            console.log(move)
            throw new Error(`Could not read move coordinates: ${JSON.stringify(move)}`);
        }

        return { from, to, promotion: this._promotionFromMove(move) };
    }

    _parseSquare(square) {
        if (typeof square === 'string') {
            const match = square.trim().match(/^([a-h])([1-8])$/i);
            if (!match) return null;
            return {
                row: 8 - Number(match[2]),
                col: FILES.indexOf(match[1].toLowerCase())
            };
        }

        if (Number.isInteger(square)) {
            if (square < 0 || square > 63) return null;
            return { row: Math.floor(square / 8), col: square % 8 };
        }

        if (Array.isArray(square) && square.length >= 2) {
            return { row: Number(square[0]), col: Number(square[1]) };
        }

        if (!square || typeof square !== 'object') return null;

        if (typeof square.square === 'string') return this._parseSquare(square.square);

        if (square.file !== undefined && square.rank !== undefined) {
            const file = typeof square.file === 'string'
                ? FILES.indexOf(square.file.toLowerCase())
                : Number(square.file);
            const rank = Number(square.rank);
            if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
            return { row: 8 - rank, col: file };
        }

        if (square.row !== undefined && square.col !== undefined) {
            return { row: Number(square.row), col: Number(square.col) };
        }
        if (square.r !== undefined && square.c !== undefined) {
            return { row: Number(square.r), col: Number(square.c) };
        }
        if (square.x !== undefined && square.y !== undefined) {
            // Canvas-style coordinates: x is column, y is row.
            return { row: Number(square.y), col: Number(square.x) };
        }

        return null;
    }

    _promotionFromMove(move) {
        const raw = move.promotion ?? move.promoteTo ??
            move.promotionPiece ?? move.promotedTo ?? null;
        if (raw && typeof raw === 'object') {
            return String(raw.type ?? raw.piece ?? '').toLowerCase() || null;
        }
        return raw ? String(raw).toLowerCase() : null;
    }

    _promotionType(move, movingPiece, toRow) {
        if (movingPiece.type !== 'p') return null;
        const requested = this._promotionFromMove(move) ??
            (typeof move === 'string' ? this._normalizeMove(move).promotion : null);
        if (requested && ['q', 'r', 'b', 'n'].includes(requested)) return requested;

        const lastRank = movingPiece.color === 'w' ? 0 : 7;
        return toRow === lastRank ? 'q' : null;
    }

    _isEnPassantMove(board, info, movingPiece, enPassantSquare, move) {
        if (move?.enPassant === true || move?.isEnPassant === true) return true;
        if (movingPiece.type !== 'p') return false;
        if (info.from.col === info.to.col) return false;
        if (board[info.to.row][info.to.col]) return false;

        const ep = this._parseSquare(enPassantSquare);
        return Boolean(ep && ep.row === info.to.row && ep.col === info.to.col);
    }

    _applyMove(game, move) {
        const info = this._normalizeMove(move);
        const { from, to } = info;

        if (!this.isInsideBoard(from.row, from.col) || !this.isInsideBoard(to.row, to.col)) {
            throw new Error('Move coordinates are outside the chessboard.');
        }

        const movingPiece = game.board[from.row][from.col];
        if (!movingPiece) {
            throw new Error(`No piece on ${this.squareName(from.row, from.col)}.`);
        }

        const board = game.board;
        const capturedPiece = board[to.row][to.col];
        const enPassant = this._isEnPassantMove(
            board, info, movingPiece, game.enPassantSquare, move
        );

        const rights = game.castling ??= this._cloneValue(DEFAULT_CASTLING);

        // Update castling rights for king and rook moves, and rook captures.
        if (movingPiece.type === 'k') {
            rights[movingPiece.color].kingSide = false;
            rights[movingPiece.color].queenSide = false;
        }

        this._removeRookCastlingRight(rights, movingPiece, from.row, from.col);
        if (capturedPiece) {
            this._removeRookCastlingRight(
                rights, capturedPiece, to.row, to.col
            );
        } else if (enPassant) {
            const epCaptured = board[from.row][to.col];
            if (epCaptured) {
                this._removeRookCastlingRight(
                    rights, epCaptured, from.row, to.col
                );
            }
        }

        // Execute the piece move.
        board[from.row][from.col] = null;
        if (enPassant) board[from.row][to.col] = null;

        const promotion = this._promotionType(move, movingPiece, to.row);
        board[to.row][to.col] = promotion
            ? { type: promotion, color: movingPiece.color }
            : { ...movingPiece };

        // Castling: king moves two files; move the corresponding rook as well.
        if (movingPiece.type === 'k' && Math.abs(to.col - from.col) === 2) {
            const kingSide = to.col > from.col;
            const rookFromCol = kingSide ? 7 : 0;
            const rookToCol = kingSide ? 5 : 3;
            const rook = board[from.row][rookFromCol];

            if (rook?.type === 'r' && rook.color === movingPiece.color) {
                board[from.row][rookFromCol] = null;
                board[from.row][rookToCol] = { ...rook };
            }
        } else if (move?.rook?.from && move?.rook?.to) {
            const rookFrom = this._parseSquare(move.rook.from);
            const rookTo = this._parseSquare(move.rook.to);
            if (rookFrom && rookTo) {
                const rook = board[rookFrom.row][rookFrom.col];
                board[rookFrom.row][rookFrom.col] = null;
                board[rookTo.row][rookTo.col] = rook;
            }
        }

        // Set en-passant target only after a two-square pawn advance.
        if (movingPiece.type === 'p' && Math.abs(to.row - from.row) === 2) {
            game.enPassantSquare = {
                row: (from.row + to.row) / 2,
                col: from.col
            };
        } else {
            game.enPassantSquare = null;
        }

        // Keep optional clocks coherent when the supplied game tracks them.
        if ('halfMoveClock' in game) {
            game.halfMoveClock =
                movingPiece.type === 'p' || capturedPiece || enPassant
                    ? 0
                    : (game.halfMoveClock ?? 0) + 1;
        }
        if ('fullMoveNumber' in game && movingPiece.color === 'b') {
            game.fullMoveNumber = (game.fullMoveNumber ?? 1) + 1;
        }

        game.turn = this.oppositeColor(movingPiece.color);

        if (Array.isArray(game.history)) game.history.push(this._cloneValue(move));
        if (Array.isArray(game.moveHistoryNotation) && typeof move === 'string') {
            game.moveHistoryNotation.push(move);
        }

        // Update repetition tracking if this ChessGame implementation uses it.
        if (game.positionCounts instanceof Map) {
            const key = game.positionKey(game);
            game.positionCounts.set(key, (game.positionCounts.get(key) ?? 0) + 1);
        }

        return game;
    }

    _removeRookCastlingRight(rights, piece, row, col) {
        if (!piece || piece.type !== 'r') return;
        const homeRow = piece.color === 'w' ? 7 : 0;
        if (row !== homeRow) return;

        if (col === 0) rights[piece.color].queenSide = false;
        if (col === 7) rights[piece.color].kingSide = false;
    }

    cloneBoard(board) {
        return board.map(row => row.map(piece => piece ? { ...piece } : null));
    }

    cloneGame(game) {
        const cloned = new ChessGame();

        // Copy additional state without sharing mutable arrays, objects or Maps.
        for (const key of Object.keys(game)) {
            if (key === 'board') continue;
            cloned[key] = this._cloneValue(game[key]);
        }

        cloned.board = this.cloneBoard(game.board);
        cloned.turn = game.turn;
        cloned.castling = this._cloneValue(game.castling ?? DEFAULT_CASTLING);
        cloned.enPassantSquare = game.enPassantSquare
            ? this._cloneValue(game.enPassantSquare)
            : null;

        if (!(cloned.positionCounts instanceof Map)) {
            cloned.positionCounts = new Map();
        }

        return cloned;
    }

    _cloneValue(value) {
        if (value === null || typeof value !== 'object') return value;
        if (value instanceof Map) {
            return new Map([...value.entries()].map(([key, item]) => [
                this._cloneValue(key), this._cloneValue(item)
            ]));
        }
        if (value instanceof Set) {
            return new Set([...value].map(item => this._cloneValue(item)));
        }
        if (Array.isArray(value)) return value.map(item => this._cloneValue(item));

        const copy = {};
        for (const [key, item] of Object.entries(value)) {
            copy[key] = this._cloneValue(item);
        }
        return copy;
    }

    // ================================================================
    // MOVE ORDERING AND QUIESCENCE
    // ================================================================

    _orderMoves(game, moves) {
        return moves.map(move => {
            const info = this._normalizeMove(move);
            const movingPiece = game.board[info.from.row]?.[info.from.col];
            const capturedPiece = game.board[info.to.row]?.[info.to.col];
            const isEnPassant = movingPiece && this._isEnPassantMove(
                game.board,
                info,
                movingPiece,
                game.enPassantSquare,
                move
            );
            const isCapture = Boolean(capturedPiece || isEnPassant);
            const promotion = movingPiece
                ? this._promotionType(move, movingPiece, info.to.row)
                : null;

            const see = this.staticExchangeEvaluation(
                game.board, move, game.enPassantSquare
            );

            let orderScore = 0;
            if (isCapture) {
                orderScore += (see >= 0 ? 100000 : 50000) + see * 10;
            }
            if (promotion) orderScore += 80000 + (this.values[promotion] - this.values.p);

            return { move, orderScore, see };
        }).sort((a, b) => b.orderScore - a.orderScore);
    }

    _isCaptureMove(game, move) {
        const info = this._normalizeMove(move);
        const movingPiece = game.board[info.from.row]?.[info.from.col];
        if (!movingPiece) return false;

        return Boolean(
            game.board[info.to.row][info.to.col] ||
            this._isEnPassantMove(
                game.board, info, movingPiece, game.enPassantSquare, move
            )
        );
    }

    _isPromotionMove(game, move) {
        const info = this._normalizeMove(move);
        const movingPiece = game.board[info.from.row]?.[info.from.col];
        return Boolean(
            movingPiece &&
            movingPiece.type === 'p' &&
            (this._promotionFromMove(move) ||
                info.to.row === (movingPiece.color === 'w' ? 0 : 7))
        );
    }

    _quiescence(game, alpha, beta, ply, remaining) {
        this.nodes++;

        const terminalKingScore = this._missingKingScore(game.board, ply);
        if (terminalKingScore !== null) return terminalKingScore;

        const side = game.turn;
        const inCheck = this.isKingInCheck(game.board, side);
        const legalMoves = game.getAllLegalMoves(side);

        if (!Array.isArray(legalMoves) || legalMoves.length === 0) {
            if (inCheck) {
                return side === 'w'
                    ? -this.MATE_SCORE + ply
                    : this.MATE_SCORE - ply;
            }
            return 0;
        }

        if (game.isDraw(game)) return 0;

        const standPat = this.evaluate(game.board, 'w');

        // Avoid unbounded check extensions. At this emergency cap, use the
        // static score; the main search still handles checkmate at its nodes.
        if (remaining <= -2) return standPat;

        if (!inCheck) {
            if (side === 'w') {
                if (standPat >= beta) return beta;
                alpha = Math.max(alpha, standPat);
            } else {
                if (standPat <= alpha) return alpha;
                beta = Math.min(beta, standPat);
            }

            if (remaining <= 0) return standPat;
        }

        const candidateMoves = inCheck
            ? legalMoves
            : legalMoves.filter(move =>
                this._isCaptureMove(game, move) ||
                this._isPromotionMove(game, move)
            );

        if (candidateMoves.length === 0) return standPat;

        const orderedMoves = this._orderMoves(game, candidateMoves);

        if (side === 'w') {
            let best = inCheck ? -Infinity : standPat;

            for (const item of orderedMoves) {
                const child = this.cloneGame(game);
                this._applyMove(child, item.move);

                const score = this._quiescence(
                    child, alpha, beta, ply + 1, remaining - 1
                );

                best = Math.max(best, score);
                alpha = Math.max(alpha, best);
                if (alpha >= beta) break;
            }

            return best;
        }

        let best = inCheck ? Infinity : standPat;

        for (const item of orderedMoves) {
            const child = this.cloneGame(game);
            this._applyMove(child, item.move);

            const score = this._quiescence(
                child, alpha, beta, ply + 1, remaining - 1
            );

            best = Math.min(best, score);
            beta = Math.min(beta, best);
            if (alpha >= beta) break;
        }

        return best;
    }

    // ================================================================
    // TERMINAL POSITIONS / DRAW DETECTION
    // ================================================================

    _missingKingScore(board, ply) {
        const whiteKing = this.findKing(board, 'w');
        const blackKing = this.findKing(board, 'b');

        if (!whiteKing && !blackKing) return 0;
        if (!whiteKing) return -this.MATE_SCORE + ply;
        if (!blackKing) return this.MATE_SCORE - ply;
        return null;
    }

    _assertGame(game) {
        if (!game || !Array.isArray(game.board) || game.board.length !== 8) {
            throw new TypeError('findBestMove expects a ChessGame with an 8x8 board.');
        }
        if (game.turn !== 'w' && game.turn !== 'b') {
            throw new TypeError("game.turn must be 'w' or 'b'.");
        }
        if (typeof game.getAllLegalMoves !== 'function') {
            throw new TypeError('ChessGame must implement getAllLegalMoves(color).');
        }
    }

    _clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
}
