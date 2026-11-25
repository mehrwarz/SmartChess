const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = 5500;
const HOST = "localhost";

// Saved networks live here, one JSON file per side.
const BRAIN_DIR = path.join(__dirname, "brains");
const BRAIN_COLORS = new Set(["white", "black"]);
const MAX_BRAIN_BYTES = 8 * 1024 * 1024;

// Historical champion snapshots.
const BRAIN_ARCHIVE = path.join(BRAIN_DIR, "archive.json");
const MAX_ARCHIVE_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10000;

// Training history: one CSV row per finished 1000-game run.
const TRAINING_LOG = path.join(__dirname, "training-log.csv");
const TRAINING_LOG_HEADER = "Training,Player1 wins,Player2 wins,Draws,Corrected,Illegal move,Empty square,Repeated, Champion Changes";
const MAX_LOG_BYTES = 64 * 1024;

// Map file extensions to correct MIME types (critical for ES6 modules)
const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".csv": "text/csv",
};

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};

// Write through a temporary file and rename it into place. A request that is
// interrupted mid-write leaves the previous brain intact instead of truncating
// brains/{color}.json to zero bytes.
const writeFileAtomic = (filePath, data, callback) => {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFile(tempPath, data, (writeError) => {
    if (writeError) {
      fs.unlink(tempPath, () => callback(writeError));
      return;
    }

    fs.rename(tempPath, filePath, (renameError) => {
      if (renameError) {
        fs.unlink(tempPath, () => callback(renameError));
        return;
      }

      callback(null);
    });
  });
};

// GET /api/brains/{white|black} -> saved weights
// POST /api/brains/{white|black} -> persist weights to brains/{color}.json
const handleBrainRequest = (req, res, color) => {
  const filePath = path.join(BRAIN_DIR, `${color}.json`);

  if (req.method === "GET") {
    fs.readFile(filePath, "utf-8", (err, content) => {
      if (err) {
        return sendJson(res, err.code === "ENOENT" ? 404 : 500, {
          error:
            err.code === "ENOENT" ? `No saved ${color} brain yet` : err.code,
        });
      }

      // An interrupted older write could leave an empty file. Treat it
      // as "nothing saved" so training starts fresh and the next save
      // repairs the file, instead of making the client fall back to
      // browser storage permanently.
      if (!content.trim()) {
        return sendJson(res, 404, { error: `No saved ${color} brain yet` });
      }

      try {
        sendJson(res, 200, JSON.parse(content));
      } catch {
        sendJson(res, 404, { error: `Saved ${color} brain is not valid JSON` });
      }
    });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on("data", (chunk) => {
    if (aborted) return;

    size += chunk.length;
    if (size > MAX_BRAIN_BYTES) {
      aborted = true;
      req.destroy();
      sendJson(res, 413, { error: "Brain file is too large" });
      return;
    }

    chunks.push(chunk);
  });

  req.on("error", () => {
    if (!aborted) {
      aborted = true;
      sendJson(res, 500, { error: "Upload failed" });
    }
  });

  req.on("end", () => {
    if (aborted) return;

    let brain;
    try {
      brain = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    } catch {
      sendJson(res, 400, { error: "Body must be JSON" });
      return;
    }

    if (!brain || !Array.isArray(brain.shape) || !Array.isArray(brain.layers)) {
      sendJson(res, 400, { error: "Not a serialized neural network" });
      return;
    }

    fs.mkdir(BRAIN_DIR, { recursive: true }, (mkdirError) => {
      if (mkdirError) {
        sendJson(res, 500, { error: mkdirError.code });
        return;
      }

      writeFileAtomic(filePath, JSON.stringify(brain), (writeError) => {
        if (writeError) {
          sendJson(res, 500, { error: writeError.code });
          return;
        }

        sendJson(res, 200, { saved: `brains/${color}.json` });
      });
    });
  });
};

const TRAINING_COLUMNS = TRAINING_LOG_HEADER.split(",").length;

const countTrainingSessions = (csv) =>
  Math.max(
    0,
    csv.split(/\r?\n/).filter((line) => line.trim() !== "").length - 1,
  );

// Early logs had only four columns. Keep their rows and pad the new counters
// with zeroes, so a file always carries one consistent header.
const normalizeTrainingCsv = (csv) => {
  const lines = String(csv ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) return `${TRAINING_LOG_HEADER}\n`;

  if (lines[0].trim() !== TRAINING_LOG_HEADER) {
    lines[0] = TRAINING_LOG_HEADER;
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",");
      while (cells.length < TRAINING_COLUMNS) cells.push("0");
      lines[i] = cells.slice(0, TRAINING_COLUMNS).join(",");
    }
  }

  return `${lines.join("\n")}\n`;
};

const readTrainingCsv = () => {
  try {
    return normalizeTrainingCsv(fs.readFileSync(TRAINING_LOG, "utf-8"));
  } catch {
    return `${TRAINING_LOG_HEADER}\n`;
  }
};

