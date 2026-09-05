<script setup>
import { computed, ref } from 'vue'

const COLORS = [
  { id: 0, name: '青', hex: '#2f7de1', corner: [0, 0] },
  { id: 1, name: '黄', hex: '#f1c232', corner: [19, 19] },
  { id: 2, name: '赤', hex: '#e5534b', corner: [19, 0] },
  { id: 3, name: '緑', hex: '#43a866', corner: [0, 19] },
]

const mode = ref('classic')
const gameConfig = computed(() => mode.value === 'duo'
  ? { size: 14, players: 2, starts: [[4, 4], [9, 9]], label: 'Blokus Duo' }
  : { size: 20, players: 4, starts: [[0, 0], [19, 19], [19, 0], [0, 19]], label: 'Blokus' })
const boardSize = computed(() => gameConfig.value.size)
const activeColors = computed(() => COLORS.slice(0, gameConfig.value.players))

// 各ピースは、正方形の相対座標で表す（全21種）。
const PIECES = [
  { id: 'I1', cells: [[0, 0]] },
  { id: 'I2', cells: [[0, 0], [1, 0]] },
  { id: 'I3', cells: [[0, 0], [1, 0], [2, 0]] },
  { id: 'V3', cells: [[0, 0], [0, 1], [1, 1]] },
  { id: 'I4', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: 'L4', cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { id: 'O4', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { id: 'T4', cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { id: 'Z4', cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { id: 'F5', cells: [[1, 0], [0, 1], [1, 1], [1, 2], [2, 2]] },
  { id: 'I5', cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  { id: 'L5', cells: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]] },
  { id: 'N5', cells: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]] },
  { id: 'P5', cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] },
  { id: 'T5', cells: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]] },
  { id: 'U5', cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'V5', cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] },
  { id: 'W5', cells: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]] },
  { id: 'X5', cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: 'Y5', cells: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 1]] },
  { id: 'Z5', cells: [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]] },
]

const emptyBoard = () => Array.from({ length: boardSize.value }, () => Array(boardSize.value).fill(null))
const board = ref(emptyBoard())
const currentPlayer = ref(0)
const selectedPieceId = ref('I1')
const rotation = ref(0)
const flipped = ref(false)
const usedPieces = ref(COLORS.map(() => []))
const passed = ref(COLORS.map(() => false))
const consecutivePasses = ref(0)
const hoverCell = ref(null)
const message = ref('青は盤面の好きな角を埋めるように置いてください。')
const gameOver = ref(false)
const undoHistory = ref([])
const redoHistory = ref([])

function openingMessage() {
  return mode.value === 'duo'
    ? '青は5行5列目か10行10列目を埋めるように置いてください。'
    : '青は盤面の好きな角を埋めるように置いてください。'
}

function startCells() {
  if (mode.value === 'duo') return gameConfig.value.starts
  const last = boardSize.value - 1
  return [[0, 0], [0, last], [last, 0], [last, last]]
}

function isOpenStartCell(row, col) {
  return board.value[row][col] === null
    && startCells().some(([startRow, startCol]) => row === startRow && col === startCol)
}

const currentColor = computed(() => COLORS[currentPlayer.value])
const selectedPiece = computed(() => PIECES.find(piece => piece.id === selectedPieceId.value))
const flipButtonLabel = computed(() => rotation.value % 2 === 0 ? '↔ 左右反転' : '↕ 上下反転')
const remainingPieces = computed(() => PIECES.filter(
  piece => !usedPieces.value[currentPlayer.value].includes(piece.id),
))
const scores = computed(() => activeColors.value.map((color) => ({
  ...color,
  remaining: PIECES
    .filter(piece => !usedPieces.value[color.id].includes(piece.id))
    .reduce((sum, piece) => sum + piece.cells.length, 0),
})))

function normalize(cells) {
  const minX = Math.min(...cells.map(([x]) => x))
  const minY = Math.min(...cells.map(([, y]) => y))
  return cells.map(([x, y]) => [x - minX, y - minY]).sort((a, b) => a[1] - b[1] || a[0] - b[0])
}

function transform(cells, turns = rotation.value, mirror = flipped.value) {
  let result = cells.map(([x, y]) => [mirror ? -x : x, y])
  for (let i = 0; i < turns; i += 1) result = result.map(([x, y]) => [-y, x])
  return normalize(result)
}

const transformedPiece = computed(() => transform(selectedPiece.value.cells))
const previewCells = computed(() => {
  if (!hoverCell.value || gameOver.value) return []
  return transformedPiece.value.map(([x, y]) => [hoverCell.value.col + x, hoverCell.value.row + y])
})
const previewValidity = computed(() => validatePlacement(previewCells.value, currentPlayer.value))

