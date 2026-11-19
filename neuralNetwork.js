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
            standardDeviation = Math.sqrt(
                2 / (inputCount + outputCount)
            );
        }

        for (let i = 0; i < inputCount; i++) {
            for (let j = 0; j < outputCount; j++) {

                level.weights[i][j] =
                    Layer.#randomNormal() * standardDeviation;

            }
        }

        // Initialize biases to zero
        level.biases.fill(0);
    }

    static #randomNormal() {

        const u1 = Math.random();
        const u2 = Math.random();

        return Math.sqrt(-2 * Math.log(u1)) *
            Math.cos(2 * Math.PI * u2);
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

        for (let i = 0; i < neuronCounts.length - 1; i++) {
            const activation =
                i === neuronCounts.length - 2
                    ? "sigmoid"
                    : "relu";

            this.layers.push(
                new Layer(
                    neuronCounts[i],
                    neuronCounts[i + 1],
                    activation
                )
            );
        }
    }
}


const whiteBrian = new NeuralNetwork([266, 102, 42, 4]);
const blackBrian = new NeuralNetwork([266, 102, 42, 4]);

blackBrian.layers.forEach((l, i) => {
    for (let j = 0; j < l.inputs.length; j++) {
       for (let k = 0; k < l.outputs.length; k++) {
            const mutation = (Math.random() * 2 - 1) * 0.01;
            l.weights[j][k] = whiteBrian.layers[i].weights[j][k] + mutation;
        }
    }
});


// const squareIndex = (row * 8 + col) * 4;


// let file = ["A","B","C","D","E","F","G","H"];
// let str = "[";
// for(let i=0; i<8; i++ ){
//     for(j=0; j<8; j++ ){
//         Decimal	Binary	Meaning
//         0	0000	Empty
//         1	0001	White Pawn
//         2	0010	White Knight
//         3	0011	White Bishop
//         4	0100	White Rook
//         5	0101	White Queen
//         6	0110	White King
//         7	0111	Reserved
//         8	1000	Black identifier
//         9	1001	Black Pawn
//         10	1010	Black Knight
//         11	1011	Black Bishop
//         12	1100	Black Rook
//         13	1101	Black Queen
//         14	1110	Black King
//         15	1111	Reserved
//     }
// }

// 257–260	En passant file (4 bits)
// Unavailable	0000
//         A	1000
//         B	1001
//         C	1010
//         D	1011
//         E	1100
//         F	1101
//         G	1110
//         H	1111

// 261	White kingside castling
// 262	White queenside castling
// 263	Black kingside castling
// 264	Black queenside castling
// 265	Side to move (0 = White, 1 = Black)
// 266	Available for another feature

