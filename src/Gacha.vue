<template>
    <div class="container">
        <h1>ガチャシミュレータ</h1>

        <div>
            <label>目標PU数</label>
            <input v-model.number="target" type="number" :min="targetMin" :max="targetMax" step="1">
            <button @click="simulate">
                再試行
            </button>
        </div>
        <div class="result">
            <p>
                平均 旧仕様：
                {{ averageOldPulls.toFixed(1) }}連
                、新仕様：
                {{ averageNewPulls.toFixed(1) }}連
                、新仕様+特典：
                {{ averageNewBonusPulls.toFixed(1) }}連
            </p>
        </div>
    </div>
    <div class="chart-container">
        <canvas ref="chartCanvas"></canvas>
    </div>
    <p class="note">
        ※PU率0.7%で10連ずつ引いた場合に目標PU数に達するまでを10000回シミュレーションした累積確率を算出します。<br>
        特典の10連チケットは即消費とします。表示確率はシミュレーション結果に基づく値であり、厳密な確率ではありません。
    </p>
</template>

<script setup>
import { ref, onMounted, watch } from "vue"
import Chart from "chart.js/auto"

const chartCanvas = ref()
let chart

function createLabels() {
    const maxPulls = target.value * 200

    return Array.from(
        { length: maxPulls / 10 + 1 },
        (_, i) => i * 10
    )
}

const rateMin = 0
const rateMax = 10
const targetMin = 1
const targetMax = 6
const simulateCountMin = 1
const simulateCountMax = 100000

const rate = ref(0.7)
const target = ref(2)
const simulateCount = ref(10000)

const histogramOld = ref({})
const histogramNew = ref({})
const histogramNewBonus = ref({})
const totalSimulations = ref(0)

const averageOldPulls = ref(0)
const averageNewPulls = ref(0)
const averageNewBonusPulls = ref(0)