function ownsAnyCell(player) {
  return board.value.some(row => row.includes(player))
}

function validatePlacement(cells, player) {
  if (!cells.length) return { valid: false, reason: '' }
  for (const [col, row] of cells) {
    if (row < 0 || row >= boardSize.value || col < 0 || col >= boardSize.value) {
      return { valid: false, reason: '盤面からはみ出しています。' }
    }
    if (board.value[row][col] !== null) return { valid: false, reason: 'ほかのピースと重なっています。' }
  }

  if (!ownsAnyCell(player)) {
    if (mode.value === 'duo') {
      const coversStart = cells.some(([col, row]) => gameConfig.value.starts.some(
        ([startRow, startCol]) => row === startRow && col === startCol,
      ))
      return coversStart
        ? { valid: true, reason: '' }
        : { valid: false, reason: '最初のピースは5行5列目か10行10列目を埋めます。' }
    }

    const coversCorner = cells.some(([col, row]) => startCells().some(
      ([cornerRow, cornerCol]) => row === cornerRow && col === cornerCol,
    ))
    return coversCorner
      ? { valid: true, reason: '' }
      : { valid: false, reason: '最初のピースは盤面のいずれかの角に置きます。' }
  }

  const orthogonal = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
  let touchesCorner = false
  for (const [col, row] of cells) {
    if (orthogonal.some(([dx, dy]) => board.value[row + dy]?.[col + dx] === player)) {
      return { valid: false, reason: '同じ色の辺同士は接触できません。' }
    }
    if (diagonal.some(([dx, dy]) => board.value[row + dy]?.[col + dx] === player)) touchesCorner = true
  }
  return touchesCorner
    ? { valid: true, reason: '' }
    : { valid: false, reason: '同じ色の角同士が接するように置いてください。' }
}

function cellPreviewState(row, col) {
  const included = previewCells.value.some(([x, y]) => x === col && y === row)
  if (!included) return ''
  return previewValidity.value.valid ? 'preview-valid' : 'preview-invalid'
}

function selectPiece(id) {
  selectedPieceId.value = id
  rotation.value = 0
  flipped.value = false
}

function rotatePiece() {
  rotation.value = (rotation.value + 1) % 4
}

function flipPiece() {
  flipped.value = !flipped.value
}

function captureState() {
  return {
    board: board.value.map(row => [...row]),
    currentPlayer: currentPlayer.value,
    selectedPieceId: selectedPieceId.value,
    rotation: rotation.value,
    flipped: flipped.value,
    usedPieces: usedPieces.value.map(pieces => [...pieces]),
    passed: [...passed.value],
    consecutivePasses: consecutivePasses.value,
    message: message.value,
    gameOver: gameOver.value,
  }
}

function restoreState(state) {
  board.value = state.board.map(row => [...row])
  currentPlayer.value = state.currentPlayer
  selectedPieceId.value = state.selectedPieceId
  rotation.value = state.rotation
  flipped.value = state.flipped
  usedPieces.value = state.usedPieces.map(pieces => [...pieces])
  passed.value = [...state.passed]
  consecutivePasses.value = state.consecutivePasses
  message.value = state.message
  gameOver.value = state.gameOver
  hoverCell.value = null
}

function recordMove() {
  undoHistory.value.push(captureState())
  redoHistory.value = []
}

function undoMove() {
  if (!undoHistory.value.length) return
  redoHistory.value.push(captureState())
  restoreState(undoHistory.value.pop())
}

function redoMove() {
  if (!redoHistory.value.length) return
  undoHistory.value.push(captureState())
  restoreState(redoHistory.value.pop())
}

function advanceTurn() {
  for (let offset = 1; offset <= gameConfig.value.players; offset += 1) {
    const candidate = (currentPlayer.value + offset) % gameConfig.value.players
    if (!passed.value[candidate]) {
      currentPlayer.value = candidate
      const firstAvailable = PIECES.find(piece => !usedPieces.value[candidate].includes(piece.id))
      selectedPieceId.value = firstAvailable?.id ?? 'I1'
      rotation.value = 0
      flipped.value = false
      message.value = `${COLORS[candidate].name}の番です。`
      return
    }
  }
  finishGame()
}

function placePiece() {
  const validation = previewValidity.value
  if (!validation.valid) {
    message.value = validation.reason
    return
  }
  recordMove()
  for (const [col, row] of previewCells.value) board.value[row][col] = currentPlayer.value
  usedPieces.value[currentPlayer.value].push(selectedPieceId.value)
  passed.value[currentPlayer.value] = false
  consecutivePasses.value = 0
  hoverCell.value = null
  advanceTurn()
}

