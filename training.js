let trainingChart = null;

async function loadTrainingData() {
    try {
        const response = await fetch("./training-log.csv");

        if (!response.ok) {
            throw new Error(`CSV loading failed: HTTP ${response.status}`);
        }

        const csvText = await response.text();
        const lines = csvText.trim().split(/\r?\n/);

        // Handle possible UTF-8 BOM
        const headers = lines[0].replace(/^\uFEFF/, "").split(",").map(h => h.trim());
        const trainingData = lines.slice(1)
            .filter(line => line.trim() !== "")
            .map(line => {
                const values = line.split(",").map(Number);
                const row = {};

                headers.forEach((header, index) => {
                    row[header] = values[index];
                });

                return row;
            });

        if (trainingData.length === 0) {
            throw new Error("CSV contains no training records.");
        }

        createTrainingChart(trainingData);

    } catch (error) {
        console.error("Training visualization error:", error);

    }
}

function createTrainingChart(data) {
    const canvas = document.getElementById("trainingChart");

    if (!canvas) {
        console.error("Canvas #trainingChart not found!");
        return;
    }

    if (typeof Chart === "undefined") {
        console.error("Chart.js library was not loaded!");
        return;
    }

    const metrics = [
        { column: "black win", label: "Black Wins", color: "#ef4444" },
        { column: "white win", label: "White Wins", color: "#22c540" },
        { column: "draw", label: "Draws", color: "#eab308" },
        { column: "corrected", label: "Corrected", color: "#1815f2" },
        { column: "illegal move", label: "Illegal Moves", color: "#f97316" },
        { column: "empty square", label: "Empty Squares", color: "#a855f7" },
        { column: "repeated", label: "Repeated Moves", color: "#17a3f5" }
    ];

    // Validate CSV columns
    metrics.forEach(metric => {
        if (!headersExist(metric.column, data)) {
            throw new Error(`Missing CSV column: ${metric.column}`);
        }
    });

    const labels = data.map(row => `Training ${row.Training}`);
    const datasets = metrics.map(metric => {
        const values = data.map(row => row[metric.column]);
        const maxValue = Math.max(...values);

        return {
            label: metric.label,
            data: values.map(value => maxValue > 0 ? (value / maxValue) * 100 : 0 ),
            borderColor: metric.color,
            backgroundColor: metric.color,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 6,
            fill: false,
            tension: 0.3
        };
    });

    if (trainingChart) {
        trainingChart.destroy();
    }

    trainingChart = new Chart(canvas, {
        type: "line",
        data: {
            labels: labels,
            datasets: datasets
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: "index"
            },

            plugins: {
                legend: {
                    display: true,
                    position: "bottom",
                    labels: {
                        color: "#ffffff",
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        label: function (context) {
                            return context.dataset.label + ": " + context.parsed.y.toFixed(2) + "%";
                        }
                    }
                }
            },

            scales: {
                x: {
                    title: {
                        display: true,
                        text: "Training Iteration",
                        color: "#ffffff"
                    },

                    ticks: {
                        color: "#cccccc",
                        maxTicksLimit: 10
                    },

                    grid: {
                        color: "#333333"
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: "Normalized Values (%)",
                        color: "#ffffff"
                    },
                    ticks: {
                        color: "#cccccc",
                        callback: value => value + "%"
                    },
                    grid: {
                        color: "#333333"
                    }
                }
            }
        }
    });
}

function headersExist(column, data) { return data.length > 0 && Object.prototype.hasOwnProperty.call(data[0], column); }

// IMPORTANT: Start loading the CSV! 
loadTrainingData();