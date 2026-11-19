export class Layer {
  constructor(inputCount, outputCount, activation = "relu") {
    this.inputs = new Array(inputCount);
    this.outputs = new Array(outputCount);
    this.biases = new Array(outputCount);
    this.weights = [];
    this.activation = activation;

    for (let i = 0; i < inputCount; i++) {
      this.weights[i] = new Array(outputCount);
    }

    Layer.#randomize(this);
  }

  static #randomize(level) {
    const inputCount = level.inputs.length;
    const outputCount = level.outputs.length;

    let standardDeviation;

    if (level.activation === "relu") {
      // He initialization
      standardDeviation = Math.sqrt(2 / inputCount);
    } else {
      // Xavier initialization
      standardDeviation = Math.sqrt(2 / (inputCount + outputCount));
    }

    for (let i = 0; i < inputCount; i++) {
      for (let j = 0; j < outputCount; j++) {
        level.weights[i][j] = Layer.#randomNormal() * standardDeviation;
      }
    }

    // Initialize biases to zero
    level.biases.fill(0);
  }

  static #randomNormal() {
    const u1 = Math.random();
    const u2 = Math.random();

    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  static feedForward(givenInputs, level) {
    for (let i = 0; i < level.inputs.length; i++) {
      level.inputs[i] = givenInputs[i];
    }

    for (let i = 0; i < level.outputs.length; i++) {
      let sum = level.biases[i];

      for (let j = 0; j < level.inputs.length; j++) {
        sum += level.inputs[j] * level.weights[j][i];
      }

      level.outputs[i] = Layer.#activate(sum, level.activation);
    }

    return level.outputs;
  }

  static #activate(value, activation) {
    switch (activation) {
      case "relu":
        return Math.max(0, value);
      case "sigmoid":
        return 1 / (1 + Math.exp(-value));
      default:
        return value;
    }
  }
}

export class NeuralNetwork {
  constructor(neuronCounts) {
    this.layers = [];

    for (let i = 0; i < neuronCounts - 1; i++) {
      const activation = i === neuronCounts.length - 2 ? "sigmoid" : "relu";

      this.layers.push(
        new Layer(neuronCounts[i], neuronCounts[i + 1], activation),
      );
    }
  }

  startLearning() {
    const whiteBrian = new NeuralNetwork([277, 114, 54, 4]);
    const blackBrian = new NeuralNetwork([277, 114, 54, 4]);

    // Modifing the black brain
    blackBrian.layers.forEach((l, i) => {
      for (let j = 0; j < l.inputs.length; j++) {
        for (let k = 0; k < l.outputs.length; k++) {
          const mutation = (Math.random() * 2 - 1) * 0.01;
          l.weights[j][k] = whiteBrian.layers[i].weights[j][k] + mutation;
        }
      }
    });

    return initBoard();
  }
}

function initBoard() {
  const picies = {
    w: {
      p: [0, 0, 0, 1],
      n: [0, 0, 1, 0],
      b: [0, 0, 1, 1],
      r: [0, 1, 0, 0],
      q: [0, 1, 0, 1],
      k: [0, 1, 1, 0],
    },
    b: {
      p: [1, 0, 0, 1],
      n: [1, 0, 1, 0],
      b: [1, 0, 1, 1],
      r: [1, 1, 0, 0],
      q: [1, 1, 0, 1],
      k: [1, 1, 1, 0],
    },
  };

  // White A,B,C,D,E,F,G,H and Black A,B,C,D,E,F,G,H; 0 unavailable 1 available
  const enPassant = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  
  const features = [
    0, // White kingside castling
    0, // White queenside castling
    0, // Black kingside castling
    0, // Black queenside castling
    0, // Side to move (0 = White, 1 = Black)
  ];

  const layout = ["r", "n", "b", "q", "k", "b", "n", "r"];
  const board = [];
  const blackPawnsRank = [];
  const whitePawnsRank = [];
  for (let i = 0; i < 8; i++) {
    blackPawnsRank.push(...picies.b.p);
    whitePawnsRank.push(...picies.w.p);
  }
  layout.map((p) => {
    board.push(...picies.b[p]);
  });

  board.push(...blackPawnsRank);
  board.push(...new Array(128).fill(0));
  board.push(...whitePawnsRank);
  layout.map((p) => {
    board.push(...picies.w[p]);
  });

  return [...board, ...enPassant, ...features];
}

// const squareIndex = (row * 8 + col) * 4;
