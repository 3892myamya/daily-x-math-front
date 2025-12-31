<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

const todayKey = ref(null)

const question = ref(null)

const opMap = {
  1: '/add.png',
  2: '/sub.png',
  3: '/mul.png',
  4: '/div.png',
  5: '/equ.png',
}

const selectedCell = ref({ row: 0, col: 0 })

const numbers = ref([
  [null, null, null],
  [null, null, null],
  [null, null, null],
])

function selectCell(row, col) {
  selectedCell.value = { row, col }
}

function isSelected(row, col) {
  return (
    selectedCell.value.row === row &&
    selectedCell.value.col === col
  )
}

function inputNumber(n) {
  if (isClearedCondition.value) return
  const { row, col } = selectedCell.value
  numbers.value[row][col] = n
}

function handleKeydown(e) {
  if (isClearedCondition.value) return
  // 数字キー 1〜9
  if (e.key >= '1' && e.key <= '9') {
    inputNumber(Number(e.key))
    return
  }
  const { row, col } = selectedCell.value

  // delete or Backspace
  if (e.key === 'Backspace' || e.key === 'Delete') {
    numbers.value[row][col] = null
  }

  if (e.key === 'ArrowRight') selectCell(row, Math.min(col + 1, 2))
  if (e.key === 'ArrowLeft') selectCell(row, Math.max(col - 1, 0))
  if (e.key === 'ArrowDown') selectCell(Math.min(row + 1, 2), col)
  if (e.key === 'ArrowUp') selectCell(Math.max(row - 1, 0), col)
}

function clearSelectedCell() {
  if (isClearedCondition.value) return
  const { row, col } = selectedCell.value
  numbers.value[row][col] = null
}

function resetAll() {
  if (isClearedCondition.value) return
  const ok = window.confirm('盤面をリセットします。よろしいですか？')
  if (!ok) return
  numbers.value = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ]
  selectedCell.value = { row: 0, col: 0 }
}

async function giveUp() {
  if (isClearedCondition.value) return
  const ok = window.confirm('ギブアップして答えを表示します。よろしいですか？')
  if (!ok) return
  try {
    const res = await fetch(`${API_BASE_URL}/api/answer`)
    const data = await res.json()
    numbers.value = data.matrix.map(row =>
      row.map(cell => cell[0] ?? null)
    )
    gameResult.value = 'giveup'
  } catch (e) {
    alert('答えの取得に失敗しました')
    console.error(e)
  }
}

const duplicateMap = computed(() => {
  const map = {}

  numbers.value.flat().forEach(n => {
    if (n !== null) {
      map[n] = (map[n] || 0) + 1
    }
  })

  return map
})

function isDuplicate(row, col) {
  const n = numbers.value[row][col]
  return n !== null && duplicateMap.value[n] >= 2
}

function isUsedNumber(n) {
  return duplicateMap.value[n] >= 1
}

function calcRow(row) {
  const nums = numbers.value[row]
  if (nums.some(n => n === null)) return null

  let result = nums[0]

  for (let i = 0; i < 2; i++) {
    const op = question.value.yokoFugo[row][i]
    const next = nums[i + 1]

    switch (op) {
      case 1: // +
        result += next
        break
      case 2: // -
        result -= next
        break
      case 3: // *
        result *= next
        break
      case 4: // /
        result /= next
        break
    }
  }
  result = Math.floor(result * 100) / 100
  return result
}

function calcCol(col) {
  const nums = [
    numbers.value[0][col],
    numbers.value[1][col],
    numbers.value[2][col],
  ]

  if (nums.some(n => n === null)) return null

  let result = nums[0]

  for (let i = 0; i < 2; i++) {
    const op = question.value.tateFugo[i][col]
    const next = nums[i + 1]

    switch (op) {
      case 1: // +
        result += next
        break
      case 2: // -
        result -= next
        break
      case 3: // *
        result *= next
        break
      case 4: // /
        result /= next
        break
    }
  }
  result = Math.floor(result * 100) / 100
  return result
}

function isRowCorrect(row) {
  const result = calcRow(row)
  if (result === null) return false
  return result === question.value.yokoKotae[row]
}

