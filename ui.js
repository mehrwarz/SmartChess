export class ChessUI {
    constructor() {
        this.boardElement = document.getElementById('chess-board');
        this.statusElement = document.getElementById('game-status');
        this.historyListElement = document.getElementById('history-list');
        this.trainBtn = document.getElementById('train-btn');
        this.updateBtn = document.getElementById('update-btn');
        this.modeSelector = document.getElementById('game-mode');

        this.pieceSymbols = {
            w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
            b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
        };
    }

    renderBoard(board, selectedSquare = null, legalMoves = []) {
        const movesBySquare = new Map(legalMoves.map(move => [move.row * 8 + move.col, move]));
        const fragment = document.createDocumentFragment();

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = (row + col) % 2 === 0 ? 'square light' : 'square dark';
                square.dataset.row = row;
                square.dataset.col = col;

                if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) {
                    square.classList.add('selected');
                }

                const move = movesBySquare.get(row * 8 + col);
                if (move) {
                    square.classList.add(move.capture || move.enPassant ? 'legal-capture' : 'legal-move');
                }

                const piece = board[row][col];
                if (piece) {
                    const pieceSpan = document.createElement('span');
                    pieceSpan.className = 'piece';
                    pieceSpan.textContent = this.pieceSymbols[piece.color][piece.type];
                    if(piece.color === "w") pieceSpan.style.color = "#bd5b06"
                    square.appendChild(pieceSpan);
                }

                fragment.appendChild(square);
            }
        }

        this.boardElement.replaceChildren(fragment);
    }

    renderHistory(moveHistoryNotation) {
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < moveHistoryNotation.length; i += 2) {
            const row = document.createElement('div');
            row.className = 'history-row';

            const whiteMove = document.createElement('span');
            whiteMove.textContent = `${Math.floor(i / 2) + 1}. ${moveHistoryNotation[i]}`;
            row.appendChild(whiteMove);

            if (moveHistoryNotation[i + 1]) {
                const blackMove = document.createElement('span');
                blackMove.textContent = moveHistoryNotation[i + 1];
                row.appendChild(blackMove);
            }

            fragment.appendChild(row);
        }

        this.historyListElement.replaceChildren(fragment);
        this.historyListElement.scrollTop = this.historyListElement.scrollHeight;
    }

    renderStatus(text) {
        this.statusElement.textContent = text;
    }

    renderDialog(color, onSelect) {
        this.hideDialog();

        const pieceNames = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
        const symbolFor = piece => this.pieceSymbols[color][piece];

        const modal = document.createElement('div');
        modal.id = 'promotion-modal';
        modal.className = 'promotion-overlay';
        modal.innerHTML = `
            <div class="promotion-dialog">
                <h3>Choose Your Promotion</h3>
                <div class="promotion-options">
                    ${['q', 'r', 'b', 'n'].map(piece => `
                        <button
                            class="promotion-piece"
                            data-piece="${piece}"
                            aria-label="Promote to ${pieceNames[piece]}"
                            title="${pieceNames[piece]}"
                        >
                            <span>${symbolFor(piece)}</span>
                            <small>${pieceNames[piece]}</small>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;

        // One delegated listener instead of one per button.
        modal.addEventListener('click', event => {
            const button = event.target.closest('.promotion-piece');
            if (!button) return;

            this.hideDialog();
            onSelect(button.dataset.piece);
        });

        document.body.appendChild(modal);
    }

    hideDialog() {
        document.getElementById('promotion-modal')?.remove();
    }
}
