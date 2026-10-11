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
            <button class="toggle-button" :class="{ active: showExplanation }" type="button"
                role="switch" :aria-checked="showExplanation" @click="showExplanation = !showExplanation">
                解説表示
            </button>
            <!-- 形勢（評価値・候補手）と形勢グラフをまとめて切り替える -->
            <button class="toggle-button" :class="{ active: showEvaluation }" type="button"
                role="switch" :aria-checked="showEvaluation" @click="showEvaluation = !showEvaluation">
                形勢表示
            </button>
        </div>
        <dialog ref="helpDialog" class="help-dialog" role="dialog" aria-modal="true"
            aria-labelledby="help-dialog-title" @cancel.prevent @click="handleHelpDialogClick">
            <div class="help-dialog-content">
                <h2 id="help-dialog-title">操作説明</h2>

                <section>
                    <h3>このアプリについて</h3>
                    <p>将棋盤上の駒を自由に配置・移動しながら、駒の利き・局面の解説・形勢（評価値と候補手）を確認できるツールです。棋譜の読み込みと出力にも対応しています。</p>
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
                        <li>手番は形勢と解説の基準になるだけで、駒は手番に関係なく動かせます。手番は駒台の「先手番／後手番」の札で示し、形勢の欄の「手番」ボタンで切り替えられます。</li>
                        <li>ただし王手を放置した局面（手番の側が相手の玉を取れる局面）や、玉が盤上に1枚ずつそろっていない局面は、形勢の評価と解説ができません。</li>
                    </ul>
                </section>

                <section>
                    <h3>表示の切り替え</h3>
                    <p>画面上部のボタンで、次の3つの表示を切り替えられます。</p>
                    <ul>
                        <li><strong>ヒートマップ表示</strong>：先手と後手の駒が利いているマスと利きの数を色で表示します。利きの数が多いほど濃い色になります。オフにすると、通常の将棋盤の見た目になります。</li>
                        <li><strong>解説表示</strong>：盤の下に局面の解説を表示します。</li>
                        <li><strong>形勢表示</strong>：評価値と候補手を表示します。解説表示もオンのときは、右の列に候補手を5手、解説の右に形勢グラフを表示します。形勢表示だけのときは、盤の下に候補手を3手表示します。</li>
                    </ul>
                </section>

                <section>
                    <h3>棋譜</h3>
                    <ul>
                        <li>棋譜の行を選ぶと、その手を指した直後の局面へ移動します。＜と＞は一手戻る／進む操作です。長押しすると連続で移動します。</li>
                        <li>棋譜の手を選んでいるときは、その手で動いた駒の移動先を緑の枠、移動元を緑の点線の枠で示します。</li>
                        <li>途中の局面で駒を動かすと、それより後の棋譜は消えて、新しく指した手に置き換わります。</li>
                        <li>棋譜欄の「読込」では、平手のKIF棋譜を読み込めます。Shift-JISの「.kif」とUTF-8の「.kifu」に対応しています。駒の動きに反する手や王手を放置する手を含む棋譜は読み込めません。</li>
                        <li>棋譜欄の「出力」では、現在の棋譜をUTF-8の「.kifu」ファイルとして保存できます。</li>
                        <li>通常の将棋で反則扱いとなる操作や手番の手動切り替えなど、KIFで表現できない操作を含む棋譜は出力できません。</li>
                    </ul>
                </section>

                <section>
                    <h3>局面の解説について</h3>
                    <ul>
                        <li>解説は一般的な棋譜解説と同じく、直前の手 → 次の一手 → 形勢の変化 の順に1つの文章で書きます。</li>
                        <li>直前の手では、その手で何が変わったか（駒を取った、角道を開けた、両取りをかけた、取られる形になった など）を書きます。</li>
                        <li>次の一手では、エンジンの候補手のうち評価の近い手を最大3手、その狙いとあわせて紹介します。ほかの手との評価差が大きいときは「〜が有力です」「〜の一手です」、指せる手が1つしかないときは「〜しかありません」と書きます。</li>
                        <li>形勢の変化は、1手前の局面から形勢（互角・指しやすい・有利・優勢）が変わったときに、今の形勢とその理由（駒の損得・玉の安全度・駒の働き・駒の狙い など）を書きます。評価値が大きく動いた手や、最善手より大きく劣る手（疑問手）にはそのことも添えます。</li>
                        <li>形勢の変化を書くには1手前の局面の評価が必要なので、棋譜を1手ずつ進めると確実です。棋譜の手を選んでいないときは、今の形勢を書きます。</li>
                        <li>次の狙いや防いだ狙いは、エンジンで確かめてから書きます。そのため、解説が出そろうまで少し時間がかかることがあります。</li>
                        <li>解説は盤面の利きと駒の配置から作った目安です。エンジンの数手先の読みまでは説明できないため、候補手の読み筋もあわせて確認してください。</li>
                    </ul>
                </section>

                <section>
                    <h3>形勢（評価値・候補手）について</h3>
                    <ul>
                        <li>局面を表示すると、自動で評価値と候補手を計算します。評価値は「先手+300」のように、どちらが何点良いかで表示します（差が50点未満なら互角）。</li>
                        <li>候補手は1手目と評価値を大きく表示し、その下に続く読み筋を表示します。</li>
                        <li>形勢グラフは、評価したことのある手のうち続けて評価した手どうしを線でつなぎます。表示中の手は緑の破線で示します。グラフにマウスを乗せるとその手の評価値が表示され、クリックするとその手の局面に移動します。</li>
                        <li>形勢の評価には、WebAssembly版の将棋エンジン
                            <a href="https://github.com/mizar/YaneuraOu.wasm" target="_blank" rel="noopener noreferrer">YaneuraOu.wasm</a>
                            の「@mizarjp/yaneuraou.k-p」（NNUE K-P、評価関数は<a href="https://twitter.com/tayayan_ts" target="_blank" rel="noopener noreferrer">たややん</a>氏の水匠Petite、バージョン7.6.3-alpha.0）を使用しています。
                        </li>
                        <li>評価エンジンのライセンスはGNU GPL v3.0です。</li>
                    </ul>
                </section>

                <section>
                    <h3>免責・お問い合わせ</h3>
                    <ul>
                        <li>評価値・候補手・解説は参考情報です。正確性や完全性を保証するものではありませんので、あらかじめご了承ください。</li>
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
        <div class="position-layout" :class="{ 'with-explain': showExplanation && showEvaluation }">
            <div class="board-stage" :class="{ 'wood-stage': heatMode === 'none' }">
                <div class="captured gote-captured" :class="{ 'to-move': sideToMove === 'gote' }" @click="moveSelectedToCaptured('gote')">
                    <!-- 手番の札（表示のみ。手番の切り替えは形勢の欄のボタンで行う） -->
                    <span v-if="sideToMove === 'gote'" class="turn-badge gote-turn">△後手番</span>
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
                    <div class="board" :class="{ 'wood-board': heatMode === 'none' }">
            <template v-for="(row, rowIndex) in board" :key="rowIndex">
                <div v-for="(cell, colIndex) in row" :key="`${rowIndex}-${colIndex}`" class="cell" :class="[
                    cellAdvantageClass(rowIndex, colIndex),
                    {
                        selected: isSelected(rowIndex, colIndex),
                        star: isStarPoint(rowIndex, colIndex),
                        'last-move-to': isLastMoveSquare('to', rowIndex, colIndex),
                        'last-move-from': isLastMoveSquare('from', rowIndex, colIndex)
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
                <div class="captured sente-captured" :class="{ 'to-move': sideToMove === 'sente' }" @click="moveSelectedToCaptured('sente')">
                    <span v-if="sideToMove === 'sente'" class="turn-badge sente-turn">▲先手番</span>
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
                <!-- 見出しと評価値はどちらも短いので1行にまとめる（右の列では評価値を2行目に送る） -->
                <div class="evaluation-heading">
                    <strong>形勢</strong>
                    <span class="evaluation-value" :class="evaluationClass">{{ evaluationText }}</span>
                    <button class="turn-button" :class="`turn-${sideToMove}`" type="button" @click="toggleTurn">
                        手番：{{ sideToMove === 'sente' ? '先手' : '後手' }}
                    </button>
                </div>
                <small v-if="evaluationDetail" class="evaluation-detail">{{ evaluationDetail }}</small>
                <ol v-if="evaluation.candidates.length" class="candidate-list">
                    <li v-for="candidate in evaluation.candidates.slice(0, candidateCount)" :key="candidate.rank" class="candidate-card">
                        <!-- 評価値放送のように、1手目と評価値を見出しにし、続きの読み筋は控えめに添える -->
                        <div class="candidate-head">
                            <span class="candidate-rank">{{ candidate.rank }}</span>
                            <strong class="candidate-move">{{ candidate.notation[0] }}</strong>
                            <span class="candidate-score" :class="candidateScoreClass(candidate)">{{ candidateScoreText(candidate) }}</span>
                        </div>
                        <div v-if="candidate.notation.length > 1" class="candidate-pv">
                            <span v-for="(step, stepIndex) in candidate.notation.slice(0, 9)" :key="stepIndex">{{ step }}</span>
                        </div>
                    </li>
                </ol>
                <p v-else-if="evaluation.status === 'thinking'" class="candidate-placeholder">候補手を探索中…</p>
            </section>
            <aside v-if="showExplanation" class="explain-side" aria-live="polite">
                <div class="explain-side-inner">
                    <h2 class="explain-side-title">解説</h2>
                    <p v-if="commentaryText" class="commentary">{{ commentaryText }}</p>
                    <p v-else class="explain-note">{{ commentaryPlaceholder }}</p>
                </div>
            </aside>
            <!-- 形勢グラフ。局面評価を右の列に出すとき（解説と局面評価を両方表示）だけ、解説の右に同じ高さで出す -->
            <figure v-if="showExplanation && showEvaluation" class="evaluation-graph" aria-label="形勢グラフ">
                <figcaption>形勢グラフ<small v-if="evaluationGraph">（{{ evaluationGraph.currentPly }}手目を表示中）</small></figcaption>
                <div v-if="evaluationGraph" class="graph-body">
                    <svg :viewBox="`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT + GRAPH_AXIS}`" role="img"
                        @click="jumpFromGraph" @mousemove="hoverGraph" @mouseleave="graphHoverPly = null">
                        <defs>
                            <clipPath id="graph-sente-side"><rect x="0" y="0" :width="GRAPH_WIDTH" :height="GRAPH_HEIGHT / 2" /></clipPath>
                            <clipPath id="graph-gote-side"><rect x="0" :y="GRAPH_HEIGHT / 2" :width="GRAPH_WIDTH" :height="GRAPH_HEIGHT / 2" /></clipPath>
                        </defs>
                        <line v-for="y in evaluationGraph.gridLines" :key="y" class="graph-grid" x1="0" :x2="GRAPH_WIDTH" :y1="y" :y2="y" />
                        <line class="graph-zero" x1="0" :x2="GRAPH_WIDTH" :y1="GRAPH_HEIGHT / 2" :y2="GRAPH_HEIGHT / 2" />
                        <path v-for="(area, index) in evaluationGraph.areas" :key="`s${index}`" class="graph-area-sente" :d="area" clip-path="url(#graph-sente-side)" />
                        <path v-for="(area, index) in evaluationGraph.areas" :key="`g${index}`" class="graph-area-gote" :d="area" clip-path="url(#graph-gote-side)" />
                        <line class="graph-current" :x1="evaluationGraph.currentX" :x2="evaluationGraph.currentX" y1="0" :y2="GRAPH_HEIGHT" />
                        <line v-if="graphHover" class="graph-hover" :x1="graphHover.x" :x2="graphHover.x" y1="0" :y2="GRAPH_HEIGHT" />
                        <polyline v-for="(line, index) in evaluationGraph.lines" :key="`l${index}`" class="graph-line" :points="line" />
                        <text class="graph-label" x="3" y="10">先手 +2000</text>
                        <text class="graph-label" x="3" :y="GRAPH_HEIGHT - 4">後手 +2000</text>
                        <!-- 横軸の目盛り（10手ごとと最終手） -->
                        <line class="graph-axis" x1="0" :x2="GRAPH_WIDTH" :y1="GRAPH_HEIGHT" :y2="GRAPH_HEIGHT" />
                        <g v-for="tick in evaluationGraph.ticks" :key="tick.ply">
                            <line class="graph-axis" :x1="tick.x" :x2="tick.x" :y1="GRAPH_HEIGHT" :y2="GRAPH_HEIGHT + 3" />
                            <text class="graph-tick" :x="tick.x" :y="GRAPH_HEIGHT + 12" :text-anchor="tick.anchor">{{ tick.ply }}</text>
                        </g>
                    </svg>
                    <div v-if="graphHover" class="graph-tooltip" :class="{ flip: graphHover.x > GRAPH_WIDTH / 2 }"
                        :style="{ left: `${(graphHover.x / GRAPH_WIDTH) * 100}%` }">
                        <strong>{{ graphHover.label }}</strong>
                        <span :class="graphHover.scoreClass">{{ graphHover.scoreText }}</span>
                    </div>
                </div>
                <p v-else class="candidate-placeholder">棋譜の手を選ぶと、初手からの形勢を表示します</p>
            </figure>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, toRaw, onBeforeUnmount, onMounted, watch, nextTick } from 'vue'
