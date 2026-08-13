<template>
    <div class="shogi-app">
        <div class="app-heading">
            <h1>Shogi Influence Map</h1>
            <button ref="helpButton" class="help-button" type="button" @click="openHelpDialog">
                操作説明
            </button>
            <button class="toggle-button" :class="{ active: heatMode === 'both' }" type="button"
                role="switch" :aria-checked="heatMode === 'both'" @click="toggleHeatMode">
                ヒートマップ表示
            </button>
            <button class="toggle-button" :class="{ active: showEvaluation }" type="button"
                role="switch" :aria-checked="showEvaluation" @click="showEvaluation = !showEvaluation">
                局面評価表示
            </button>
        </div>
        <dialog ref="helpDialog" class="help-dialog" role="dialog" aria-modal="true"
            aria-labelledby="help-dialog-title" @cancel.prevent @click="handleHelpDialogClick">
            <div class="help-dialog-content">
                <h2 id="help-dialog-title">操作説明</h2>

                <section>
                    <h3>このアプリについて</h3>
                    <p>将棋盤上の駒を自由に配置・移動し、駒の利き、棋譜、局面評価を確認するためのツールです。</p>
                </section>

                <section>
                    <h3>基本操作</h3>
                    <ul>
                        <li>盤上の駒を選択し、移動先のマスを押すと駒を移動できます。</li>
                        <li>持ち駒を選択し、空いているマスを押すと盤上に打てます。選択中の持ち駒をもう一度押すと選択を解除できます。</li>
                        <li>盤上の駒を選択して駒台を押すと、その駒を持ち駒へ移せます。</li>
                        <li class="promotion-help"><strong>歩・香・桂・銀・角・飛を<span class="long-press-emphasis">【長押し】</span>すると、場所に関係なく成／不成を切り替えられます。</strong></li>
                    </ul>
                </section>

                <section>
                    <h3>このアプリのルール</h3>
                    <ul class="rule-warning">
                        <li><strong>このアプリは通常の将棋の反則を判定しません。駒は本来の動きや手番に関係なく自由に動かせます。二手指し、二歩、行き場のない駒、成れない場所での成り、王手の放置なども反則扱いにはなりません。</strong></li>
                    </ul>
                </section>

                <section>
                    <h3>表示と棋譜</h3>
                    <ul>
                        <li>ヒートマップ表示では、先手と後手の駒が利いているマスと利きの数を確認できます。利きの数が多いほど濃い色で表示されます。</li>
                        <li>局面評価表示では、評価値と候補手を確認できます。</li>
                        <li>棋譜の行を選ぶと、その手を指した直後の局面へ移動します。＜と＞は一手戻る／進む操作です。長押しすると連続で移動します。</li>
                        <li>棋譜欄の「読込」では、平手のKIF棋譜を読み込めます。Shift-JISの「.kif」とUTF-8の「.kifu」に対応しています。</li>
                        <li>棋譜欄の「出力」では、現在の棋譜をUTF-8の「.kifu」ファイルとして保存できます。</li>
                        <li>通常の将棋で反則扱いとなる操作など、KIFで表現できない操作を含む棋譜は出力できません。</li>
                    </ul>
                </section>

                <section>
                    <h3>局面評価について</h3>
                    <ul>
                        <li>局面評価には、WebAssembly版の将棋エンジン
                            <a href="https://github.com/mizar/YaneuraOu.wasm" target="_blank" rel="noopener noreferrer">YaneuraOu.wasm</a>
                            の「@mizarjp/yaneuraou.material」（MaterialLv1、バージョン7.6.3-alpha.0）を使用しています。
                        </li>
                        <li>評価エンジンのライセンスはGNU GPL v3.0です。</li>
                        <li>局面によっては評価できない場合があります。</li>
                    </ul>
                </section>

                <section>
                    <h3>免責・お問い合わせ</h3>
                    <ul>
                        <li>評価値と候補手は参考情報です。正確性や完全性を保証するものではありませんので、あらかじめご了承ください。</li>
                        <li>お問い合わせは
                            <a href="https://x.com/3892myamya" target="_blank" rel="noopener noreferrer">https://x.com/3892myamya</a>
                            までお願いします。
                        </li>
                    </ul>
                </section>

                <div class="help-dialog-actions">
                    <button ref="helpCloseButton" type="button" @click="closeHelpDialog">閉じる</button>
                </div>
            </div>
        </dialog>
        <div class="position-layout">
            <div class="board-stage">
                <div class="captured gote-captured" @click="moveSelectedToCaptured('gote')">
                    <span v-for="type in GOTE_CAPTURED_PIECE_TYPES" :key="type" class="piece gote"
                        :class="{
                            'selected-drop': selectedDrop?.type === type && selectedDrop?.owner === 'gote',
                            'captured-empty': !capturedPieces.gote[type]
                        }" @click.stop="onCapturedPieceClick('gote', type)">
                        {{ capturedPieceLabel(type, 'gote') }} ×{{ capturedPieces.gote[type] ?? 0 }}
                    </span>
                </div>
                <div class="board-with-coordinates">
                    <div class="file-labels" aria-hidden="true">
                        <span v-for="file in BOARD_FILES" :key="file">{{ file }}</span>
                    </div>
                    <div class="board">
            <template v-for="(row, rowIndex) in board" :key="rowIndex">
                <div v-for="(cell, colIndex) in row" :key="`${rowIndex}-${colIndex}`" class="cell" :class="[
                    cellAdvantageClass(rowIndex, colIndex),
                    {
                        selected: isSelected(rowIndex, colIndex)
                    }
                ]" @pointerdown="onPressStart(rowIndex, colIndex)" @pointerup="onPressEnd(rowIndex, colIndex)"
                    @pointercancel="onPressCancel" @pointerleave="onPressCancel">
                    <div class=" heat" :style="heatStyle(rowIndex, colIndex)"></div>
                    <span v-if="heatMode === 'both'" class="heat-count gote-count">
                        {{ attackMap.gote[rowIndex][colIndex] }}
                    </span>
                    <span v-if="heatMode === 'both'" class="heat-count sente-count">
                        {{ attackMap.sente[rowIndex][colIndex] }}
                    </span>
                    <span v-if="cell" class="piece" :class="{
                        gote: cell.owner === 'gote',
                        sente: cell.owner === 'sente',
                        promoted: cell.promoted
                    }">
                        {{ pieceLabel(cell) }}
                    </span>
                </div>
            </template>
                    </div>
                    <div class="rank-labels" aria-hidden="true">
                        <span v-for="rank in BOARD_RANKS" :key="rank">{{ rank }}</span>
                    </div>
                </div>
                <div class="captured sente-captured" @click="moveSelectedToCaptured('sente')">
                    <span v-for="type in SENTE_CAPTURED_PIECE_TYPES" :key="type" class="piece sente"
                        :class="{
                            'selected-drop': selectedDrop?.type === type && selectedDrop?.owner === 'sente',
                            'captured-empty': !capturedPieces.sente[type]
                        }" @click.stop="onCapturedPieceClick('sente', type)">
                        {{ capturedPieceLabel(type, 'sente') }} ×{{ capturedPieces.sente[type] ?? 0 }}
                    </span>
                </div>
                <aside class="move-record-panel" aria-live="polite">
                    <Transition name="toast">
                        <div v-if="kifMessage" class="kif-toast" :class="{ error: kifMessageIsError }" role="status"
                            aria-live="polite">
                            {{ kifMessage }}
                        </div>
                    </Transition>
                    <div class="move-record-heading">
                        <strong>棋譜</strong>
                        <div class="kif-actions">
                            <button type="button" @click="kifFileInput?.click()">読込</button>
                            <button type="button" @click="downloadKifu">出力</button>
                            <input ref="kifFileInput" type="file" accept=".kif,.kifu" @change="loadKifFile">
                        </div>
                    </div>
                    <ol ref="moveRecordList" class="move-record-list">
                        <li>
                            <button type="button" :class="{ 'selected-record': selectedRecordIndex === -1 }"
                                data-record-index="-1" @click="showInitialPosition()">
                                <span>0</span>
                                <span>開始前</span>
                            </button>
                        </li>
                        <li v-for="(record, index) in moveRecords" :key="index">
                            <button type="button" :class="{ 'selected-record': selectedRecordIndex === index }"
                                :data-record-index="index" @click="showMovePosition(index)">
                                <span>{{ index + 1 }}</span>
                                <span :class="`move-${record.owner}`">{{ record.notation }}</span>
                            </button>
                        </li>
                    </ol>
                    <div class="move-record-controls">
                        <button type="button" aria-label="一手戻る" :disabled="!canMoveRecordBackward"
                            @pointerdown="startRecordMove('backward')" @pointerup="stopRecordMove"
                            @pointerleave="stopRecordMove" @pointercancel="stopRecordMove">＜</button>
                        <button type="button" aria-label="一手進む" :disabled="!canMoveRecordForward"
                            @pointerdown="startRecordMove('forward')" @pointerup="stopRecordMove"
                            @pointerleave="stopRecordMove" @pointercancel="stopRecordMove">＞</button>
                    </div>
                </aside>
            </div>
            <section v-show="showEvaluation" class="evaluation-panel" aria-live="polite">
                <div class="evaluation-heading">
                    <strong>局面評価</strong>
                    <button class="turn-button" :class="`turn-${sideToMove}`" type="button" @click="toggleTurn">
                        手番：{{ sideToMove === 'sente' ? '先手' : '後手' }}
                    </button>
                </div>
                <div class="evaluation-result">
                    <span :class="evaluationClass">{{ evaluationText }}</span>
                    <small>{{ evaluationDetail }}</small>
                </div>
                <ol v-if="evaluation.candidates.length" class="candidate-list">
                    <li v-for="candidate in evaluation.candidates" :key="candidate.rank" class="candidate-card">
                        <div class="candidate-line">
                            <span :class="candidateScoreClass(candidate)">{{ candidateScoreText(candidate) }}</span>
                            <span class="candidate-pv">{{ candidate.notation.slice(0, 9).join('　') }}</span>
                        </div>
                    </li>
                </ol>
                <p v-else-if="evaluation.status === 'thinking'" class="candidate-placeholder">候補手を探索中…</p>
            </section>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, toRaw, onBeforeUnmount, onMounted, watch, nextTick } from 'vue'
