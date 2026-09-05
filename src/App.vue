<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import {
  MAX_ELAPSED_MS, STORAGE_PREFIX, calendarDays, getDateFromSearch, isDateInRange,
  monthKey, progressStatus, readProgress, resolvedGameResult, shiftMonth,
  shouldPersistProgress, shouldStartWithEmptyBoard,
  needsLegacyClearCheck, repairLegacyClear,
  elapsedMsForSave, formatElapsedTime, savedClearElapsedMs, savedElapsedMs, savedTimerStarted,
} from './dailyXMathArchive.js'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

const todayKey = ref(null)
const availableFrom = ref('2025-12-31')
const today = ref(null)
const calendarOpen = ref(false)
const calendarMonth = ref(null)
const loadError = ref('')
const isHydrating = ref(false)
const isApplyingAnswer = ref(false)
const isAnswerRevealed = ref(false)
const isStoredAnswerRevealed = ref(false)
const showClearOverlay = ref(false)
const isTemporaryRetry = ref(false)
const archiveRevision = ref(0)
const elapsedMs = ref(0)
const timerStarted = ref(false)
const firstClearElapsedMs = ref(null)
let activeRequest = 0
let persistTimer = null
let legacyRepairIdleId = null
let timerRunStartedAt = null
let timerIntervalId = null

const question = ref(null)

const isLoading = ref(true)

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

function currentElapsedMs(now = Date.now()) {
  const runningElapsedMs = timerRunStartedAt === null ? 0 : Math.max(0, now - timerRunStartedAt)
  return Math.min(elapsedMs.value + runningElapsedMs, MAX_ELAPSED_MS)
}

const elapsedTimeText = computed(() => formatElapsedTime(elapsedMs.value))
const displayedElapsedTimeText = computed(() => (
  gameResult.value === 'clear'
  && isClearedCondition.value
  && firstClearElapsedMs.value === null
    ? '--:--'
    : elapsedTimeText.value
))

function stopTimerInterval() {
  if (timerIntervalId === null) return
  clearInterval(timerIntervalId)
  timerIntervalId = null
}

function pauseTimer() {
  if (timerRunStartedAt !== null) {
    elapsedMs.value = Math.min(
      elapsedMs.value + Math.max(0, Date.now() - timerRunStartedAt),
      MAX_ELAPSED_MS,
    )
    timerRunStartedAt = null
  }
  stopTimerInterval()
}

function resetTimer() {
  pauseTimer()
  elapsedMs.value = 0
  timerStarted.value = false
}

function canRunTimer() {
  return timerStarted.value
    && elapsedMs.value < MAX_ELAPSED_MS
    && !isClearedCondition.value
    && !isAnswerRevealed.value
}

function resumeTimer() {
  if (timerRunStartedAt !== null || document.visibilityState === 'hidden' || !canRunTimer()) return
  timerRunStartedAt = Date.now()
  timerIntervalId = window.setInterval(() => {
    const now = Date.now()
    elapsedMs.value = Math.min(
      elapsedMs.value + Math.max(0, now - timerRunStartedAt),
      MAX_ELAPSED_MS,
    )
    timerRunStartedAt = now
    if (elapsedMs.value >= MAX_ELAPSED_MS) {
      timerRunStartedAt = null
      stopTimerInterval()
    }
  }, 1000)
}

function inputNumber(n) {
  if (isClearedCondition.value) return
  const { row, col } = selectedCell.value
  if (numbers.value[row][col] === n) return
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
    clearSelectedCell()
  }

  if (e.key === 'ArrowRight') selectCell(row, Math.min(col + 1, 2))
  if (e.key === 'ArrowLeft') selectCell(row, Math.max(col - 1, 0))
  if (e.key === 'ArrowDown') selectCell(Math.min(row + 1, 2), col)
  if (e.key === 'ArrowUp') selectCell(Math.max(row - 1, 0), col)
}

function clearSelectedCell() {
  if (isClearedCondition.value) return
  const { row, col } = selectedCell.value
  if (numbers.value[row][col] === null) return
  numbers.value[row][col] = null
}

