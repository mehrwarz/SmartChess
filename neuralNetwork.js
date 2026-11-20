export class Layer {
    constructor(inputCount, outputCount, activation = "relu") {
        this.inputCount = inputCount;
        this.outputCount = outputCount;

        this.inputs = new Float32Array(inputCount);
        this.outputs = new Float32Array(outputCount);
        this.biases = new Float32Array(outputCount);

        // Flat weight matrix
        this.weights = new Float32Array(inputCount * outputCount);

        this.activation = activation;

        Layer.#randomize(this);
    }

    static #randomize(layer) {
        const { inputCount, outputCount, activation, weights } = layer;

        const stdDev =
            activation === "relu"
                ? Math.sqrt(2 / inputCount)
                : Math.sqrt(2 / (inputCount + outputCount));

        for (let i = 0; i < weights.length; i++) {
            weights[i] = Layer.#randomNormal() * stdDev;
        }
    }

    static #randomNormal() {
        const u1 = Math.random() || Number.MIN_VALUE;
        const u2 = Math.random();

        return Math.sqrt(-2 * Math.log(u1)) *
            Math.cos(2 * Math.PI * u2);
    }

    static feedForward(givenInputs, layer) {
        const {
            inputCount,
            outputCount,
            weights,
            biases,
            outputs,
            activation,
        } = layer;

        for (let i = 0; i < outputCount; i++) {
            let sum = biases[i];
            let weightIndex = i;

            for (let j = 0; j < inputCount; j++) {
                sum += givenInputs[j] * weights[weightIndex];
                weightIndex += outputCount;
            }

            outputs[i] = activation === "relu" ? Math.max(0, sum)
                : activation === "sigmoid" ? 1 / (1 + Math.exp(-sum)) : sum;
        }

        return outputs;
    }
}


export class NeuralNetwork {
    constructor(neuronCounts) {
        this.layers = new Array(neuronCounts.length - 1);

        for (let i = 0; i < this.layers.length; i++) {
            const activation =
                i === this.layers.length - 1 ? "sigmoid" : "relu";

            this.layers[i] = new Layer(
                neuronCounts[i],
                neuronCounts[i + 1],
                activation
            );
        }
    }

    predict(inputs) {
        let output = inputs;

        for (let i = 0; i < this.layers.length; i++) {
            output = Layer.feedForward(output, this.layers[i]);
        }

        return output;
    }

    mutate(parent, mutationRate = 0.01) {
        for (let i = 0; i < this.layers.length; i++) {
            const childWeights = this.layers[i].weights;
            const parentWeights = parent.layers[i].weights;

            for (let j = 0; j < childWeights.length; j++) {
                childWeights[j] =
                    parentWeights[j] +
                    (Math.random() * 2 - 1) * mutationRate;
            }
        }

        return this;
    }

    clone() {
        const child = new NeuralNetwork(
            [
                this.layers[0].inputCount,
                ...this.layers.map(layer => layer.outputCount)
            ]
        );

        for (let i = 0; i < this.layers.length; i++) {
            child.layers[i].weights.set(this.layers[i].weights);
            child.layers[i].biases.set(this.layers[i].biases);
        }

        return child;
    }
}


export function initBoard() {
  const pieces = {
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

  const layout = ["r", "n", "b", "q", "k", "b", "n", "r"];

  // 64 squares * 4 bits
  // 16 en passant flags + 5 additional features
  const board = new Uint8Array(277);

  let offset = 0;

  // Black back rank
  for (let i = 0; i < 8; i++) {
    board.set(pieces.b[layout[i]], offset);
    offset += 4;
  }

  // Black pawns
  for (let i = 0; i < 8; i++) {
    board.set(pieces.b.p, offset);
    offset += 4;
  }

  // Empty squares are already initialized to zero.
  offset += 128;

  // White pawns
  for (let i = 0; i < 8; i++) {
    board.set(pieces.w.p, offset);
    offset += 4;
  }

  // White back rank
  for (let i = 0; i < 8; i++) {
    board.set(pieces.w[layout[i]], offset);
    offset += 4;
  }

  return board;
}


// const squareIndex = (row * 8 + col) * 4;