import engineScriptUrl from '@mizarjp/yaneuraou.material/lib/yaneuraou.material.js?url'
import engineWasmUrl from '@mizarjp/yaneuraou.material/lib/yaneuraou.material.wasm?url'
import engineWorkerUrl from '@mizarjp/yaneuraou.material/lib/yaneuraou.material.worker.js?url'
import { formatUsiPv, positionToSfen } from './shogiEvaluation.js'
import { isFatalEngineEvent } from './shogiEngineError.js'
import { applyMove as applyKifMove, createStandardPosition, decodeKif, exportKifu, formatMove as formatKifMove, parseKif } from './shogiKif.js'

const sideToMove = ref('sente')
const showEvaluation = ref(true)
const helpDialog = ref(null)
const helpButton = ref(null)
const helpCloseButton = ref(null)
const moveRecords = ref([])
const selectedRecordIndex = ref(-1)
const moveRecordList = ref(null)
const kifFileInput = ref(null)
const kifMessage = ref('')
const kifMessageIsError = ref(false)
const kifIncompatibleReason = ref('')
let initialPosition = null
const evaluation = ref({
    status: 'loading', score: 0, depth: 0, nodes: 0, mate: null, message: '', candidates: [],
    restartRequired: false,
})
let engine = null
let evaluationTimer = null
let evaluationSequence = 0
let evaluationBoard = null
let evaluationSideToMove = 'sente'
let lastMovedPiece = null
let recordMoveTimer = null
let recordMoveInterval = null
let kifMessageTimer = null

onMounted(async () => {
    computeAttackMap()
    initialPosition = createPositionSnapshot()
    window.addEventListener('error', handleUnhandledEngineError)
    window.addEventListener('unhandledrejection', handleUnhandledEngineError)
    await initializeEngine()
})
watch(sideToMove, scheduleEvaluation)

onBeforeUnmount(() => {
    clearTimeout(evaluationTimer)
    clearTimeout(kifMessageTimer)
    stopRecordMove()
    window.removeEventListener('error', handleUnhandledEngineError)
    window.removeEventListener('unhandledrejection', handleUnhandledEngineError)
    engine?.terminate()
})