function isColCorrect(col) {
  const result = calcCol(col)
  if (result === null) return false
  return result === question.value.tateKotae[col]
}

function shareToX() {
  if (!question.value) return

  const text = [
    `Daily X-Math ${question.value.seed} をクリアしました！🎉`,
    '#DailyXMath',
  ].join('\n')

  const url = location.href
  const shareUrl =
    'https://twitter.com/intent/tweet?' +
    new URLSearchParams({
      text,
      url,
    }).toString()

  window.open(shareUrl, '_blank')
}

const gameResult = ref(null)
const isClearedCondition = computed(() => {
  const rowsOk = [0, 1, 2].every(r => isRowCorrect(r))
  const colsOk = [0, 1, 2].every(c => isColCorrect(c))
  const noDuplicate = Object.values(duplicateMap.value).every(v => v <= 1)

  return rowsOk && colsOk && noDuplicate
})

watch(
  [numbers, gameResult],
  () => {
    if (!todayKey.value) return
    const data = {
      numbers: numbers.value,
      gameResult: gameResult.value,
    }
    localStorage.setItem(todayKey.value, JSON.stringify(data))
  },
  { deep: true }
)

watch(isClearedCondition, (val) => {
  if (val && gameResult.value === null) {
    gameResult.value = 'clear'
  }
})