function resetAll() {
  if (isClearedCondition.value && !isArchive.value && gameResult.value === 'giveup') return
  const ok = window.confirm('盤面をリセットします。よろしいですか？')
  if (!ok) return

  const startsNewClearAttempt = isClearedCondition.value && !isAnswerRevealed.value

  if (isClearedCondition.value && !isArchive.value) {
    // 当日のクリア盤面は永続化したまま、以降の再挑戦だけを一時状態にする。
    if (gameResult.value === null) recordGameResult('clear')
    saveCurrentProgress()
    isTemporaryRetry.value = true
  }
  if (startsNewClearAttempt) resetTimer()
  numbers.value = emptyNumbers()
  isAnswerRevealed.value = false
  isStoredAnswerRevealed.value = false
  selectedCell.value = { row: 0, col: 0 }
  timerStarted.value = true
  resumeTimer()
}

async function giveUp() {
  if (isClearedCondition.value || isTemporaryRetry.value) return
  const isStoredAnswer = archiveHasResult.value
  const message = archiveHasResult.value
    ? '答えを表示します。よろしいですか？'
    : isArchive.value
      ? 'ギブアップして答えを表示します。よろしいですか？'
    : 'ギブアップして答えを表示します。よろしいですか？\n※ギブアップすると再挑戦できません。'
  const ok = window.confirm(message)
  if (!ok) return
  try {
    const res = await fetch(`${API_BASE_URL}/api/answer/${question.value.seed}`)
    if (!res.ok) throw new Error(`Answer request failed: ${res.status}`)
    const data = await res.json()
    isApplyingAnswer.value = true
    pauseTimer()
    recordGameResult('giveup')
    isAnswerRevealed.value = true
    isStoredAnswerRevealed.value = isStoredAnswer
    numbers.value = data.matrix.map(row =>
      row.map(cell => cell[0] ?? null)
    )
  } catch (e) {
    alert('答えの取得に失敗しました')
    console.error(e)
  } finally {
    isApplyingAnswer.value = false
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

function calculateRow(row) {
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

function calculateCol(col) {
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

const rowResults = computed(() => [0, 1, 2].map(calculateRow))
const colResults = computed(() => [0, 1, 2].map(calculateCol))

function calcRow(row) {
  return rowResults.value[row]
}

function calcCol(col) {
  return colResults.value[col]
}

function isRowCorrect(row) {
  const result = rowResults.value[row]
  if (result === null) return false
  return result === question.value.yokoKotae[row]
}

function isColCorrect(col) {
  const result = colResults.value[col]
  if (result === null) return false
  return result === question.value.tateKotae[col]
}

function shareToX() {
  if (!question.value) return

  const text = [
    `Daily X-Math ${question.value.seed} をクリアしました！🎉`,
    '#DailyXMath',
  ].join('\n')

  const url = new URL(location.href)
  if (question.value.seed === today.value) url.searchParams.delete('date')
  else url.searchParams.set('date', question.value.seed)
  const shareUrl =
    'https://twitter.com/intent/tweet?' +
    new URLSearchParams({
      text,
      url,
    }).toString()

  window.open(shareUrl, '_blank')
}

const gameResult = ref(null)
const isArchive = computed(() => Boolean(question.value && today.value && question.value.seed < today.value))
const archiveHasResult = computed(() => isArchive.value && gameResult.value !== null)
const isClearedCondition = computed(() => {
  const rowsOk = [0, 1, 2].every(r => isRowCorrect(r))
  const colsOk = [0, 1, 2].every(c => isColCorrect(c))
  const noDuplicate = Object.values(duplicateMap.value).every(v => v <= 1)

  return rowsOk && colsOk && noDuplicate
})
const canReset = computed(() => !isClearedCondition.value || isArchive.value || gameResult.value === 'clear')

watch(
  [numbers, gameResult],
  () => {
    if (!todayKey.value || !shouldPersistProgress(isHydrating.value, isTemporaryRetry.value)) return
    scheduleProgressSave()
  },
  { deep: true }
)

function recordGameResult(result) {
  gameResult.value = resolvedGameResult(gameResult.value, result, isArchive.value)
}

watch(isClearedCondition, (val) => {
  if (val && !isHydrating.value && !isApplyingAnswer.value) {
    pauseTimer()
    const previousResult = gameResult.value
    recordGameResult('clear')
    if (previousResult !== 'clear' && gameResult.value === 'clear') {
      firstClearElapsedMs.value = elapsedMs.value
    }
    showClearOverlay.value = true
  }
}, { flush: 'sync' })

function dismissClearOverlay() {
  showClearOverlay.value = false
}

const emptyNumbers = () => [
  [null, null, null],
  [null, null, null],
  [null, null, null],
]

function writeCurrentProgress() {
  if (!todayKey.value || !shouldPersistProgress(isHydrating.value, isTemporaryRetry.value)) return
  localStorage.setItem(todayKey.value, JSON.stringify({
    numbers: numbers.value,
    gameResult: gameResult.value,
    elapsedMs: elapsedMsForSave(currentElapsedMs(), gameResult.value, firstClearElapsedMs.value),
    timerStarted: timerStarted.value,
    clearElapsedMs: gameResult.value === 'clear' ? firstClearElapsedMs.value : null,
  }))
  archiveRevision.value++
}

function cancelScheduledProgressSave() {
  if (persistTimer === null) return
  clearTimeout(persistTimer)
  persistTimer = null
}

function scheduleProgressSave() {
  cancelScheduledProgressSave()
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeCurrentProgress()
  }, 180)
}

function saveCurrentProgress() {
  cancelScheduledProgressSave()
  writeCurrentProgress()
}

function persistLegacyRepair(date, data, questionData) {
  const repaired = repairLegacyClear(data, questionData)
  if (repaired === data) return data
  localStorage.setItem(`${STORAGE_PREFIX}${date}`, JSON.stringify(repaired))
  archiveRevision.value++
  return repaired
}

function legacyClearCandidateDates() {
  if (!today.value) return []
  const dates = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(STORAGE_PREFIX)) continue
    const date = key.slice(STORAGE_PREFIX.length)
    if (!isDateInRange(date, availableFrom.value, today.value)) continue
    if (needsLegacyClearCheck(readProgress(localStorage, date))) dates.push(date)
  }
  return dates
}

