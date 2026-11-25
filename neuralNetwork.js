export class Layer {
    constructor(inputCount, outputCount, activation = "relu") {
        this.inputCount = inputCount;
        this.outputCount = outputCount;

        this.inputs = new Float32Array(inputCount);
        this.outputs = new Float32Array(outputCount);
        // Reused by NeuralNetwork.train for the backward pass.
        this.errors = new Float32Array(outputCount);
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

        if (!givenInputs || givenInputs.length !== inputCount) {
            throw new Error(
                `Invalid network input: expected ${inputCount}, received ${givenInputs?.length}.`
            );
        }

        for (let j = 0; j < inputCount; j++) {
            if (!Number.isFinite(givenInputs[j])) {
                throw new Error(
                    `Invalid input at index ${j}: ${givenInputs[j]}`
                );
            }
        }

        for (let i = 0; i < outputCount; i++) {
            let sum = biases[i];
            let weightIndex = i;

            if (!Number.isFinite(sum)) {
                throw new Error(`Invalid bias at neuron ${i}.`);
            }

            for (let j = 0; j < inputCount; j++) {
                const weight = weights[weightIndex];

                if (!Number.isFinite(weight)) {
                    throw new Error(`Invalid weight at index ${weightIndex}.`);
                }

                sum += givenInputs[j] * weight;
                weightIndex += outputCount;
            }

            if (!Number.isFinite(sum)) {
                throw new Error(
                    `NaN detected during feedforward at neuron ${i}.`
                );
            }

            if (activation === "relu") {
                outputs[i] = Math.max(0, sum);
            } else if (activation === "sigmoid") {
                outputs[i] = 1 / (1 + Math.exp(-sum));
            } else {
                outputs[i] = sum;
            }
        }

        return outputs;
    }

}


export class NeuralNetwork {
    constructor(neuronCounts) {
        this.layers = new Array(neuronCounts.length - 1);

        for (let i = 0; i < this.layers.length; i++) {
            const activation = i === this.layers.length - 1 ? "sigmoid" : "relu";
            this.layers[i] = new Layer(neuronCounts[i], neuronCounts[i + 1], activation);
        }
    }

    predictRaw(inputs) {
        let output = inputs;

        for (let i = 0; i < this.layers.length; i++) {
            output = Layer.feedForward(output, this.layers[i]);
        }

        return Array.from(output);
    }

    predict(inputs) {
        const raw = this.predictRaw(inputs);

        if (raw.length !== 5) {
            throw new Error("Expected exactly 5 network outputs.");
        }

        return [...raw.slice(0, 4).map(value => Math.min(7, Math.max(0, Math.round(value * 7)))),
        Math.min(3, Math.max(0, Math.round(raw[4] * 3)))
        ];
    }