onMounted(async () => {
  const res = await fetch(`${API_BASE_URL}/api/question`)
  question.value = await res.json()
  todayKey.value = `daily-cross-math-${question.value.seed}`
  // 今日の進捗を復元
  const saved = localStorage.getItem(todayKey.value)
  if (saved) {
    try {
      const data = JSON.parse(saved)
      if (data.numbers) {
        numbers.value = data.numbers
      }
      if (data.gameResult) {
        gameResult.value = data.gameResult
      }
    } catch (e) {
      console.warn('Failed to load saved data', e)
    }
  }
  selectedCell.value = { row: 0, col: 0 }
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

</script>

<template>
  <div class="title-row">
    <h1>Daily X-Math</h1>
    <span v-if="question" class="seed-badge">
      #{{ question.seed }}
    </span>
  </div>
  <div v-if="question" class="board" @click="gameResult !== 'giveup' && (gameResult = null)">
    <div v-if="gameResult === 'clear'" class="clear-overlay">
      <div class="clear-message">
        🎉 CLEAR! 🎉
        <button class="share-x-btn" @click.stop="shareToX">
          𝕏 で共有
        </button>
      </div>
    </div>

    <!-- 横1段目 -->
    <div class="row">
      <div class="cell number" :class="{
        selected: isSelected(0, 0), duplicate: isDuplicate(0, 0), cleared: isClearedCondition,
        giveup: gameResult === 'giveup'
      }" @click="selectCell(0, 0)">{{ numbers[0][0] }}
      </div>
      <img :src="opMap[question.yokoFugo[0][0]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(0, 1), duplicate: isDuplicate(0, 1), cleared: isClearedCondition,
        giveup: gameResult === 'giveup'
      }" @click="selectCell(0, 1)">{{ numbers[0][1] }}
      </div>
      <img :src="opMap[question.yokoFugo[0][1]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(0, 2), duplicate: isDuplicate(0, 2), cleared: isClearedCondition,
        giveup: gameResult === 'giveup'
      }" @click="selectCell(0, 2)">{{ numbers[0][2] }}
      </div>
      <img :src="opMap[5]" class="cell op" />
      <div class="cell answer" :class="{ correctAnswer: isRowCorrect(0) }">{{ question.yokoKotae[0] }}</div>
      <div class="cell spacer" :class="{ correctAnswer: isRowCorrect(0) }">{{ calcRow(0) }}</div>
    </div>

    <!-- 縦オペレータ1段目 -->
    <div class="row">
      <img :src="opMap[question.tateFugo[0][0]]" class="cell op" />
      <div class="cell spacer"></div>
      <img :src="opMap[question.tateFugo[0][1]]" class="cell op" />
      <div class="cell spacer"></div>
      <img :src="opMap[question.tateFugo[0][2]]" class="cell op" />
    </div>

    <!-- 横2段目 -->
    <div class="row">
      <div class="cell number" :class="{
        selected: isSelected(1, 0), duplicate: isDuplicate(1, 0), cleared: isClearedCondition,
        giveup: gameResult === 'giveup'
      }" @click="selectCell(1, 0)">{{ numbers[1][0] }}
      </div>
      <img :src="opMap[question.yokoFugo[1][0]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(1, 1), duplicate: isDuplicate(1, 1), cleared: isClearedCondition,
        giveup: gameResult === 'giveup'
      }" @click="selectCell(1, 1)">{{ numbers[1][1] }}
      </div>
      <img :src="opMap[question.yokoFugo[1][1]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(1, 2), duplicate: isDuplicate(1, 2), cleared: isClearedCondition,
        giveup: gameResult === 'giveup'
      }" @click="selectCell(1, 2)">{{ numbers[1][2] }}
      </div>
      <img :src="opMap[5]" class="cell op" />
      <div class="cell answer" :class="{ correctAnswer: isRowCorrect(1) }">{{ question.yokoKotae[1] }}</div>
      <div class="cell spacer" :class="{ correctAnswer: isRowCorrect(1) }">{{ calcRow(1) }}</div>
    </div>

    <!-- 縦オペレータ2段目 -->
    <div class="row">
      <img :src="opMap[question.tateFugo[1][0]]" class="cell op" />
      <div class="cell spacer"></div>
      <img :src="opMap[question.tateFugo[1][1]]" class="cell op" />
      <div class="cell spacer"></div>
      <img :src="opMap[question.tateFugo[1][2]]" class="cell op" />
    </div>

    <!-- 横3段目 -->
    <div class="row">
      <div class="cell number" :class="{
        selected: isSelected(2, 0), duplicate: isDuplicate(2, 0), cleared: isClearedCondition,
        giveup: gameResult === 'giveup'
      }" @click="selectCell(2, 0)">{{ numbers[2][0] }}
      </div>
      <img :src="opMap[question.yokoFugo[2][0]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(2, 1), duplicate: isDuplicate(2, 1), cleared: isClearedCondition,
        giveup: gameResult === 'giveup'
      }" @click="selectCell(2, 1)">{{ numbers[2][1] }}
      </div>
      <img :src="opMap[question.yokoFugo[2][1]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(2, 2), duplicate: isDuplicate(2, 2), cleared: isClearedCondition,
        giveup: gameResult === 'giveup'
      }" @click="selectCell(2, 2)">{{ numbers[2][2] }}
      </div>
      <img :src="opMap[5]" class="cell op" />
      <div class="cell answer" :class="{ correctAnswer: isRowCorrect(2) }">{{ question.yokoKotae[2] }}</div>
      <div class="cell spacer" :class="{ correctAnswer: isRowCorrect(2) }">{{ calcRow(2) }}</div>
    </div>

    <!-- 縦イコール -->
    <div class="row">
      <img :src="opMap[5]" class="cell op" />
      <div class="cell spacer"></div>
      <img :src="opMap[5]" class="cell op" />
      <div class="cell spacer"></div>
      <img :src="opMap[5]" class="cell op" />
    </div>

    <!-- 最下段 -->
    <div class="row">
      <div class="cell answer" :class="{ correctAnswer: isColCorrect(0) }">{{ question.tateKotae[0] }}</div>
      <div class="cell spacer"></div>
      <div class="cell answer" :class="{ correctAnswer: isColCorrect(1) }">{{ question.tateKotae[1] }}</div>
      <div class="cell spacer"></div>
      <div class="cell answer" :class="{ correctAnswer: isColCorrect(2) }">{{ question.tateKotae[2] }}</div>
    </div>

    <div class="row">
      <div class="cell spacer" :class="{ correctAnswer: isColCorrect(0) }">{{ calcCol(0) }}</div>
      <div class="cell spacer"></div>
      <div class="cell spacer" :class="{ correctAnswer: isColCorrect(1) }">{{ calcCol(1) }}</div>
      <div class="cell spacer"></div>
      <div class="cell spacer" :class="{ correctAnswer: isColCorrect(2) }">{{ calcCol(2) }}</div>
    </div>
  </div>

  <!-- 数字入力パネル -->
  <div class="number-panel" :class="{ cleared: isClearedCondition }">
    <!-- 1行目：1〜5 -->
    <div v-for="n in [1, 2, 3, 4, 5]" :key="n" class="cell panel-number"
      :class="{ used: isUsedNumber(n) || isClearedCondition }" @click="inputNumber(n)">
      {{ n }}
    </div>
    <div></div>
    <div class="wide-cell panel-number" :class="{ used: isClearedCondition }" @click="resetAll">RESET</div>
    <!-- 2行目：6〜9 -->
    <div v-for="n in [6, 7, 8, 9]" :key="n" class="cell panel-number"
      :class="{ used: isUsedNumber(n) || isClearedCondition }" @click="inputNumber(n)">
      {{ n }}
    </div>
    <!-- C ボタン -->
    <div class="cell panel-number clear-btn" @click="clearSelectedCell" :class="{ used: isClearedCondition }">
      C
    </div>
    <div></div>
    <div class="wide-cell panel-number" :class="{ used: isClearedCondition }" @click="giveUp">GIVE UP</div>
  </div>

  <div class="footer-note" style="margin-top: 56px; font-size: 0.7em; text-align: center;">
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