async function repairLegacyClearProgress() {
  const dates = legacyClearCandidateDates()
  let nextIndex = 0

  async function worker() {
    while (nextIndex < dates.length) {
      const date = dates[nextIndex++]
      try {
        const res = await fetch(`${API_BASE_URL}/api/question/${date}`)
        if (!res.ok) continue
        const questionData = await res.json()
        // 通信中に更新された可能性があるため、保存データは取得後に読み直す。
        const current = readProgress(localStorage, date)
        if (needsLegacyClearCheck(current)) persistLegacyRepair(date, current, questionData)
      } catch (e) {
        console.warn(`Failed to repair legacy clear progress: ${date}`, e)
      }
    }
  }

  await worker()
}

function scheduleLegacyClearRepair() {
  const run = () => {
    legacyRepairIdleId = null
    void repairLegacyClearProgress()
  }
  if ('requestIdleCallback' in window) {
    legacyRepairIdleId = window.requestIdleCallback(run, { timeout: 1500 })
  } else {
    legacyRepairIdleId = window.setTimeout(run, 500)
  }
}

function cancelLegacyClearRepair() {
  if (legacyRepairIdleId === null) return
  if ('cancelIdleCallback' in window) window.cancelIdleCallback(legacyRepairIdleId)
  else clearTimeout(legacyRepairIdleId)
  legacyRepairIdleId = null
}