    // One gradient step over every layer toward four target coordinates (0-7).
    // The old version only touched the output layer, which cannot change what
    // the hidden layers detect, so training never improved the policy. This is
    // full backprop: sigmoid derivative on the output, ReLU derivative on the
    // hidden layers, plain MSE loss on target/7.
    train(inputs, target, rate = 0.05) {
        if (
            !inputs ||
            inputs.length !== this.layers[0].inputCount
        ) {
            throw new Error("Invalid training input size.");
        }

        if (!target || target.length !== 5) {
            throw new Error("Invalid training target.");
        }

        for (let i = 0; i < target.length; i++) {
            if (!Number.isFinite(target[i])) {
                throw new Error(
                    `Invalid training target at index ${i}.`
                );
            }
        }

        let activation = inputs;

        for (const layer of this.layers) {
            layer.inputs.set(activation);
            activation = Layer.feedForward(activation, layer);
        }

        const outputLayer = this.layers[this.layers.length - 1];
        let errors = outputLayer.errors;

        for (let i = 0; i < outputLayer.outputCount; i++) {
            const output = outputLayer.outputs[i];
            // d(0.5 * (output - target)^2)/dz for a sigmoid output.
            const targetScale = i === 4 ? 3 : 7;
            errors[i] = (target[i] / targetScale - output) * output * (1 - output);
        }

        // Walk backwards. Deltas for the previous layer are computed from the
        // pre-update weights, then this layer is nudged along its own deltas.
        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layer = this.layers[l];

            if (l > 0) {
                const previous = this.layers[l - 1];
                const previousErrors = previous.errors;

                for (let j = 0; j < previous.outputCount; j++) {
                    let sum = 0;

                    // ReLU derivative: 0 where the unit is switched off.
                    if (previous.outputs[j] > 0) {
                        for (let i = 0; i < layer.outputCount; i++) {
                            sum += errors[i] * layer.weights[j * layer.outputCount + i];
                        }
                    }

                    previousErrors[j] = sum;
                }
            }

            const layerInputs = layer.inputs;

            for (let i = 0; i < layer.outputCount; i++) {
                const error = errors[i];
                if (error === 0) continue;

                const delta = error * rate;
                layer.biases[i] += delta;

                let weightIndex = i;
                for (let j = 0; j < layer.inputCount; j++) {
                    layer.weights[weightIndex] += delta * layerInputs[j];
                    weightIndex += layer.outputCount;
                }
            }

            errors = l > 0 ? this.layers[l - 1].errors : errors;
        }
    }

    // Plain-JSON form so a brain can be written to disk and reloaded later.
    // Weights are rounded slightly to keep the file small.
    toJSON() {
        return {
            shape: [this.layers[0].inputCount, ...this.layers.map(layer => layer.outputCount)],
            layers: this.layers.map(layer => ({
                weights: Array.from(layer.weights, weight => Number(weight.toFixed(5))),
                biases: Array.from(layer.biases, bias => Number(bias.toFixed(5)))
            }))
        };
    }

    static fromJSON(data) {
        if (!data || !Array.isArray(data.shape) || !Array.isArray(data.layers)) {
            throw new Error("Brain file must contain a shape and layers.");
        }

        const network = new NeuralNetwork(data.shape);

        if (data.layers.length !== network.layers.length) {
            throw new Error("Brain file does not match the network shape.");
        }

        for (let i = 0; i < network.layers.length; i++) {
            const layer = network.layers[i];
            const saved = data.layers[i];

            if (!saved ||
                !Array.isArray(saved.weights) ||
                !Array.isArray(saved.biases) ||
                saved.weights.length !== layer.weights.length ||
                saved.biases.length !== layer.biases.length) {
                throw new Error(`Brain file layer ${i} does not match the network shape.`);
            }

            if (
                !saved.weights.every(Number.isFinite) ||
                !saved.biases.every(Number.isFinite)
            ) {
                throw new Error(
                    `Brain file contains invalid numbers in layer ${i}.`
                );
            }
            layer.weights.set(saved.weights);
            layer.biases.set(saved.biases);
        }

        return network;
    }

    // Copies the parent's weights and biases, then nudges both. Mutating only
    // the weights used to drop every bias the champion had learned, so each
    // challenger started with zeroed biases and was not really a copy of the
    // champion.
    mutate(parent, mutationRate = 0.01) {
        for (let i = 0; i < this.layers.length; i++) {
            const childWeights = this.layers[i].weights;
            const parentWeights = parent.layers[i].weights;

            for (let j = 0; j < childWeights.length; j++) {
                childWeights[j] =
                    parentWeights[j] +
                    (Math.random() * 2 - 1) * mutationRate;
            }

            const childBiases = this.layers[i].biases;
            const parentBiases = parent.layers[i].biases;

            for (let j = 0; j < childBiases.length; j++) {
                childBiases[j] =
                    parentBiases[j] +
                    (Math.random() * 2 - 1) * mutationRate;
            }
        }

        return this;
    }

    // Bias-only mutation, used to break a drawing line without disturbing the
    // weights that encode the champion's policy.
    mutateBiases(mutationRate = 0.01) {
        for (const layer of this.layers) {
            for (let i = 0; i < layer.biases.length; i++) {
                layer.biases[i] += (Math.random() * 2 - 1) * mutationRate;
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
