import { ChessGame } from "./actions.js";
import { GameBrian } from "./brian.js";
import { ChessUI } from "./ui.js";

class GameManager {
  constructor() {
    this.game = new ChessGame();
    this.ui = new ChessUI();
    this.ai = new GameBrian();

    this.gameStarted = false;
    this.gameOver = false;
    this.selectedSquare = null;
    this.legalMoves = [];

    this.gameMode = "ai";
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
    document
      .getElementById("new-btn")
      .addEventListener("click", () => this.newGame());
    this.ui.undoBtn.addEventListener("click", () => this.undoMove());
    this.ui.modeSelector.addEventListener("change", (e) => {
      this.gameMode = e.target.value;
      this.ui.updateBlackLabel(this.gameMode);
    });
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
  }

  newGame() {
    clearInterval(this.timerInterval);
    this.game.reset();
    this.gameStarted = false;
    this.gameOver = false;
    this.selectedSquare = null;
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

  startTimers() {
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.gameOver || !this.gameStarted) return;

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
    if (!this.gameStarted || this.gameOver) return;
    if (this.gameMode === "ai" && this.game.turn === "b") return;

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

          if(this.ai){
            const bestPiece = this.ai.findBestPromote(this.game, moveMatch, 3 );
            
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
    const validPieces = ["q", "r", "b", "n"];

    if (!validPieces.includes(promotionPiece)) {
      promotionPiece = "q";
    }
    const success = this.game.makeMove(
      fromRow,
      fromCol,
      toRow,
      toCol,
      promotionPiece,
    );

    if (!success) return;

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
        `${currTurn === "w" ? "White's turn" : this.gameMode === "ai" ? "Brian AI's turn..." : "Black's turn"}`,
      );
    }

    if (this.gameMode === "ai" && this.game.turn === "b" && !this.gameOver) {
      setTimeout(() => this.makeAIMove(), 400);
    }
  }

  makeAIMove() {
    if (this.gameOver) return;
    const aiMove = this.ai.findBestMove(this.game, 2);
    if (aiMove) {
      this.executeMove(
        aiMove.fromRow,
        aiMove.fromCol,
        aiMove.toRow,
        aiMove.toCol,
        aiMove.promotion,
      );
    }
  }

  undoMove() {
    if (this.game.history.length === 0 || !this.gameStarted || this.gameOver)
      return;

    const steps = this.gameMode === "ai" ? 2 : 1;
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
        : this.gameMode === "ai"
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

function showPromotionDialog(color, onSelect) {
  const piecesOption =
    color === "w"
      ? [
          { type: "q", icon: "♕", name: "Queen" },
          { type: "r", icon: "♖", name: "Rook" },
          { type: "b", icon: "♗", name: "Bishop" },
          { type: "n", icon: "♘", name: "Knight" },
        ]
      : [
          { type: "q", icon: "♛", name: "Queen" },
          { type: "r", icon: "♜", name: "Rook" },
          { type: "b", icon: "♝", name: "Bishop" },
          { type: "n", icon: "♞", name: "Knight" },
        ];

  const modal = document.createElement("div");
  modal.id = "promotion-modal";
  modal.className = "promotion-overlay";

  modal.innerHTML = `
            <style>
                .promotion-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                }

                .promotion-dialog {
                    background: #fff;
                    padding: 25px;
                    border-radius: 12px;
                    text-align: center;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                }

                .promotion-dialog h3 {
                    margin: 0 0 20px;
                    color: #222;
                }

                .promotion-options {
                    display: flex;
                    gap: 12px;
                }

                .promotion-piece {
                    width: 75px;
                    height: 90px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    background: #f7f7f7;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 5px;
                }

                .promotion-piece:hover {
                    background: #e5e5e5;
                    border-color: #888;
                }

                .promotion-piece span {
                    font-size: 42px;
                    line-height: 1;
                }

                .promotion-piece small {
                    font-size: 12px;
                    color: #333;
                }
            </style>
            <div class="promotion-dialog">
                <h3>Choose Your Promotion</h3>
                <div class="promotion-options">
                    ${piecesOption
                      .map(
                        (piece) => `
                        <button
                            class="promotion-piece"
                            data-piece="${piece.type}"
                            aria-label="Promote to ${piece.name}"
                            title="${piece.name}"
                        >
                            <span>${piece.icon}</span>
                            <small>${piece.name}</small>
                        </button>
                    `,
                      )
                      .join("")}
                </div>
            </div>
        `;

  modal.querySelectorAll(".promotion-piece").forEach((button) => {
    button.addEventListener("click", () => {
      onSelect(button.dataset.piece);
      hidePromotionDialog();
    });
  });
  document.body.appendChild(modal);
}

function hidePromotionDialog() {
  document.getElementById("promotion-modal")?.remove();
}