function passTurn() {
  if (gameOver.value) return
  if (!window.confirm(`${currentColor.value.name}はパスします。よろしいですか？`)) return
  recordMove()
  passed.value[currentPlayer.value] = true
  consecutivePasses.value += 1
  if (consecutivePasses.value >= gameConfig.value.players
    || passed.value.slice(0, gameConfig.value.players).every(Boolean)) finishGame()
  else advanceTurn()
}

function finishGame() {
  gameOver.value = true
  const best = Math.min(...scores.value.map(score => score.remaining))
  const winners = scores.value.filter(score => score.remaining === best).map(score => score.name).join('・')
  message.value = `ゲーム終了。${winners}の勝ちです！`
}

function resetGame() {
  if (board.value.some(row => row.some(cell => cell !== null)) && !window.confirm('現在の盤面をリセットしますか？')) return
  board.value = emptyBoard()
  currentPlayer.value = 0
  selectedPieceId.value = 'I1'
  rotation.value = 0
  flipped.value = false
  usedPieces.value = COLORS.map(() => [])
  passed.value = COLORS.map(() => false)
  consecutivePasses.value = 0
  hoverCell.value = null
  gameOver.value = false
  message.value = openingMessage()
  undoHistory.value = []
  redoHistory.value = []
}

function switchMode() {
  if (board.value.some(row => row.some(cell => cell !== null))
    && !window.confirm('モードを切り替えると現在の盤面がリセットされます。よろしいですか？')) return
  mode.value = mode.value === 'classic' ? 'duo' : 'classic'
  board.value = emptyBoard()
  currentPlayer.value = 0
  selectedPieceId.value = 'I1'
  rotation.value = 0
  flipped.value = false
  usedPieces.value = COLORS.map(() => [])
  passed.value = COLORS.map(() => false)
  consecutivePasses.value = 0
  hoverCell.value = null
  gameOver.value = false
  message.value = openingMessage()
  undoHistory.value = []
  redoHistory.value = []
}

function pieceGrid(piece) {
  const cells = transform(piece.cells, 0, false)
  const width = Math.max(...cells.map(([x]) => x)) + 1
  const height = Math.max(...cells.map(([, y]) => y)) + 1
  return { cells, width, height }
}

</script>