function openHelpDialog() {
    if (!helpDialog.value || helpDialog.value.open) return
    helpDialog.value.showModal()
    nextTick(() => helpCloseButton.value?.focus())
}

function closeHelpDialog() {
    if (!helpDialog.value?.open) return
    helpDialog.value.close()
    nextTick(() => helpButton.value?.focus())
}

function handleHelpDialogClick(event) {
    if (event.target === event.currentTarget) {
        closeHelpDialog()
    }
}

const evaluationText = computed(() => {
    if (evaluation.value.status === 'loading') return 'エンジン準備中…'
    if (evaluation.value.status === 'thinking') return '評価中…'
    if (evaluation.value.status === 'error') return '評価できません'
    if (evaluation.value.mate !== null) {
        const winner = evaluation.value.mate > 0 ? '先手' : '後手'
        return `${winner}に詰みあり（${Math.abs(evaluation.value.mate)}手）`
    }
    const score = evaluation.value.score
    if (Math.abs(score) < 50) return '互角'
    return `${score > 0 ? '先手' : '後手'} ${score > 0 ? '+' : ''}${score}`
})

const canMoveRecordForward = computed(() => (
    selectedRecordIndex.value !== null && selectedRecordIndex.value < moveRecords.value.length - 1
))
const canMoveRecordBackward = computed(() => (
    selectedRecordIndex.value !== null && selectedRecordIndex.value >= 0
))

const evaluationDetail = computed(() => {
    if (evaluation.value.status === 'error') return evaluation.value.message
    if (evaluation.value.status !== 'ready') return '初回のみエンジンの読み込みに少し時間がかかります'
    return `深さ ${evaluation.value.depth}・${evaluation.value.nodes.toLocaleString()}局面を探索（先手基準）`
})

const evaluationClass = computed(() => ({
    'sente-evaluation': evaluation.value.score > 0 || (evaluation.value.mate ?? 0) > 0,
    'gote-evaluation': evaluation.value.score < 0 || (evaluation.value.mate ?? 0) < 0,
}))
const selected = ref(null)
const capturedPieces = ref({
    sente: {},
    gote: {}
})
const heatMode = ref('both')
const createEmptyBoard = () =>
    Array.from({ length: 9 }, () =>
        Array(9).fill(0)
    )
const attackMap = ref({
    sente: createEmptyBoard(),
    gote: createEmptyBoard()
})
const longPressTimer = ref(null)
const longPressTriggered = ref(false)
const LONG_PRESS_MS = 500
function handleClick(row, col) {
    // ■ 持ち駒
    if (selectedDrop.value) {
        if (!board.value[row][col]) {
            dropPiece(row, col)
        }
        selectedDrop.value = null
        selected.value = null
        return
    }

    // ■ 移動
    if (selected.value) {
        const selectedPiece =
            board.value[selected.value.row][selected.value.col]

        const target =
            board.value[row][col]

        // 同じ駒再クリック → 選択解除
        if (selected.value.row === row && selected.value.col === col) {
            selected.value = null
            return
        }

        // 自駒選択し直し
        if (target && target.owner === selectedPiece.owner) {
            selected.value = { row, col }
            return
        }

        movePiece(selected.value, { row, col })
        selected.value = null
        return
    }

    const piece = board.value[row][col]
    if (!piece) return

    selected.value = { row, col }
}

function onPressStart(row, col) {
    longPressTriggered.value = false

    longPressTimer.value = setTimeout(() => {
        longPressTriggered.value = true
        togglePromotion(row, col)
    }, LONG_PRESS_MS)
}

function onPressEnd(row, col) {
    clearTimeout(longPressTimer.value)

    // 長押し発火済みならクリック扱いしない
    if (longPressTriggered.value) return

    handleClick(row, col)
}

function onPressCancel() {
    clearTimeout(longPressTimer.value)
}

function togglePromotion(row, col) {
    const piece = board.value[row][col]
    if (!piece) return
    if (!canPromote(piece)) return

    const isPromoting = !piece.promoted
    piece.promoted = !piece.promoted
    const promotesLastMove =
        isPromoting &&
        lastMovedPiece?.piece === piece &&
        lastMovedPiece.row === row &&
        lastMovedPiece.col === col
    if (promotesLastMove) {
        const record = moveRecords.value[lastMovedPiece.recordIndex]
        if (record && !record.promoted) {
            record.notation += '成'
            record.promoted = true
            record.move.promotes = true
        }
    } else {
        markKifIncompatible('直前に移動した駒以外の成／不成を変更しました')
    }
    computeAttackMap()
    if (promotesLastMove) {
        savePositionToRecord(lastMovedPiece.recordIndex)
    } else {
        selectedRecordIndex.value = null
    }
    scheduleEvaluation()
}
function getAttacks(row, col) {
    const piece = board.value[row][col]
    if (!piece) return []

    const attacks = []

    const dir = piece.owner === 'sente' ? -1 : 1

    const push = (r, c) => {
        if (insideBoard(r, c)) {
            attacks.push({ row: r, col: c })
        }
    }

    const effectiveType =
        piece.promoted &&
            ['FU', 'KY', 'KE', 'GI'].includes(piece.type)
            ? 'KI'
            : piece.type

    switch (effectiveType) {

        case 'FU':
            push(row + dir, col)
            break

        case 'KY':
            let r = row + dir
            while (insideBoard(r, col)) {
                attacks.push({ row: r, col })
                if (board.value[r][col]) break
                r += dir
            }
            break

        case 'KE':
            push(row + dir * 2, col - 1)
            push(row + dir * 2, col + 1)
            break

        case 'GI':
            push(row + dir, col)
            push(row + dir, col - 1)
            push(row + dir, col + 1)
            push(row - dir, col - 1)
            push(row - dir, col + 1)
            break

        case 'KI':
            push(row + dir, col - 1)
            push(row + dir, col)
            push(row + dir, col + 1)

            push(row, col - 1)
            push(row, col + 1)

            push(row - dir, col)
            break

        case 'OU':
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue
                    push(row + dr, col + dc)
                }
            }
            break

        case 'KA':
            for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                let r = row + dr
                let c = col + dc

                while (insideBoard(r, c)) {
                    attacks.push({ row: r, col: c })
                    if (board.value[r][c]) break
                    r += dr
                    c += dc
                }
            }

            if (piece.promoted) {
                push(row + 1, col)
                push(row - 1, col)
                push(row, col + 1)
                push(row, col - 1)
            }

            break

        case 'HI':
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                let r = row + dr
                let c = col + dc

                while (insideBoard(r, c)) {
                    attacks.push({ row: r, col: c })
                    if (board.value[r][c]) break
                    r += dr
                    c += dc
                }
            }

            if (piece.promoted) {
                push(row + 1, col + 1)
                push(row + 1, col - 1)
                push(row - 1, col + 1)
                push(row - 1, col - 1)
            }

            break
    }

    return attacks
}
function computeAttackMap() {
    const sente = createEmptyBoard()
    const gote = createEmptyBoard()

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const piece = board.value[r][c]
            if (!piece) continue

            const attacks = getAttacks(r, c)

            for (const a of attacks) {
                if (piece.owner === 'sente') {
                    sente[a.row][a.col]++
                } else {
                    gote[a.row][a.col]++
                }
            }
        }
    }

    attackMap.value = { sente, gote }
}
const selectedDrop = ref(null) // { owner, type }