// GET /api/training-log -> CSV session history
// POST /api/training-log { black, white, draws, corrected, illegal, empty, repeated }
// -> append one session row
const handleTrainingLogRequest = (req, res) => {
  if (req.method === "GET") {
    const csv = readTrainingCsv();

    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Length": Buffer.byteLength(csv),
      "Cache-Control": "no-store",
    });

    res.end(csv);
    return;

  }

  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); sendJson(res, 405, { error: "Method not allowed" }); return; }

  const chunks = []; let size = 0; let aborted = false;

  req.on("data", (chunk) => {
    if (aborted) return;

    size += chunk.length;

    if (size > MAX_LOG_BYTES) {
      aborted = true;
      req.resume();

      sendJson(res, 413, {
        error: "Training result is too large",
      });

      return;
    }

    chunks.push(chunk);

  });

  req.on("error", () => {
    if (!aborted) {
      aborted = true;

      sendJson(res, 500, {
        error: "Upload failed",
      });
    }

  });

  req.on("end", () => {
    if (aborted) return;

    let result;

    try {
      result = JSON.parse(
        Buffer.concat(chunks).toString("utf-8")
      );
    } catch {
      sendJson(res, 400, {
        error: "Body must be valid JSON",
      });

      return;
    }

    const values = [
      result?.player1,
      result?.player2,
      result?.draws,
      result?.corrected ?? 0,
      result?.illegal ?? 0,
      result?.empty ?? 0,
      result?.repeated ?? 0,
      result?.championChanges??0,
    ];

    const names = [
      "player1",
      "player2",
      "draws",
      "corrected",
      "illegal",
      "empty",
      "repeated",
      "championChanges"
    ];

    for (let i = 0; i < values.length; i++) {
      if (
        !Number.isInteger(values[i]) ||
        values[i] < 0
      ) {
        sendJson(res, 400, {
          error: `Invalid training value: ${names[i]}`,
          received: values[i] ?? null,
        });

        return;
      }
    }

    const existing = readTrainingCsv();
    const session = countTrainingSessions(existing) + 1;

    try {
      fs.writeFileSync(
        TRAINING_LOG,
        `${existing}${session},${values.join(",")}\n`,
      );
    } catch (error) {
      sendJson(res, 500, {
        error: error.code || "Could not write training log",
      });

      return;
    }

    sendJson(res, 200, {
      saved: "training-log.csv",
      session,
    });

  });
};


// GET /api/brains/archive -> all archived champions
// POST /api/brains/archive -> append a new champion snapshot
let archiveWriteQueue = Promise.resolve();

const readBrainArchive = async () => {
  try {
    const content = await fs.promises.readFile(BRAIN_ARCHIVE, "utf-8");
    const archive = JSON.parse(content);

    if (!Array.isArray(archive)) {
      throw new Error("Archive must contain a JSON array");
    }

    return archive;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const handleBrainArchiveRequest = (req, res) => {
  if (req.method === "GET") {
    readBrainArchive()
      .then((archive) => {
        res.setHeader("Cache-Control", "no-store");
        sendJson(res, 200, archive);
      })
      .catch((error) => {
        console.error("Archive read failed:", error);
        sendJson(res, 500, { error: "Could not read brain archive" });
      });

    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on("data", (chunk) => {
    if (aborted) return;

    size += chunk.length;

    if (size > MAX_ARCHIVE_ENTRY_BYTES) {
      aborted = true;
      req.resume();
      sendJson(res, 413, { error: "Archive entry is too large" });
      return;
    }

    chunks.push(chunk);
  });

  req.on("error", () => {
    if (!aborted) {
      aborted = true;
      sendJson(res, 500, { error: "Archive upload failed" });
    }
  });

  req.on("end", () => {
    if (aborted) return;

    let snapshot;

    try {
      snapshot = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    } catch {
      sendJson(res, 400, { error: "Body must be valid JSON" });
      return;
    }

    // Validate the snapshot before saving.
    if (
      !snapshot ||
      typeof snapshot.timestamp !== "string" ||
      typeof snapshot.score !== "number" ||
      !Number.isFinite(snapshot.score) ||
      snapshot.score < 0 ||
      snapshot.score > 1 ||
      !snapshot.brain ||
      !Array.isArray(snapshot.brain.shape) ||
      !Array.isArray(snapshot.brain.layers)
    ) {
      sendJson(res, 400, {
        error: "Invalid champion snapshot",
      });
      return;
    }

    // Serialize archive writes so simultaneous requests cannot
    // overwrite each other's appended entries.
    const operation = archiveWriteQueue.then(async () => {
      await fs.promises.mkdir(BRAIN_DIR, { recursive: true });

      const archive = await readBrainArchive();

      if (archive.length >= MAX_ARCHIVE_ENTRIES) {
        throw new Error("Maximum archive entries reached");
      }

      archive.push(snapshot);

      await new Promise((resolve, reject) => {
        writeFileAtomic(
          BRAIN_ARCHIVE,
          JSON.stringify(archive, null, 2),
          (error) => (error ? reject(error) : resolve()),
        );
      });

      return archive.length;
    });

    archiveWriteQueue = operation.catch(() => { });

    operation
      .then((count) => {
        sendJson(res, 200, {
          saved: "brains/archive.json",
          generation: count,
          games: snapshot.games,
          score: snapshot.score,
        });
      })
      .catch((error) => {
        console.error("Archive write failed:", error);

        sendJson(res, 500, {
          error: error.message || "Could not archive champion",
        });
      });
  });
};


const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);

  if (url.pathname === "/api/training-log") {
    handleTrainingLogRequest(req, res);
    return;
  }

  if (url.pathname === "/api/brains/archive") {
    handleBrainArchiveRequest(req, res);
    return;
  }

  const brainMatch = url.pathname.match(/^\/api\/brains\/([^/]+)$/);

  if (brainMatch) {
    const color = decodeURIComponent(brainMatch[1]);

    if (!BRAIN_COLORS.has(color)) {
      sendJson(res, 404, { error: "Unknown brain color" });
      return;
    }

    handleBrainRequest(req, res, color);
    return;
  }

  // Normalize URL path
  let filePath = path.join(
    __dirname,
    url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname),
  );
  let extname = path.extname(filePath);
  let contentType = MIME_TYPES[extname] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        // File not found
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>404 Not Found</h1>", "utf-8");
      } else {
        // Server error
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      // Success
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Chess server running at http://${HOST}:${PORT}/`);
});
