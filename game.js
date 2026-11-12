import { ChessGame } from "./actions.js";
import { Bot } from "./bot.js";
import { ChessUI } from "./ui.js";
import { NeuralNetwork, Level } from "./neuralNetwork.js";

class GameManager {
    constructor() {
        this.game = new ChessGame();
        this.ui = new ChessUI();
        this.bot = new Bot();
        // this.levels = new Level(64,4)
        this.gameStarted = false;
        this.gameOver = false;
        this.gamePaused = false;
        this.selectedSquare = null;
        this.legalMoves = [];
        this.gameMode = "bot";
        this.whiteTime = 600;
        this.blackTime = 600;
        this.timerInterval = null;
        this.initListeners();
        this.ui.renderBoard(this.game.board);
        this.ui.updateBlackLabel(this.gameMode);
    }

    initListeners() {
        this.ui.boardElement.addEventListener("click", (e) =>
            this.handleBoardClick(e),
        );
        this.ui.startBtn.addEventListener("click", () => this.startGame());
        this.ui.pauseBtn.addEventListener("click", () => this.pauseGame());
        this.ui.undoBtn.addEventListener("click", () => this.undoMove());
        this.ui.newGame.addEventListener("click", () => this.newGame());
        this.ui.modeSelector.addEventListener("change", (e) => {
            this.gameMode = e.target.value;
            this.ui.updateBlackLabel(this.gameMode);
        });
        this.ui.pauseBtn.disabled = true;
    }


    newGame() {
        clearInterval(this.timerInterval);
        this.game.reset();
        this.gameStarted = false;
        this.gameOver = false;
        this.selectedSquare = null;
        this.ui.pauseBtn.disabled = true;
        this.legalMoves = [];
        this.whiteTime = 600;
        this.blackTime = 600;
        this.ui.startBtn.textContent = "Start Game";
        this.ui.startBtn.disabled = false;
        this.ui.modeSelector.disabled = false;
        this.ui.undoBtn.disabled = true;
        this.ui.renderTimers(this.whiteTime, this.blackTime);
        this.ui.renderBoard(this.game.board);
        this.ui.renderHistory(this.game.moveHistoryNotation);
        this.ui.renderStatus("Welcome! Click 'Start Game'");
    }

    startGame() {
        if (this.gameStarted) return;
        this.gameStarted = true;
        this.gameOver = false;
        this.ui.startBtn.textContent = "Game in Progress";
        this.ui.startBtn.disabled = true;
        this.ui.modeSelector.disabled = true;
        this.ui.renderStatus("White's turn");
        this.startTimers();
        this.ui.pauseBtn.disabled = false;
        if(this.gameMode === "train") this.makebotMove();

    }