const displayedCalendarDays = computed(() => {
  archiveRevision.value
  if (!calendarMonth.value) return []
  return calendarDays(calendarMonth.value).map(date => {
    if (!date) return null
    const progress = readProgress(localStorage, date)
    const status = progressStatus(progress)
    const clearElapsedMs = status === 'clear' ? savedClearElapsedMs(progress) : null
    return {
      date,
      status,
      clearTime: clearElapsedMs === null ? null : formatElapsedTime(clearElapsedMs),
    }
  })
})
const canGoPreviousMonth = computed(() => calendarMonth.value > monthKey(availableFrom.value))
const canGoNextMonth = computed(() => today.value && calendarMonth.value < monthKey(today.value))

function updateUrl(date, mode = 'push') {
  const url = new URL(location.href)
  if (date === today.value) url.searchParams.delete('date')
  else url.searchParams.set('date', date)
  history[`${mode}State`]({}, '', url)
}

async function loadQuestion(date = null, { historyMode = 'push' } = {}) {
  const requestId = ++activeRequest
  let loadedSuccessfully = false
  pauseTimer()
  saveCurrentProgress()
  loadError.value = ''
  isLoading.value = true

  try {
    const path = date ? `/api/question/${date}` : '/api/question'
    const res = await fetch(`${API_BASE_URL}${path}`)
    if (!res.ok) throw new Error(`Question request failed: ${res.status}`)
    const loadedQuestion = await res.json()
    if (requestId !== activeRequest) return

    let loadedProgress = readProgress(localStorage, loadedQuestion.seed)
    if (needsLegacyClearCheck(loadedProgress)) {
      loadedProgress = persistLegacyRepair(loadedQuestion.seed, loadedProgress, loadedQuestion)
    }
    const loadedGameResult = loadedProgress?.gameResult || null
    const isClearedArchive = loadedQuestion.seed < loadedQuestion.today
      && loadedGameResult === 'clear'
    const isSettledArchive = shouldStartWithEmptyBoard(
      loadedQuestion.seed,
      loadedQuestion.today,
      loadedGameResult,
    )
    let settledArchiveNumbers = null
    if (isSettledArchive) {
      const answerRes = await fetch(`${API_BASE_URL}/api/answer/${loadedQuestion.seed}`)
      if (!answerRes.ok) throw new Error(`Answer request failed: ${answerRes.status}`)
      const answerData = await answerRes.json()
      if (requestId !== activeRequest) return
      settledArchiveNumbers = answerData.matrix.map(row => row.map(cell => cell[0] ?? null))
    }
    isHydrating.value = true
    question.value = loadedQuestion
    availableFrom.value = loadedQuestion.availableFrom
    today.value = loadedQuestion.today
    todayKey.value = `${STORAGE_PREFIX}${loadedQuestion.seed}`
    gameResult.value = loadedGameResult
    numbers.value = isSettledArchive
      ? settledArchiveNumbers
      : Array.isArray(loadedProgress?.numbers) ? loadedProgress.numbers : emptyNumbers()
    firstClearElapsedMs.value = gameResult.value === 'clear'
      ? savedClearElapsedMs(loadedProgress)
      : null
    elapsedMs.value = isClearedArchive
      ? firstClearElapsedMs.value ?? 0
      : isSettledArchive ? 0 : savedElapsedMs(loadedProgress)
    timerStarted.value = isSettledArchive
      || gameResult.value === null
      || savedTimerStarted(loadedProgress)
    isAnswerRevealed.value = gameResult.value === 'giveup'
    isStoredAnswerRevealed.value = false
    showClearOverlay.value = !isSettledArchive && gameResult.value === 'clear'
    isTemporaryRetry.value = false
    selectedCell.value = { row: 0, col: 0 }
    calendarMonth.value = monthKey(loadedQuestion.seed)
    if (historyMode) {
      updateUrl(loadedQuestion.seed, historyMode)
    }
    loadedSuccessfully = true
  } catch (e) {
    if (requestId !== activeRequest) return
    loadError.value = '問題の読み込みに失敗しました。時間をおいて再度お試しください。'
    console.error('Failed to fetch question', e)
  } finally {
    if (requestId === activeRequest) {
      isHydrating.value = false
      isLoading.value = false
      resumeTimer()
      if (loadedSuccessfully && gameResult.value === null) writeCurrentProgress()
    }
  }
}

