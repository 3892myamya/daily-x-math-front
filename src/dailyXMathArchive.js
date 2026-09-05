export const STORAGE_PREFIX = 'daily-cross-math-'

export function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isDateInRange(date, min, max) {
  return isDateString(date) && date >= min && date <= max
}

export function getDateFromSearch(search) {
  const value = new URLSearchParams(search).get('date')
  return isDateString(value) ? value : null
}

export function progressStatus(data) {
  if (!data || typeof data !== 'object') return 'unstarted'
  if (data.gameResult === 'clear') return 'clear'
  if (data.gameResult === 'giveup') return 'giveup'
  return Array.isArray(data.numbers) && data.numbers.flat().some(Number.isInteger)
    ? 'progress'
    : 'unstarted'
}

export function resolvedGameResult(current, next, isArchive) {
  return isArchive && current !== null ? current : next
}

export function shouldPersistProgress(isHydrating, isTemporaryRetry) {
  return !isHydrating && !isTemporaryRetry
}

export function shouldStartWithEmptyBoard(seed, today, gameResult) {
  return seed < today && gameResult !== null
}

export function savedElapsedMs(data) {
  const value = data?.elapsedMs
  return Number.isFinite(value) && value >= 0 ? value : 0
}

export function savedTimerStarted(data) {
  return data?.timerStarted === true
}

export function savedClearElapsedMs(data) {
  if (Number.isFinite(data?.clearElapsedMs) && data.clearElapsedMs >= 0) {
    return data.clearElapsedMs
  }
  const elapsedMs = savedElapsedMs(data)
  return data?.gameResult === 'clear' && data?.timerStarted === true && elapsedMs > 0
    ? elapsedMs
    : null
}

export function elapsedMsForSave(currentElapsedMs, gameResult, firstClearElapsedMs) {
  return gameResult === 'clear' && Number.isFinite(firstClearElapsedMs)
    ? firstClearElapsedMs
    : currentElapsedMs
}

export function formatElapsedTime(elapsedMs) {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const totalSeconds = Math.floor(safeElapsedMs / 1000)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${String(totalMinutes).padStart(2, '0')}:${seconds}`
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}:${seconds}`
}

export function needsLegacyClearCheck(data) {
  if (!data || typeof data !== 'object') return false
  return data.gameResult == null
    && Array.isArray(data.numbers)
    && data.numbers.length === 3
    && data.numbers.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isInteger))
}

function calculateLine(values, operators) {
  let result = values[0]
  for (let i = 0; i < operators.length; i++) {
    const next = values[i + 1]
    switch (operators[i]) {
      case 1: result += next; break
      case 2: result -= next; break
      case 3: result *= next; break
      case 4: result /= next; break
      default: return null
    }
  }
  return Math.floor(result * 100) / 100
}

export function isSolvedBoard(numbers, question) {
  if (!needsLegacyClearCheck({ numbers, gameResult: null }) || !question) return false

  const values = numbers.flat()
  if (values.some(value => value < 1 || value > 9) || new Set(values).size !== 9) return false

  const rowsOk = numbers.every((row, index) =>
    calculateLine(row, question.yokoFugo?.[index] || []) === question.yokoKotae?.[index]
  )
  const colsOk = [0, 1, 2].every(col =>
    calculateLine(numbers.map(row => row[col]), [
      question.tateFugo?.[0]?.[col],
      question.tateFugo?.[1]?.[col],
    ]) === question.tateKotae?.[col]
  )
  return rowsOk && colsOk
}

export function repairLegacyClear(data, question) {
  if (!needsLegacyClearCheck(data) || !isSolvedBoard(data.numbers, question)) return data
  return { ...data, gameResult: 'clear' }
}

export function readProgress(storage, date) {
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${date}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function monthKey(date) {
  return date.slice(0, 7)
}

export function shiftMonth(month, amount) {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, value - 1 + amount, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function calendarDays(month) {
  const [year, value] = month.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(year, value - 1, 1)).getUTCDay()
  const count = new Date(Date.UTC(year, value, 0)).getUTCDate()
  return [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ]
}