function isSelected(row, col) {
    return (
        selected.value &&
        selected.value.row === row &&
        selected.value.col === col
    )
}


function insideBoard(row, col) {
    return row >= 0 && row < 9 && col >= 0 && col < 9
}

function movePiece(from, to) {
    const movingPiece =
        board.value[from.row][from.col]

    const captured =
        board.value[to.row][to.col]

    // 取る
    if (captured) {
        addCaptured(movingPiece.owner, captured.type)
    }

    board.value[to.row][to.col] =
        movingPiece

    board.value[from.row][from.col] =
        null

    addMoveRecord(movingPiece, to.row, to.col, false, from)

    computeAttackMap()
    setTurnAfterMove(movingPiece.owner)
    savePositionToRecord(lastMovedPiece.recordIndex)
    scheduleEvaluation()

}
function dropPiece(row, col) {
    const { owner, type } = selectedDrop.value
    if (!capturedPieces.value[owner][type]) {
        selectedDrop.value = null
        return
    }

    // 駒を置く
    board.value[row][col] = {
        type,
        owner,
        promoted: false
    }
    const droppedPiece = board.value[row][col]

    // 持ち駒を減らす
    capturedPieces.value[owner][type]--

    if (capturedPieces.value[owner][type] <= 0) {
        delete capturedPieces.value[owner][type]
    }
    addMoveRecord(droppedPiece, row, col, true)
    computeAttackMap()
    setTurnAfterMove(owner)
    savePositionToRecord(lastMovedPiece.recordIndex)
    scheduleEvaluation()

}

function moveSelectedToCaptured(owner) {
    if (!selected.value) return

    const { row, col } = selected.value
    const selectedPiece = board.value[row][col]
    if (!selectedPiece) return
    markKifIncompatible('盤上の駒を駒台へ直接移動しました')

    addCaptured(owner, selectedPiece.type)
    board.value[row][col] = null
    selected.value = null
    selectedDrop.value = null
    lastMovedPiece = null
    selectedRecordIndex.value = null

    computeAttackMap()
    setTurnAfterMove(owner)
    scheduleEvaluation()
}

function setTurnAfterMove(owner) {
    sideToMove.value = owner === 'sente' ? 'gote' : 'sente'
}

function addMoveRecord(movingPiece, row, col, isDrop = false, from = null) {
    if (
        selectedRecordIndex.value !== null &&
        selectedRecordIndex.value < moveRecords.value.length - 1
    ) {
        moveRecords.value.splice(selectedRecordIndex.value + 1)
        kifIncompatibleReason.value = ''
    }

    const move = {
        owner: movingPiece.owner,
        type: movingPiece.type,
        from: from ? { ...from } : null,
        to: { row, col },
        drop: isDrop,
        promotes: false,
        pieceWasPromoted: movingPiece.promoted,
    }
    const marker = movingPiece.owner === 'sente' ? '▲' : '△'
    moveRecords.value.push({
        owner: movingPiece.owner,
        notation: `${marker}${formatKifMove(move)}`,
        promoted: false,
        move,
    })
    lastMovedPiece = {
        piece: movingPiece,
        row,
        col,
        recordIndex: moveRecords.value.length - 1,
    }
    selectedRecordIndex.value = lastMovedPiece.recordIndex
    nextTick(() => {
        if (moveRecordList.value) {
            moveRecordList.value.scrollTop = moveRecordList.value.scrollHeight
        }
    })
    return lastMovedPiece.recordIndex
}

function savePositionToRecord(index) {
    const record = moveRecords.value[index]
    if (!record) return
    record.position = createPositionSnapshot()
}

function createPositionSnapshot() {
    return {
        board: structuredClone(toRaw(board.value)),
        capturedPieces: structuredClone(toRaw(capturedPieces.value)),
        attackMap: structuredClone(toRaw(attackMap.value)),
        sideToMove: sideToMove.value,
    }
}

function restorePosition(position, recordIndex) {
    if (!position) return

    board.value = structuredClone(toRaw(position.board))
    capturedPieces.value = structuredClone(toRaw(position.capturedPieces))
    attackMap.value = structuredClone(toRaw(position.attackMap))
    sideToMove.value = position.sideToMove
    selected.value = null
    selectedDrop.value = null
    selectedRecordIndex.value = recordIndex
    lastMovedPiece = null
    scheduleEvaluation()
}

function showInitialPosition(scrollAlignment = null) {
    restorePosition(initialPosition, -1)
    scrollSelectedRecord(scrollAlignment)
}

function showMovePosition(index, scrollAlignment = null) {
    restorePosition(moveRecords.value[index]?.position, index)
    scrollSelectedRecord(scrollAlignment)
}

function moveRecordForward() {
    if (!canMoveRecordForward.value) return
    showMovePosition(selectedRecordIndex.value + 1, 'end')
}