import engineScriptUrl from '@mizarjp/yaneuraou.k-p/lib/yaneuraou.k-p.js?url'
import engineWasmUrl from '@mizarjp/yaneuraou.k-p/lib/yaneuraou.k-p.wasm?url'
import engineWorkerUrl from '@mizarjp/yaneuraou.k-p/lib/yaneuraou.k-p.worker.js?url'
import { formatUsiPv, positionToSfen } from './shogiEvaluation.js'
import { isFatalEngineEvent } from './shogiEngineError.js'
import { applyUsiMove, canCaptureKing, computeAttackCounts, explainMove, explainPosition, followUpRelation, moveToUsi } from './shogiExplain.js'
import { commentFormChange, commentMove, commentPlan, lossOfPlayedMove } from './shogiCommentary.js'
import { applyMove as applyKifMove, createStandardPosition, decodeKif, exportKifu, formatMove as formatKifMove, parseKif } from './shogiKif.js'

const sideToMove = ref('sente')
const showEvaluation = ref(true)
const showExplanation = ref(true)
// 候補手の数。局面評価を右の列に出す（解説と局面評価を両方表示する）ときは縦に余裕があるので5手、
// 局面評価だけのときは横長の欄に並べるので3手
const candidateCount = computed(() => (showExplanation.value && showEvaluation.value ? 5 : 3))
// 候補手を増やしたときだけ読み直す（減らすときは表示を絞るだけでよい）
watch(candidateCount, (count, previous) => {
    if (count > previous) scheduleEvaluation(0)
})
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
// エンジンに送った探索の列。エンジンは命令を順に処理し、探索ごとに最後に bestmove を返すので、
// bestmove が届くまでの info は列の先頭の探索のものとして扱う
const engineTasks = []
// 相手が何もしなかった局面で、狙い（次の狙い・防いだ狙い）が本当に好手かの確認結果（キーは局面と狙いの手）
const threatChecks = ref({})
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
    if (evaluation.value.mated) {
        const loser = evaluation.value.mated === 'sente' ? '先手' : '後手'
        const winner = evaluation.value.mated === 'sente' ? '後手' : '先手'
        return `${winner}の勝ち（${loser}玉は詰んでいます）`
    }
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
    // 探索の深さや局面数は利用者には意味が伝わらないので出さない
    return ''
})