<template>
  <main class="game-shell">
    <header class="game-header">
      <div>
        <p class="eyebrow">四隅から広げる陣取りゲーム</p>
        <h1>{{ gameConfig.label }}</h1>
      </div>
      <div class="header-actions">
        <div class="history-buttons" aria-label="操作履歴">
          <button type="button" :disabled="!undoHistory.length" @click="undoMove">← 一手戻る</button>
          <button type="button" :disabled="!redoHistory.length" @click="redoMove">一手進む →</button>
        </div>
        <button class="mode-button" type="button" @click="switchMode">
          {{ mode === 'classic' ? 'Duoで遊ぶ' : '4人版で遊ぶ' }}
        </button>
        <button class="reset-button" type="button" @click="resetGame">最初から</button>
      </div>
    </header>

    <section
      class="score-strip"
      aria-label="各プレイヤーの残りマス数"
      :style="{ gridTemplateColumns: `repeat(${gameConfig.players}, 1fr)` }"
    >
      <div
        v-for="score in scores"
        :key="score.id"
        class="score-card"
        :class="{ active: currentPlayer === score.id && !gameOver, passed: passed[score.id] }"
        :style="{ '--player-color': score.hex }"
      >
        <span class="color-dot"></span>
        <strong>{{ score.name }}</strong>
        <span>残り {{ score.remaining }}</span>
        <small v-if="passed[score.id]">終了</small>
      </div>
    </section>

    <p class="status" role="status" :style="{ '--player-color': currentColor.hex }">{{ message }}</p>

    <div class="play-area">
      <section class="board-wrap">
        <div
          class="board"
          :style="{ gridTemplateColumns: `repeat(${boardSize}, 1fr)` }"
          @mouseleave="hoverCell = null"
        >
          <button
            v-for="(_, index) in boardSize * boardSize"
            :key="index"
            class="board-cell"
            :class="[
              cellPreviewState(Math.floor(index / boardSize), index % boardSize),
              { 'start-target': isOpenStartCell(Math.floor(index / boardSize), index % boardSize) },
            ]"
            :style="board[Math.floor(index / boardSize)][index % boardSize] !== null
              ? { backgroundColor: COLORS[board[Math.floor(index / boardSize)][index % boardSize]].hex }
              : undefined"
            type="button"
            :aria-label="`${Math.floor(index / boardSize) + 1}行${index % boardSize + 1}列`"
            @mouseenter="hoverCell = { row: Math.floor(index / boardSize), col: index % boardSize }"
            @focus="hoverCell = { row: Math.floor(index / boardSize), col: index % boardSize }"
            @click="placePiece"
          ></button>
        </div>
      </section>

      <aside class="control-panel" :style="{ '--player-color': currentColor.hex }">
        <div class="turn-heading">
          <span class="turn-color"></span>
          <div><small>現在の手番</small><strong>{{ currentColor.name }}</strong></div>
        </div>

        <div class="transform-buttons">
          <button type="button" :disabled="gameOver" @click="rotatePiece">↻ 回転</button>
          <button type="button" :disabled="gameOver" @click="flipPiece">{{ flipButtonLabel }}</button>
        </div>

        <div class="selected-preview" aria-label="選択中のピース">
          <div
            class="piece-large"
            :style="{
              gridTemplateColumns: `repeat(${Math.max(...transformedPiece.map(cell => cell[0])) + 1}, 22px)`,
              gridTemplateRows: `repeat(${Math.max(...transformedPiece.map(cell => cell[1])) + 1}, 22px)`,
            }"
          >
            <span
              v-for="([x, y], i) in transformedPiece"
              :key="i"
              :style="{ gridColumn: x + 1, gridRow: y + 1 }"
            ></span>
          </div>
        </div>

        <div class="piece-list">
          <button
            v-for="piece in remainingPieces"
            :key="piece.id"
            class="piece-button"
            :class="{ selected: selectedPieceId === piece.id }"
            type="button"
            :aria-label="`${piece.id}ピースを選択`"
            :disabled="gameOver"
            @click="selectPiece(piece.id)"
          >
            <span
              class="piece-mini"
              :style="{
                gridTemplateColumns: `repeat(${pieceGrid(piece).width}, 9px)`,
                gridTemplateRows: `repeat(${pieceGrid(piece).height}, 9px)`,
              }"
            >
              <i
                v-for="y in pieceGrid(piece).height"
                :key="y"
                class="mini-row"
              ></i>
              <b
                v-for="([x, y], i) in pieceGrid(piece).cells"
                :key="i"
                :style="{ gridColumn: x + 1, gridRow: y + 1 }"
              ></b>
            </span>
          </button>
        </div>

        <button class="pass-button" type="button" :disabled="gameOver" @click="passTurn">置けないのでパス</button>
      </aside>
    </div>

    <details class="rules">
      <summary>遊び方</summary>
      <ol>
        <li>{{ mode === 'duo' ? '青・黄' : '青・黄・赤・緑' }}の順に、選んだピースを盤面へ置きます。</li>
        <li v-if="mode === 'duo'">最初のピースは、各色とも5行5列目か10行10列目の好きな方を埋めます。</li>
        <li v-else>最初のピースは、各色とも盤面の好きな角を埋めます。</li>
        <li>2個目からは自分のピースと角だけを接触させます。辺同士は接触できません。</li>
        <li>置けないプレイヤーはパスし、全員がパスしたら残りマスが最少の人の勝ちです。</li>
      </ol>
    </details>
  </main>
