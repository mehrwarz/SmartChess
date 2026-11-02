export class ChessUI {
    constructor() {
        this.boardElement = document.getElementById('chess-board');
        this.statusElement = document.getElementById('game-status');
        this.historyListElement = document.getElementById('history-list');
        this.whiteTimerElement = document.getElementById('white-timer');
        this.blackTimerElement = document.getElementById('black-timer');
        this.blackLabelElement = document.getElementById('black-label');
        this.undoBtn = document.getElementById('undo-btn');
        this.startBtn = document.getElementById('start-btn');
        this.modeSelector = document.getElementById('game-mode');

        this.pieceSymbols = {
            w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
            b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
        };
    }

    renderBoard(board, selectedSquare = null, legalMoves = []) {
        this.boardElement.innerHTML = '';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const square = document.createElement('div');
                square.classList.add('square');
                square.classList.add((r + c) % 2 === 0 ? 'light' : 'dark');
                square.dataset.row = r;
                square.dataset.col = c;

                if (selectedSquare && selectedSquare.row === r && selectedSquare.col === c) {
                    square.classList.add('selected');
                }

                const moveMatch = legalMoves.find(m => m.row === r && m.col === c);
                if (moveMatch) {
                    if (moveMatch.capture || moveMatch.enPassant) {
                        square.classList.add('legal-capture');
                    } else {
                        square.classList.add('legal-move');
                    }
                }

                const piece = board[r][c];
                if (piece) {
                    const pieceSpan = document.createElement('span');
                    pieceSpan.classList.add('piece');
                    pieceSpan.textContent = this.pieceSymbols[piece.color][piece.type];
                    square.appendChild(pieceSpan);
                }

                this.boardElement.appendChild(square);
            }
        }
    }

    renderHistory(moveHistoryNotation) {
        this.historyListElement.innerHTML = '';
        for (let i = 0; i < moveHistoryNotation.length; i += 2) {
            const row = document.createElement('div');
            row.classList.add('history-row');

            const whiteMove = document.createElement('span');
            whiteMove.textContent = `${Math.floor(i / 2) + 1}. ${moveHistoryNotation[i]}`;
            row.appendChild(whiteMove);

            if (moveHistoryNotation[i + 1]) {
                const blackMove = document.createElement('span');
                blackMove.textContent = moveHistoryNotation[i + 1];
                row.appendChild(blackMove);
            }

            this.historyListElement.appendChild(row);
        }
        this.historyListElement.scrollTop = this.historyListElement.scrollHeight;
    }

    renderStatus(text) {
        this.statusElement.textContent = text;
    }

    renderTimers(whiteSeconds, blackSeconds) {
        this.whiteTimerElement.textContent = this.formatTime(whiteSeconds);
        this.blackTimerElement.textContent = this.formatTime(blackSeconds);
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    updateBlackLabel(mode) {
        this.blackLabelElement.textContent = mode === 'ai' ? 'Black (Brian AI)' : 'Black (Player 2)';
    }
}