function moveRecordBackward() {
    if (!canMoveRecordBackward.value) return
    const previousIndex = selectedRecordIndex.value - 1
    if (previousIndex === -1) {
        showInitialPosition('start')
        return
    }
    showMovePosition(previousIndex, 'start')
}

function startRecordMove(direction) {
    stopRecordMove()
    moveRecord(direction)
    recordMoveTimer = setTimeout(() => {
        recordMoveInterval = setInterval(() => moveRecord(direction), 100)
    }, 400)
}

function stopRecordMove() {
    clearTimeout(recordMoveTimer)
    clearInterval(recordMoveInterval)
    recordMoveTimer = null
    recordMoveInterval = null
}

function moveRecord(direction) {
    if (direction === 'backward') {
        if (!canMoveRecordBackward.value) stopRecordMove()
        else moveRecordBackward()
        return
    }
    if (!canMoveRecordForward.value) stopRecordMove()
    else moveRecordForward()
}

function scrollSelectedRecord(alignment) {
    if (!alignment) return
    nextTick(() => {
        const list = moveRecordList.value
        const selectedRow = list?.querySelector(`[data-record-index="${selectedRecordIndex.value}"]`)
        if (!list || !selectedRow) return

        const listRect = list.getBoundingClientRect()
        const rowRect = selectedRow.getBoundingClientRect()
        const isOutside = rowRect.top < listRect.top || rowRect.bottom > listRect.bottom
        if (!isOutside) return

        if (alignment === 'start') {
            list.scrollTop += rowRect.top - listRect.top
        } else {
            list.scrollTop += rowRect.bottom - listRect.bottom
        }
    })
}

const PIECE_LABELS = {
    FU: '歩',
    KY: '香',
    KE: '桂',
    GI: '銀',
    KI: '金',
    KA: '角',
    HI: '飛',
    OU: '王',
}
const SENTE_CAPTURED_PIECE_TYPES = ['FU', 'KY', 'KE', 'GI', 'KI', 'KA', 'HI', 'OU']
const GOTE_CAPTURED_PIECE_TYPES = [...SENTE_CAPTURED_PIECE_TYPES].reverse()
const BOARD_FILES = [9, 8, 7, 6, 5, 4, 3, 2, 1]
const BOARD_FILE_LABELS = ['９', '８', '７', '６', '５', '４', '３', '２', '１']
const BOARD_RANKS = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

function capturedPieceLabel(type, owner) {
    if (type === 'OU') return owner === 'sente' ? '玉' : '王'
    return PIECE_LABELS[type]
}

function piece(type, owner) {
    return {
        type,
        owner,
        promoted: false,
    }
}

const board = ref([
    [
        piece('KY', 'gote'),
        piece('KE', 'gote'),
        piece('GI', 'gote'),
        piece('KI', 'gote'),
        piece('OU', 'gote'),
        piece('KI', 'gote'),
        piece('GI', 'gote'),
        piece('KE', 'gote'),
        piece('KY', 'gote'),
    ],
    [
        null,
        piece('HI', 'gote'),
        null,
        null,
        null,
        null,
        null,
        piece('KA', 'gote'),
        null,
    ],
    [
        piece('FU', 'gote'),
        piece('FU', 'gote'),
        piece('FU', 'gote'),
        piece('FU', 'gote'),
        piece('FU', 'gote'),
        piece('FU', 'gote'),
        piece('FU', 'gote'),
        piece('FU', 'gote'),
        piece('FU', 'gote'),
    ],

    [null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],

    [
        piece('FU', 'sente'),
        piece('FU', 'sente'),
        piece('FU', 'sente'),
        piece('FU', 'sente'),
        piece('FU', 'sente'),
        piece('FU', 'sente'),
        piece('FU', 'sente'),
        piece('FU', 'sente'),
        piece('FU', 'sente'),
    ],
    [
        null,
        piece('KA', 'sente'),
        null,
        null,
        null,
        null,
        null,
        piece('HI', 'sente'),
        null,
    ],
    [
        piece('KY', 'sente'),
        piece('KE', 'sente'),
        piece('GI', 'sente'),
        piece('KI', 'sente'),
        piece('OU', 'sente'),
        piece('KI', 'sente'),
        piece('GI', 'sente'),
        piece('KE', 'sente'),
        piece('KY', 'sente'),
    ],
])

function pieceLabel(piece) {
    if (piece.promoted) {
        switch (piece.type) {
            case 'FU': return 'と'
            case 'KY': return '杏'
            case 'KE': return '圭'
            case 'GI': return '全'
            case 'KA': return '馬'
            case 'HI': return '龍'
        }
    }
    if (piece.type === 'OU') {
        return piece.owner === 'sente' ? '玉' : '王'
    }
    return PIECE_LABELS[piece.type]
}

function canPromote(piece) {
    return [
        'FU',
        'KY',
        'KE',
        'GI',
        'KA',
        'HI'
    ].includes(piece.type)
}

function addCaptured(owner, type) {
    const bag = capturedPieces.value[owner]

    if (!bag[type]) {
        bag[type] = 0
    }

    bag[type]++
}

function selectDrop(owner, type) {
    if (!capturedPieces.value[owner][type]) return

    if (selectedDrop.value?.owner === owner && selectedDrop.value?.type === type) {
        selectedDrop.value = null
        return
    }
    selectedDrop.value = { owner, type }
}

function onCapturedPieceClick(owner, type) {
    if (selected.value) {
        moveSelectedToCaptured(owner)
        return
    }
    selectDrop(owner, type)
}

function heatStyle(row, col) {
    if (heatMode.value === 'none') {
        return { backgroundColor: 'transparent' }
    }

    const s = attackMap.value.sente[row][col]
    const g = attackMap.value.gote[row][col]

    const sAlpha = Math.min(0.15 + s * 0.15, 0.8)
    const gAlpha = Math.min(0.15 + g * 0.15, 0.8)

    if (s === 0 && g === 0) {
        return { backgroundColor: 'transparent' }
    }

    if (s > 0 && g > 0) {
        return {
            background: `
                linear-gradient(
                    rgba(30, 136, 229, ${sAlpha}),
                    rgba(229, 57, 53, ${gAlpha})
                )
            `
        }
    }

    if (s > 0) {
        return {
            backgroundColor: `rgba(30, 136, 229, ${sAlpha})`
        }
    }

    return {
        backgroundColor: `rgba(229, 57, 53, ${gAlpha})`
    }
}