async function selectArchiveDate(date) {
  if (!isDateInRange(date, availableFrom.value, today.value)) return
  calendarOpen.value = false
  if (date !== question.value?.seed) await loadQuestion(date)
}

function toggleCalendar() {
  calendarMonth.value = monthKey(question.value.seed)
  calendarOpen.value = !calendarOpen.value
}

function handleDocumentClick(e) {
  if (calendarOpen.value && !e.target.closest('.date-picker')) calendarOpen.value = false
}

function handleEscape(e) {
  if (e.key === 'Escape') calendarOpen.value = false
}

function handlePopState() {
  const requested = getDateFromSearch(location.search)
  loadQuestion(requested, { historyMode: 'replace' })
}

function handlePageHide() {
  pauseTimer()
  saveCurrentProgress()
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    pauseTimer()
    saveCurrentProgress()
  } else {
    resumeTimer()
  }
}

onMounted(async () => {
  const requested = getDateFromSearch(location.search)
  await loadQuestion(requested, { historyMode: 'replace' })
  scheduleLegacyClearRepair()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('keydown', handleEscape)
  window.addEventListener('popstate', handlePopState)
  window.addEventListener('pagehide', handlePageHide)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  document.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  pauseTimer()
  saveCurrentProgress()
  cancelLegacyClearRepair()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('keydown', handleEscape)
  window.removeEventListener('popstate', handlePopState)
  window.removeEventListener('pagehide', handlePageHide)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  document.removeEventListener('click', handleDocumentClick)
})

</script>

