import { Actions } from "./actions.js";
import { ChessUI } from "./ui.js";
import { NeuralNetwork } from "./neuralNetwork.js";
import { loadTrainingData } from "./training.js";
// ============================================================
// CONFIGURATION
// ============================================================
const NET_SHAPE = [277, 114, 54, 5];
const INPUT_SIZE = NET_SHAPE[0];
const PIECE_CODE_BITS = 4;
const BOARD_BUFFER = new Uint8Array(INPUT_SIZE);
const EN_PASSANT_START = 256;
const CASTLING_START = 272;
const SIDE_TO_MOVE_INDEX = 276;
const MAX_TRAINING_PLIES = 200;
// Number of challenges.
// Each challenge consists of TWO games.
const TRAINING_CYCLES = 500;
const PLAYER1_MUTATION_RATE = 0.0015;
const DRAW_BIAS_RATE = 0.001;
const MAX_DRAW_DRIFT = 0.001;
const CAPTURE_LEARNING_RATE = 0.001;
const CORRECTION_LEARNING_RATE = 0.003;
const EMPTY_SQUARE_LEARNING_RATE = 0.003;
const PROGRESS_EVERY = 1;
const BOT_DELAY_MS = 150;
const PROMOTION_PIECES = ["n", "b", "r", "q"];
const PIECE_VALUES = Object.freeze({
    p: 1, n: 3, b: 3.3, r: 5, q: 9, k: 0,
});
const WINNING_MARGIN = 3;
// ============================================================
// STORAGE
// ============================================================
const BRAIN_ENDPOINT = "/api/brains";
const BRAIN_ARCHIVE_ENDPOINT = "/api/brains/archive";
const BRAIN_STORAGE_KEY = "smartchess-brains";
const TRAINING_LOG_ENDPOINT = "/api/training-log";
const TRAINING_LOG_KEY = "smartchess-training-log";
const TRAINING_LOG_HEADER = "Training,Player1 wins,Player2 wins,Draws,Corrected,Illegal move,Empty square,Repeated, Champion Changes";
const TRAINING_LOG_COLUMNS = TRAINING_LOG_HEADER.split(",").length;

// The existing server endpoint uses the black brain file
// as its saved champion file.
//
// This is only a storage compatibility convention.
// The brain itself belongs to Player2, not to black.
let brainStorage = "server";
let trainingLogStorage = "server";
let persistenceQueue = Promise.resolve();
function enqueuePersistence(task) {
    const next = persistenceQueue.then(() => task());
    persistenceQueue = next.then(
        () => { }, () => { },);
    return next;
}
// ============================================================
// BOARD ENCODING
// ============================================================
const PIECE_CODES = Object.freeze({
    wp: [0, 0, 0, 1], wn: [0, 0, 1, 0], wb: [0, 0, 1, 1], wr: [0, 1, 0, 0], wq: [0, 1, 0, 1], wk: [0, 1, 1, 0], bp: [1, 0, 0, 1], bn: [1, 0, 1, 0], bb: [1, 0, 1, 1], br: [1, 1, 0, 0], bq: [1, 1, 0, 1], bk: [1, 1, 1, 0],
});

// White A,B,C,D,E,F,G,H and Black A,B,C,D,E,F,G,H; 0 unavailable 1 available
// enPassant = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
// features = [
//     0, // White kingside castling
//     0, // White queenside castling
//     0, // Black kingside castling
//     0, // Black queenside castling
//     0, // Side to move (0 = White, 1 = Black)
// ];

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

const INITIAL_POSITION_FEATURES = () => ({
    // White A-H, then Black A-H.
    enPassant: new Uint8Array(16),

    // White kingside, White queenside,
    // Black kingside, Black queenside.
    castling: new Uint8Array([1, 1, 1, 1]),
});