function cellAdvantageClass(row, col) {
    if (heatMode.value === 'none') return ''

    const s = attackMap.value.sente[row][col]
    const g = attackMap.value.gote[row][col]

    if (s > g) return 'sente-advantage'
    if (g > s) return 'gote-advantage'

    return ''
}

function toggleHeatMode() {
    heatMode.value = heatMode.value === 'both' ? 'none' : 'both'
}

function toggleTurn() {
    markKifIncompatible('手番を手動で変更しました')
    selectedRecordIndex.value = null
    lastMovedPiece = null
    sideToMove.value = sideToMove.value === 'sente' ? 'gote' : 'sente'
}

function markKifIncompatible(reason) {
    if (!kifIncompatibleReason.value) kifIncompatibleReason.value = reason
}

async function loadKifFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
        if (!/\.kifu?$/i.test(file.name)) throw new Error('拡張子 .kif または .kifu のファイルを選択してください')
        const text = decodeKif(await file.arrayBuffer(), file.name)
        const moves = parseKif(text)
        const position = createStandardPosition()
        const importedRecords = []
        let previousTo = null

        board.value = structuredClone(position.board)
        capturedPieces.value = structuredClone(position.capturedPieces)
        sideToMove.value = position.sideToMove
        computeAttackMap()
        initialPosition = createPositionSnapshot()

        for (const move of moves) {
            applyKifMove(position, move)
            board.value = structuredClone(position.board)
            capturedPieces.value = structuredClone(position.capturedPieces)
            sideToMove.value = position.sideToMove
            computeAttackMap()
            importedRecords.push({
                owner: move.owner,
                notation: `${move.owner === 'sente' ? '▲' : '△'}${formatKifMove(move, previousTo)}`,
                promoted: move.promotes,
                move: structuredClone(move),
                position: createPositionSnapshot(),
            })
            previousTo = move.to
        }

        moveRecords.value = importedRecords
        selectedRecordIndex.value = importedRecords.length - 1
        selected.value = null
        selectedDrop.value = null
        lastMovedPiece = null
        kifIncompatibleReason.value = ''
        showKifMessage(`${file.name} を読み込みました`)
        scheduleEvaluation()
        nextTick(() => {
            if (moveRecordList.value) moveRecordList.value.scrollTop = moveRecordList.value.scrollHeight
        })
    } catch (error) {
        showKifMessage(`読込エラー: ${error instanceof Error ? error.message : String(error)}`, true)
    } finally {
        event.target.value = ''
    }
}

function downloadKifu() {
    try {
        if (kifIncompatibleReason.value) throw new Error(kifIncompatibleReason.value)
        const text = exportKifu(moveRecords.value.map((record) => record.move))
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = 'shogi-influence-map.kifu'
        link.click()
        URL.revokeObjectURL(url)
        showKifMessage('KIFUファイルを出力しました')
    } catch (error) {
        showKifMessage(`出力できません: ${error instanceof Error ? error.message : String(error)}`, true)
    }
}

function showKifMessage(message, isError = false) {
    clearTimeout(kifMessageTimer)
    kifMessage.value = message
    kifMessageIsError.value = isError
    kifMessageTimer = setTimeout(() => {
        kifMessage.value = ''
    }, 3000)
}

function handleUnhandledEngineError(event) {
    if (!isFatalEngineEvent(event, engineWorkerUrl)) return
    event.preventDefault?.()
    setFatalEngineError()
}

function setFatalEngineError() {
    if (evaluation.value.restartRequired) return

    clearTimeout(evaluationTimer)
    evaluationSequence++
    evaluation.value = {
        ...evaluation.value,
        status: 'error',
        message: '評価中にエラーが発生しました。画面を再読み込みしてください。',
        candidates: [],
        restartRequired: true,
    }
}

async function initializeEngine() {
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
        evaluation.value = {
            ...evaluation.value,
            status: 'error',
            message: '評価機能にはCross-Origin Isolation対応の配信設定が必要です',
        }
        return
    }

    try {
        await loadEngineScript()
        engine = await window.YaneuraOu_Material({
            locateFile(path) {
                if (path.endsWith('.wasm')) return engineWasmUrl
                if (path.endsWith('.worker.js')) return engineWorkerUrl
                return path
            },
            onAbort() {
                setFatalEngineError()
            },
        })
        if (evaluation.value.restartRequired) return
        engine.addMessageListener(handleEngineMessage)
        engine.postMessage('usi')
    } catch (error) {
        if (evaluation.value.restartRequired) return
        evaluation.value = {
            ...evaluation.value,
            status: 'error',
            message: `エンジンを起動できませんでした: ${error instanceof Error ? error.message : String(error)}`,
        }
    }
}

function loadEngineScript() {
    if (window.YaneuraOu_Material) return Promise.resolve()
    return new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = engineScriptUrl
        script.onload = resolve
        script.onerror = () => reject(new Error('エンジンスクリプトの読み込みに失敗しました'))
        document.head.appendChild(script)
    })
}

function handleEngineMessage(line) {
    if (evaluation.value.restartRequired) return

    if (line === 'usiok') {
        engine.postMessage('setoption name USI_Hash value 32')
        engine.postMessage('setoption name MultiPV value 3')
        engine.postMessage('isready')
        return
    }
    if (line === 'readyok') {
        scheduleEvaluation(0)
        return
    }
    if (!line.startsWith('info ')) return

    const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/)
    if (!scoreMatch) return

    const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0)
    const nodes = Number(line.match(/\bnodes (\d+)/)?.[1] ?? 0)
    const rank = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1)
    const pvMatch = line.match(/\bpv (.+)$/)
    if (!pvMatch || !evaluationBoard) return

    const moves = pvMatch[1].trim().split(/\s+/)
    const value = Number(scoreMatch[2])
    const senteFactor = evaluationSideToMove === 'sente' ? 1 : -1
    const candidate = {
        rank,
        score: scoreMatch[1] === 'cp' ? value * senteFactor : 0,
        mate: scoreMatch[1] === 'mate' ? value * senteFactor : null,
        depth,
        nodes,
        moves,
        notation: formatUsiPv(moves, evaluationBoard, evaluationSideToMove),
    }
    const candidates = evaluation.value.candidates
        .filter((item) => item.rank !== rank)
        .concat(candidate)
        .sort((a, b) => a.rank - b.rank)

    const best = rank === 1 ? candidate : evaluation.value.candidates.find((item) => item.rank === 1)

    evaluation.value = {
        status: 'ready',
        score: best?.score ?? 0,
        mate: best?.mate ?? null,
        depth: best?.depth ?? depth,
        nodes: best?.nodes ?? nodes,
        message: '',
        candidates,
        restartRequired: false,
    }
}