<template>
  <div class="title-row">
    <h1>Daily X-Math</h1>
    <div v-if="question" class="date-picker">
      <button class="seed-badge" type="button" :aria-expanded="calendarOpen" aria-haspopup="dialog"
        @click.stop="toggleCalendar">
        #{{ question.seed }}
      </button>
      <div v-if="calendarOpen" class="calendar-popover" role="dialog" aria-label="バックナンバーを選択"
        @click.stop>
        <div class="calendar-header">
          <button type="button" aria-label="前の月" :disabled="!canGoPreviousMonth"
            @click="calendarMonth = shiftMonth(calendarMonth, -1)">‹</button>
          <strong>{{ calendarMonth }}</strong>
          <button type="button" aria-label="次の月" :disabled="!canGoNextMonth"
            @click="calendarMonth = shiftMonth(calendarMonth, 1)">›</button>
        </div>
        <div class="calendar-weekdays" aria-hidden="true">
          <span v-for="day in ['日', '月', '火', '水', '木', '金', '土']" :key="day">{{ day }}</span>
        </div>
        <div class="calendar-grid">
          <span v-for="(entry, index) in displayedCalendarDays" :key="entry?.date || `blank-${index}`">
            <button v-if="entry" type="button" class="calendar-day" :class="[
              `status-${entry.status}`,
              { selected: entry.date === question.seed, today: entry.date === today }
            ]" :disabled="!isDateInRange(entry.date, availableFrom, today)"
              :aria-label="`${entry.date} ${entry.status}${entry.clearTime ? ` クリアタイム ${entry.clearTime}` : ''}`"
              @click="selectArchiveDate(entry.date)">
              {{ Number(entry.date.slice(-2)) }}
              <small v-if="entry.clearTime" aria-hidden="true">{{ entry.clearTime }}</small>
              <i v-else aria-hidden="true"></i>
            </button>
          </span>
        </div>
        <div class="calendar-legend">
          <span class="legend-progress">途中</span><span class="legend-clear">クリア</span><span class="legend-giveup">ギブアップ</span>
        </div>
      </div>
    </div>
  </div>
  <div v-if="loadError" class="load-error" role="alert">{{ loadError }}</div>
  <div v-if="isLoading" class="loading">
    Now Loading...
    <img src="/icon_loader_a_ww_02_s1.gif" alt="Loading" class="loading-icon" />
  </div>
  <div v-else-if="question" class="board" @click="showClearOverlay && dismissClearOverlay()">
    <div v-if="showClearOverlay" class="clear-overlay">
      <div class="clear-message">
        <div>🎉 CLEAR! 🎉</div>
        <div class="clear-elapsed-time">CLEAR TIME: {{ displayedElapsedTimeText }}</div>
        <button v-if="!isArchive" class="share-x-btn" @click.stop="shareToX">
          𝕏 で共有
        </button>
      </div>
    </div>

    <!-- 横1段目 -->
    <div class="row">
      <div class="cell number" :class="{
        selected: isSelected(0, 0), duplicate: isDuplicate(0, 0), cleared: isClearedCondition,
        giveup: isAnswerRevealed && !isStoredAnswerRevealed,
        storedAnswer: isStoredAnswerRevealed
      }" @click="selectCell(0, 0)">{{ numbers[0][0] }}
      </div>
      <img :src="opMap[question.yokoFugo[0][0]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(0, 1), duplicate: isDuplicate(0, 1), cleared: isClearedCondition,
        giveup: isAnswerRevealed && !isStoredAnswerRevealed,
        storedAnswer: isStoredAnswerRevealed
      }" @click="selectCell(0, 1)">{{ numbers[0][1] }}
      </div>
      <img :src="opMap[question.yokoFugo[0][1]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(0, 2), duplicate: isDuplicate(0, 2), cleared: isClearedCondition,
        giveup: isAnswerRevealed && !isStoredAnswerRevealed,
        storedAnswer: isStoredAnswerRevealed
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
        giveup: isAnswerRevealed && !isStoredAnswerRevealed,
        storedAnswer: isStoredAnswerRevealed
      }" @click="selectCell(1, 0)">{{ numbers[1][0] }}
      </div>
      <img :src="opMap[question.yokoFugo[1][0]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(1, 1), duplicate: isDuplicate(1, 1), cleared: isClearedCondition,
        giveup: isAnswerRevealed && !isStoredAnswerRevealed,
        storedAnswer: isStoredAnswerRevealed
      }" @click="selectCell(1, 1)">{{ numbers[1][1] }}
      </div>
      <img :src="opMap[question.yokoFugo[1][1]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(1, 2), duplicate: isDuplicate(1, 2), cleared: isClearedCondition,
        giveup: isAnswerRevealed && !isStoredAnswerRevealed,
        storedAnswer: isStoredAnswerRevealed
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
        giveup: isAnswerRevealed && !isStoredAnswerRevealed,
        storedAnswer: isStoredAnswerRevealed
      }" @click="selectCell(2, 0)">{{ numbers[2][0] }}
      </div>
      <img :src="opMap[question.yokoFugo[2][0]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(2, 1), duplicate: isDuplicate(2, 1), cleared: isClearedCondition,
        giveup: isAnswerRevealed && !isStoredAnswerRevealed,
        storedAnswer: isStoredAnswerRevealed
      }" @click="selectCell(2, 1)">{{ numbers[2][1] }}
      </div>
      <img :src="opMap[question.yokoFugo[2][1]]" class="cell op" />
      <div class="cell number" :class="{
        selected: isSelected(2, 2), duplicate: isDuplicate(2, 2), cleared: isClearedCondition,
        giveup: isAnswerRevealed && !isStoredAnswerRevealed,
        storedAnswer: isStoredAnswerRevealed
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
  <div v-if="question" class="number-panel" :class="{ cleared: isClearedCondition && !canReset }">
    <div class="elapsed-time" aria-live="off">TIME: {{ displayedElapsedTimeText }}</div>
    <!-- 1行目：1〜5 -->
    <div v-for="n in [1, 2, 3, 4, 5]" :key="n" class="cell panel-number"
      :class="{ used: isUsedNumber(n) || isClearedCondition }" @click="inputNumber(n)">
      {{ n }}
    </div>
    <div></div>
    <div class="wide-cell panel-number clear-btn" :class="{ used: !canReset }" @click="resetAll">RESET</div>
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
    <div class="wide-cell panel-number clear-btn" :class="{
      used: isClearedCondition || isTemporaryRetry,
      disabled: isClearedCondition || isTemporaryRetry
    }" :aria-disabled="isClearedCondition || isTemporaryRetry" @click="giveUp">
      {{ archiveHasResult ? 'ANSWER' : 'GIVE UP' }}
    </div>
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
  font-weight: normal;
  line-height: 1.5;
  cursor: pointer;
}

