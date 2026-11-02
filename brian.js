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
    }

    evaluate(board) {
        let score = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (!piece) continue;
                let val = this.values[piece.type];
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
                return maximizing ? -100000 : 100000;
            }
            return 0;
        }

        if (maximizing) {
            let maxEval = -Infinity;
            for (const move of allMoves) {
                const tempGame = this.cloneGame(game);
                tempGame.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol, 'q');
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