function candidateScoreText(candidate) {
    if (candidate.mate !== null) {
        return `${candidate.mate > 0 ? '先手' : '後手'} 詰${Math.abs(candidate.mate)}`
    }
    if (Math.abs(candidate.score) < 50) return '互角'
    return `${candidate.score > 0 ? '先手' : '後手'}${candidate.score > 0 ? '+' : ''}${candidate.score}`
}

function candidateScoreClass(candidate) {
    const value = candidate.mate ?? candidate.score
    return value > 0 ? 'sente-evaluation' : value < 0 ? 'gote-evaluation' : ''
}

function scheduleEvaluation(delay = 350) {
    if (!engine || evaluation.value.restartRequired) return
    clearTimeout(evaluationTimer)
    evaluation.value = { ...evaluation.value, status: 'thinking', message: '', candidates: [] }
    const sequence = ++evaluationSequence
    evaluationTimer = setTimeout(() => evaluatePosition(sequence), delay)
}

function evaluatePosition(sequence) {
    if (!engine || evaluation.value.restartRequired || sequence !== evaluationSequence) return

    const validationError = validatePosition()
    if (validationError) {
        evaluation.value = { ...evaluation.value, status: 'error', message: validationError }
        return
    }

    evaluationBoard = structuredClone(toRaw(board.value))
    evaluationSideToMove = sideToMove.value
    evaluation.value = { ...evaluation.value, status: 'thinking', message: '', candidates: [] }
    engine.postMessage('stop')
    engine.postMessage(`position sfen ${positionToSfen(board.value, capturedPieces.value, sideToMove.value)}`)
    engine.postMessage('go depth 12')
}

function validatePosition() {
    const kings = { sente: 0, gote: 0 }
    for (const row of board.value) {
        for (const boardPiece of row) {
            if (boardPiece?.type === 'OU') kings[boardPiece.owner]++
        }
    }
    if (kings.sente !== 1 || kings.gote !== 1) {
        return '盤上に先手・後手の玉を1枚ずつ配置してください'
    }
    if (capturedPieces.value.sente.OU || capturedPieces.value.gote.OU) {
        return '玉を持ち駒にした局面は評価できません'
    }
    return ''
}

</script>

<style scoped>
.shogi-app {
    padding: 20px;
    font-family: sans-serif;
}

h1 {
    font-size: 28px;
    margin: 0;
    line-height: 1.2;
}

.app-heading {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 12px;
    flex-wrap: nowrap;
    white-space: nowrap;
}

.app-heading h1,
.app-heading button {
    flex-shrink: 0;
}

.app-heading .help-button {
    height: 40px;
    padding: 0 18px;
    border: 1px solid #666;
    border-radius: 8px;
    background: #fff;
    color: #333;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
}

.app-heading .toggle-button {
    display: inline-flex;
    min-width: 190px;
    height: 40px;
    align-items: center;
    gap: 9px;
    padding: 0 16px;
    border: 1px solid #666;
    border-radius: 999px;
    background: #fff;
    color: #444;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    transition: background .15s;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
}

.toggle-button::before {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border-radius: 50%;
    background: #aaa;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .15);
    content: '';
}

.app-heading .toggle-button.active {
    border-color: #075cb7;
    background: #2878d0;
    color: #fff;
}

.toggle-button.active::before {
    background: #fff;
}

.help-dialog {
    width: min(680px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    box-sizing: border-box;
    padding: 0;
    overflow: visible;
    border: 1px solid #999;
    border-radius: 12px;
    background: #fff;
    color: #222;
    box-shadow: 0 18px 50px rgba(0, 0, 0, .35);
}

.help-dialog::backdrop {
    background: rgba(0, 0, 0, .58);
}

.help-dialog-content {
    max-height: calc(100vh - 48px);
    box-sizing: border-box;
    padding: 24px;
    overflow-y: auto;
}

.help-dialog h2 {
    margin: 0 0 20px;
    font-size: 24px;
}

.help-dialog section + section {
    margin-top: 20px;
}

.help-dialog h3 {
    margin: 0 0 8px;
    font-size: 18px;
}

.help-dialog p {
    margin: 0;
    line-height: 1.7;
}

.help-dialog p + p {
    margin-top: 10px;
}

.help-dialog ul {
    margin: 0;
    padding-left: 1.5em;
}

.help-dialog li {
    line-height: 1.7;
}

.help-dialog li + li {
    margin-top: 5px;
}

.help-dialog .promotion-help {
    margin-top: 10px;
    padding: 10px 12px;
    border-left: 4px solid #2878d0;
    border-radius: 4px;
    background: #eef6ff;
}

.promotion-help strong {
    font-size: 17px;
}

.promotion-help .long-press-emphasis {
    color: #c00000;
}

.help-dialog .rule-warning {
    padding: 12px 14px 12px 2.2em;
    border: 1px solid #d49b42;
    border-radius: 8px;
    background: #fff7e7;
}

.help-dialog-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 24px;
}

.help-dialog-actions button {
    min-width: 100px;
    padding: 8px 18px;
    border: 1px solid #666;
    border-radius: 7px;
    background: #fff;
    color: #222;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
}

.evaluation-panel {
    width: 1090px;
    min-width: 1090px;
    box-sizing: border-box;
    padding: 12px;
    border: 1px solid #bbb;
    border-radius: 10px;
    background: #f7f7f7;
}

.position-layout {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
}

.board-stage {
    display: grid;
    grid-template-columns: 130px 574px 130px 220px;
    align-items: stretch;
    gap: 12px;
}