</template>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(body) { margin: 0; min-width: 320px; background: #f4f1e8; color: #23313a; font-family: Inter, "Noto Sans JP", system-ui, sans-serif; }
button { font: inherit; }
.game-shell { width: min(1180px, 100%); margin: 0 auto; padding: 24px clamp(12px, 3vw, 36px) 40px; }
.game-header { display: flex; align-items: end; justify-content: space-between; border-bottom: 2px solid #23313a; padding-bottom: 12px; }
.eyebrow { margin: 0 0 3px; color: #66737a; font-size: 12px; letter-spacing: .16em; }
h1 { margin: 0; font-family: Georgia, serif; font-size: clamp(34px, 5vw, 55px); line-height: .95; letter-spacing: -.04em; }
.header-actions, .history-buttons { display: flex; gap: 8px; }
.reset-button, .mode-button, .history-buttons button, .transform-buttons button, .pass-button { border: 1px solid #a6adae; border-radius: 6px; background: #fff; padding: 9px 14px; cursor: pointer; box-shadow: 0 2px 0 #c8c3b8; }
.history-buttons { padding-right: 8px; border-right: 1px solid #c8c3b8; }
.mode-button { border-color: #526d7a; background: #e9f0f2; color: #29434f; font-weight: 700; }
button:disabled { cursor: not-allowed; opacity: .45; }
.score-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0 10px; }
.score-card { position: relative; display: flex; align-items: baseline; gap: 7px; min-width: 0; border: 1px solid #d1cdc2; border-radius: 7px; background: rgba(255,255,255,.65); padding: 8px 10px; }
.score-card.active { border-color: var(--player-color); box-shadow: inset 0 -3px var(--player-color); }
.score-card.passed { opacity: .55; }
.score-card span:not(.color-dot) { font-size: 12px; white-space: nowrap; }
.score-card small { margin-left: auto; }
.color-dot, .turn-color { display: inline-block; flex: 0 0 auto; width: 12px; height: 12px; border-radius: 2px; background: var(--player-color); }
.status { min-height: 24px; margin: 10px 0; border-left: 4px solid var(--player-color); padding: 2px 10px; font-size: 14px; }
.play-area { display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: clamp(16px, 3vw, 32px); align-items: start; }
.board-wrap { width: 100%; max-width: 720px; }
.board { display: grid; aspect-ratio: 1; border: 4px solid #26343a; background: #8b9699; gap: 1px; box-shadow: 0 10px 25px rgba(45, 50, 48, .16); }
.board-cell { position: relative; min-width: 0; border: 0; background: #eef0e9; padding: 0; cursor: crosshair; }
.board-cell.start-target { background: #d8e2d6; box-shadow: inset 0 0 0 2px #8ba087; }
.board-cell.start-target::after { content: ''; position: absolute; inset: 36%; border-radius: 50%; background: #6f856b; opacity: .7; }
.board-cell:hover { outline: 2px solid rgba(28,35,38,.35); z-index: 1; }
.board-cell.preview-valid { background: var(--preview, #84c594) !important; box-shadow: inset 0 0 0 2px #256c39; }
.board-cell.preview-invalid { background: #ef9b94 !important; box-shadow: inset 0 0 0 2px #ad3930; }
.board-cell.preview-valid::after, .board-cell.preview-invalid::after { display: none; }
.control-panel { border-top: 5px solid var(--player-color); background: #fff; padding: 15px; box-shadow: 0 7px 20px rgba(45,50,48,.12); }
.turn-heading { display: flex; align-items: center; gap: 10px; }
.turn-heading .turn-color { width: 28px; height: 28px; border-radius: 5px; }
.turn-heading div { display: flex; flex-direction: column; }
.turn-heading small { color: #788286; }
.turn-heading strong { font-size: 20px; }
.transform-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 14px 0; }
.selected-preview { display: grid; place-items: center; min-height: 108px; border: 1px dashed #b8b7b0; background: #f7f6f1; }
.piece-large, .piece-mini { display: grid; align-self: center; justify-self: center; }
.piece-large span { width: 22px; height: 22px; border: 1px solid rgba(0,0,0,.18); background: var(--player-color); }
.piece-list { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin: 12px 0; }
.piece-button { display: grid; place-items: center; min-height: 47px; border: 1px solid #d2d2ce; border-radius: 4px; background: #fafaf8; padding: 3px; cursor: pointer; }
.piece-button.selected { border-color: var(--player-color); outline: 2px solid var(--player-color); background: #f1f3ed; }
.piece-mini b { width: 9px; height: 9px; border: .5px solid rgba(0,0,0,.18); background: var(--player-color); }
.mini-row { display: none; }
.pass-button { width: 100%; margin-top: 2px; }
.rules { margin-top: 22px; border-top: 1px solid #b9b8b1; padding-top: 12px; color: #505d63; font-size: 14px; }
.rules summary { cursor: pointer; font-weight: 700; }
.rules ol { padding-left: 22px; line-height: 1.8; }
@media (max-width: 800px) {
  .play-area { grid-template-columns: 1fr; }
  .board-wrap { margin: auto; }
  .control-panel { width: 100%; }
  .game-header { align-items: flex-start; }
  .header-actions { flex-wrap: wrap; justify-content: flex-end; }
  .score-card { flex-wrap: wrap; gap: 3px 6px; }
  .score-card small { display: none; }
}
@media (max-width: 480px) {
  .game-shell { padding-inline: 8px; }
  .game-header { align-items: flex-start; }
  .header-actions { flex-direction: column; }
  .history-buttons { padding: 0 0 7px; border-right: 0; border-bottom: 1px solid #c8c3b8; }
  .header-actions button { padding: 7px 9px; font-size: 12px; }
  .score-strip { gap: 3px; }
  .score-card { padding: 6px 5px; }
  .score-card span:not(.color-dot) { font-size: 10px; }
  .piece-list { grid-template-columns: repeat(7, 1fr); }
  .piece-button { min-height: 43px; }
}
</style>
