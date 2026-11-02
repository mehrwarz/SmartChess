export class ChessGame {
    constructor() {
        this.reset();
    }

    reset() {
        this.board = [
            [
                { type: 'r', color: 'b' }, { type: 'n', color: 'b' }, { type: 'b', color: 'b' }, { type: 'q', color: 'b' },
                { type: 'k', color: 'b' }, { type: 'b', color: 'b' }, { type: 'n', color: 'b' }, { type: 'r', color: 'b' }
            ],
            [
                { type: 'p', color: 'b' }, { type: 'p', color: 'b' }, { type: 'p', color: 'b' }, { type: 'p', color: 'b' },
                { type: 'p', color: 'b' }, { type: 'p', color: 'b' }, { type: 'p', color: 'b' }, { type: 'p', color: 'b' }
            ],
            Array(8).fill(null),
            Array(8).fill(null),
            Array(8).fill(null),
            Array(8).fill(null),
            [
                { type: 'p', color: 'w' }, { type: 'p', color: 'w' }, { type: 'p', color: 'w' }, { type: 'p', color: 'w' },
                { type: 'p', color: 'w' }, { type: 'p', color: 'w' }, { type: 'p', color: 'w' }, { type: 'p', color: 'w' }
            ],
            [
                { type: 'r', color: 'w' }, { type: 'n', color: 'w' }, { type: 'b', color: 'w' }, { type: 'q', color: 'w' },
                { type: 'k', color: 'w' }, { type: 'b', color: 'w' }, { type: 'n', color: 'w' }, { type: 'r', color: 'w' }
            ]
        ];

        this.turn = 'w';
        this.castling = {
            w: { kingSide: true, queenSide: true },
            b: { kingSide: true, queenSide: true }
        };
        this.enPassantSquare = null;
        this.history = [];
        this.moveHistoryNotation = [];
    }

    getPiece(row, col) {
        if (row < 0 || row > 7 || col < 0 || col > 7) return null;
        return this.board[row][col];
    }

    cloneBoard() {
        return this.board.map(row => row.map(piece => piece ? { ...piece } : null));
    }

    getLegalMoves(row, col) {
        const piece = this.getPiece(row, col);
        if (!piece || piece.color !== this.turn) return [];

        const pseudoMoves = this.getPseudoLegalMoves(row, col, this.board, this.castling, this.enPassantSquare);
        const legalMoves = [];
        for (const move of pseudoMoves) {
            if (!this.resultsInCheck(row, col, move.row, move.col)) {
                legalMoves.push(move);
            }
        }
        return legalMoves;
    }

    getPseudoLegalMoves(row, col, board, castling, enPassantSquare) {
        const piece = board[row][col];
        if (!piece) return [];
        const moves = [];
        const color = piece.color;
        const oppColor = color === 'w' ? 'b' : 'w';

        const addMove = (r, c, special = {}) => {
            if (r >= 0 && r < 8 && c >= 0 && c < 8) {
                const target = board[r][c];
                if (!target) {
                    moves.push({ row: r, col: c, ...special });
                } else if (target.color !== color) {
                    moves.push({ row: r, col: c, capture: true, ...special });
                }
            }
        };

        if (piece.type === 'p') {
            const dir = color === 'w' ? -1 : 1;
            const startRow = color === 'w' ? 6 : 1;
            
            const r1 = row + dir;
            if (r1 >= 0 && r1 < 8 && !board[r1][col]) {
                const isPromo = (color === 'w' && r1 === 0) || (color === 'b' && r1 === 7);
                moves.push({ row: r1, col: col, promotion: isPromo });

                const r2 = row + 2 * dir;
                if (row === startRow && !board[r2][col]) {
                    moves.push({ row: r2, col: col });
                }
            }

            for (const dc of [-1, 1]) {
                const nc = col + dc;
                if (r1 >= 0 && r1 < 8 && nc >= 0 && nc < 8) {
                    const target = board[r1][nc];
                    const isPromo = (color === 'w' && r1 === 0) || (color === 'b' && r1 === 7);
                    if (target && target.color === oppColor) {
                        moves.push({ row: r1, col: nc, capture: true, promotion: isPromo });
                    }
                    if (enPassantSquare && enPassantSquare.row === r1 && enPassantSquare.col === nc) {
                        moves.push({ row: r1, col: nc, enPassant: true });
                    }
                }
            }
        } else if (piece.type === 'n') {
            const knightMoves = [
                [-2, -1], [-2, 1], [-1, -2], [-1, 2],
                [1, -2], [1, 2], [2, -1], [2, 1]
            ];
            for (const [dr, dc] of knightMoves) {
                addMove(row + dr, col + dc);
            }
        } else if (piece.type === 'b' || piece.type === 'r' || piece.type === 'q') {
            const dirs = [];
            if (piece.type === 'b' || piece.type === 'q') dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
            if (piece.type === 'r' || piece.type === 'q') dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);

            for (const [dr, dc] of dirs) {
                let r = row + dr;
                let c = col + dc;
                while (r >= 0 && r < 8 && c >= 0 && c < 8) {
                    const target = board[r][c];
                    if (!target) {
                        moves.push({ row: r, col: c });
                    } else {
                        if (target.color !== color) {
                            moves.push({ row: r, col: c, capture: true });
                        }
                        break;
                    }
                    r += dr;
                    c += dc;
                }
            }
        } else if (piece.type === 'k') {
            const kingMoves = [
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1], [0, 1],
                [1, -1], [1, 0], [1, 1]
            ];
            for (const [dr, dc] of kingMoves) {
                addMove(row + dr, col + dc);
            }

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

    isSquareAttacked(r, c, attackerColor, board) {
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (piece && piece.color === attackerColor) {
                    if (piece.type === 'k') {
                        if (Math.abs(row - r) <= 1 && Math.abs(col - c) <= 1) return true;
                    } else {
                        const moves = this.getPseudoLegalMoves(row, col, board, null, null);
                        if (moves.some(m => m.row === r && m.col === c)) return true;
                    }
                }
            }
        }
        return false;
    }

    findKing(color, board) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p && p.type === 'k' && p.color === color) {
                    return { row: r, col: c };
                }
            }
        }
        return null;
    }

    isInCheck(color, board = this.board) {
        const kingPos = this.findKing(color, board);
        if (!kingPos) return false;
        const oppColor = color === 'w' ? 'b' : 'w';
        return this.isSquareAttacked(kingPos.row, kingPos.col, oppColor, board);
    }

    resultsInCheck(fromRow, fromCol, toRow, toCol) {
        const tempBoard = this.cloneBoard();
        const piece = tempBoard[fromRow][fromCol];
        tempBoard[toRow][toCol] = piece;
        tempBoard[fromRow][fromCol] = null;

        if (piece.type === 'p' && this.enPassantSquare && toRow === this.enPassantSquare.row && toCol === this.enPassantSquare.col) {
            const capRow = piece.color === 'w' ? toRow + 1 : toRow - 1;
            tempBoard[capRow][toCol] = null;
        }

        return this.isInCheck(piece.color, tempBoard);
    }

    makeMove(fromRow, fromCol, toRow, toCol, promotionPiece = 'q') {
        const piece = this.getPiece(fromRow, fromCol);
        if (!piece) return false;

        const legalMoves = this.getLegalMoves(fromRow, fromCol);
        const moveInfo = legalMoves.find(m => m.row === toRow && m.col === toCol);
        if (!moveInfo) return false;

        const prevState = {
            board: this.cloneBoard(),
            turn: this.turn,
            castling: JSON.parse(JSON.stringify(this.castling)),
            enPassantSquare: this.enPassantSquare ? { ...this.enPassantSquare } : null,
            moveHistoryNotation: [...this.moveHistoryNotation]
        };
        this.history.push(prevState);

        const capturedPiece = this.board[toRow][toCol];
        let notation = this.getAlgebraicNotation(fromRow, fromCol, toRow, toCol, piece, capturedPiece, moveInfo);

        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = null;

        if (moveInfo.castling) {
            if (moveInfo.castling === 'k') {
                const rookRow = toRow;
                this.board[rookRow][5] = this.board[rookRow][7];
                this.board[rookRow][7] = null;
            } else if (moveInfo.castling === 'q') {
                const rookRow = toRow;
                this.board[rookRow][3] = this.board[rookRow][0];
                this.board[rookRow][0] = null;
            }
        }

        if (moveInfo.enPassant) {
            const capRow = piece.color === 'w' ? toRow + 1 : toRow - 1;
            this.board[capRow][toCol] = null;
        }

        if (piece.type === 'p' && Math.abs(fromRow - toRow) === 2) {
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

        this.turn = this.turn === 'w' ? 'b' : 'w';

        const oppColor = this.turn;
        if (this.isInCheck(oppColor)) {
            if (this.isCheckmate(oppColor)) {
                notation += '#';
            } else {
                notation += '+';
            }
        }

        this.moveHistoryNotation.push(notation);
        return true;
    }

    undo() {
        if (this.history.length === 0) return false;
        const prevState = this.history.pop();
        this.board = prevState.board;
        this.turn = prevState.turn;
        this.castling = prevState.castling;
        this.enPassantSquare = prevState.enPassantSquare;
        this.moveHistoryNotation = prevState.moveHistoryNotation;
        return true;
    }

    isCheckmate(color) {
        if (!this.isInCheck(color)) return false;
        return this.hasNoLegalMoves(color);
    }

    isStalemate(color) {
        if (this.isInCheck(color)) return false;
        return this.hasNoLegalMoves(color);
    }

    hasNoLegalMoves(color) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && piece.color === color) {
                    const moves = this.getLegalMoves(r, c);
                    if (moves.length > 0) return false;
                }
            }
        }
        return true;
    }

    getAlgebraicNotation(fromRow, fromCol, toRow, toCol, piece, captured, moveInfo) {
        if (moveInfo.castling === 'k') return 'O-O';
        if (moveInfo.castling === 'q') return 'O-O-O';

        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

        const pSymbol = piece.type === 'p' ? '' : piece.type.toUpperCase();
        const captureStr = (captured || moveInfo.enPassant) ? (piece.type === 'p' ? files[fromCol] + 'x' : 'x') : '';
        const destStr = files[toCol] + ranks[toRow];

        return `${pSymbol}${captureStr}${destStr}`;
    }

    getAllLegalMoves(color) {
        const allMoves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && p.color === color) {
                    const moves = this.getLegalMoves(r, c);
                    for (const m of moves) {
                        allMoves.push({ fromRow: r, fromCol: c, toRow: m.row, toCol: m.col, promotion: m.promotion, castling: m.castling, enPassant: m.enPassant });
                    }
                }
            }
        }
        return allMoves;
    }
}