// 形勢グラフ。横軸は初手から今表示している手まで、縦軸は先手から見た評価値（±2000で打ち切り、詰みは端）。
// 評価したことのある局面だけを打ち、評価は探索のたびに更新される evaluationHistory の最新を使う
const GRAPH_WIDTH = 296
const GRAPH_HEIGHT = 150
// 横軸の目盛りの文字を置く高さ
const GRAPH_AXIS = 16
const GRAPH_LIMIT = 2000
const GRAPH_PAD = 4

// 形勢グラフ上のマウスの位置に最も近い手
function graphPlyAt(event) {
    const graph = evaluationGraph.value
    const svg = event.currentTarget
    if (!graph || !svg) return null
    const rect = svg.getBoundingClientRect()
    const viewX = ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH
    const ratio = (viewX - GRAPH_PAD) / (GRAPH_WIDTH - GRAPH_PAD * 2)
    return Math.max(0, Math.min(graph.lastPly, Math.round(ratio * Math.max(graph.lastPly, 1))))
}

// クリックした位置に近い手の局面を表示する
function jumpFromGraph(event) {
    const ply = graphPlyAt(event)
    if (ply === null) return
    if (ply === 0) showInitialPosition()
    else showMovePosition(ply - 1)
}

// マウスを乗せた手の手数・指し手・評価値をツールチップに出す
const graphHoverPly = ref(null)
function hoverGraph(event) {
    graphHoverPly.value = graphPlyAt(event)
}

const graphHover = computed(() => {
    const graph = evaluationGraph.value
    const ply = graphHoverPly.value
    if (!graph || ply === null || ply > graph.lastPly) return null
    const entry = graph.entries[ply]
    const label = ply === 0 ? '開始前' : `${ply}手目 ${moveRecords.value[ply - 1]?.notation ?? ''}`
    if (!entry) return { x: graph.x(ply), label, scoreText: '未評価', scoreClass: '' }
    // 手番の側がすでに詰んでいる局面（mate 0）は、相手の勝ちとして示す
    if (entry.mate === 0) {
        const winner = graph.positions[ply].sideToMove === 'sente' ? 'gote' : 'sente'
        return { x: graph.x(ply), label, scoreText: `${winner === 'sente' ? '先手' : '後手'}勝ち`, scoreClass: `${winner}-evaluation` }
    }
    return { x: graph.x(ply), label, scoreText: candidateScoreText(entry), scoreClass: candidateScoreClass(entry) }
})
const evaluationGraph = computed(() => {
    // initialPosition はリアクティブでないので、起動直後に早く return しても評価が届いたら描き直されるよう、先に評価の履歴を読む
    const history = evaluationHistory.value
    const index = selectedRecordIndex.value
    if (index === null || !initialPosition) return null
    const positions = [initialPosition, ...moveRecords.value.map((record) => record.position)]
    const currentPly = index + 1
    // 横軸は、評価したことのある最も先の手まで（表示中の手がそれより先ならそこまで）
    const evaluatedPlies = positions.map((position, ply) => (position && history[positionKey(position)] ? ply : -1))
    const lastPly = Math.max(currentPly, ...evaluatedPlies)
    const x = (ply) => GRAPH_PAD + (ply / Math.max(lastPly, 1)) * (GRAPH_WIDTH - GRAPH_PAD * 2)
    const y = (value) => GRAPH_HEIGHT / 2 - (value / GRAPH_LIMIT) * (GRAPH_HEIGHT / 2 - 2)
    const valueOf = (position, entry) => {
        if (entry.mate === 0) return position.sideToMove === 'sente' ? -GRAPH_LIMIT : GRAPH_LIMIT
        if (entry.mate !== null && entry.mate !== undefined) return Math.sign(entry.mate) * GRAPH_LIMIT
        return Math.max(-GRAPH_LIMIT, Math.min(GRAPH_LIMIT, entry.score))
    }
    const entries = positions.slice(0, lastPly + 1).map((position) => (position && history[positionKey(position)]) || null)
    const points = []
    entries.forEach((entry, ply) => {
        if (entry) points.push({ ply, x: x(ply), y: y(valueOf(positions[ply], entry)) })
    })
    // 続けて評価のある手どうしだけを線でつなぐ（評価していない手をまたいで線を引かない）
    const runs = []
    for (const point of points) {
        const run = runs.at(-1)
        if (run && run.at(-1).ply === point.ply - 1) run.push(point)
        else runs.push([point])
    }
    const zero = GRAPH_HEIGHT / 2
    const connected = runs.filter((run) => run.length > 1)
    // 目盛りは10手ごと（長い将棋では間隔を広げる）と最終手。最終手に近すぎる目盛りは文字が重なるので省く
    const step = lastPly <= 150 ? 10 : lastPly <= 300 ? 20 : 50
    const ticks = []
    for (let ply = 0; ply < lastPly; ply += step) {
        if (ply === 0 || x(lastPly) - x(ply) >= 26) ticks.push({ ply, x: x(ply), anchor: ply === 0 ? 'start' : 'middle' })
    }
    ticks.push({ ply: lastPly, x: x(lastPly), anchor: 'end' })
    return {
        lastPly,
        currentPly,
        currentX: x(currentPly),
        x,
        entries,
        positions,
        ticks,
        lines: connected.map((run) => run.map((point) => `${point.x},${point.y}`).join(' ')),
        areas: connected.map((run) => `M${run[0].x},${zero} ${run.map((point) => `L${point.x},${point.y}`).join(' ')} L${run.at(-1).x},${zero} Z`),
        gridLines: [y(1000), y(-1000)],
    }
})

