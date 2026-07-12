<template>
    <div class="container" @dragover.prevent @drop.prevent="onDrop">
        <h1>Land Two-Color Dithering Tool</h1>

        <input ref="fileInput" type="file" accept="image/*" hidden @change="onFileChange" />

        <!-- 表示用Canvas -->
        <canvas ref="canvas" @click="openFileDialog"></canvas>

        <!-- 元画像（非表示） -->
        <img v-if="imageUrl" :src="imageUrl" ref="image" @load="drawImage" hidden />

        <!-- 表示モード -->
        <div class="mode-selector">
            <label>
                <input type="radio" v-model="mode" value="original" />
                オリジナル
            </label>

            <label>
                <input type="radio" v-model="mode" value="yellow" />
                白＋黒＋黄
            </label>

            <label>
                <input type="radio" v-model="mode" value="purple" />
                白＋黒＋紫
            </label>

            <label>
                <input type="radio" v-model="mode" value="aqua" />
                白＋黒＋水
            </label>

            <label>
                <input type="radio" v-model="mode" value="eight" />
                8色
            </label>
            <button class="save-button" :disabled="!imageUrl" @click="saveImage">
                保存
            </button>
        </div>
    </div>
    <div class="footer-note">
        ※
        <a href="https://3892myamya.github.io/introduction/" target="_blank" rel="noopener noreferrer">
            3892myamya tools
        </a>
        developed by
        <a href="https://twitter.com/3892myamya/" target="_blank" rel="noopener noreferrer">
            @3892myamya
        </a>
    </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'

const imageUrl = ref(null)
const image = ref(null)
const canvas = ref(null)
const fileInput = ref(null)

const mode = ref('original')

onMounted(() => {
    drawHint()
})


function drawHint() {
    const cvs = canvas.value
    const ctx = cvs.getContext('2d')

    cvs.width = 600
    cvs.height = 300

    ctx.fillStyle = '#fafafa'
    ctx.fillRect(0, 0, cvs.width, cvs.height)

    ctx.strokeStyle = '#ccc'
    ctx.setLineDash([5, 5])
    ctx.strokeRect(10, 10, cvs.width - 20, cvs.height - 20)
    ctx.setLineDash([])

    ctx.fillStyle = '#666'
    ctx.font = '16px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const lines = [
        'ここへドラッグ＆ドロップ、またはクリック・タップしてアップロード',
        '※画像はブラウザ上で処理され、サーバーには一切送信されません。'
    ]

    const lineHeight = 28
    const startY = cvs.height / 2 - lineHeight

    lines.forEach((line, index) => {
        ctx.fillText(
            line,
            cvs.width / 2,
            startY + index * lineHeight
        )
    })
}


watch(mode, () => {
    if (image.value) {
        drawImage()
    }
})


// ファイル選択を開く
function openFileDialog() {
    fileInput.value?.click()
}


// inputから選択
function onFileChange(e) {
    const file = e.target.files?.[0]
    loadImageFile(file)
}


// ドラッグ＆ドロップ
function onDrop(e) {
    const file = e.dataTransfer.files?.[0]

    if (!file) return

    if (!file.type.startsWith('image/')) {
        return
    }

    loadImageFile(file)
}


// 共通画像読み込み
function loadImageFile(file) {

    if (!file) return

    if (imageUrl.value) {
        URL.revokeObjectURL(imageUrl.value)
    }

    imageUrl.value = URL.createObjectURL(file)
}

function drawImage() {
    const img = image.value
    const cvs = canvas.value

    cvs.width = img.naturalWidth
    cvs.height = img.naturalHeight

    const ctx = cvs.getContext('2d')
    ctx.drawImage(img, 0, 0)

    if (mode.value === 'original') {
        return
    }

    if (mode.value === 'yellow') {
        applyTwoColor(ctx, cvs.width, cvs.height, [true, true, false], 2)
    } else if (mode.value === 'purple') {
        applyTwoColor(ctx, cvs.width, cvs.height, [true, false, true], 1)
    } else if (mode.value === 'aqua') {
        applyTwoColor(ctx, cvs.width, cvs.height, [false, true, true], 0)
    } else if (mode.value === 'eight') {
        applyEightColor(ctx, cvs.width, cvs.height)
    }
}