function encodeBoard(board, turn, features, target = BOARD_BUFFER) {
    if (!(target instanceof Uint8Array) || target.length < INPUT_SIZE) {
        throw new Error(
            `Board input buffer must have ${INPUT_SIZE} elements.`
        );
    }

    target.fill(0);

    let offset = 0;

    // ----------------------------------------
    // 256 BOARD INPUTS
    // ----------------------------------------
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = board?.[row]?.[col];

            if (piece) {
                const key = piece.color + piece.type;
                const code = PIECE_CODES[key];

                if (code) {
                    target.set(code, offset);
                }
            }

            offset += PIECE_CODE_BITS;
        }
    }

    // ----------------------------------------
    // 16 EN PASSANT INPUTS
    // ----------------------------------------
    target.set(
        features.enPassant,
        EN_PASSANT_START
    );

    // ----------------------------------------
    // 4 CASTLING INPUTS
    // ----------------------------------------
    target.set(
        features.castling,
        CASTLING_START
    );

    // ----------------------------------------
    // 1 SIDE-TO-MOVE INPUT
    // 0 = White
    // 1 = Black
    // ----------------------------------------
    target[SIDE_TO_MOVE_INDEX] = turn === "w" ? 0 : 1;

    return target;
}
// ============================================================
// STORAGE HELPERS
// ============================================================
function isStorageAvailable() {
    try {
        return typeof localStorage !== "undefined";
    } catch {
        return false;
    }
}
function safeReadStorage(key) {
    if (!isStorageAvailable()) return null;
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.warn(`Cannot read ${key}:`, error);
        return null;
    }
}
function safeWriteStorage(key, value) {
    if (!isStorageAvailable()) return false;
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`Cannot write ${key}:`, error);
        return false;
    }
}
function parseJsonSafe(raw, fallback, label) {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) ?? fallback;
    } catch (error) {
        console.warn(`Invalid JSON in ${label}:`, error);
        return fallback;
    }
}
function readBrowserBrain() {
    const parsed = parseJsonSafe(
        safeReadStorage(BRAIN_STORAGE_KEY), {}, BRAIN_STORAGE_KEY,);
    if (!parsed || typeof parsed !== "object") {
        return null;
    }
    // New format: one saved Best Brain.
    if (parsed.best) {
        return parsed.best;
    }
    // Legacy compatibility: the old black brain was the champion.
    return parsed.b ?? parsed.black ?? null;
}
function writeBrowserBrain(payload) {
    return safeWriteStorage(
        BRAIN_STORAGE_KEY, JSON.stringify({ best: payload }),);
}
// ============================================================
// BRAIN PERSISTENCE
// ============================================================
function hydrateNetwork(payload, label) {
    if (!payload || typeof payload !== "object") return null;
    try {
        const network = NeuralNetwork.fromJSON(payload);
        if (typeof network.predictRaw !== "function") {
            return null;
        }
        return network;
    } catch (error) {
        console.warn(`Invalid ${label} network:`, error);
        return null;
    }
}
async function loadBestBrain() {
    if (brainStorage === "browser") {
        return hydrateNetwork(readBrowserBrain(), "browser Best Brain");
    }
    try {
        const response = await fetch(`${BRAIN_ENDPOINT}/black`);
        if (response.status === 404) return null;
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return hydrateNetwork(
            await response.json(), "saved Best Brain",);
    } catch (error) {
        console.info(
            "Server brain unavailable. Using browser storage.", error,);
        brainStorage = "browser";
        return hydrateNetwork(
            readBrowserBrain(), "browser Best Brain",);
    }
}

