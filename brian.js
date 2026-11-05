import { ChessGame } from './actions.js';

export class BrianAI {
    constructor() {
        this.values = {
            p: 100,
            n: 320,
            b: 330,
            r: 500,
            q: 900,
            k: 20000
        };

        this.piecesTable = {
            p: [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [50, 50, 50, 50, 50, 50, 50, 50],
                [10, 10, 20, 30, 30, 20, 10, 10],
                [5, 5, 10, 25, 25, 10, 5, 5],
                [0, 0, 0, 20, 20, 0, 0, 0],
                [5, -5, -10, 0, 0, -10, -5, 5],
                [5, 10, 10, -20, -20, 10, 10, 5],
                [0, 0, 0, 0, 0, 0, 0, 0]
            ],

            n: [
                [-50, -40, -30, -30, -30, -30, -40, -50],
                [-40, -20, 0, 5, 5, 0, -20, -40],
                [-30, 0, 10, 15, 15, 10, 0, -30],
                [-30, 5, 15, 20, 20, 15, 5, -30],
                [-30, 0, 15, 20, 20, 15, 0, -30],
                [-30, 5, 10, 15, 15, 10, 5, -30],
                [-40, -20, 0, 0, 0, 0, -20, -40],
                [-50, -40, -30, -30, -30, -30, -40, -50]
            ],

            r: [
                [0, 0, 5, 10, 10, 5, 0, 0],
                [5, 10, 10, 10, 10, 10, 10, 5],
                [-5, 0, 0, 0, 0, 0, 0, -5],
                [-5, 0, 0, 0, 0, 0, 0, -5],
                [-5, 0, 0, 0, 0, 0, 0, -5],
                [-5, 0, 0, 0, 0, 0, 0, -5],
                [-5, 0, 0, 0, 0, 0, 0, -5],
                [0, 0, 5, 10, 10, 5, 0, 0]
            ],

            b: [
                [-20, -10, -10, -10, -10, -10, -10, -20],
                [-10, 5, 0, 0, 0, 0, 5, -10],
                [-10, 10, 10, 10, 10, 10, 10, -10],
                [-10, 0, 10, 10, 10, 10, 0, -10],
                [-10, 5, 5, 10, 10, 5, 5, -10],
                [-10, 0, 5, 10, 10, 5, 0, -10],
                [-10, 0, 0, 0, 0, 0, 0, -10],
                [-20, -10, -10, -10, -10, -10, -10, -20]
            ],

            q: [
                [-20, -10, -10, -5, -5, -10, -10, -20],
                [-10, 0, 0, 0, 0, 0, 0, -10],
                [-10, 0, 5, 5, 5, 5, 0, -10],
                [-5, 0, 5, 5, 5, 5, 0, -5],
                [0, 0, 5, 5, 5, 5, 0, -5],
                [-10, 5, 5, 5, 5, 5, 0, -10],
                [-10, 0, 5, 0, 0, 0, 0, -10],
                [-20, -10, -10, -5, -5, -10, -10, -20]
            ],

            k: [
                [-30, -40, -40, -50, -50, -40, -40, -30],
                [-30, -40, -40, -50, -50, -40, -40, -30],
                [-30, -40, -40, -50, -50, -40, -40, -30],
                [-30, -40, -40, -50, -50, -40, -40, -30],
                [-20, -30, -30, -40, -40, -30, -30, -20],
                [-10, -20, -20, -20, -20, -20, -20, -10],
                [20, 20, 0, 0, 0, 0, 20, 20],
                [20, 30, 10, 0, 0, 10, 30, 20]
            ]
        }

    }

    evaluate(board) {
        let score = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (!piece) continue;

                let val = this.values[piece.type];
                const row = piece.color === 'w' ? r : 7 - r;

                // Add positional bonuses (invert table for black pieces)
                // if (piece.type === 'n') {
                //     row = piece.color === 'w' ? r : 7 - r;
                // }
                val += this.piecesTable[piece.type][row][c];

                score += piece.color === 'w' ? val : -val;
            }
        }
        return score;
    }

    findBestMove(game, depth = 2) {
        const color = game.turn;
        const maximizing = color === 'w';
        const allMoves = game.getAllLegalMoves(color);
        if (allMoves.length === 0) return null;

        let bestMove = allMoves[0];
        let bestValue = maximizing ? -Infinity : Infinity;

        for (const move of allMoves) {
            const tempGame = this.cloneGame(game);
            tempGame.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol, 'q');

            const value = this.minimax(tempGame, depth - 1, -Infinity, Infinity, !maximizing);

            if (maximizing) {
                if (value > bestValue) {
                    bestValue = value;
                    bestMove = move;
                }
            } else {
                if (value < bestValue) {
                    bestValue = value;
                    bestMove = move;
                }
            }
        }

        return bestMove;
    }

    minimax(game, depth, alpha, beta, maximizing) {
        if (depth === 0) {
            return this.evaluate(game.board);
        }

        const color = game.turn;
        const allMoves = game.getAllLegalMoves(color);

        if (allMoves.length === 0) {
            if (game.isInCheck(color)) {
                return maximizing ? -100000 - depth : 100000 + depth;
            }
            return 0;
        }

        if (maximizing) {
            let maxEval = -Infinity;
            for (const move of allMoves) {
                const tempGame = this.cloneGame(game);
                const promotion = move.promotion || 'q';
                tempGame.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol, promotion);
                const evaluation = this.minimax(tempGame, depth - 1, alpha, beta, false);
                maxEval = Math.max(maxEval, evaluation);
                alpha = Math.max(alpha, evaluation);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of allMoves) {
                const tempGame = this.cloneGame(game);
                tempGame.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol, 'q');
                const evaluation = this.minimax(tempGame, depth - 1, alpha, beta, true);
                minEval = Math.min(minEval, evaluation);
                beta = Math.min(beta, evaluation);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    cloneGame(game) {
        const cloned = new ChessGame();
        cloned.board = game.cloneBoard();
        cloned.turn = game.turn;
        cloned.castling = JSON.parse(JSON.stringify(game.castling));
        cloned.enPassantSquare = game.enPassantSquare ? { ...game.enPassantSquare } : null;
        return cloned;
    }
}