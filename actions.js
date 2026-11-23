const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

const KNIGHT_OFFSETS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_OFFSETS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ORTHOGONAL_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAGONAL_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

const INITIAL_RANK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

const isOnBoard = (row, col) => row >= 0 && row < 8 && col >= 0 && col < 8;

export class Actions {
    constructor() {
        this.reset();
    }

    reset() {
        this.board = Array.from({ length: 8 }, (_, row) => {
            if (row > 1 && row < 6) return Array(8).fill(null);

            const color = row < 2 ? 'b' : 'w';
            const pawnRow = row === 1 || row === 6;

            return Array.from({ length: 8 }, (_, col) => ({
                type: pawnRow ? 'p' : INITIAL_RANK[col],
                color
            }));
        });

        this.turn = 'w';
        this.castling = {
            w: { kingSide: true, queenSide: true },
            b: { kingSide: true, queenSide: true }
        };
        this.enPassantSquare = null;
        this.halfMoveClock = 0;
        this.history = [];
        this.moveHistoryNotation = [];
        this.positionCounts = new Map([[this.getPositionKey(), 1]]);
    }

    getPositionKey(board = this.board, turn = this.turn, castling = this.castling, enPassant = this.enPassantSquare) {
        const parts = new Array(68);

        let index = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                parts[index++] = piece ? piece.color + piece.type : '--';
            }
        }

        const castlingStr =
            (castling?.w?.kingSide ? 'K' : '') +
            (castling?.w?.queenSide ? 'Q' : '') +
            (castling?.b?.kingSide ? 'k' : '') +
            (castling?.b?.queenSide ? 'q' : '');

        parts[index++] = turn;
        parts[index++] = castlingStr;
        parts[index] = enPassant ? `${enPassant.row},${enPassant.col}` : '-';

        return parts.join('');
    }

    getPiece(row, col) {
        if (!isOnBoard(row, col)) return null;
        return this.board[row][col];
    }

    cloneBoard() {
        return this.board.map(row => row.map(piece => (piece ? { ...piece } : null)));
    }

    getLegalMoves(row, col) {
        const piece = this.getPiece(row, col);
        if (!piece || piece.color !== this.turn) return [];

        const pseudoMoves = this.getPseudoLegalMoves(row, col, this.board, this.castling, this.enPassantSquare);
        const legalMoves = [];

        for (const move of pseudoMoves) {
            if (!this.moveLeavesKingInCheck(row, col, move)) legalMoves.push(move);
        }

        return legalMoves;
    }

    // Tests a candidate move by playing it in place and rewinding, which avoids
    // cloning the whole board for every pseudo-legal move.
    moveLeavesKingInCheck(fromRow, fromCol, move) {
        const board = this.board;
        const piece = board[fromRow][fromCol];
        const captured = board[move.row][move.col];

        const enPassantRow = move.enPassant ? (piece.color === 'w' ? move.row + 1 : move.row - 1) : -1;
        const enPassantCaptured = enPassantRow === -1 ? null : board[enPassantRow][move.col];

        if (enPassantRow !== -1) board[enPassantRow][move.col] = null;
        board[move.row][move.col] = piece;
        board[fromRow][fromCol] = null;

        const inCheck = this.isInCheck(piece.color);

        board[fromRow][fromCol] = piece;
        board[move.row][move.col] = captured;
        if (enPassantRow !== -1) board[enPassantRow][move.col] = enPassantCaptured;

        return inCheck;
    }

    getPseudoLegalMoves(row, col, board, castling, enPassantSquare) {
        const piece = board[row][col];
        if (!piece) return [];

        const moves = [];
        const color = piece.color;
        const oppColor = color === 'w' ? 'b' : 'w';

        const addMove = (r, c, special = {}) => {
            if (!isOnBoard(r, c)) return;

            const target = board[r][c];
            if (!target) {
                moves.push({ row: r, col: c, ...special });
            } else if (target.color !== color) {
                moves.push({ row: r, col: c, capture: true, ...special });
            }
        };

        if (piece.type === 'p') {
            const dir = color === 'w' ? -1 : 1;
            const startRow = color === 'w' ? 6 : 1;

            const r1 = row + dir;
            if (isOnBoard(r1, col) && !board[r1][col]) {
                moves.push({ row: r1, col: col, promotion: (color === 'w' && r1 === 0) || (color === 'b' && r1 === 7) });

                const r2 = row + 2 * dir;
                if (row === startRow && !board[r2][col]) {
                    moves.push({ row: r2, col: col });
                }
            }

            for (const dc of [-1, 1]) {
                const nc = col + dc;
                if (!isOnBoard(r1, nc)) continue;

                const target = board[r1][nc];
                const isPromo = (color === 'w' && r1 === 0) || (color === 'b' && r1 === 7);

                if (target && target.color === oppColor) {
                    moves.push({ row: r1, col: nc, capture: true, promotion: isPromo });
                }
                if (enPassantSquare && enPassantSquare.row === r1 && enPassantSquare.col === nc) {
                    moves.push({ row: r1, col: nc, enPassant: true });
                }
            }
        } else if (piece.type === 'n') {
            for (const [dr, dc] of KNIGHT_OFFSETS) addMove(row + dr, col + dc);
        } else if (piece.type === 'b' || piece.type === 'r' || piece.type === 'q') {
            const dirs = [];
            if (piece.type === 'b' || piece.type === 'q') dirs.push(...DIAGONAL_DIRS);
            if (piece.type === 'r' || piece.type === 'q') dirs.push(...ORTHOGONAL_DIRS);

            for (const [dr, dc] of dirs) {
                let r = row + dr;
                let c = col + dc;

                while (isOnBoard(r, c)) {
                    const target = board[r][c];

                    if (!target) {
                        moves.push({ row: r, col: c });
                    } else {
                        if (target.color !== color) moves.push({ row: r, col: c, capture: true });
                        break;
                    }

                    r += dr;
                    c += dc;
                }
            }
        } else if (piece.type === 'k') {
            for (const [dr, dc] of KING_OFFSETS) addMove(row + dr, col + dc);

            if (castling && castling[color]) {
                const homeRow = color === 'w' ? 7 : 0;

                if (row === homeRow && col === 4) {
                    if (castling[color].kingSide && !board[homeRow][5] && !board[homeRow][6]) {
                        if (!this.isSquareAttacked(homeRow, 4, oppColor, board) &&
                            !this.isSquareAttacked(homeRow, 5, oppColor, board) &&
                            !this.isSquareAttacked(homeRow, 6, oppColor, board)) {
                            moves.push({ row: homeRow, col: 6, castling: 'k' });
                        }
                    }
                    if (castling[color].queenSide && !board[homeRow][3] && !board[homeRow][2] && !board[homeRow][1]) {
                        if (!this.isSquareAttacked(homeRow, 4, oppColor, board) &&
                            !this.isSquareAttacked(homeRow, 3, oppColor, board) &&
                            !this.isSquareAttacked(homeRow, 2, oppColor, board)) {
                            moves.push({ row: homeRow, col: 2, castling: 'q' });
                        }
                    }
                }
            }
        }

        return moves;
    }

    // Direct ray/offset inspection instead of generating every pseudo-legal move
    // of every enemy piece, which used to allocate thousands of move objects per call.
    isSquareAttacked(row, col, attackerColor, board = this.board) {
        const pawnRow = attackerColor === 'w' ? row + 1 : row - 1;

        for (const dc of [-1, 1]) {
            if (!isOnBoard(pawnRow, col + dc)) continue;
            const piece = board[pawnRow][col + dc];
            if (piece && piece.color === attackerColor && piece.type === 'p') return true;
        }

        for (const [dr, dc] of KNIGHT_OFFSETS) {
            const r = row + dr;
            const c = col + dc;
            if (!isOnBoard(r, c)) continue;

            const piece = board[r][c];
            if (piece && piece.color === attackerColor && piece.type === 'n') return true;
        }

        for (const [dr, dc] of KING_OFFSETS) {
            const r = row + dr;
            const c = col + dc;
            if (!isOnBoard(r, c)) continue;

            const piece = board[r][c];
            if (piece && piece.color === attackerColor && piece.type === 'k') return true;
        }

        for (const [dr, dc] of ORTHOGONAL_DIRS) {
            let r = row + dr;
            let c = col + dc;

            while (isOnBoard(r, c)) {
                const piece = board[r][c];
                if (piece) {
                    if (piece.color === attackerColor && (piece.type === 'r' || piece.type === 'q')) return true;
                    break;
                }
                r += dr;
                c += dc;
            }
        }

        for (const [dr, dc] of DIAGONAL_DIRS) {
            let r = row + dr;
            let c = col + dc;

            while (isOnBoard(r, c)) {
                const piece = board[r][c];
                if (piece) {
                    if (piece.color === attackerColor && (piece.type === 'b' || piece.type === 'q')) return true;
                    break;
                }
                r += dr;
                c += dc;
            }
        }

        return false;
    }

    findKing(color, board = this.board) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (piece && piece.type === 'k' && piece.color === color) {
                    return { row: r, col: c };
                }
            }
        }
        return null;
    }

    isInCheck(color, board = this.board) {
        const kingPos = this.findKing(color, board);
        if (!kingPos) return false;

        return this.isSquareAttacked(kingPos.row, kingPos.col, color === 'w' ? 'b' : 'w', board);
    }

    makeMove(fromRow, fromCol, toRow, toCol, promotionPiece = 'q') {
        const piece = this.getPiece(fromRow, fromCol);
        if (!piece || piece.color !== this.turn) return false;

        const moveInfo = this.getLegalMoves(fromRow, fromCol).find(m => m.row === toRow && m.col === toCol);
        if (!moveInfo) return false;

        const capturedPiece = this.board[toRow][toCol];
        const isPawnMove = piece.type === 'p';
        const isCapture = Boolean(capturedPiece) || Boolean(moveInfo.enPassant);

        // Snapshot only what undo needs; the old code also copied the whole
        // repetition Map on every single move.
        const prevState = {
            board: this.cloneBoard(),
            turn: this.turn,
            castling: {
                w: { ...this.castling.w },
                b: { ...this.castling.b }
            },
            enPassantSquare: this.enPassantSquare ? { ...this.enPassantSquare } : null,
            halfMoveClock: this.halfMoveClock,
            moveHistoryNotation: [...this.moveHistoryNotation],
            addedPositionKey: null
        };
        this.history.push(prevState);

        // Capturing a rook on its original square removes its castling right.
        if (capturedPiece?.type === 'r') {
            if (capturedPiece.color === 'w') {
                if (toRow === 7 && toCol === 0) this.castling.w.queenSide = false;
                if (toRow === 7 && toCol === 7) this.castling.w.kingSide = false;
            } else {
                if (toRow === 0 && toCol === 0) this.castling.b.queenSide = false;
                if (toRow === 0 && toCol === 7) this.castling.b.kingSide = false;
            }
        }

        let notation = this.getAlgebraicNotation(fromRow, fromCol, toRow, toCol, piece, capturedPiece, moveInfo);

        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = null;

        if (moveInfo.castling) {
            if (moveInfo.castling === 'k') {
                this.board[toRow][5] = this.board[toRow][7];
                this.board[toRow][7] = null;
            } else {
                this.board[toRow][3] = this.board[toRow][0];
                this.board[toRow][0] = null;
            }
        }

        if (moveInfo.enPassant) {
            this.board[piece.color === 'w' ? toRow + 1 : toRow - 1][toCol] = null;
        }

        if (isPawnMove && Math.abs(fromRow - toRow) === 2) {
            this.enPassantSquare = { row: (fromRow + toRow) / 2, col: toCol };
        } else {
            this.enPassantSquare = null;
        }

        if (moveInfo.promotion) {
            piece.type = promotionPiece;
            notation += `=${promotionPiece.toUpperCase()}`;
        }

        if (piece.type === 'k') {
            this.castling[piece.color].kingSide = false;
            this.castling[piece.color].queenSide = false;
        }
        if (piece.type === 'r') {
            if (fromRow === 7 && fromCol === 0) this.castling.w.queenSide = false;
            if (fromRow === 7 && fromCol === 7) this.castling.w.kingSide = false;
            if (fromRow === 0 && fromCol === 0) this.castling.b.queenSide = false;
            if (fromRow === 0 && fromCol === 7) this.castling.b.kingSide = false;
        }

        this.halfMoveClock = isPawnMove || isCapture ? 0 : this.halfMoveClock + 1;
        this.turn = this.turn === 'w' ? 'b' : 'w';

        const newKey = this.getPositionKey();
        this.positionCounts.set(newKey, (this.positionCounts.get(newKey) || 0) + 1);
        prevState.addedPositionKey = newKey;

        if (this.isInCheck(this.turn)) {
            notation += this.hasNoLegalMoves(this.turn) ? '#' : '+';
        }

        this.moveHistoryNotation.push(notation);
        return true;
    }

    undo() {
        if (this.history.length === 0) return false;

        const prevState = this.history.pop();

        if (prevState.addedPositionKey) {
            const count = this.positionCounts.get(prevState.addedPositionKey) || 0;
            if (count <= 1) {
                this.positionCounts.delete(prevState.addedPositionKey);
            } else {
                this.positionCounts.set(prevState.addedPositionKey, count - 1);
            }
        }

        this.board = prevState.board;
        this.turn = prevState.turn;
        this.castling = prevState.castling;
        this.enPassantSquare = prevState.enPassantSquare;
        this.halfMoveClock = prevState.halfMoveClock;
        this.moveHistoryNotation = prevState.moveHistoryNotation;
        return true;
    }

    // --- Repetition & Game Status Checks ---

    getCurrentPositionRepetitionCount() {
        return this.positionCounts.get(this.getPositionKey()) || 1;
    }

    isCheckmate(color) {
        return this.isInCheck(color) && this.hasNoLegalMoves(color);
    }

    isStalemate(color) {
        return !this.isInCheck(color) && this.hasNoLegalMoves(color);
    }

    hasNoLegalMoves(color) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && piece.color === color && this.getLegalMoves(r, c).length > 0) return false;
            }
        }
        return true;
    }

    // One pass to describe the position for the UI: game over, check, and why.
    getGameState() {
        const color = this.turn;
        const check = this.isInCheck(color);

        if (this.hasNoLegalMoves(color)) {
            return {
                over: true,
                check,
                message: check
                    ? `Checkmate! ${color === 'w' ? 'Black' : 'White'} wins!`
                    : "Stalemate! It's a draw.",
                repetition: false
            };
        }

        // Callers that recover from a repetition loop need to tell this draw
        // apart from the permanent ones (75-move, insufficient material).
        const repetition = this.getCurrentPositionRepetitionCount() >= 5;
        const draw = this.isDraw();
        if (draw) return { over: true, check, message: draw, repetition };

        return { over: false, check, message: null, repetition: false };
    }

    isDraw() {
        // Automatic 75-move rule.
        if (this.halfMoveClock >= 150) return 'Draw by the 75-move rule.';

        // Automatic fivefold repetition.
        if (this.getCurrentPositionRepetitionCount() >= 5) return 'Draw by fivefold repetition.';

        // Insufficient mating material.
        if (this.isInsufficientMaterial(this.board)) return 'Draw by insufficient material.';

        return null;
    }

    isInsufficientMaterial(board) {
        const nonKings = [];

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (!piece || piece.type === 'k') continue;

                // Any pawn, rook or queen means mating material may exist.
                if (piece.type === 'p' || piece.type === 'r' || piece.type === 'q') return false;

                nonKings.push({ type: piece.type, row, col });
            }
        }

        if (nonKings.length === 0) return true; // K vs K.
        if (nonKings.length === 1) return true; // K+B vs K or K+N vs K.

        // Bishops only: if every bishop is on the same square colour,
        // checkmate is impossible.
        if (nonKings.every(piece => piece.type === 'b')) {
            const squareColors = new Set(nonKings.map(piece => (piece.row + piece.col) % 2));
            if (squareColors.size === 1) return true;
        }

        return false;
    }

    getAlgebraicNotation(fromRow, fromCol, toRow, toCol, piece, captured, moveInfo) {
        if (moveInfo.castling === 'k') return 'O-O';
        if (moveInfo.castling === 'q') return 'O-O-O';

        const pSymbol = piece.type === 'p' ? '' : piece.type.toUpperCase();
        const captureStr = captured || moveInfo.enPassant
            ? (piece.type === 'p' ? FILES[fromCol] + 'x' : 'x')
            : '';

        return `${pSymbol}${captureStr}${FILES[toCol]}${RANKS[toRow]}`;
    }

    getAllLegalMoves(color) {
        const allMoves = [];

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (!piece || piece.color !== color) continue;

                for (const move of this.getLegalMoves(r, c)) {
                    allMoves.push({
                        fromRow: r,
                        fromCol: c,
                        toRow: move.row,
                        toCol: move.col,
                        promotion: move.promotion,
                        castling: move.castling,
                        enPassant: move.enPassant
                    });
                }
            }
        }

        return allMoves;
    }
}