function saveBestBrain(brain) {
    return enqueuePersistence(async () => {
        if (!brain || typeof brain.toJSON !== "function") {
            return null;
        }
        const payload = brain.toJSON();
        if (brainStorage === "browser") {
            return writeBrowserBrain(payload) ? "browser" : null;
        }
        try {
            const response = await fetch(`${BRAIN_ENDPOINT}/black`, {
                method: "POST", headers: {
                    "Content-Type": "application/json",
                }, body: JSON.stringify(payload),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return "server";
        } catch (error) {
            console.warn("Cannot save Best Brain to server:", error);
            brainStorage = "browser";
            return writeBrowserBrain(payload) ? "browser" : null;
        }
    });
}
// ============================================================
// BRAIN ARCHIVE
// ============================================================
function archiveBrain(brain, score) {
    return enqueuePersistence(async () => {
        if (!brain || typeof brain.toJSON !== "function") { return null; }

        const snapshot = {
            timestamp: new Date().toISOString(),
            score,
            brain: brain.toJSON(),
        };
        try {
            const response = await fetch(BRAIN_ARCHIVE_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(snapshot),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            console.info(`Brain archived successfully: generation ${result.generation}`);
            return "server";
        } catch (error) {
            console.error("Brain archive failed:", error);
            return null;
        }
    });

}
// ============================================================
// TRAINING LOG
// ============================================================
function sanitizeCsvCell(value) {
    return String(value ?? "")
        .replace(/[\x00-\x1F\x7F]+/g, " ")
        .replace(/["',\t;]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function normalizeTrainingLog(csv) {
    const lines = String(csv ?? "")
        .split(/\r?\n/)
        .filter(Boolean);
    if (!lines.length) {
        return `${TRAINING_LOG_HEADER}\n`;
    }
    const rows = [TRAINING_LOG_HEADER];
    const start = lines[0] === TRAINING_LOG_HEADER ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
        const cells = lines[i]
            .split(",")
            .map(sanitizeCsvCell);
        while (cells.length < TRAINING_LOG_COLUMNS) {
            cells.push("0");
        }
        rows.push(cells.slice(0, TRAINING_LOG_COLUMNS).join(","));
    }
    return `${rows.join("\n")}\n`;
}

function appendBrowserTrainingLog(player1, player2, draws, stats) {
    const csv = normalizeTrainingLog(safeReadStorage(TRAINING_LOG_KEY),);
    const sessions = Math.max(0, csv.split(/\r?\n/).filter(Boolean).length - 1,);
    const row = [
        sessions + 1,
        player1,
        player2,
        draws,
        stats.corrected,
        stats.illegal,
        stats.empty,
        stats.repeated,
        stats.championChanges,
    ].join(",");
    return safeWriteStorage(TRAINING_LOG_KEY, `${csv}${row}\n`,);
}

function logTrainingSession(player1, player2, draws, stats) {
    return enqueuePersistence(async () => {
        if (trainingLogStorage === "browser") {
            return appendBrowserTrainingLog(
                player1, player2, draws, stats,);
        }
        try {
            const response = await fetch(TRAINING_LOG_ENDPOINT, {
                method: "POST", headers: {
                    "Content-Type": "application/json",
                }, body: JSON.stringify({
                    player1, player2, draws, ...stats,
                }),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return true;
        } catch (error) {
            console.warn("Training log server unavailable:", error);
            trainingLogStorage = "browser";
            return appendBrowserTrainingLog(
                player1, player2, draws, stats,);
        }
    });
}
// ============================================================
// MOVE HELPERS
// ============================================================
function squareKey(move) {
    return [move.fromRow, move.fromCol, move.toRow, move.toCol,].join(",");
}

function promotionIndex(piece) {
    const index = PROMOTION_PIECES.indexOf(piece);
    return index >= 0 ? index : 3;
}
function promotionFromIndex(index) {
    const safeIndex = Math.max(
        0, Math.min(3, Math.round(Number(index) || 0)),);
    return PROMOTION_PIECES[safeIndex];
}
// ============================================================
// GAME MANAGER
// ============================================================
export class GameManager {
    constructor() {
        this.actions = new Actions();
        this.ui = new ChessUI();
        this.gameMode = this.ui.modeSelector?.value ?? "bot";
        this.selectedSquare = null;
        this.legalMoves = [];
        this.gameOver = false;
        this.training = false;
        this.botTimer = null;
        this.trainingStats = null;
        // ----------------------------------------------------
        // PLAYER IDENTITY
        // ----------------------------------------------------
        this.players = {
            player1: {
                name: "Player1", brain: null, wins: 0,
            }, player2: {
                name: "Player2", brain: null, wins: 0,
            },
        };
        // The Best Brain is the current champion.
        this.bestBrain = null;
        // Player2 always receives the Best Brain.
        this.players.player2.brain = null;
        // ----------------------------------------------------
        // TRAINING STATISTICS
        // ----------------------------------------------------
        this.trainingResults = {
            player1: 0, player2: 0, draws: 0,
        };
        this.challengeNumber = 0;
        this.brainsReady = this.loadBrains();
        // ----------------------------------------------------
        // UI EVENTS
        // ----------------------------------------------------
        this.ui.boardElement.addEventListener("click", (event) => this.handleBoardClick(event),);
        this.ui.modeSelector?.addEventListener(
            "change", (event) => {
                this.gameMode = event.target.value;
                this.startNewGame();
            },);
        this.ui.trainBtn.addEventListener("click", () => this.startTraining(),);
        this.ui.updateBtn.addEventListener("click", () => this.alterBases(),);
        this.positionFeatures = INITIAL_POSITION_FEATURES();
        this.startNewGame();
    }
    // ========================================================
    // LOAD BEST BRAIN
    // ========================================================
    async loadBrains() {
        this.bestBrain = await loadBestBrain();
        if (!this.bestBrain) {
            console.info("No saved Best Brain found. A new brain will be created.",);
            return;
        }
        this.players.player2.brain = this.bestBrain.clone();
        console.info("Best Brain loaded successfully.");
        if (!this.training && !this.gameOver) {
            this.ui.renderStatus("Best Brain loaded. Player2 is ready.",);
        }
    }
    // ========================================================
    // INITIALIZE PLAYERS
    // ========================================================
    initializePlayers() {
        if (!this.bestBrain) {
            this.bestBrain = new NeuralNetwork(NET_SHAPE);
        }
        // Player2 always has the current champion.
        this.players.player2.brain = this.bestBrain.clone();
        // Player1 receives a mutated copy.
        this.players.player1.brain = new NeuralNetwork(NET_SHAPE).mutate(this.bestBrain, PLAYER1_MUTATION_RATE,);
    }
    // ========================================================
    // START NEW HUMAN/BOT GAME
    // ========================================================
    startNewGame() {
        clearTimeout(this.botTimer);
        this.actions.reset();
        this.resetPositionFeatures();
        this.gameOver = false;
        this.training = false;
        this.selectedSquare = null;
        this.legalMoves = [];
        this.ui.renderBoard(this.actions.board);
        this.ui.renderHistory(this.actions.moveHistoryNotation);
        this.ui.renderStatus(
            this.gameMode === "train"
                ? "Training mode - press Train the model."
                : "White to move",);
    }
    // ========================================================
    // HUMAN PLAYER
    // ========================================================
    handleBoardClick(event) {
        if (this.gameOver || this.gameMode === "train") {
            return;
        }
        if (
            this.gameMode === "bot" &&
            this.actions.turn === "b"
        ) {
            return;
        }
        const squareEl = event.target.closest(".square");
        if (!squareEl) return;
        const row = Number(squareEl.dataset.row);
        const col = Number(squareEl.dataset.col);
        if (!Number.isInteger(row) || !Number.isInteger(col)) {
            return;
        }
        if (this.tryExecuteLegalTarget(row, col)) {
            return;
        }
        const piece = this.actions.getPiece(row, col);
        const isOwnPiece = Boolean(piece && piece.color === this.actions.turn);
        this.selectedSquare = isOwnPiece
            ? { row, col }
            : null;
        this.legalMoves = isOwnPiece
            ? this.actions.getLegalMoves(row, col)
            : [];
        this.ui.renderBoard(
            this.actions.board, this.selectedSquare, this.legalMoves,);
    }
    tryExecuteLegalTarget(row, col) {
        const target = this.legalMoves.find(
            (move) => move.row === row && move.col === col,);
        if (!target || !this.selectedSquare) {
            return false;
        }
        const { row: fromRow, col: fromCol } = this.selectedSquare;
        if (target.promotion) {
            this.ui.renderDialog(
                this.actions.turn, (piece) => {
                    this.playMove(
                        fromRow, fromCol, row, col, piece,);
                },);
            return true;
        }
        this.playMove(fromRow, fromCol, row, col);
        return true;
    }
    // ========================================================
    // EXECUTE MOVE
    // ========================================================
    playMove(
        fromRow, fromCol, toRow, toCol, promotionPiece = "q",) {
        if (this.gameOver) return;
        const promotion = PROMOTION_PIECES.includes(
            promotionPiece,)
            ? promotionPiece
            : "q";
        this.selectedSquare = null;
        this.legalMoves = [];
        if (!this.makeMoveWithFeatures(fromRow, fromCol, toRow, toCol, promotion)) {
            return;
        }

        this.refreshAfterMove();
    }
    refreshAfterMove() {
        const state = this.actions.getGameState();
        this.ui.renderBoard(this.actions.board);
        this.ui.renderHistory(
            this.actions.moveHistoryNotation,);
        if (state.over) {
            this.endGame(state.message);
            return;
        }
        this.ui.renderStatus(
            this.getStatusText(state.check),);
        this.scheduleBotMove();
    }
    getStatusText(inCheck) {
        const suffix = inCheck ? " - Check!" : "";
        if (this.actions.turn === "w") {
            return `White's turn${suffix}`;
        }
        if (this.gameMode === "bot") {
            return `Player2 AI's turn${suffix}`;
        }
        return `Black's turn${suffix}`;
    }
    // ========================================================
    // BOT GAME
    // ========================================================
    scheduleBotMove() {
        if (
            this.gameMode !== "bot" ||
            this.gameOver ||
            this.actions.turn !== "b"
        ) {
            return;
        }
        clearTimeout(this.botTimer);
        this.botTimer = setTimeout(
            () => this.playBotMove(), BOT_DELAY_MS,);
    }
    async playBotMove() {
        if (
            this.gameOver ||
            this.gameMode !== "bot" ||
            this.actions.turn !== "b"
        ) {
            return;
        }
        await this.brainsReady;
        if (!this.players.player2.brain && this.bestBrain) {
            this.players.player2.brain = this.bestBrain.clone();
        }
        const brain = this.players.player2.brain ??
            (this.players.player2.brain = new NeuralNetwork(NET_SHAPE));
        const move = this.chooseNetworkMove(brain);
        if (!move) return;
        this.playMove(
            move.fromRow, move.fromCol, move.toRow, move.toCol, move.promotion,);
    }
    // ========================================================
    // NEURAL NETWORK PREDICTION
    // ========================================================
    decodePrediction(network, inputs) {
        // The network has five sigmoid outputs.
        // Convert them into the requested discrete values.
        const raw = network.predictRaw(inputs);
        if (!raw || raw.length < 5) {
            throw new Error(
                "Neural network must return five outputs.",);
        }
        return [
            Math.min(7, Math.max(0, Math.round(raw[0] * 7))), Math.min(7, Math.max(0, Math.round(raw[1] * 7))), Math.min(7, Math.max(0, Math.round(raw[2] * 7))), Math.min(7, Math.max(0, Math.round(raw[3] * 7))), Math.min(3, Math.max(0, Math.round(raw[4] * 3))),];
    }
    validatePrediction(predicted, expectedColor) {
        const [
            fromRow, fromCol, toRow, toCol,] = predicted;
        const piece = this.actions.getPiece(
            fromRow, fromCol,);
        if (!piece) return "empty-square";
        if (piece.color !== expectedColor) {
            return "wrong-side";
        }
        return this.isLegalTargetSquare(
            fromRow, fromCol, toRow, toCol,)
            ? null
            : "illegal-move";
    }
    isLegalTargetSquare(
        fromRow, fromCol, toRow, toCol,) {
        return this.actions
            .getLegalMoves(fromRow, fromCol)
            .some(
                (move) =>
                    move.row === toRow &&
                    move.col === toCol,);
    }
    // ========================================================
    // FIND CLOSEST LEGAL MOVE
    // ========================================================
    nearestLegalMove(predicted, moves) {
        if (!moves?.length) return null;
        const [
            fromRow, fromCol, toRow, toCol,] = predicted;
        let bestMove = null;
        let bestDistance = Infinity;
        for (const move of moves) {
            const distance = Math.abs(move.fromRow - fromRow) +
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
    // ========================================================
    // CAPTURE LEARNING
    // ========================================================
    trainCapture(network, inputs, moves, chosen) {
        let bestMove = null;
        let bestGain = 0;
        for (const move of moves) {
            const victim = this.actions.getPiece(
                move.toRow, move.toCol,);
            const attacker = this.actions.getPiece(
                move.fromRow, move.fromCol,);
            if (!victim || !attacker) continue;
            const gain = (PIECE_VALUES[victim.type] ?? 0) -
                (PIECE_VALUES[attacker.type] ?? 0);
            if (gain > bestGain) {
                bestGain = gain;
                bestMove = move;
            }
        }
        if (
            !bestMove ||
            (chosen &&
                squareKey(bestMove) === squareKey(chosen))
        ) {
            return;
        }
        network.train(
            inputs, [
            bestMove.fromRow, bestMove.fromCol, bestMove.toRow, bestMove.toCol, bestMove.promotion
                ? promotionIndex(bestMove.promotion)
                : 3,], CAPTURE_LEARNING_RATE,);
    }
    // ========================================================
    // CHOOSE NETWORK MOVE
    // ========================================================
    chooseNetworkMove(
        network, {
            bannedKeys = null, legalMoves = null, learn = false, penalizeRepeats = true, } = {},) {
        const moves = legalMoves ??
            this.actions.getAllLegalMoves(this.actions.turn);
        if (!moves.length) return null;
        const expectedColor = this.actions.turn;
        const inputs = encodeBoard(this.actions.board, expectedColor, this.positionFeatures);
        const predicted = this.decodePrediction(network, inputs);
        const issue = this.validatePrediction(predicted, expectedColor,);
        let choices = moves;
        let repeated = false;
        if (penalizeRepeats && bannedKeys?.size) {
            const allowed = moves.filter(
                (move) => !bannedKeys.has(squareKey(move)),);
            if (allowed.length) {
                choices = allowed;
                const nearest = this.nearestLegalMove(
                    predicted, moves,);
                repeated = nearest
                    ? bannedKeys.has(squareKey(nearest))
                    : false;
            }
        }
        const chosen = this.nearestLegalMove(predicted, choices) ??
            choices[0];
        const finalIssue = issue ?? (repeated ? "repeated-move" : null);
        // Select the promotion piece using output number 5.
        let promotion = "q";
        if (chosen.promotion) {
            promotion = promotionFromIndex(predicted[4]);
        }
        if (learn) {
            this.trainCapture(
                network, inputs, choices, chosen,);
            if (finalIssue) {
                network.train(
                    inputs, [
                    chosen.fromRow, chosen.fromCol, chosen.toRow, chosen.toCol, chosen.promotion
                        ? promotionIndex(promotion)
                        : 3,], finalIssue === "empty-square"
                    ? EMPTY_SQUARE_LEARNING_RATE
                    : CORRECTION_LEARNING_RATE,);
            }
            if (finalIssue && this.trainingStats) {
                this.trainingStats[finalIssue] = (this.trainingStats[finalIssue] ?? 0) + 1;

                if (finalIssue === "illegal-move") {
                    this.trainingStats.illegal++;
                }

                if (finalIssue === "empty-square") {
                    this.trainingStats.empty++;
                }

                if (finalIssue === "repeated-move") {
                    this.trainingStats.repeated++;
                }

                if (finalIssue === "wrong-side") {
                    this.trainingStats.corrected++;
                }
            }

        }
        return {
            ...chosen, promotion, issue: finalIssue,
        };
    }
    // ========================================================
    // MATERIAL EVALUATION
    // ========================================================
    getMaterialBalance() {
        let balance = 0;
        for (const row of this.actions.board) {
            for (const piece of row) {
                if (!piece) continue;
                const value = PIECE_VALUES[piece.type] ?? 0;
                balance += piece.color === "w"
                    ? value
                    : -value;
            }
        }
        return balance;
    }
    winnerByMaterial() {
        const balance = this.getMaterialBalance();
        if (Math.abs(balance) < WINNING_MARGIN) {
            return null;
        }
        return balance > 0 ? "w" : "b";
    }
    findRepeatedMoveKeys(keys) {
        const seen = new Set();
        const repeated = new Set();
        for (const key of keys) {
            if (seen.has(key)) {
                repeated.add(key);
            } else {
                seen.add(key);
            }
        }
        return repeated;
    }
    // ========================================================
    // PLAY ONE TRAINING GAME
    // ========================================================
    playTrainingGame(
        player1Color, { learn = false } = {},) {
        this.actions.reset();
        this.resetPositionFeatures();
        const ownMoveKeys = {
            w: [], b: [],
        };
        let plies = 0;
        const player2Color = player1Color === "w" ? "b" : "w";
        const playerForColor = (color) => {
            return color === player1Color
                ? "player1"
                : "player2";
        };
        while (plies < MAX_TRAINING_PLIES) {
            const color = this.actions.turn;
            const moves = this.actions.getAllLegalMoves(color);
            if (!moves.length) {
                const checked = this.actions.isInCheck(color);
                if (checked) {
                    const winnerColor = color === "w" ? "b" : "w";
                    return {
                        plies, winner: playerForColor(winnerColor), reason: "checkmate",
                    };
                }
                return {
                    plies, winner: null, reason: "stalemate",
                };
            }
            // Select the brain by PLAYER IDENTITY,             // not by chess color.
            const player = playerForColor(color);
            const brain = this.players[player].brain;
            const move = this.chooseNetworkMove(
                brain, {
                bannedKeys: this.findRepeatedMoveKeys(
                    ownMoveKeys[color],), legalMoves: moves, learn,
            },);
            if (
                !move ||
                !this.makeMoveWithFeatures(
                    move.fromRow,
                    move.fromCol,
                    move.toRow,
                    move.toCol,
                    move.promotion ?? "q"
                )
            ) {
                break;
            }
            plies++;
            ownMoveKeys[color].push(squareKey(move));
            const draw = this.actions.isDraw();
            if (draw) {
                return {
                    plies, winner: null, reason: String(draw),
                };
            }
        }
        // Material evaluation at the ply limit.
        const materialWinner = this.winnerByMaterial();
        if (materialWinner) {
            return {
                plies, winner: playerForColor(materialWinner), reason: "material",
            };
        }
        return {
            plies, winner: null, reason: "ply limit",
        };
    }
    // ========================================================
    // PLAY ONE TWO-GAME CHALLENGE
    // ========================================================
    async playChallenge() {
        const results = { player1: 0, player2: 0, draws: 0 };
        // Game 1:
        // Player1 = White
        // Player2 = Black
        let result = this.playTrainingGame("w", { learn: true });
        if (result.winner) {
            results[result.winner]++;
        } else {
            results.draws++;
        }
        // Game 2:
        // Player1 = Black
        // Player2 = White
        result = this.playTrainingGame("b", { learn: true });
        if (result.winner) {
            results[result.winner]++;
        } else {
            results.draws++;
        }
        // ----------------------------------------------------
        // CHALLENGE RESULT
        // ----------------------------------------------------
        const player1WonBoth = results.player1 === 2;
        const player2WonBoth = results.player2 === 2;
        if (player1WonBoth) {
            // Player1 becomes the new champion.
            this.bestBrain = this.players.player1.brain.clone();
            // Player2 immediately receives the new Best Brain.
            this.players.player2.brain = this.bestBrain.clone();
            this.players.player1.brain = this.bestBrain.mutate(this.bestBrain, PLAYER1_MUTATION_RATE)
            console.info(`Challenge ${this.challengeNumber}: Player1 is the new champion!`);
            await archiveBrain(this.bestBrain, 1);
            const saved = await saveBestBrain(this.bestBrain);
            if (!saved) console.warn("Could not save new Best Brain.");
            
            if (this.trainingStats) {
                this.trainingStats.championChanges++;
            }
        } else if (player2WonBoth) {
            // Player2 retains the championship.
            this.bestBrain = this.players.player2.brain.clone();
            console.info(`Challenge ${this.challengeNumber}: Player2 retained the championship.`,);
            this.players.player1.brain = this.bestBrain.mutate(this.bestBrain, PLAYER1_MUTATION_RATE)
        } else {
            // Split result or draws.
            // Player2 remains champion.
            this.players.player1.brain = this.bestBrain.mutate(this.bestBrain, PLAYER1_MUTATION_RATE)
        }
        this.trainingResults.player1 += results.player1;
        this.trainingResults.player2 += results.player2;
        this.trainingResults.draws += results.draws;
        this.players.player1.wins += results.player1;
        this.players.player2.wins += results.player2;
        return {
            ...results, player1WonBoth, player2WonBoth,
        };
    }
    // ========================================================
    // INITIALIZE CHAMPION
    // ========================================================
    async initializeChampion() {
        await this.brainsReady;
        if (!this.bestBrain) {
            this.bestBrain = new NeuralNetwork(NET_SHAPE);
            console.info("Created initial Best Brain.");
        }
        this.players.player2.brain = this.bestBrain.clone();
        return this.bestBrain;
    }
    // ========================================================
    // FINALIZE TRAINING
    // ========================================================
    async finalizeTraining({
        challengesPlayed, gamesPlayed, started, promotionsCount, }) {
        const seconds = (performance.now() - started) / 1000;
        const results = this.trainingResults;

        await logTrainingSession(
            results.player1,
            results.player2,
            results.draws,
            {
                ...this.trainingStats,
                championChanges: promotionsCount
            }
        );
        this.actions.reset();
        this.resetPositionFeatures();
        this.ui.renderBoard(this.actions.board);
        this.ui.renderHistory(this.actions.moveHistoryNotation,);
        this.ui.renderStatus(
            `Training completed.\n` +
            `Challenges: ${challengesPlayed}\n` +
            `Games: ${gamesPlayed}\n` +
            `Time: ${seconds.toFixed(1)} seconds\n\n` +
            `Player1 wins: ${results.player1}\n` +
            `Player2 wins: ${results.player2}\n` +
            `Draws: ${results.draws}\n\n` +
            `New champions: ${promotionsCount}\n` +
            `Illegal moves: ${this.trainingStats["illegal-move"]}\n` +
            `Empty squares: ${this.trainingStats["empty-square"]}\n` +
            `Wrong side: ${this.trainingStats["wrong-side"]}\n` +
            `Repeated moves: ${this.trainingStats["repeated-move"]}`,);
    }
    // ========================================================
    // START TRAINING
    // ========================================================
    async startTraining(challenges = TRAINING_CYCLES) {
        if (this.training) return;
        clearTimeout(this.botTimer);
        this.legalMoves = [];
        this.training = true;
        this.gameOver = false;
        this.selectedSquare = null;
        this.ui.trainBtn.disabled = true;
        this.trainingStats = {
            "empty-square": 0,
            "wrong-side": 0,
            "illegal-move": 0,
            "repeated-move": 0,
            corrected: 0,
            illegal: 0,
            empty: 0,
            repeated: 0,
            wrongSide: 0,
            championChanges: 0
        };
        this.trainingResults = {
            player1: 0, player2: 0, draws: 0,
        };
        this.players.player1.wins = 0;
        this.players.player2.wins = 0;
        this.challengeNumber = 0;
        try {
            this.ui.renderStatus(
                "Preparing training...",);
            await this.initializeChampion();
            let promotionsCount = 0;
            let gamesPlayed = 0;
            const started = performance.now();
            let drawDrift = 0;
            for (
                let challenge = 1;
                challenge <= challenges;
                challenge++
            ) {
                this.challengeNumber = challenge;
                // ------------------------------------------------
                // Create Player1 from the current Best Brain.
                // ------------------------------------------------
                this.players.player1.brain = new NeuralNetwork(NET_SHAPE).mutate(
                    this.bestBrain, PLAYER1_MUTATION_RATE + drawDrift,);
                // Player2 always receives the champion.
                this.players.player2.brain = this.bestBrain.clone();
                // ------------------------------------------------
                // Play TWO games.
                // ------------------------------------------------
                const result = await this.playChallenge();
                gamesPlayed += 2;
                if (result.player1WonBoth) {
                    promotionsCount++;
                    drawDrift = 0;
                    console.info(
                        `Challenge ${challenge}: Player1 promoted to champion.`,);
                } else if (result.player2WonBoth) {
                    drawDrift = 0;
                } else {
                    drawDrift = Math.min(
                        drawDrift + DRAW_BIAS_RATE, MAX_DRAW_DRIFT,);
                }
                // ------------------------------------------------
                // Update progress.
                // ------------------------------------------------
                if (
                    challenge % PROGRESS_EVERY === 0 ||
                    challenge === challenges
                ) {
                    const results = this.trainingResults;
                    this.ui.renderStatus(
                        `Player1 wins: ${results.player1}\n` +
                        `Player2 wins: ${results.player2}\n` +
                        `Draws: ${results.draws}\n\n` +
                        `New champions: ${promotionsCount}\n` +
                        `Current champion: Player2\n`,);
                        `Training challenge ${challenge}/${challenges}\n\n` +
                        `Games played: ${gamesPlayed}\n\n` +
                    await new Promise(
                        (resolve) => setTimeout(resolve, 0),);
                }
            }
            await this.finalizeTraining({
                challengesPlayed: this.challengeNumber, gamesPlayed, started, promotionsCount,
            });
        } catch (error) {
            console.error("Training failed:", error);
            this.ui.renderStatus(
                `Training failed: ${error.message}`,);
        } finally {
            this.training = false;
            this.trainingStats = null;
            this.ui.trainBtn.disabled = false;
        }
    }
    // ========================================================
    // BATCH TRAINING
    // ========================================================
    async alterBases(maxBatches = 10000) {
        if (this.training) return;
        for (let i = 1; i <= maxBatches; i++) {
            console.info(`Batch ${i}/${maxBatches} is running.`,);
            await loadTrainingData();
            await this.startTraining(TRAINING_CYCLES);
        }
    }
    // ========================================================
    // END GAME
    // ========================================================
    endGame(message) {
        this.legalMoves = [];
        this.gameOver = true;
        this.selectedSquare = null;
        clearTimeout(this.botTimer);
        this.ui.renderStatus(message);
        this.ui.renderBoard(this.actions.board);
    }

    // ========================================================
    // POSITION FEATURE MANAGEMENT
    // ========================================================

    resetPositionFeatures() {
        this.positionFeatures = INITIAL_POSITION_FEATURES();
    }

    // Disable castling rights.
    disableCastling(color, side) {
        const index = color === "w"
            ? (side === "kingside" ? 0 : 1)
            : (side === "kingside" ? 2 : 3);

        this.positionFeatures.castling[index] = 0;
    }

    // Update castling rights when a piece moves.
    updateCastlingAfterMove(
        movingPiece,
        capturedPiece,
        fromRow,
        fromCol,
        toRow,
        toCol
    ) {
        // ----------------------------------------
        // KING MOVES
        // ----------------------------------------
        if (
            movingPiece.type === "k" &&
            fromCol === 4
        ) {
            this.disableCastling(
                movingPiece.color,
                "kingside"
            );

            this.disableCastling(
                movingPiece.color,
                "queenside"
            );
        }

        // ----------------------------------------
        // ROOK MOVES
        // ----------------------------------------
        if (movingPiece.type === "r") {
            const homeRow = movingPiece.color === "w" ? 7 : 0;

            if (fromRow === homeRow) {
                if (fromCol === 7) {
                    this.disableCastling(
                        movingPiece.color,
                        "kingside"
                    );
                }

                if (fromCol === 0) {
                    this.disableCastling(
                        movingPiece.color,
                        "queenside"
                    );
                }
            }
        }

        // ----------------------------------------
        // ROOK CAPTURED ON ITS ORIGINAL SQUARE
        // ----------------------------------------
        if (capturedPiece?.type === "r") {
            const capturedColor = capturedPiece.color;

            const homeRow = capturedColor === "w" ? 7 : 0;

            if (toRow === homeRow) {
                if (toCol === 7) {
                    this.disableCastling(
                        capturedColor,
                        "kingside"
                    );
                }

                if (toCol === 0) {
                    this.disableCastling(
                        capturedColor,
                        "queenside"
                    );
                }
            }
        }
    }

    // Update en passant availability after a successful move.
    updateEnPassantAfterMove(
        movingPiece,
        fromRow,
        fromCol,
        toRow,
        toCol
    ) {
        // Previous en passant rights expire after one move.
        this.positionFeatures.enPassant.fill(0);

        // Only a pawn moving two squares creates
        // a new en passant opportunity.
        if (
            movingPiece.type !== "p" ||
            Math.abs(toRow - fromRow) !== 2
        ) {
            return;
        }

        const opponentColor = movingPiece.color === "w" ? "b" : "w";

        // White availability: indexes 0-7.
        // Black availability: indexes 8-15.
        const index = opponentColor === "w" ? toCol : 8 + toCol;

        this.positionFeatures.enPassant[index] = 1;
    }

    // ========================================================
    // CENTRALIZED MOVE EXECUTION
    // ========================================================

    makeMoveWithFeatures(
        fromRow,
        fromCol,
        toRow,
        toCol,
        promotion = "q"
    ) {
        const movingPiece = this.actions.getPiece(fromRow, fromCol);

        if (!movingPiece) {
            return false;
        }

        // Save the captured piece before the board changes.
        const capturedPiece = this.actions.getPiece(toRow, toCol);

        const movingPieceSnapshot = {
            type: movingPiece.type,
            color: movingPiece.color,
        };

        const capturedPieceSnapshot = capturedPiece
            ? {
                type: capturedPiece.type,
                color: capturedPiece.color,
            }
            : null;

        // Execute the actual chess move.
        const success = this.actions.makeMove(
            fromRow,
            fromCol,
            toRow,
            toCol,
            promotion
        );

        if (!success) {
            return false;
        }

        // Update castling rights.
        this.updateCastlingAfterMove(
            movingPieceSnapshot,
            capturedPieceSnapshot,
            fromRow,
            fromCol,
            toRow,
            toCol
        );

        // Update en passant availability.
        this.updateEnPassantAfterMove(
            movingPieceSnapshot,
            fromRow,
            fromCol,
            toRow,
            toCol
        );

        return true;
    }

}
// ============================================================
// INITIALIZE
// ============================================================
window.addEventListener(
    "DOMContentLoaded", () => {
        new GameManager();
    },);
