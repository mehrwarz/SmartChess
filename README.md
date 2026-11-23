# Grandmaster Chess

Browser-based chess with a two-player mode, a training mode that evolves small neural
networks against each other, and a minimal Node static file server.

## Requirements

- Node.js 18 or newer (no dependencies to install)

## Run

```bash
npm start
```

Then open http://localhost:5500/.

`npm run dev` does the same with `node --watch`, restarting the server when files change.

The page uses ES modules, so it must be served over HTTP — opening `index.html` directly
from the filesystem will not load the game.

## Files

| File               | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `index.html`       | Page markup: board, move history, mode selector                 |
| `style.css`        | Board and layout styling                                        |
| `game.js`          | Entry point: game loop, mode handling, AI and training dispatch |
| `actions.js`       | Board state, legal move generation, notation, draw detection    |
| `ui.js`            | Board/history rendering and the promotion dialog                |
| `neuralNetwork.js` | Dense layers and a mutating network used by training mode       |
| `server.js`        | Static file server plus the brain save/load API on port 5500    |

## Modes

- **vs Computer** — play against the bot.
- **Two Player** — alternate moves on the same board.
- **Training Mode** — press *Train the model* to play out 1000 self-play games and keep the winner brain (see below).

## Training

Each press of *Train the model* plays 1000 games of up to 200 plies. Black holds
the current champion, loaded from disk or browser storage; white is a copy of it
nudged by **0.001** in both weights and biases.

The winner of each game takes the black seat for the next game, whether it won as
white or as black. Its brain, including weights and biases, is written to
`brains/black.json` immediately, and the next white challenger is a 0.001
mutation of that winner. Both seats keep learning during the game, so the winner
carries that game's learning into the next game as black. A game with no winner
(draw) keeps the current champion in the black seat and saves nothing; it only
nudges the next challenger's biases. The status line reports wins, draws, how
often white took the black seat, saves, and black's material per game.

A saved champion can also be dead rather than merely weak: if all four output
units are pinned at 0/1 and its opening prediction is an illegal move, no 0.001
mutation can ever change its play, and it repeats the same loss forever. That is
the state an older promotion loop left `brains/black.json` in.
Training detects it on the opening position, reports it in the status line, and
starts that run from a fresh network so evolution has something trainable to work
with.

If the page is served by a static-only server (VS Code Live Preview on port 5500,
for example), there is no `/api/brains` endpoint: the network is stored in the
browser's `localStorage` under `smartchess-brains` instead, and the status line says
so. `npm start` on a free port gives you file storage again.

Each finished run appends one row to `training-log.csv`:

    Training,black win,white win,draw,corrected,illegal move,empty square,repeated
    1,35,536,209,154,97,912,0

The four counters are the rejected network picks during that run: wrong-side
("corrected"), illegal, empty square and repeated. `GET /api/training-log`
returns the file. On a static-only server the rows are kept in the browser's
`localStorage` under `smartchess-training-log` instead.

Draws by repetition, the 75-move rule or stalemate are adjudicated on material, because
most games otherwise end with one side several pieces ahead while shuffling instead of
converting — that gives the selection loop a result instead of discarding a decided
game. A draw with less than a three-point gap stays a draw.

A drawn game produces no winner, so black keeps the seat. It only adds a
bias-only mutation to the next white challenger: 0.005 for the first draw,
growing by 0.005 per consecutive draw up to 0.1. Weights are left intact so the learned policy is
not dragged away, while the bias nudge is enough to break a deterministic shuffle.

Training is not mutation-only. Every position where a capture is available trains
the network by backpropagation toward the most valuable capture, through all layers.
That dense signal is what lets 1000 games change the policy at all; a game outcome
alone is too sparse to learn from.

Every prediction is checked against the live position. An empty from-square, an
opponent's piece, an unreachable destination, or a move that side has already
played twice is rejected: the network is forced to the nearest legal move and,
while training, backprops one step toward that move. A normal game never retrains the loaded brain.
The status line reports how many of each correction were applied.
The side-to-move flag (the last input) is validated
against the board on every prediction.