.seed-badge:hover {
  border-color: #90a4ae;
}

.date-picker {
  position: relative;
}

.calendar-popover {
  position: absolute;
  z-index: 100;
  top: calc(100% + 10px);
  right: 0;
  width: min(286px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid #607d8b;
  border-radius: 12px;
  background: #172b3d;
  color: #f0f0f0;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
  font-size: 14px;
  transform: translateY(5px);
}

.calendar-header {
  display: grid;
  grid-template-columns: 36px 1fr 36px;
  align-items: center;
  margin-bottom: 8px;
}

.calendar-header button {
  padding: 2px;
  height: 32px;
  background: transparent;
  color: inherit;
  font-size: 24px;
}

.calendar-header button:disabled,
.calendar-day:disabled {
  opacity: 0.25;
  cursor: default;
}

.calendar-weekdays,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}

.calendar-weekdays span {
  padding-bottom: 3px;
  color: #b0bec5;
  font-size: 11px;
}

.calendar-grid > span {
  min-width: 0;
  aspect-ratio: 1;
}

.calendar-day {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 0 0 4px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font-size: 12px;
}

.calendar-day:hover:not(:disabled) {
  border-color: #90caf9;
}

.calendar-day.selected {
  border-color: #fff;
  background: #29465f;
}

.calendar-day.today::after {
  content: '';
  position: absolute;
  inset: 1px;
  border: 1px dashed #ffd54f;
  border-radius: 3px;
  pointer-events: none;
}

.calendar-day i {
  position: absolute;
  left: 50%;
  bottom: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  transform: translateX(-50%);
}

.calendar-day small {
  position: absolute;
  right: 0;
  bottom: 3px;
  left: 0;
  color: #66bb6a;
  font-family: monospace;
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  font-weight: bold;
  line-height: 1;
  white-space: nowrap;
}

.status-progress i, .legend-progress::before { background: #ffd54f; }
.status-clear i, .legend-clear::before { background: #66bb6a; }
.status-giveup i, .legend-giveup::before { background: #ef5350; }

.calendar-legend {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 10px;
  color: #cfd8dc;
  font-size: 10px;
}

.calendar-legend span::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 4px;
  border-radius: 50%;
}

.load-error {
  max-width: 390px;
  margin-bottom: 12px;
  padding: 8px 10px;
  border: 1px solid #ef9a9a;
  border-radius: 6px;
  background: #4a2020;
  color: #ffcdd2;
  font-size: 12px;
  text-align: left;
}

.elapsed-time {
  position: absolute;
  top: -92px;
  right: 0;
  box-sizing: border-box;
  width: 100px;
  color: #b0bec5;
  font-family: monospace;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: center;
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
  touch-action: manipulation;
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
  background: #c6d4c1;
  border-color: #698c63;
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

.number.storedAnswer {
  color: #1565c0;
  border-color: #90caf9;
  background: #e3f2fd;
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
  position: relative;
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
  touch-action: manipulation;
}

.panel-number.used {
  background: #aaa;
  color: #666;
}

.panel-number.disabled:hover {
  border-color: #999;
  background: #aaa;
  color: #666;
  cursor: default;
}

.panel-number:hover {
  background: #ccf;
}

.clear-btn {
  background: #fee; /* 好きな色に変更 */
  color: #223; /* 文字色 */
  border: 1px solid #aaa;
}

.clear-btn:hover {
  background: #dcf; /* ホバー時の色 */
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

.clear-elapsed-time {
  margin-top: 8px;
  font-family: monospace;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
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

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #eee;
  text-align: center;
  font-size: 1.2em;
  margin-top: 50px;
}
.loading-icon {
  width: 30px;
  height: 30px;
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