function applyTwoColor(ctx, width, height, keepChannels, grayChannel) {
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data

    const bayer = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5]
    ]

    const blockSize = 4

    // 補色チャンネル
    let complementChannel = 0

    if (keepChannels[0] && keepChannels[1] && !keepChannels[2]) {
        // 黄(RG) → 青が補色
        complementChannel = 2
    }
    else if (keepChannels[0] && !keepChannels[1] && keepChannels[2]) {
        // 紫(RB) → 緑が補色
        complementChannel = 1
    }
    else if (!keepChannels[0] && keepChannels[1] && keepChannels[2]) {
        // 水(GB) → 赤が補色
        complementChannel = 0
    }

    for (let by = 0; by < height; by += blockSize) {
        for (let bx = 0; bx < width; bx += blockSize) {
            for (let y = by; y < Math.min(by + blockSize, height); y++) {
                for (let x = bx; x < Math.min(bx + blockSize, width); x++) {

                    const i = (y * width + x) * 4

                    const r = data[i]
                    const g = data[i + 1]
                    const b = data[i + 2]

                    // 目的色チャンネル平均
                    let targetSum = 0
                    let targetCount = 0

                    if (keepChannels[0]) {
                        targetSum += r
                        targetCount++
                    }
                    if (keepChannels[1]) {
                        targetSum += g
                        targetCount++
                    }
                    if (keepChannels[2]) {
                        targetSum += b
                        targetCount++
                    }

                    const targetStrength = targetSum / targetCount

                    // 補色成分
                    const complementStrength = data[i + complementChannel]

                    // 補色との差
                    // 大きいほど目的色
                    const colorStrength = targetStrength - complementStrength

                    // 白判定
                    const whiteStrength = (r + g + b) / 3

                    const threshold =
                        (bayer[y - by][x - bx] + 0.5) * 16

                    const isColor = colorStrength >= threshold - 96
                    const isWhite = whiteStrength >= threshold

                    if (isColor) {
                        // 黄・紫・水
                        data[i] = keepChannels[0] ? 255 : 0
                        data[i + 1] = keepChannels[1] ? 255 : 0
                        data[i + 2] = keepChannels[2] ? 255 : 0
                    }
                    else if (isWhite) {
                        // 白
                        data[i] = 255
                        data[i + 1] = 255
                        data[i + 2] = 255
                    }
                    else {
                        // 黒
                        data[i] = 0
                        data[i + 1] = 0
                        data[i + 2] = 0
                    }


                }
            }
        }
    }

    ctx.putImageData(imageData, 0, 0)
}

function applyEightColor(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data

    const bayer = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5]
    ]

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {

            const i = (y * width + x) * 4

            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]

            const threshold =
                (bayer[y & 3][x & 3] + 0.5) * 16


            // 各色成分を独立にベイヤー化
            const rOn = r >= threshold
            const gOn = g >= threshold
            const bOn = b >= threshold


            data[i] = rOn ? 255 : 0
            data[i + 1] = gOn ? 255 : 0
            data[i + 2] = bOn ? 255 : 0
        }
    }

    ctx.putImageData(imageData, 0, 0)
}
function saveImage() {
    const cvs = canvas.value

    if (!cvs) return

    const link = document.createElement('a')

    link.download = 'land-two-color.png'
    link.href = cvs.toDataURL('image/png')

    link.click()
}
</script>

<style scoped>
.container {
    max-width: 90%;
    margin: 10px auto;
    text-align: center;
}

h1 {
    margin: 8px 0 10px;
    font-size: 24px;
}

canvas {
    background: #fafafa;
    max-width: 100%;
    max-height: 80vh;
    width: auto;
    height: auto;
    object-fit: contain;
    border: 1px solid #ccc;
    cursor: pointer;
}

.mode-selector {
    margin-top: 10px;
    display: flex;
    justify-content: center;
    gap: 20px;
    flex-wrap: wrap;
}

.mode-selector label {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
}

.notice {
    display: block;
    font-size: 12px;
    color: #888;
    margin-bottom: 10px;
}

.save-button {
    padding: 4px 12px;
    cursor: pointer;
    border: 1px solid #aaa;
    border-radius: 4px;
    background: #fff;
}

.save-button:hover {
    background: #f0f0f0;
}

.save-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.footer-note {
    margin-top: 20px;
    text-align: center;
    font-size: 11px;
    color: #aaa;
}

.footer-note a {
    color: #999;
    text-decoration: none;
}

.footer-note a:hover {
    text-decoration: underline;
}
</style>
