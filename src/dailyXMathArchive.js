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
