import { Actions } from "./actions.js";
import { ChessUI } from "./ui.js";
import { NeuralNetwork } from "./neuralNetwork.js";

const NET_SHAPE = [277, 114, 54, 4];
const INPUT_SIZE = 277; // 64 squares * 4 bits, plus feature flags
const SIDE_TO_MOVE_INDEX = INPUT_SIZE - 1;
const MAX_TRAINING_PLIES = 200;

// One press of "Train the model" plays this many games. Black always holds the
// current champion; white is its challenger. The winner of each game takes
// the black seat for the next game, whichever colour it won with.
const TRAINING_CYCLES = 1000;
// How far a challenger drifts from the champion before each game.
const WHITE_MUTATION_RATE = 0.0025;
// A draw means white is still following the same drawing line. Each drawn
// game nudges the next challenger's biases further from the champion, up to a
// cap, so repeated 23-ply repetitions eventually become decisive games.
const DRAW_BIAS_RATE = 0.0001;
const MAX_DRAW_DRIFT = 0.001;
// Learning signal for positions where a better capture is available. Kept
// small, because the champion trains across thousands of positions and an
// aggressive rate saturates the sigmoid outputs.
const CAPTURE_LEARNING_RATE = 0.005;
const CORRECTION_LEARNING_RATE = 0.0002;
// Empty-square guesses are the bulk of rejected predictions; learning them at
// full rate drowns the capture signal with noise.
const EMPTY_SQUARE_LEARNING_RATE = 0.00055;
const PROGRESS_EVERY = 10;

const BOT_DELAY_MS = 150;
const PROMOTION_PIECES = new Set(["q", "r", "b", "n"]);

// Material values used to decide whether a game produced a winner.
const PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 20 });
// One pawn is not a result; require a piece's worth of material to call a win.
const WINNING_MARGIN = 3;
const BRAIN_ARCHIVE_ENDPOINT = "/api/brains/archive";
const BRAIN_ARCHIVE_KEY = "smartchess-brain-archive";
const BRAIN_ENDPOINT = "/api/brains";
const BRAIN_STORAGE_KEY = "smartchess-brains";
const TRAINING_LOG_ENDPOINT = "/api/training-log";
const TRAINING_LOG_KEY = "smartchess-training-log";
const TRAINING_LOG_HEADER =
  "Training,black win,white win,draw,corrected,illegal move,empty square,repeated";
const TRAINING_LOG_COLUMNS = TRAINING_LOG_HEADER.split(",").length;

// 4-bit signature per piece. Kept identical to the original encoding so
// inputs stay compatible with earlier training runs.
const PIECE_CODES = Object.freeze({
  wp: [0, 0, 0, 1],
  wn: [0, 0, 1, 0],
  wb: [0, 0, 1, 1],
  wr: [0, 1, 0, 0],
  wq: [0, 1, 0, 1],
  wk: [0, 1, 1, 0],
  bp: [1, 0, 0, 1],
  bn: [1, 0, 1, 0],
  bb: [1, 0, 1, 1],
  br: [1, 1, 0, 0],
  bq: [1, 1, 0, 1],
  bk: [1, 1, 1, 0],
});

const squareKey = (move) =>
  `${move.fromRow}${move.fromCol}${move.toRow}${move.toCol}`;

// Encodes the live position on demand instead of keeping a hand-built board
// snapshot that went stale as soon as a piece moved. The final element is the
// side to move (1 = white), which chooseNetworkMove validates against the board.
function encodeBoard(board, turn) {
  const inputs = new Uint8Array(INPUT_SIZE);

  let offset = 0;
  for (let row = 0; row < 8; row++) {
    const rowPieces = board[row];

    for (let col = 0; col < 8; col++) {
      const piece = rowPieces[col];
      if (piece) inputs.set(PIECE_CODES[piece.color + piece.type], offset);
      offset += 4;
    }
  }

  inputs[SIDE_TO_MOVE_INDEX] = turn === "w" ? 1 : 0;
  return inputs;
}