// 棋譜の手を選んでいるときは、その手で動いた駒の移動元と移動先を盤上で示す
const lastMove = computed(() => {
    const index = selectedRecordIndex.value
    if (index === null || index < 0) return null
    return moveRecords.value[index]?.move ?? null
})

function isLastMoveSquare(end, row, col) {
    const square = lastMove.value?.[end]
    if (!square || (end === 'from' && lastMove.value.drop)) return false
    return square.row === row && square.col === col
}

const positionExplanation = computed(() => {
    if (evaluation.value.status !== 'ready') return null
    return explainPosition(
        { board: board.value, hands: capturedPieces.value, sideToMove: sideToMove.value },
        { score: evaluation.value.score, mate: evaluation.value.mate },
    )
})

// 局面ごとの評価を覚えておき、解説の最後で形勢の変化に触れる
const evaluationHistory = ref({})

function positionKey(position) {
    return positionToSfen(position.board, position.capturedPieces, position.sideToMove)
}

const currentPositionKey = computed(() => positionToSfen(board.value, capturedPieces.value, sideToMove.value))
const STANDARD_START_KEY = positionKey(createStandardPosition())

// 候補手（USI と評価値）も残しておき、実戦の手が最善手よりどれだけ悪かったかの判定に使う
const currentEvaluation = computed(() => (
    evaluation.value.status === 'ready'
        ? {
            score: evaluation.value.score,
            mate: evaluation.value.mate,
            candidates: [...evaluation.value.candidates]
                .sort((a, b) => a.rank - b.rank)
                .filter((candidate) => candidate.moves?.[0])
                // 読み筋の最初の3手（実戦の手の意図の手がかりに使う）
                .map((candidate) => ({
                    usi: candidate.moves[0],
                    score: candidate.score,
                    mate: candidate.mate,
                    pv: candidate.notation.slice(0, 3),
                    pvUsi: candidate.moves.slice(0, 3),
                })),
        }
        : null
))

watch(currentEvaluation, (value) => {
    if (value) evaluationHistory.value = { ...evaluationHistory.value, [currentPositionKey.value]: value }
})

function opponentOf(owner) {
    return owner === 'sente' ? 'gote' : 'sente'
}

// 狙いを確かめる局面（相手が何もしなかったとして、狙いを持つ側に手番を渡した局面）。
// 直前の手: 次の狙いは指した後の局面で指した側の手番、防いだ狙いは指す前の局面で相手の手番
const moveThreatSfen = computed(() => {
    const index = selectedRecordIndex.value
    const record = index !== null && index >= 0 ? moveRecords.value[index] : null
    const prev = index === 0 ? initialPosition : moveRecords.value[index - 1]?.position
    if (!record?.position || !prev) return null
    // 王手放置になる局面はエンジンに渡さない（その狙いは確かめられないので書かない）
    const sfen = (position, side) => (canCaptureKing(position.board, side) ? null : positionToSfen(position.board, position.capturedPieces, side))
    return {
        next: sfen(record.position, record.owner),
        prevent: sfen(prev, opponentOf(record.owner)),
    }
})

// 推奨手の防いだ狙いは、今の局面で相手の手番
const planThreatSfen = computed(() => ({
    prevent: canCaptureKing(board.value, opponentOf(sideToMove.value))
        ? null
        : positionToSfen(board.value, capturedPieces.value, opponentOf(sideToMove.value)),
}))

function threatRequests(effects, sfens) {
    if (!sfens) return []
    return effects
        .filter((effect) => (effect.kind === 'next' || effect.kind === 'prevent') && effect.threatUsi && sfens[effect.kind])
        .map((effect) => ({ usi: effect.threatUsi, sfen: sfens[effect.kind] }))
}

// 次の狙い・防いだ狙いは、エンジンで好手と確かめられたものだけを書く（確認中は書かない）
function verifiedEffects(effects, sfens) {
    return effects.filter((effect) => {
        if (effect.kind !== 'next' && effect.kind !== 'prevent') return true
        if (!effect.threatUsi || !sfens?.[effect.kind]) return false
        return threatChecks.value[threatCheckKey({ usi: effect.threatUsi, sfen: sfens[effect.kind] })] === true
    })
}

// エンジンでの確認が必要な狙いの一覧（直前の手を先に確かめる）
const pendingThreatChecks = computed(() => [
    ...threatRequests(moveExplanation.value, moveThreatSfen.value),
    ...threatRequests(planExplanation.value?.effects ?? [], planThreatSfen.value),
].filter((check) => !(threatCheckKey(check) in threatChecks.value)))