    pauseGame() {
        this.gamePaused = !this.gamePaused;
        if(!this.gamePaused) {
            this.ui.pauseBtn.textContent = "Pause Game";

            console.log(this.gameMode === "bot", this.game.turn === "b", )
            if(this.gameMode === "bot" && this.game.turn === "b" || this.gameMode === "train" ) {
                this.makebotMove();
                console.log("Making move")
            }
            return
        }
        this.ui.pauseBtn.textContent = "Resume Game";
    }
    startTimers() {
        clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            if (this.gamePaused || this.gameOver || !this.gameStarted) return;
            if (this.game.turn === "w") {
                if (this.whiteTime > 0) this.whiteTime--;
                if (this.whiteTime === 0) {
                    this.endGame("Time out! Black wins!");
                }
            } else {
                if (this.blackTime > 0) this.blackTime--;
                if (this.blackTime === 0) {
                    this.endGame("Time out! White wins!");
                }
            }
            this.ui.renderTimers(this.whiteTime, this.blackTime); 
        }, 1000);
    }

    handleBoardClick(e) {
        if (!this.gameStarted || this.gameOver ) return;
        if (this.gameMode=== "train" || this.gameMode === "bot" && this.game.turn === "b") return;

        const squareEl = e.target.closest(".square");
        if (!squareEl) return;

        const row = parseInt(squareEl.dataset.row);
        const col = parseInt(squareEl.dataset.col);
        const clickedPiece = this.game.getPiece(row, col);

        if (this.selectedSquare) {
            const moveMatch = this.legalMoves.find(
                (m) => m.row === row && m.col === col,
            );
            if (moveMatch) {
                const fromRow = this.selectedSquare.row;
                const fromCol = this.selectedSquare.col;

                if (moveMatch.promotion) {
                    this.pendingPromotion = {
                        fromRow,
                        fromCol,
                        toRow: row,
                        toCol: col,
                    };

                    if (this.bot) {
                        const bestPiece = this.bot.findBestPromote(this.game, moveMatch, 3);

                        this.executeMove(
                            move.fromRow,
                            move.fromCol,
                            move.toRow,
                            move.toCol,
                            bestPiece,
                        );
                    }
                    showPromotionDialog(this.game.turn, (piece) => {
                        const move = this.pendingPromotion;
                        if (!move) return;

                        this.pendingPromotion = null;
                        hidePromotionDialog();
                        this.executeMove(
                            move.fromRow,
                            move.fromCol,
                            move.toRow,
                            move.toCol,
                            piece,
                        );
                        this.selectedSquare = null;
                        this.legalMoves = [];
                        this.ui.renderBoard(this.game.board);
                    });
                    return;
                }

                this.executeMove(fromRow, fromCol, row, col);
                this.selectedSquare = null;
                this.legalMoves = [];
            } else if (clickedPiece && clickedPiece.color === this.game.turn) {
                this.selectedSquare = { row, col };
                this.legalMoves = this.game.getLegalMoves(row, col);
            } else {
                this.selectedSquare = null;
                this.legalMoves = [];
            }
        } else {
            if (clickedPiece && clickedPiece.color === this.game.turn) {
                this.selectedSquare = { row, col };
                this.legalMoves = this.game.getLegalMoves(row, col);
            }
        }

        this.ui.renderBoard(this.game.board, this.selectedSquare, this.legalMoves);
    }

    executeMove(fromRow, fromCol, toRow, toCol, promotionPiece = "q") {
        if(this.gameOver || this.gamePaused) return
        
        const validPieces = ["q", "r", "b", "n"];
        
        if (!validPieces.includes(promotionPiece)) promotionPiece = "q";
        if (this.game.makeMove(fromRow, fromCol, toRow, toCol, promotionPiece)) {
            const drawResult = this.game.isDraw(this.game);

            if (drawResult) {
                this.gameOver = true;
                // Display the draw result in your game UI.
                this.ui.renderStatus(drawResult.message);
                return;
            }

            this.ui.renderBoard(this.game.board);
            this.ui.renderHistory(this.game.moveHistoryNotation);
            this.ui.undoBtn.disabled = false;

            const currTurn = this.game.turn;            

            if (this.game.isCheckmate(currTurn)) {
                const winner = currTurn === "w" ? "Black" : "White";
                this.endGame(`Checkmate! ${winner} wins!`);
                return;
            } else if (this.game.isStalemate(currTurn)) {
                this.endGame("Stalemate! It's a draw.");
                return;
            } else if (this.game.isInCheck(currTurn)) {
                this.ui.renderStatus(
                    `${currTurn === "w" ? "White" : "Black"}'s turn - Check!`,
                );
            } else {
                this.ui.renderStatus(
                    `${currTurn === "w" ? "White's turn" : this.gameMode === "bot" ? "Brian AI's turn..." : "Black's turn"}`,
                );
            }

            if (this.gameMode === "train") {
                setTimeout(() => this.makebotMove(), 1500);
            }
            
            if (this.gameMode === "bot" && this.game.turn === "b") {
                setTimeout(() => this.makebotMove(), 1000);
            }
        }
    }

    makebotMove() {
        if (this.gameOver || this.gamePaused ) return;
        const botMove = this.bot.findBestMove(this.game, 2);

        if (botMove) {
            this.executeMove(
                botMove.fromRow,
                botMove.fromCol,
                botMove.toRow,
                botMove.toCol,
                botMove.promotion,
            );
        }
    }

    undoMove() {
        if (this.game.history.length === 0 || !this.gameStarted || this.gameOver) return;

        const steps = this.gameMode === "bot" ? 2 : 1;

        for (let i = 0; i < steps; i++) {
            if (this.game.history.length > 0) {
                this.game.undo();
            }
        }

        this.selectedSquare = null;
        this.legalMoves = [];
        this.ui.renderBoard(this.game.board);
        this.ui.renderHistory(this.game.moveHistoryNotation);
        if (this.game.history.length === 0) {
            this.ui.undoBtn.disabled = true;
        }
        const currTurn =
            this.game.turn === "w"
                ? "White's turn"
                : this.gameMode === "bot"
                    ? "Brian AI's turn..."
                    : "Black's turn";
        this.ui.renderStatus(currTurn);
    }

    endGame(message) {
        this.gameOver = true;
        clearInterval(this.timerInterval);
        this.ui.renderStatus(message);
        this.ui.undoBtn.disabled = true;
    }
}

window.addEventListener("DOMContentLoaded", () => {
    new GameManager();
});

function showPromotionDialog(color, onSelect) { this.ui.renderDiaglog(color, onSelect);}
function hidePromotionDialog() { document.getElementById("promotion-modal")?.remove();}