// A saturated output layer pins every coordinate at 0 or 7. The old training
// runs could leave the saved champion in that state: it then played the same
// illegal move regardless of tiny mutations, which is why black lost every game.
// Detect it before training and start from a trainable network instead.
function isSaturatedChampion(network) {
  const probe = new Actions();
  const inputs = encodeBoard(probe.board, "w");
  const raw = network.predictRaw(inputs);
  if (!raw.every(Number.isFinite)) return true;

  const saturated = raw.filter(
    (value) => value < 0.001 || value > 0.999,
  ).length;
  if (saturated < 3) return false;

  const [fromRow, fromCol, toRow, toCol] = network.predict(inputs);
  const piece = probe.getPiece(fromRow, fromCol);
  if (!piece || piece.color !== "w") return true;

  return !probe
    .getLegalMoves(fromRow, fromCol)
    .some((move) => move.row === toRow && move.col === toCol);
}

// The page is often served by a plain static server (VS Code's Live Preview on
// port 5500, for example), which answers /api/brains/... with index.html or 405.
// In that case brains are kept in browser storage instead, so training still
// persists between reloads. Running `npm start` restores file storage.
let brainStorage = "server";
let trainingLogStorage = "server";

function readBrowserBrains() {
  if (typeof localStorage === "undefined") return {};

  try {
    return JSON.parse(localStorage.getItem(BRAIN_STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function writeBrowserBrain(color, payload) {
  if (typeof localStorage === "undefined") return false;

  try {
    const brains = readBrowserBrains();
    brains[color] = payload;
    localStorage.setItem(BRAIN_STORAGE_KEY, JSON.stringify(brains));
    return true;
  } catch (error) {
    console.warn(`Could not store the ${color} brain in the browser:`, error);
    return false;
  }
}

function loadBrowserBrain(color) {
  const payload = readBrowserBrains()[color];
  if (!payload) return null;

  try {
    return NeuralNetwork.fromJSON(payload);
  } catch (error) {
    console.warn(`Ignoring the stored ${color} brain:`, error);
    return null;
  }
}

async function loadBrainFile(color) {
  if (brainStorage === "browser") return loadBrowserBrain(color);

  try {
    const response = await fetch(`${BRAIN_ENDPOINT}/${color}`);
    const contentType = response.headers?.get?.("content-type") ?? "";

    // Our own server answers a missing brain with a JSON 404, which just means
    // nothing has been saved for that side yet.
    if (response.status === 404 && contentType.includes("json")) return null;

    // An HTML 404, HTML 200 or 405 means there is no brain API behind this URL.
    if (!response.ok || !contentType.includes("json")) {
      console.info(
        `No brain file API at ${BRAIN_ENDPOINT}; using browser storage.`,
      );
      brainStorage = "browser";
      return loadBrowserBrain(color);
    }

    return NeuralNetwork.fromJSON(await response.json());
  } catch (error) {
    console.info(`Brain file API unreachable, using browser storage:`, error);
    brainStorage = "browser";
    return loadBrowserBrain(color);
  }
}

async function saveBrainFile(color, brain) {
  const payload = brain.toJSON();

  if (brainStorage === "browser") {
    return writeBrowserBrain(color, payload) ? "browser" : null;
  }

  try {
    const response = await fetch(`${BRAIN_ENDPOINT}/${color}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return "file";
  } catch (error) {
    console.info(
      `Cannot write brains/${color}.json here, keeping it in browser storage:`,
      error,
    );
    brainStorage = "browser";
    return writeBrowserBrain(color, payload) ? "browser" : null;
  }
}

async function archiveBrain(brain, games, score) {
  // Create an independent snapshot of the champion.
  const snapshot = {
    timestamp: new Date().toISOString(),
    games,
    score,
    brain: JSON.parse(JSON.stringify(brain.toJSON())),
  };

  // Static-server fallback: append to browser storage.
  const appendToBrowser = () => {
    if (typeof localStorage === "undefined") return false;

    try {
      const archive = JSON.parse(
        localStorage.getItem(BRAIN_ARCHIVE_KEY) ?? "[]",
      );

      archive.push(snapshot);

      localStorage.setItem(BRAIN_ARCHIVE_KEY, JSON.stringify(archive));

      return true;
    } catch (error) {
      console.warn("Could not archive champion:", error);
      return false;
    }
  };

  if (brainStorage === "browser") {
    return appendToBrowser() ? "browser" : null;
  }

  try {
    const response = await fetch(BRAIN_ARCHIVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return "file";
  } catch (error) {
    console.warn("Could not append to brains/archive.json:", error);

    brainStorage = "browser";
    return appendToBrowser() ? "browser" : null;
  }
}

// Training history is one CSV row per finished run:
//   Training,black win,white win,draw,corrected,illegal move,empty square,repeated
//   1,35,536,209,154,97,912,0
// The server appends to training-log.csv; a static-only server falls back to
// browser storage, just like the brains.
// Earlier logs only had four columns. Pad their rows with zeroes so the
// browser copy keeps one consistent header.
function normalizeTrainingLog(csv) {
  const lines = String(csv ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length === 0) return `${TRAINING_LOG_HEADER}\n`;

  if (lines[0].trim() !== TRAINING_LOG_HEADER) {
    lines[0] = TRAINING_LOG_HEADER;
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",");
      while (cells.length < TRAINING_LOG_COLUMNS) cells.push("0");
      lines[i] = cells.slice(0, TRAINING_LOG_COLUMNS).join(",");
    }
  }

  return `${lines.join("\n")}\n`;
}

function readBrowserTrainingLog() {
  if (typeof localStorage === "undefined") return `${TRAINING_LOG_HEADER}\n`;

  try {
    return normalizeTrainingLog(localStorage.getItem(TRAINING_LOG_KEY));
  } catch {
    return `${TRAINING_LOG_HEADER}\n`;
  }
}

function countTrainingSessions(csv) {
  return Math.max(
    0,
    csv.split(/\r?\n/).filter((line) => line.trim()).length - 1,
  );
}

function trainingLogCounters(stats) {
  return {
    corrected: stats?.["wrong-side"] ?? 0,
    illegal: stats?.["illegal-move"] ?? 0,
    empty: stats?.["empty-square"] ?? 0,
    repeated: stats?.["repeated-move"] ?? 0,
  };
}

function appendBrowserTrainingLog(black, white, draws, counters) {
  if (typeof localStorage === "undefined") return null;

  try {
    const csv = readBrowserTrainingLog();
    const session = countTrainingSessions(csv) + 1;
    const row =
      `${session},${black},${white},${draws},` +
      `${counters.corrected},${counters.illegal},${counters.empty},${counters.repeated}\n`;

    localStorage.setItem(
      TRAINING_LOG_KEY,
      csv.endsWith("\n") ? csv + row : `${csv}\n${row}`,
    );
    return session;
  } catch (error) {
    console.warn("Could not store the training log in the browser:", error);
    return null;
  }
}

async function logTrainingSession(black, white, draws, stats) {
  const counters = trainingLogCounters(stats);

  if (trainingLogStorage === "browser") {
    const session = appendBrowserTrainingLog(black, white, draws, counters);
    return session ? { storage: "browser", session } : null;
  }

  try {
    const response = await fetch(TRAINING_LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ black, white, draws, ...counters }),
    });
    const contentType = response.headers?.get?.("content-type") ?? "";

    if (!response.ok || !contentType.includes("json")) {
      throw new Error(`HTTP ${response.status} ${contentType}`.trim());
    }

    const data = await response.json();
    if (!Number.isInteger(data.session))
      throw new Error("The log API returned no session number.");

    return { storage: "file", session: data.session };
  } catch (error) {
    console.info(
      "Cannot write training-log.csv here, keeping it in browser storage:",
      error,
    );
    trainingLogStorage = "browser";
    const session = appendBrowserTrainingLog(black, white, draws, counters);
    return session ? { storage: "browser", session } : null;
  }
}

export class GameManager {
  constructor() {
    this.actions = new Actions();
    this.ui = new ChessUI();

    this.gameMode = this.ui.modeSelector?.value ?? "bot";
    this.selectedSquare = null;
    this.legalMoves = [];
    this.gameOver = false;
    this.training = false;
    this.trainingStats = null;
    this.botTimer = null;

    // Both seats keep their network across games so a trained brain can be
    // saved to disk and reloaded next time instead of starting over.
    this.brains = { w: null, b: null };
    this.brainsReady = this.loadBrains();

    this.ui.boardElement.addEventListener("click", (event) =>
      this.handleBoardClick(event),
    );
    this.ui.modeSelector?.addEventListener("change", (event) => {
      this.gameMode = event.target.value;
      this.startNewGame();
    });
    this.ui.trainBtn.addEventListener("click", () => this.startTraining());
    this.ui.updateBtn.addEventListener("click", () => this.alterBases());
    this.startNewGame();
  }

  async loadBrains() {
    const [white, black] = await Promise.all([
      loadBrainFile("white"),
      loadBrainFile("black"),
    ]);

    this.brains.w = white;
    this.brains.b = black;

    const loaded = [white && "white", black && "black"].filter(Boolean);
    if (loaded.length === 0) return;

    console.info(`Loaded saved brain(s): ${loaded.join(", ")}.`);

    if (
      !this.training &&
      !this.gameOver &&
      this.actions.moveHistoryNotation.length === 0
    ) {
      this.ui.renderStatus(
        `White to move - loaded ${loaded.join(" + ")} brain.`,
      );
    }
  }

  getBrain(color) {
    const key = color === "b" ? "b" : "w";

    if (!this.brains[key]) {
      // Seed the second seat from its partner, so a reloaded brain gives
      // the opponent a learned baseline instead of random noise.
      const partner = this.brains[key === "w" ? "b" : "w"];
      this.brains[key] = partner
        ? new NeuralNetwork(NET_SHAPE).mutate(partner, 0.01)
        : new NeuralNetwork(NET_SHAPE);
    }

    return this.brains[key];
  }

  startNewGame() {
    clearTimeout(this.botTimer);

    this.actions.reset();
    this.gameOver = false;
    this.training = false;
    this.selectedSquare = null;
    this.legalMoves = [];

    this.ui.renderBoard(this.actions.board);
    this.ui.renderHistory(this.actions.moveHistoryNotation);
    this.ui.renderStatus(
      this.gameMode === "train"
        ? "Training mode - press 'Train the model'."
        : "White to move",
    );
  }

  handleBoardClick(event) {
    if (this.gameOver || this.gameMode === "train") return;
    if (this.gameMode === "bot" && this.actions.turn === "b") return;

    const squareEl = event.target.closest(".square");
    if (!squareEl) return;

    const row = Number(squareEl.dataset.row);
    const col = Number(squareEl.dataset.col);
    const target = this.legalMoves.find(
      (move) => move.row === row && move.col === col,
    );

    if (target) {
      if (target.promotion) {
        this.ui.renderDialog(this.actions.turn, (piece) => {
          this.playMove(
            this.selectedSquare.row,
            this.selectedSquare.col,
            row,
            col,
            piece,
          );
        });
        return;
      }

      this.playMove(this.selectedSquare.row, this.selectedSquare.col, row, col);
      return;
    }

    const piece = this.actions.getPiece(row, col);
    if (piece && piece.color === this.actions.turn) {
      this.selectedSquare = { row, col };
      this.legalMoves = this.actions.getLegalMoves(row, col);
    } else {
      this.selectedSquare = null;
      this.legalMoves = [];
    }

    this.ui.renderBoard(
      this.actions.board,
      this.selectedSquare,
      this.legalMoves,
    );
  }

  playMove(fromRow, fromCol, toRow, toCol, promotionPiece = "q") {
    if (this.gameOver) return;

    const promotion = PROMOTION_PIECES.has(promotionPiece)
      ? promotionPiece
      : "q";
    this.selectedSquare = null;
    this.legalMoves = [];

    if (!this.actions.makeMove(fromRow, fromCol, toRow, toCol, promotion))
      return;

    this.refreshAfterMove();
  }

  // Single place that renders the result of a move. The previous version
  // re-entered executeMove with the same arguments, so every move was applied
  // again (and again) until something threw.
  refreshAfterMove() {
    const state = this.actions.getGameState();

    this.ui.renderBoard(this.actions.board);
    this.ui.renderHistory(this.actions.moveHistoryNotation);

    if (state.over) {
      this.endGame(state.message);
      return;
    }

    this.ui.renderStatus(this.getStatusText(state.check));
    this.scheduleBotMove();
  }

  getStatusText(inCheck) {
    const suffix = inCheck ? " - Check!" : "";

    if (this.actions.turn === "w") return `White's turn${suffix}`;
    if (this.gameMode === "bot") return `Brian AI's turn...${suffix}`;
    return `Black's turn${suffix}`;
  }

  scheduleBotMove() {
    if (this.gameMode !== "bot" || this.gameOver || this.actions.turn !== "b")
      return;

    clearTimeout(this.botTimer);
    this.botTimer = setTimeout(() => this.playBotMove(), BOT_DELAY_MS);
  }

  playBotMove() {
    if (this.gameOver || this.gameMode !== "bot" || this.actions.turn !== "b")
      return;

    const move = this.chooseNetworkMove(this.getBrain("b"));
    if (move)
      this.playMove(
        move.fromRow,
        move.fromCol,
        move.toRow,
        move.toCol,
        move.promotion,
      );
  }

  // The raw prediction is four board coordinates. A prediction can point at an
  // empty square, at the opponent's pieces, or at a destination the piece
  // cannot reach; each of those is reported instead of silently accepted.
  validatePrediction([fromRow, fromCol, toRow, toCol], expectedColor) {
    const piece = this.actions.getPiece(fromRow, fromCol);

    if (!piece) return "empty-square";
    if (piece.color !== expectedColor) return "wrong-side";

    const legal = this.actions.getLegalMoves(fromRow, fromCol);
    return legal.some((move) => move.row === toRow && move.col === toCol)
      ? null
      : "illegal-move";
  }

  nearestLegalMove([fromRow, fromCol, toRow, toCol], moves) {
    let bestMove = null;
    let bestDistance = Infinity;

    for (const move of moves) {
      const distance =
        Math.abs(move.fromRow - fromRow) +
        Math.abs(move.fromCol - fromCol) +
        Math.abs(move.toRow - toRow) +
        Math.abs(move.toCol - toCol);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMove = move;
        if (distance === 0) break;
      }
    }

    return bestMove;
  }

  // Dense training signal. Game outcomes are far too sparse to teach a policy
  // (hundreds of moves, one result), so whenever a capture exists the network
  // is taught to take the most valuable one. This is the signal that makes
  // 1000 games actually change how the brain plays.
  trainCapture(network, inputs, moves, chosen) {
    let bestMove = null;
    let bestGain = 0;

    // Only teach captures that win material: taking a defended pawn with a
    // queen is not a lesson worth reinforcing.
    for (const move of moves) {
      const victim = this.actions.getPiece(move.toRow, move.toCol);
      const attacker = this.actions.getPiece(move.fromRow, move.fromCol);
      if (!victim || !attacker) continue;

      const gain =
        (PIECE_VALUES[victim.type] ?? 0) - (PIECE_VALUES[attacker.type] ?? 0);
      if (gain > bestGain) {
        bestGain = gain;
        bestMove = move;
      }
    }

    // Only correct mistakes. Re-teaching a move the network already plays
    // just pushes the same weights every ply and saturates the outputs.
    if (!bestMove || (chosen && squareKey(bestMove) === squareKey(chosen)))
      return;

    network.train(
      inputs,
      [bestMove.fromRow, bestMove.fromCol, bestMove.toRow, bestMove.toCol],
      CAPTURE_LEARNING_RATE,
    );
  }

  // Decodes the four network outputs into the closest legal move. When the
  // prediction is invalid (wrong side's piece, empty square, unreachable
  // square, or a move this side has already played twice) the network
  // backprops one step toward the legal move it is being forced to play.
  chooseNetworkMove(
    network,
    { bannedKeys = null, legalMoves = null, learn = this.training } = {},
  ) {
    const moves =
      legalMoves ?? this.actions.getAllLegalMoves(this.actions.turn);
    if (moves.length === 0) return null;

    const inputs = encodeBoard(this.actions.board, this.actions.turn);
    const expectedColor = this.actions.turn;
    const colorFromInputs = inputs[SIDE_TO_MOVE_INDEX] === 1 ? "w" : "b";

    // The side to move is the last input. If it ever disagrees with the
    // board, trust the board (and the validation below rejects the mismatch).
    if (colorFromInputs !== expectedColor) {
      console.warn(
        `Side-to-move input (${colorFromInputs}) disagrees with the board (${expectedColor}).`,
      );
    }

    const predicted = network.predict(inputs);
    const pieceProblem = this.validatePrediction(predicted, expectedColor);

    let choices = moves;
    let repeated = false;

    if (bannedKeys?.size) {
      const allowed = moves.filter((move) => !bannedKeys.has(squareKey(move)));
      if (allowed.length > 0) {
        choices = allowed;
        repeated = bannedKeys.has(
          squareKey(this.nearestLegalMove(predicted, moves)),
        );
      }
    }

    const chosen = this.nearestLegalMove(predicted, choices) ?? moves[0];
    const issue = pieceProblem ?? (repeated ? "repeated-move" : null);

    if (learn) this.trainCapture(network, inputs, choices, chosen);

    if (issue) {
      // Only learn while training. Otherwise a bot game, or an evaluation
      // game, silently retrains the very brain it is testing.
      if (learn) {
        // A rejected prediction still teaches the hidden layers: without
        // this the network keeps emitting empty squares and the
        // closest-legal-move fallback, not the policy, decides.
        network.train(
          inputs,
          [chosen.fromRow, chosen.fromCol, chosen.toRow, chosen.toCol],
          issue === "empty-square"
            ? EMPTY_SQUARE_LEARNING_RATE
            : CORRECTION_LEARNING_RATE,
        );
      }

      if (this.trainingStats) {
        this.trainingStats[issue] = (this.trainingStats[issue] ?? 0) + 1;
      }
    }

    return {
      ...chosen,
      promotion: chosen.promotion ? "q" : undefined,
      issue,
    };
  }

  getMaterialBalance() {
    let balance = 0;

    for (const row of this.actions.board) {
      for (const piece of row) {
        if (!piece) continue;

        const value = PIECE_VALUES[piece.type] ?? 0;
        balance += piece.color === "w" ? value : -value;
      }
    }

    return balance;
  }

  winnerByMaterial() {
    const balance = this.getMaterialBalance();
    if (Math.abs(balance) < WINNING_MARGIN) return null;

    return balance > 0 ? "w" : "b";
  }

  // Ban every move this side has already played twice. A two-move shuffle
  // (Ra4/Ra3, Ra8/Ra7) never repeats the same key back-to-back, so checking
  // only the last two moves let it run forever. Banning all twice-used keys
  // forces the brain to try something new instead of shuffling to a draw.
  findRepeatedMoveKeys(keys) {
    const counts = new Map();

    for (const key of keys) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const repeated = new Set();
    for (const [key, count] of counts) {
      if (count >= 2) repeated.add(key);
    }

    return repeated;
  }

  // One complete game. Both seats learn during the game; the caller decides
  // which winning brain holds the black seat for the next game.
  playTrainingGame(
    whiteBrain = this.brains.w,
    blackBrain = this.brains.b,
    { learn = false } = {},
  ) {
    // Every game starts from the initial position, so one game can never
    // inherit the previous game's board.
    this.actions.reset();
    const ownMoveKeys = { w: [], b: [] };
    let plies = 0;

    while (plies < MAX_TRAINING_PLIES) {
      const color = this.actions.turn;
      const moves = this.actions.getAllLegalMoves(color);

      if (moves.length === 0) {
        const checked = this.actions.isInCheck(color);

        if (checked)
          return {
            plies,
            winner: color === "w" ? "b" : "w",
            reason: "checkmate",
          };

        // Stalemating an opponent while a piece up is a failure to
        // convert, not a draw worth defending, so adjudicate it.
        return {
          plies,
          winner: null,
          reason: "stalemate",
        };
      }

      const move = this.chooseNetworkMove(
        color === "w" ? whiteBrain : blackBrain,
        {
          bannedKeys: this.findRepeatedMoveKeys(ownMoveKeys[color]),
          legalMoves: moves,
          learn,
        },
      );

      if (
        !move ||
        !this.actions.makeMove(
          move.fromRow,
          move.fromCol,
          move.toRow,
          move.toCol,
          move.promotion ?? "q",
        )
      )
        break;

      plies++;
      ownMoveKeys[color].push(squareKey(move));

      const draw = this.actions.isDraw();
      if (draw) {
        // Repetition and 75-move draws routinely end games with a big
        // material gap: the side that is ahead is shuffling instead of
        // converting. Adjudicate on material so the cycle still
        // produces a winner for the selection loop.
        return {
          plies,
          winner: null,
          reason: `${draw}`,
        };
      }
    }

    return { plies, winner: null, reason: "ply limit" };
  }

  async startTraining(cycles = TRAINING_CYCLES) {
    if (this.training) return;

    clearTimeout(this.botTimer);

    this.training = true;
    this.gameOver = false;
    this.selectedSquare = null;
    this.legalMoves = [];

    this.trainingStats = {
      "empty-square": 0,
      "wrong-side": 0,
      "illegal-move": 0,
      "repeated-move": 0,
    };

    this.ui.trainBtn.disabled = true;

    try {
      await this.brainsReady;

      this.ui.renderStatus("Preparing training...");

      // Recover the saved champion or create a fresh network.
      this.brains.b ??= this.brains.w?.clone() ?? new NeuralNetwork(NET_SHAPE);

      let repairedChampion = false;

      if (isSaturatedChampion(this.brains.b)) {
        console.warn("Champion is saturated. Creating a fresh brain.");

        this.brains.b = new NeuralNetwork(NET_SHAPE);
        repairedChampion = true;
      }

      // Keep the champion completely unchanged during evaluation.
      const champion = this.brains.b;

      // Generate one challenger from the champion.
      const challenger = new NeuralNetwork(NET_SHAPE).mutate(
        champion,
        WHITE_MUTATION_RATE,
      );

      this.brains.w = challenger;

      const wins = { w: 0, b: 0, draw: 0 };

      let challengerPoints = 0;
      let gamesPlayed = 0;
      let replaced = 0;
      let materialTotal = 0;

      const started = performance.now();

      // One tournament, with alternating colors.
      while (gamesPlayed < cycles) {
        const challengerColor = gamesPlayed % 2 === 0 ? "w" : "b";

        const result =
          challengerColor === "w"
            ? this.playTrainingGame(challenger, champion, {
                learn: false,
              })
            : this.playTrainingGame(champion, challenger, {
                learn: false,
              });

        gamesPlayed++;

        // Record the game result.
        if (result.winner === null) {
          wins.draw++;
          challengerPoints += 0.5;
        } else {
          wins[result.winner]++;

          if (result.winner === challengerColor) {
            challengerPoints += 1;
          }
        }

        // Track the material balance for reporting.
        materialTotal +=
          challengerColor === "w"
            ? this.getMaterialBalance()
            : -this.getMaterialBalance();

        if (gamesPlayed % PROGRESS_EVERY === 0) {
          const score = challengerPoints / gamesPlayed;

          this.ui.renderStatus(
            `Tournament ${gamesPlayed}/${cycles} - ` +
              `challenger score ${(score * 100).toFixed(1)}% - ` +
              `white ${wins.w}, black ${wins.b}, draws ${wins.draw}`,
          );

          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      // Decide which brain survives.
      const challengerScore = challengerPoints / Math.max(gamesPlayed, 1);
      const championScore = 1 - challengerScore;

      // The champion wins ties. Only promote a challenger
      // that actually scores better.
      if (challengerScore > championScore) {
        this.brains.b = challenger;
        replaced = 1;

        console.info(
          `New champion! Challenger score: ${(challengerScore * 100).toFixed(1)}%`,
        );
      } else {
        this.brains.b = champion;
        console.info(
          `Champion retained. Challenger score: ${(challengerScore * 100).toFixed(1)}%`,
        );
      }

      // Save ONLY ONCE after all games have finished.
      const saved = await saveBrainFile("black", this.brains.b);

      // Append an independent copy to the archive.
      const archived = await archiveBrain(
        this.brains.b,
        gamesPlayed,
        replaced ? challengerScore : championScore,
      );

      const seconds = (performance.now() - started) / 1000;
      const stats = this.trainingStats;

      await logTrainingSession(wins.b, wins.w, wins.draw, stats);

      this.actions.reset();

      this.ui.renderBoard(this.actions.board);
      this.ui.renderHistory(this.actions.moveHistoryNotation);

      const championName = replaced
        ? "New challenger promoted!"
        : "Previous champion retained.";

      this.ui.renderStatus(
        `${gamesPlayed} games completed in ${seconds.toFixed(1)}s. ` +
          `${championName} ` +
          `Challenger score: ${(challengerScore * 100).toFixed(1)}%. ` +
          `White wins: ${wins.w}, black wins: ${wins.b}, draws: ${wins.draw}. ` +
          `Champion saved: ${saved ?? "failed"}. ` +
          `Archive: ${archived ?? "failed"}. ` +
          (repairedChampion ? "Previous saturated brain was replaced. " : "") +
          `Invalid moves: ${stats["illegal-move"]}, ` +
          `empty squares: ${stats["empty-square"]}, ` +
          `wrong side: ${stats["wrong-side"]}.`,
      );
    } catch (error) {
      console.error("Training failed:", error);
      this.ui.renderStatus(`Training failed: ${error.message}`);
    } finally {
      this.training = false;
      this.trainingStats = null;
      this.ui.trainBtn.disabled = false;
    }
  }

  async alterBases() {
    for( let i=1; i<=10000; i++){
      console.log(`${i/10000} is running.`);
      await this.startTraining(TRAINING_CYCLES);
    }
  }

  endGame(message) {
    this.gameOver = true;
    clearTimeout(this.botTimer);
    this.selectedSquare = null;
    this.legalMoves = [];

    this.ui.renderBoard(this.actions.board);
    this.ui.renderStatus(message);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new GameManager();
});