const moveCommentary = computed(() => {
    const index = selectedRecordIndex.value
    if (index === null || index < 0 || !moveExplanation.value) return []
    const record = moveRecords.value[index]
    const prev = index === 0 ? initialPosition : moveRecords.value[index - 1]?.position
    if (!record || !prev) return []
    const before = evaluationHistory.value[positionKey(prev)] ?? null
    const played = before?.candidates?.find((candidate) => candidate.usi === moveToUsi(record.move))
    const effects = verifiedEffects(moveExplanation.value, moveThreatSfen.value)
    return commentMove({
        notation: record.notation,
        mover: record.owner,
        effects,
        before,
        playedLoss: lossOfPlayedMove(before?.candidates, moveToUsi(record.move), record.owner),
        plannedNext: plannedFollowUp(played, record),
        after: currentEvaluation.value,
        seed: currentPositionKey.value,
        includeEvaluation: false,
    })
})

// 候補手ごとの効果（次の一手で、符号の前に説明を付けるため）
const planExplanation = computed(() => {
    if (!currentEvaluation.value) return null
    const current = { board: board.value, hands: capturedPieces.value, sideToMove: sideToMove.value }
    const index = selectedRecordIndex.value
    const last = index !== null && index >= 0 ? moveRecords.value[index] : null
    const beforeLast = index === 0 ? initialPosition : moveRecords.value[index - 1]?.position
    const candidates = [...evaluation.value.candidates]
        .sort((a, b) => a.rank - b.rank)
        .map((candidate) => {
            const next = candidate.moves?.[0] && applyUsiMove(current, candidate.moves[0])
            if (!next) return { notation: candidate.notation[0], score: candidate.score, mate: candidate.mate, effects: [] }
            // 直前に相手が駒を取ったマスで取る手は「取り返す」
            const recapture = Boolean(last?.move && beforeLast && !last.move.drop
                && last.move.to.row === next.move.to.row && last.move.to.col === next.move.to.col
                && beforeLast.board[last.move.to.row][last.move.to.col])
            return {
                notation: candidate.notation[0],
                score: candidate.score,
                mate: candidate.mate,
                effects: explainMove(current, next.position, next.move, { recapture }),
            }
        })
    if (!candidates.length) return null
    return { candidates, effects: candidates[0].effects }
})

const planCommentary = computed(() => {
    const plan = planExplanation.value
    if (!plan) return []
    // 1番手の狙い（〜を防ぐ）はエンジンで確かめたものだけを書く。2番手以降は確かめていないので狙いを書かない
    const candidates = plan.candidates.map((candidate, rank) => ({
        ...candidate,
        effects: rank === 0
            ? verifiedEffects(candidate.effects, planThreatSfen.value)
            : candidate.effects.filter((effect) => effect.kind !== 'next' && effect.kind !== 'prevent'),
    }))
    // 直前の手の文との境目がわかるよう、手番の側を名指しして書き出す
    const replying = moveCommentary.value.length > 0
    // 探索が終わって候補手が1つだけなら、合法手がその1手しかない（エンジンは合法手の数より多くの候補を返さない）
    const onlyMove = Boolean(evaluation.value.complete) && candidates.length === 1
    return commentPlan({ seed: currentPositionKey.value, candidates, sideToMove: sideToMove.value, lead: replying ? 'reply' : 'turn', onlyMove })
})

// 直前の局面の解説。形勢の言い方が変わったかを比べる
const previousExplanation = computed(() => {
    const index = selectedRecordIndex.value
    if (index === null || index < 0) return null
    const prev = index === 0 ? initialPosition : moveRecords.value[index - 1]?.position
    const evaluationBefore = prev && evaluationHistory.value[positionKey(prev)]
    if (!evaluationBefore) return null
    return explainPosition({ board: prev.board, hands: prev.capturedPieces, sideToMove: prev.sideToMove }, evaluationBefore)
})

// 形勢の変化（大きく動いたときだけ）。棋譜の手を選んでいないときは今の形勢を書く
const formCommentary = computed(() => {
    const index = selectedRecordIndex.value
    if (index === null || index < 0) {
        // 平手の初期局面が互角なのは当たり前なので書かない
        if (currentPositionKey.value === STANDARD_START_KEY) return []
        return commentFormChange({ explanation: positionExplanation.value, seed: currentPositionKey.value, standalone: true })
    }
    const record = moveRecords.value[index]
    const prev = index === 0 ? initialPosition : moveRecords.value[index - 1]?.position
    const before = prev ? evaluationHistory.value[positionKey(prev)] ?? null : null
    // 直前の局面の評価がわからなければ、変化を語れないので書かない
    if (!record || !before) return []
    return commentFormChange({
        notation: record.notation,
        mover: record.owner,
        before,
        after: currentEvaluation.value,
        playedLoss: lossOfPlayedMove(before.candidates, moveToUsi(record.move), record.owner),
        explanation: positionExplanation.value,
        previousExplanation: previousExplanation.value,
        seed: currentPositionKey.value,
    })
})

// 一般的な棋譜解説に合わせ、直前の手 → 次の一手 → 形勢の変化 の順に1つの文章にまとめる
// 評価できない局面（王手放置など）は、反則の手を解説しないよう何も書かない
const commentaryText = computed(() => (evaluation.value.status === 'error' ? '' : [...moveCommentary.value, ...planCommentary.value, ...formCommentary.value]
    .map((part) => part.text).join('')))

const commentaryPlaceholder = computed(() => {
    if (evaluation.value.status === 'error') return `この局面は解説できません。${evaluation.value.message}`
    return evaluation.value.mated ? '詰みのため、次の一手はありません。' : '評価が出ると解説を表示します'
})

const moveExplanation = computed(() => {
    const index = selectedRecordIndex.value
    if (index === null || index < 0) return []
    const record = moveRecords.value[index]
    const prev = index === 0 ? initialPosition : moveRecords.value[index - 1]?.position
    const toInput = (position) => position && {
        board: position.board,
        hands: position.capturedPieces,
        sideToMove: position.sideToMove,
    }
    return explainMove(toInput(prev), toInput(record?.position), record?.move, { recapture: isRecapture(index) })
})

// 実戦の手が候補手だったとき、その読み筋のうち実戦の手と連動する続き（連動しなければ null）
function plannedFollowUp(played, record) {
    if (!played?.pvUsi?.[2] || !record?.position) return null
    const position = { board: record.position.board, hands: record.position.capturedPieces, sideToMove: record.position.sideToMove }
    const relation = followUpRelation(position, record.move, played.pvUsi[1], played.pvUsi[2])
    return relation ? { next: played.pv[2], reply: played.pv[1], ...relation } : null
}

// index 手目が、直前の手で駒を取られたマスで取り返す手か
function isRecapture(index) {
    if (index < 1) return false
    const record = moveRecords.value[index]
    const last = moveRecords.value[index - 1]
    const beforeLast = index === 1 ? initialPosition : moveRecords.value[index - 2]?.position
    if (!record?.move || !last?.move || !beforeLast) return false
    const sameSquare = record.move.to.row === last.move.to.row && record.move.to.col === last.move.to.col
    return sameSquare && !last.move.drop && Boolean(beforeLast.board[last.move.to.row][last.move.to.col])
}