<style scoped>
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.title-row h1 {
  font-size: 2.4em;
  line-height: 1.1;
  margin: 0;
}

.seed-badge {
  font-family: monospace;
  font-size: 0.8em;
  padding: 4px 10px;
  border-radius: 99px;
  background: #eef3f8;
  color: #455a64;
  border: 1px solid #cfd8dc;
  user-select: none;
  transform: translateY(5px);
}

.board {
  font-family: monospace;
  font-size: 20px;
}

.row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.cell {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wide-cell {
  width: 100px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.op {
  object-fit: contain;
  border: 1px solid transparent;
}

.number {
  border: 1px solid #ccc;
  background: #f9f9f9;
  font-weight: bold;
  color: #102030;
  cursor: pointer;
}

.number.duplicate {
  background: #ff8ae5;
  border-color: #e000b0;
}

.number.selected {
  background: #b8e6b8;
  border-color: #4caf50;
}

.number.duplicate.selected {
  background: #dcb8cf;
  border-color: #9a5fa3;
}

.number.cleared {
  background: #e3f2fd;
  border-color: #90caf9;
}

.number.giveup {
  color: #d32f2f;
  border-color: #ef9a9a;
  background: #fff5f5;
}

.spacer {
  border: 1px solid transparent;
}

.answer {
  border: 1px solid #999;
  font-weight: bold;
  background: #b9b9b9;
  color: #102030;
}

.answer.correctAnswer {
  color: #1565c0;
}

.spacer.correctAnswer {
  color: #b3e5fc;
}

.number-panel {
  display: grid;
  font-family: monospace;
  font-size: 20px;
  grid-template-columns: repeat(5, 40px) 10px 100px;
  gap: 8px;
  margin-top: 20px;
}

.panel-number:nth-child(n + 6) {
  grid-column: span 1;
}

.panel-number {
  background: #eee;
  border: 1px solid #999;
  cursor: pointer;
  font-weight: bold;
  color: #102030;
}

.panel-number.used {
  background: #aaa;
  color: #666;
}

.panel-number:hover {
  background: #ccf;
}

/* クリア後は hover を完全無効化 */
.number-panel.cleared .panel-number:hover {
  background: #aaa;
  color: #666;
  cursor: default;
}

.clear-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.4s ease-out;
}

.clear-message {
  background: #ffffff;
  padding: 30px 50px;
  border-radius: 16px;
  font-size: 40px;
  font-weight: bold;
  color: #1565c0;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  animation: pop 0.6s ease-out;
}

.share-x-btn {
  margin-top: 20px;
  padding: 10px 20px;
  font-size: 16px;
  font-weight: bold;
  border-radius: 999px;
  border: none;
  background: #000;
  color: #fff;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.share-x-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
}

.share-x-btn:active {
  transform: translateY(0);
  box-shadow: none;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes pop {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }

  60% {
    transform: scale(1.1);
    opacity: 1;
  }

  100% {
    transform: scale(1);
  }
}
</style>