onMounted(() => {
    const labels = createLabels()
    chart = new Chart(chartCanvas.value, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "旧仕様",
                    data: new Array(labels.length).fill(0),
                    borderColor: "#42A5F5",
                    backgroundColor: "#42A5F5",
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.15
                },
                {
                    label: "新仕様",
                    data: new Array(labels.length).fill(0),
                    borderColor: "#EF5350",
                    backgroundColor: "#EF5350",
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.15
                },
                {
                    label: "新仕様+特典",
                    data: new Array(labels.length).fill(0),
                    borderColor: "#66BB6A",
                    backgroundColor: "#66BB6A",
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.15
                }
            ]

        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: "index"
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            const label = items[0].label;
                            return `${label}連`;
                        },
                        label: function (context) {
                            const value = context.parsed.y;
                            return `${context.dataset.label}: ${(value * 100).toFixed(1)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: "回数"
                    },
                    ticks: {
                        callback: function (value, index) {
                            return `${this.getLabelForValue(value)}連`;
                        }
                    }
                },
                y: {
                    min: 0,
                    max: 1,
                    title: {
                        display: true,
                        text: "累積確率"
                    },
                    ticks: {
                        callback: value => `${Math.round(value * 100)}%`
                    }
                }
            }
        },

    })
    simulate()
})
let timer

watch(
    [rate, target, simulateCount],
    () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
            if (chart) {
                simulate()
            }
        }, 300)
    }
)

function updateChart() {
    const labels = createLabels()

    let cumulativeOld = 0
    let cumulativeNew = 0
    let cumulativeNewBonus = 0

    const oldData = []
    const newData = []
    const newBonusData = []

    labels.forEach(label => {
        cumulativeOld += histogramOld.value[label] ?? 0
        cumulativeNew += histogramNew.value[label] ?? 0
        cumulativeNewBonus += histogramNewBonus.value[label] ?? 0

        if (totalSimulations.value === 0) {
            oldData.push(0)
            newData.push(0)
            newBonusData.push(0)
        } else {
            oldData.push(
                cumulativeOld / totalSimulations.value
            )
            newData.push(
                cumulativeNew / totalSimulations.value
            )
            newBonusData.push(
                cumulativeNewBonus / totalSimulations.value
            )
        }
    })

    chart.data.labels = labels

    chart.data.datasets[0].data = oldData
    chart.data.datasets[1].data = newData
    chart.data.datasets[2].data = newBonusData

    chart.update()
}

function simulateOnce() {
    let pickup = 0
    let count10 = 0
    while (true) {
        count10++
        // 10連中に最大1個まで
        let isPickup = false

        for (let i = 0; i < 10; i++) {
            if (Math.random() * 100 < rate.value) {
                isPickup = true
                break
            }
        }
        if (isPickup) {
            pickup++
        }
        const totalPulls = count10 * 10
        const exchange = Math.floor(totalPulls / 200)

        if (pickup + exchange >= target.value) {
            break
        }
    }
    return {
        pulls: count10 * 10,
        pickup
    }
}

function simulateOnceNew() {
    let pickup = 0
    let count = 0
    let point = 0
    while (pickup < target.value) {
        // 10連
        let isPickupInTen = false
        for (let i = 0; i < 10; i++) {
            count++
            point++
            let currentRate = rate.value
            // 100ポイント、200ポイント到達時のみ確率アップ
            if (point === 200) {
                currentRate = 100
            }
            else if (point === 100) {
                currentRate = 50
            }
            if (Math.random() * 100 < currentRate) {
                // PU取得でポイントリセット
                point = 0
                if (!isPickupInTen) {
                    // 10連内最大1個まで
                    pickup++
                    isPickupInTen = true
                }
            }
        }
    }

    return {
        pulls: count,
        pickup
    }
}
function simulateOnceNewBonus() {
    let pickup = 0
    let count = 0
    let returnCount = 0
    let point = 0

    // 無料になるガチャ回数
    const freePulls = [
        [71, 80],
        [131, 140],
        [151, 160],
        [171, 180],
        [271, 280],
        [331, 340],
        [351, 360],
        [371, 380]
    ]

    while (pickup < target.value) {
        // 10連
        let isPickupInTen = false
        for (let i = 0; i < 10; i++) {
            count++
            // 無料区間ではない場合だけ消費回数を増やす
            const isFree = freePulls.some(
                ([start, end]) => count >= start && count <= end
            )
            if (!isFree) {
                returnCount++
            }
            point++
            let currentRate = rate.value
            // 100ポイント、200ポイント到達時のみ確率アップ
            if (point === 200) {
                currentRate = 100
            }
            else if (point === 100) {
                currentRate = 50
            }
            if (Math.random() * 100 < currentRate) {
                // PU取得でポイントリセット
                point = 0
                if (!isPickupInTen) {
                    // 10連内最大1個まで
                    pickup++
                    isPickupInTen = true
                }
            }
        }
    }
    return {
        pulls: returnCount,
        pickup
    }
}

function simulate() {
    if (
        rate.value < rateMin ||
        rate.value > rateMax ||
        target.value < targetMin ||
        target.value > targetMax ||
        simulateCount.value < simulateCountMin ||
        simulateCount.value > simulateCountMax
    ) {
        averageOldPulls.value = 0
        averageNewPulls.value = 0
        averageNewBonusPulls.value = 0

        if (chart) {
            chart.data.datasets[0].data = []
            chart.data.datasets[1].data = []
            chart.data.datasets[2].data = []
            chart.update()
        }
        return
    }

    histogramOld.value = {}
    histogramNew.value = {}
    histogramNewBonus.value = {}

    totalSimulations.value = 0

    let totalOldPulls = 0
    let totalNewPulls = 0
    let totalNewBonusPulls = 0

    for (let i = 0; i < simulateCount.value; i++) {
        // 旧仕様
        const oldResult = simulateOnce()
        totalOldPulls += oldResult.pulls
        histogramOld.value[oldResult.pulls] =
            (histogramOld.value[oldResult.pulls] ?? 0) + 1
        // 新仕様
        const newResult = simulateOnceNew()
        totalNewPulls += newResult.pulls
        histogramNew.value[newResult.pulls] =
            (histogramNew.value[newResult.pulls] ?? 0) + 1
        // 新仕様+特典
        const newBonusResult = simulateOnceNewBonus()
        totalNewBonusPulls += newBonusResult.pulls
        histogramNewBonus.value[newBonusResult.pulls] =
            (histogramNewBonus.value[newBonusResult.pulls] ?? 0) + 1
    }
    averageOldPulls.value =
        totalOldPulls / simulateCount.value
    averageNewPulls.value =
        totalNewPulls / simulateCount.value
    averageNewBonusPulls.value =
        totalNewBonusPulls / simulateCount.value
    totalSimulations.value = simulateCount.value
    updateChart()
}

</script>

<style scoped>
h1 {
    margin: 8px 0;
}

.container {
    width: 1500px;
    max-width: 95vw;
    margin: auto;
    margin-bottom: 10px;
    text-align: center;
}

div {
    margin: 8px 0;
}

input {
    width: 60px;
    margin: 8px;
}

button {
    margin: 4px;
    padding: 4px 16px;
}

.note {
    color: #999;
    font-size: 0.85rem;
    text-align: center;
    margin: 8px 0 20px;
}

/* グラフ用 */
.chart-container {
    width: min(95vw, 1200px);
    height: 70vh;

    min-height: 300px;
    max-height: 700px;

    margin: 15px auto;
}

.chart-container canvas {
    width: 100% !important;
    height: 100% !important;
}
</style>