.move-record-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 568px;
    min-width: 0;
    box-sizing: border-box;
    padding: 10px;
    overflow: visible;
    border: 1px solid #aaa;
    border-radius: 8px;
    background: #f7f7f7;
}

.move-record-heading {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
}

.kif-actions {
    display: flex;
    gap: 4px;
}

.kif-actions button {
    padding: 3px 7px;
    border: 1px solid #888;
    border-radius: 4px;
    background: #fff;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
}

.kif-actions input {
    display: none;
}

.kif-toast {
    position: absolute;
    top: 0;
    left: 50%;
    z-index: 1000;
    width: max-content;
    max-width: 320px;
    box-sizing: border-box;
    padding: 12px 18px;
    border-radius: 8px;
    background: #276528;
    color: #fff;
    box-shadow: 0 6px 20px rgba(0, 0, 0, .3);
    font-weight: 700;
    transform: translate(-50%, calc(-100% - 8px));
}

.kif-toast.error {
    background: #b00020;
}

.toast-enter-active,
.toast-leave-active {
    transition: opacity .2s ease, transform .2s ease;
}

.toast-enter-from,
.toast-leave-to {
    opacity: 0;
    transform: translate(-50%, calc(-100% + 2px));
}

.move-record-panel > p {
    margin: 0;
    color: #999;
    font-size: 14px;
}

.move-record-list {
    display: grid;
    flex: 1 1 auto;
    min-height: 0;
    gap: 4px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    align-content: start;
}

.move-record-list li {
    min-width: 0;
}

.move-record-list button {
    display: grid;
    width: 100%;
    grid-template-columns: 2.5em 1fr;
    gap: 4px;
    box-sizing: border-box;
    padding: 3px 5px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
}

.move-record-list button:hover {
    background: #ececec;
}

.move-record-list button.selected-record {
    border-color: #888;
    background: #dfdfdf;
}

.move-record-controls {
    display: grid;
    flex: 0 0 auto;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 8px;
}

.move-record-controls button {
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid #888;
    border-radius: 5px;
    background: #fff;
    font-weight: 700;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
}

.move-record-controls button:disabled {
    cursor: default;
    opacity: .4;
}

.move-sente {
    color: #0040c0;
    font-weight: 700;
}

.move-gote {
    color: #c00000;
    font-weight: 700;
}

.evaluation-heading,
.evaluation-result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.turn-button {
    padding: 5px 10px;
    border: 1px solid #777;
    border-radius: 6px;
    background: white;
    font-weight: 700;
    cursor: pointer;
}

.turn-button.turn-sente {
    color: #0040c0;
}

.turn-button.turn-gote {
    color: #c00000;
}

.evaluation-result > span {
    font-weight: 700;
}

.evaluation-result small {
    color: #666;
    text-align: right;
}

.sente-evaluation {
    color: #075cb7;
}

.gote-evaluation {
    color: #bd2723;
}

.candidate-list {
    display: grid;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    gap: 8px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
}

.candidate-card {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    padding: 9px 10px;
    border: 1px solid #d4d4d4;
    border-radius: 7px;
    background: #fff;
}

.candidate-line {
    display: flex;
    min-width: 0;
    gap: 10px;
    align-items: center;
}

.candidate-line > :first-child {
    flex: 0 0 auto;
    font-weight: 700;
}

.candidate-pv {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    color: #333;
    font-size: 14px;
    line-height: 1.6;
    white-space: nowrap;
}

.candidate-placeholder {
    color: #777;
}

.candidate-placeholder {
    margin: 12px 0 0;
    font-size: 14px;
}

.board-with-coordinates {
    display: grid;
    grid-template-columns: 544px 30px;
    grid-template-rows: 24px 544px;
}

.file-labels {
    grid-column: 1;
    display: grid;
    grid-template-columns: repeat(9, 60px);
    box-sizing: border-box;
    padding-left: 2px;
    font-weight: 700;
}

.file-labels span,
.rank-labels span {
    display: flex;
    align-items: center;
    justify-content: center;
}

.rank-labels {
    grid-column: 2;
    grid-row: 2;
    display: grid;
    grid-template-rows: repeat(9, 60px);
    box-sizing: border-box;
    padding-top: 2px;
    font-weight: 700;
}

.board {
    grid-column: 1;
    grid-row: 2;
    width: 540px;
    display: grid;
    grid-template-columns: repeat(9, 60px);
    grid-template-rows: repeat(9, 60px);
    border: 2px solid #333;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
}

.cell {
    position: relative;

    width: 60px;
    height: 60px;
    border: 1px solid #666;

    display: flex;
    align-items: center;
    justify-content: center;

    touch-action: none;

    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
}

.piece {
    font-size: 28px;
    font-weight: bold;
    user-select: none;
    z-index: 2;
}

.piece.sente {
    color: #0040C0;
}

.piece.gote {
    color: #c00000;
    transform: rotate(180deg);
}

.piece.promoted.sente {
    color: #3060FF;
    font-weight: 900;
}

.piece.promoted.gote {
    color: #ff3030;
    font-weight: 900;
}

.selected {
    background: #ffdf80 !important;
}

.captured {
    min-width: 0;
    min-height: 80px;
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid #aaa;
    border-radius: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    align-content: flex-start;
    cursor: pointer;
}

.gote-captured {
    align-self: start;
}

.sente-captured {
    align-self: end;
}

.piece.captured-empty {
    color: #999;
    cursor: default;
}

.piece.selected-drop {
    background: #ffd54f;
    border-radius: 4px;
}

.heat {
    position: absolute;
    inset: 0;
    z-index: 0;
}

.heat-count {
    position: absolute;
    font-size: 10px;
    font-weight: bold;
    z-index: 4;
    pointer-events: none;
}

.gote-count {
    top: 2px;
    left: 3px;
    color: #e53935;
    transform: rotate(180deg);
    transform-origin: center;
    display: inline-block;
}

.sente-count {
    bottom: 2px;
    right: 3px;
    color: #1e88e5;
}

.sente-advantage {
    box-shadow: inset 0 0 0 3px #1e88e5;
}

.gote-advantage {
    box-shadow: inset 0 0 0 3px #e53935;
}
</style>