const evaluationClass = computed(() => ({
    'sente-evaluation': evaluation.value.score > 0 || (evaluation.value.mate ?? 0) > 0 || evaluation.value.mated === 'gote',
    'gote-evaluation': evaluation.value.score < 0 || (evaluation.value.mate ?? 0) < 0 || evaluation.value.mated === 'sente',
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
function computeAttackMap() {
    attackMap.value = computeAttackCounts(board.value)
}
const selectedDrop = ref(null) // { owner, type }

function isSelected(row, col) {
    return (
        selected.value &&
        selected.value.row === row &&
        selected.value.col === col
    )
}


function movePiece(from, to) {
    // 同種の駒の区別（右・左・上・引・寄・直）には、指す前の盤面が要る
    const boardBefore = structuredClone(toRaw(board.value))
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

    addMoveRecord(movingPiece, to.row, to.col, false, from, boardBefore)

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

function addMoveRecord(movingPiece, row, col, isDrop = false, from = null, boardBefore = null) {
    if (
        selectedRecordIndex.value !== null &&
        selectedRecordIndex.value < moveRecords.value.length - 1
    ) {
        moveRecords.value.splice(selectedRecordIndex.value + 1)
        kifIncompatibleReason.value = ''
    }
    // 直前の手と同じマスへの手は「同」と書く（棋譜の続きでないときは書かない）
    const previousTo = selectedRecordIndex.value !== null ? moveRecords.value.at(-1)?.move?.to ?? null : null

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
        notation: `${marker}${formatKifMove(move, previousTo, false, boardBefore)}`,
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

// 確かめる狙いが変わったら、手が空いていればすぐ確かめる
watch(pendingThreatChecks, () => startThreatCheck())

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

// 星（盤の目印の点）は３・６段目と３・６筋の交点。その交点を右下の角に持つマスに付ける
function isStarPoint(row, col) {
    return (row === 2 || row === 5) && (col === 2 || col === 5)
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
            // 同種の駒の区別（右・左・上・引・寄・直）には、指す前の盤面が要る
            const boardBefore = structuredClone(position.board)
            applyKifMove(position, move)
            board.value = structuredClone(position.board)
            capturedPieces.value = structuredClone(position.capturedPieces)
            sideToMove.value = position.sideToMove
            computeAttackMap()
            importedRecords.push({
                owner: move.owner,
                notation: `${move.owner === 'sente' ? '▲' : '△'}${formatKifMove(move, previousTo, false, boardBefore)}`,
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

// エンジンが異常終了したら、リロードしなくて済むよう自動で作り直す。
// 同じ原因で止まり続ける場合に備えて回数に上限を設け、超えたらリロードを案内する
const MAX_ENGINE_RESTARTS = 3
let engineRestarts = 0
// 作り直している間は、止まったエンジンから遅れて届くエラー通知を無視する
let restartingEngine = false

function setFatalEngineError() {
    if (evaluation.value.restartRequired || restartingEngine) return

    clearTimeout(evaluationTimer)
    evaluationSequence++
    engineTasks.length = 0
    try {
        engine?.terminate()
    } catch {
        // すでに止まっているエンジンは終了できなくてもよい
    }
    engine = null

    if (engineRestarts >= MAX_ENGINE_RESTARTS) {
        evaluation.value = {
            ...evaluation.value,
            status: 'error',
            message: '評価中にエラーが続いて発生しました。画面を再読み込みしてください。',
            candidates: [],
            restartRequired: true,
        }
        return
    }
    engineRestarts++
    restartingEngine = true
    evaluation.value = { ...evaluation.value, status: 'loading', message: '', candidates: [], mated: null }
    setTimeout(() => initializeEngine(), 300)
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
        engine = await window.YaneuraOu_K_P({
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
    if (window.YaneuraOu_K_P) return Promise.resolve()
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
        engineMultiPv = 3
        engine.postMessage('isready')
        return
    }
    if (line === 'readyok') {
        // 作り直したエンジンが使えるようになった
        restartingEngine = false
        scheduleEvaluation(0)
        return
    }
    if (line.startsWith('bestmove')) {
        const task = engineTasks.shift()
        // 局面評価の探索が終わった。候補手が出そろったので、合法手が1つしかないかを判断できる
        if (task?.type === 'main' && !task.cancelled && task.sequence === evaluationSequence && evaluation.value.status === 'ready') {
            evaluation.value = { ...evaluation.value, complete: true }
        }
        if (task?.type === 'verify' && !task.cancelled) {
            // 狙いの手が候補手（MultiPV 3）に入り、最善手と大差がなければ、好手の狙いとして書ける
            const best = task.lines[0]
            const threat = task.lines.find((item) => item?.usi === task.usi)
            const verified = Boolean(best && threat && best.value - threat.value <= THREAT_CHECK_MARGIN)
            threatChecks.value = { ...threatChecks.value, [task.key]: verified }
        }
        startThreatCheck()
        return
    }
    if (!line.startsWith('info ')) return
    const task = engineTasks[0]
    if (task?.type === 'verify') {
        const rank = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1)
        const first = line.match(/\bpv (\S+)/)?.[1]
        const score = line.match(/\bscore (cp|mate) (-?\d+)/)
        // 評価は手番の側（狙いを持つ側）から見た値。詰みは大きな値に置き換える
        const value = score?.[1] === 'mate' ? Math.sign(Number(score[2]) || 1) * 30000 : Number(score?.[2] ?? 0)
        if (first) task.lines[rank - 1] = { usi: first, value }
        return
    }
    // 止めた古い局面の探索結果で、今の局面の評価を上書きしない
    if (task?.cancelled || (task && task.sequence !== evaluationSequence)) return

    const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/)
    if (!scoreMatch) return

    const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0)
    const nodes = Number(line.match(/\bnodes (\d+)/)?.[1] ?? 0)
    const rank = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1)
    const pvMatch = line.match(/\bpv (.+)$/)
    if (!pvMatch || !evaluationBoard) return

    const moves = pvMatch[1].trim().split(/\s+/)
    if (moves[0] === 'resign') {
        // 手番の側がすでに詰んでいる（エンジンは「mate -0 / pv resign」を返す）
        evaluation.value = {
            ...evaluation.value,
            status: 'ready',
            score: 0,
            mate: 0,
            mated: evaluationSideToMove,
            depth,
            nodes,
            message: '',
            candidates: [],
            restartRequired: false,
        }
        return
    }
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
    evaluation.value = { ...evaluation.value, status: 'thinking', message: '', candidates: [], mated: null, complete: false }
    const sequence = ++evaluationSequence
    evaluationTimer = setTimeout(() => evaluatePosition(sequence), delay)
}

// 確認に使う探索の深さ。浅いと境目の手で判定がぶれるので、局面評価と同じ12にする
const THREAT_CHECK_DEPTH = 12
// 狙いの手が候補3手に入り、最善手との評価差がこれ以内なら「好手の狙い」とみなす
const THREAT_CHECK_MARGIN = 200

// エンジンに設定している候補手の数。変わるときだけ設定し直す（探索の開始時に読まれる）
let engineMultiPv = 3

function setEngineMultiPv(count) {
    if (engineMultiPv === count) return
    engine.postMessage(`setoption name MultiPV value ${count}`)
    engineMultiPv = count
}

function threatCheckKey(check) {
    return `${check.sfen}|${check.usi}`
}

// 局面評価が終わったあと、解説に出す狙い（次の狙い・防いだ狙い）をエンジンで1つずつ確かめる
function startThreatCheck() {
    const check = pendingThreatChecks.value[0]
    if (!engine || !check || engineTasks.length) return
    engineTasks.push({ type: 'verify', key: threatCheckKey(check), usi: check.usi, lines: [] })
    // 狙いの確認は「候補3手に入るか」で判定するので、局面評価の候補手の数によらず3手で読む
    setEngineMultiPv(3)
    engine.postMessage(`position sfen ${check.sfen}`)
    engine.postMessage(`go depth ${THREAT_CHECK_DEPTH}`)
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
    evaluation.value = { ...evaluation.value, status: 'thinking', message: '', candidates: [], mated: null, complete: false }
    // 途中で止めた探索の結果は使わない
    engineTasks.forEach((task) => { task.cancelled = true })
    engine.postMessage('stop')
    engineTasks.push({ type: 'main', sequence })
    setEngineMultiPv(candidateCount.value)
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
    // 王手放置の局面はエンジンが異常終了することがあるので渡さない
    if (canCaptureKing(board.value, sideToMove.value)) {
        const mover = sideToMove.value === 'sente' ? '先手' : '後手'
        const target = sideToMove.value === 'sente' ? '後手' : '先手'
        return `${target}玉に王手がかかったまま${mover}の手番になっているため評価できません（手番か局面を直してください）`
    }
    return ''
}

</script>

<style scoped>
:global(body) {
    background: #f3ede2;
}

.shogi-app {
    padding: 20px;
    font-family: sans-serif;
}

h1 {
    font-family: "Shippori Mincho B1", serif;
    font-size: 28px;
    font-weight: 800;
    margin: 0;
    line-height: 1.2;
    color: #2b2118;
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
    border: 1px solid #3b2f25;
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
    border: 1px solid #3b2f25;
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
    border-color: #3b2f25;
    background: #3b2f25;
    color: #f6e9cf;
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
    border: 1px solid #d9cbb2;
    border-radius: 10px;
    background: #fffcf6;
    box-shadow: 0 4px 14px rgba(60, 40, 20, .08);
}

.position-layout {
    display: grid;
    grid-template-columns: max-content;
    align-items: start;
    gap: 12px;
}

.position-layout.with-explain {
    grid-template-columns: max-content 320px;
}

/* 解説を表示するときは、解説を盤の下に、局面評価を右の列の上（盤の横）に置く。
   局面評価の中身で行の高さが変わらないよう高さは盤の行に合わせ（height: 0 + min-height: 100%）、
   候補手が収まらないときは候補手の部分だけをスクロールさせる */
.with-explain .evaluation-panel {
    grid-column: 2;
    grid-row: 1;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    width: auto;
    min-width: 0;
    height: 0;
    min-height: 100%;
}

.with-explain .candidate-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    align-content: start;
}

.with-explain .candidate-card {
    padding: 6px 10px;
}

.with-explain .candidate-pv {
    font-size: 10.5px;
    line-height: 1.45;
}

.with-explain .candidate-pv > span {
    margin-right: .35em;
}

/* 盤の下の横長の欄では、候補手のカードを横に並べる */
.position-layout:not(.with-explain) .candidate-list {
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
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
    border: 1px solid #d9cbb2;
    border-radius: 8px;
    background: #fffcf6;
    box-shadow: 0 4px 14px rgba(60, 40, 20, .08);
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

.evaluation-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
}

.evaluation-value {
    margin-right: auto;
    font-size: 18px;
    font-weight: 700;
}

.evaluation-detail {
    display: block;
    margin-top: 4px;
    color: #666;
}

/* 右の列は幅が狭いので、評価値は見出しの下の行に置く */
.with-explain .evaluation-value {
    order: 3;
    flex-basis: 100%;
}

.with-explain .evaluation-heading .turn-button {
    margin-left: auto;
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

.explain-side-inner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    box-sizing: border-box;
    padding: 12px 16px;
}

.explain-side-title {
    margin: 0;
    font-size: 16px;
}

.explain-side {
    grid-column: 1;
    grid-row: 2;
    width: 1090px;
    /* 解説の長さで高さが変わらないよう、従来の局面評価の欄と同じ高さに固定し、長いときはスクロールさせる */
    height: 228px;
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid #d9cbb2;
    border-radius: 8px;
    background: #fffcf6;
    box-shadow: 0 4px 14px rgba(60, 40, 20, .08);
}

.commentary,
.explain-side .explain-note {
    flex: 1;
    /* 欄の高さは固定し、文章が長いときは白地の文章部分だけをスクロールさせる */
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 10px 14px;
    border: 1px solid #e4d8c3;
    border-radius: 7px;
    /* 読みやすさを優先し、文章の部分だけ白地にする */
    background: #fff;
}

.commentary {
    color: #1f1a14;
    font-size: 17px;
    line-height: 1.9;
    letter-spacing: .02em;
}


.explain-note {
    margin: 6px 0 0;
    color: #6b5a45;
    font-size: 13px;
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

.candidate-head {
    display: flex;
    min-width: 0;
    gap: 8px;
    align-items: baseline;
}

.candidate-rank {
    flex: 0 0 auto;
    color: #8a7560;
    font-size: 13px;
    font-weight: 700;
}

.candidate-move {
    flex: 1 1 auto;
    min-width: 0;
    color: #1f1a14;
    font-size: 19px;
    font-weight: 800;
}

.candidate-score {
    flex: 0 0 auto;
    font-size: 16px;
    font-weight: 800;
}

.candidate-pv {
    margin-top: 2px;
    min-width: 0;
    color: #7a6a58;
    font-size: 13px;
    line-height: 1.5;
}

/* 符号の途中（▲と筋の間など）で折り返さない */
.candidate-pv > span {
    display: inline-block;
    margin-right: .5em;
    white-space: nowrap;
}

.candidate-placeholder {
    color: #777;
}

.evaluation-graph {
    grid-column: 2;
    grid-row: 2;
    height: 228px;
    min-width: 0;
    box-sizing: border-box;
    margin: 0;
    padding: 12px;
    border: 1px solid #d9cbb2;
    border-radius: 8px;
    background: #fffcf6;
    box-shadow: 0 4px 14px rgba(60, 40, 20, .08);
}

.evaluation-graph figcaption {
    margin-bottom: 6px;
    font-size: 16px;
    font-weight: 700;
}

.evaluation-graph figcaption small {
    color: #8a7560;
    font-weight: 400;
}

.evaluation-graph svg {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid #e4d8c3;
    border-radius: 7px;
    background: #fff;
    cursor: pointer;
}

.graph-grid {
    stroke: #eee3d0;
    stroke-dasharray: 3 3;
}

.graph-body {
    position: relative;
}

.graph-hover {
    stroke: #8a7560;
    stroke-width: 1;
}

.graph-axis {
    stroke: #b9a78c;
}

.graph-tick {
    fill: #8a7560;
    font-size: 9px;
}

/* ツールチップは指した位置の右に出し、右半分では左に出す */
.graph-tooltip {
    position: absolute;
    top: 4px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    margin-left: 8px;
    padding: 4px 8px;
    border: 1px solid #d9cbb2;
    border-radius: 6px;
    background: rgba(255, 255, 255, .95);
    box-shadow: 0 2px 8px rgba(60, 40, 20, .15);
    font-size: 12px;
    line-height: 1.5;
    white-space: nowrap;
    pointer-events: none;
}

.graph-tooltip.flip {
    transform: translateX(-100%);
    margin-left: -8px;
}

.graph-current {
    stroke: #10a04a;
    stroke-width: 1.2;
    stroke-dasharray: 4 3;
}

.graph-zero {
    stroke: #b9a78c;
}

.graph-area-sente {
    fill: rgba(30, 136, 229, .22);
}

.graph-area-gote {
    fill: rgba(229, 57, 53, .22);
}

.graph-line {
    fill: none;
    stroke: #4a3a2a;
    stroke-width: 1.5;
    stroke-linejoin: round;
}

.graph-label {
    fill: #9a8a74;
    font-size: 9px;
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
    font-family: "Shippori Mincho B1", serif;
    font-weight: 800;
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
    font-family: "Shippori Mincho B1", serif;
    font-weight: 800;
}

.board {
    grid-column: 1;
    grid-row: 2;
    width: 540px;
    display: grid;
    grid-template-columns: repeat(9, 60px);
    grid-template-rows: repeat(9, 60px);
    border: 2px solid #3a2a1a;
    box-shadow: 0 0 0 3px #caa064, 0 0 0 4px #8a6234, 0 10px 24px rgba(60, 40, 20, .25);
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
}

.cell {
    position: relative;

    width: 60px;
    height: 60px;
    border: 1px solid #666;
    /* 利きの半透明色を正しく見せるため、マスの地は白に固定する */
    background: #fff;

    display: flex;
    align-items: center;
    justify-content: center;

    touch-action: none;

    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
}

.piece {
    font-family: "Shippori Mincho B1", serif;
    font-size: 28px;
    font-weight: 800;
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

/* 直前の手: 移動先は太い枠、移動元は点線の枠。利きの赤・青と紛れない緑にする */
.cell.last-move-to::after,
.cell.last-move-from::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
}

.cell.last-move-to::after {
    box-shadow: inset 0 0 0 4px #10a04a;
}

.cell.last-move-from::after {
    inset: 3px;
    border: 2px dashed #10a04a;
}


.captured {
    min-width: 0;
    min-height: 80px;
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid #a87b45;
    border-radius: 8px;
    background: linear-gradient(160deg, #f2e0bc, #e8cfa0);
    box-shadow: 0 4px 12px rgba(60, 40, 20, .18);
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

/* 手番の側の駒台。札は駒台の外の空いている側（後手は下、先手は上）に重ねて置き、
   手番が変わっても駒台の大きさや持ち駒の位置が動かないようにする */
.captured {
    position: relative;
}

.captured.to-move {
    border-color: #6b4e2a;
    box-shadow: 0 0 0 3px rgba(240, 180, 60, .55), 0 4px 12px rgba(60, 40, 20, .18);
}

.turn-badge {
    position: absolute;
    left: 50%;
    z-index: 3;
    padding: 3px 12px;
    border-radius: 999px;
    color: #fff;
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    transform: translateX(-50%);
    pointer-events: none;
}

.turn-badge.gote-turn {
    top: calc(100% + 10px);
    background: #c00000;
}

.turn-badge.sente-turn {
    bottom: calc(100% + 10px);
    background: #0040c0;
}

.piece.captured-empty {
    color: #8a7560;
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

/* ヒートマップを表示しないときは、利きの色を見せる必要がないので、木目の将棋盤と駒の形にする */
.board.wood-board {
    background:
        repeating-linear-gradient(97deg, rgba(150, 100, 40, .05) 0 2px, transparent 2px 9px),
        linear-gradient(135deg, #e9c789, #d9a95f);
}

.wood-board .cell {
    border-color: #6b4e2a;
    background: transparent;
}

.wood-board .cell.selected {
    background: rgba(255, 210, 90, .75) !important;
}

.wood-board .cell.star::before {
    content: "";
    position: absolute;
    right: -4px;
    bottom: -4px;
    z-index: 3;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4a3418;
    pointer-events: none;
}

.wood-board .piece {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 52px;
    padding-top: 6px;
    box-sizing: border-box;
    background: linear-gradient(180deg, #fff6e0, #f5dfb0);
    clip-path: polygon(50% 0, 86% 16%, 100% 100%, 0 100%, 14% 16%);
    font-size: 26px;
    line-height: 1;
}

/* 一般的な将棋盤に合わせ、先手・後手は駒の向きで区別し、文字は成っていなければ黒、成っていれば赤にする（駒台も同じ） */
.wood-board .piece.sente,
.wood-board .piece.gote,
.wood-stage .captured .piece:not(.captured-empty) {
    color: #1a1410;
}

.wood-board .piece.promoted.sente,
.wood-board .piece.promoted.gote {
    color: #c41a12;
}
</style>
