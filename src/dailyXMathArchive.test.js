import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calendarDays, getDateFromSearch, isDateInRange, isDateString,
  progressStatus, readProgress, resolvedGameResult, shiftMonth, shouldPersistProgress,
  shouldStartWithEmptyBoard, isSolvedBoard, needsLegacyClearCheck, repairLegacyClear,
  elapsedMsForSave, formatElapsedTime, savedClearElapsedMs, savedElapsedMs, savedTimerStarted,
} from './dailyXMathArchive.js'

test('validates dates and ranges', () => {
  assert.equal(isDateString('2026-02-28'), true)
  assert.equal(isDateString('2026-02-30'), false)
  assert.equal(isDateInRange('2025-12-31', '2025-12-31', '2026-01-02'), true)
  assert.equal(isDateInRange('2026-01-03', '2025-12-31', '2026-01-02'), false)
})

test('reads only valid date query values', () => {
  assert.equal(getDateFromSearch('?date=2026-01-02'), '2026-01-02')
  assert.equal(getDateFromSearch('?date=bad'), null)
})

test('derives all progress states', () => {
  const empty = [[null, null, null], [null, null, null], [null, null, null]]
  assert.equal(progressStatus(null), 'unstarted')
  assert.equal(progressStatus({ numbers: empty, gameResult: null }), 'unstarted')
  assert.equal(progressStatus({ numbers: empty, gameResult: null, timerStarted: true }), 'progress')
  assert.equal(progressStatus({ numbers: [[1]], gameResult: null }), 'progress')
  assert.equal(progressStatus({ numbers: empty, gameResult: 'clear' }), 'clear')
  assert.equal(progressStatus({ numbers: empty, gameResult: 'giveup' }), 'giveup')
})

test('keeps the first archive result but updates today result', () => {
  assert.equal(resolvedGameResult(null, 'giveup', true), 'giveup')
  assert.equal(resolvedGameResult('giveup', 'clear', true), 'giveup')
  assert.equal(resolvedGameResult('clear', 'giveup', true), 'clear')
  assert.equal(resolvedGameResult('clear', 'giveup', false), 'giveup')
})

test('does not persist hydration or a temporary today retry', () => {
  assert.equal(shouldPersistProgress(false, false), true)
  assert.equal(shouldPersistProgress(true, false), false)
  assert.equal(shouldPersistProgress(false, true), false)
})

test('starts settled archives with an empty board only', () => {
  assert.equal(shouldStartWithEmptyBoard('2026-01-01', '2026-01-02', 'clear'), true)
  assert.equal(shouldStartWithEmptyBoard('2026-01-01', '2026-01-02', 'giveup'), true)
  assert.equal(shouldStartWithEmptyBoard('2026-01-01', '2026-01-02', null), false)
  assert.equal(shouldStartWithEmptyBoard('2026-01-02', '2026-01-02', 'clear'), false)
})

test('reads and formats backward-compatible elapsed time', () => {
  assert.equal(savedElapsedMs(null), 0)
  assert.equal(savedElapsedMs({ elapsedMs: -1 }), 0)
  assert.equal(savedElapsedMs({ elapsedMs: '83000' }), 0)
  assert.equal(savedElapsedMs({ elapsedMs: 83000 }), 83000)
  assert.equal(savedElapsedMs({ elapsedMs: 9_999_999 }), 5_999_000)
  assert.equal(savedTimerStarted({}), false)
  assert.equal(savedTimerStarted({ timerStarted: true }), true)
  assert.equal(savedClearElapsedMs({ gameResult: 'clear' }), null)
  assert.equal(savedClearElapsedMs({ gameResult: 'clear', timerStarted: true, elapsedMs: 83_000 }), 83_000)
  assert.equal(savedClearElapsedMs({ gameResult: 'clear', clearElapsedMs: 0 }), 0)
  assert.equal(savedClearElapsedMs({ gameResult: 'clear', clearElapsedMs: 9_999_999 }), 5_999_000)
  assert.equal(formatElapsedTime(0), '00:00')
  assert.equal(formatElapsedTime(Number.NaN), '00:00')
  assert.equal(formatElapsedTime(83_999), '01:23')
  assert.equal(formatElapsedTime(3_661_000), '61:01')
  assert.equal(formatElapsedTime(9_999_999), '99:59')
})

test('keeps the first clear time when later attempts are saved', () => {
  assert.equal(elapsedMsForSave(90_000, null, null), 90_000)
  assert.equal(elapsedMsForSave(90_000, 'giveup', null), 90_000)
  assert.equal(elapsedMsForSave(120_000, 'clear', 75_000), 75_000)
})

const solvedNumbers = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
const additionQuestion = {
  yokoFugo: [[1, 1], [1, 1], [1, 1]],
  tateFugo: [[1, 1, 1], [1, 1, 1]],
  yokoKotae: [6, 15, 24],
  tateKotae: [12, 15, 18],
}

test('repairs only a verified legacy clear', () => {
  const legacy = { numbers: solvedNumbers, gameResult: null }
  assert.equal(needsLegacyClearCheck(legacy), true)
  assert.equal(isSolvedBoard(solvedNumbers, additionQuestion), true)
  assert.deepEqual(repairLegacyClear(legacy, additionQuestion), {
    numbers: solvedNumbers,
    gameResult: 'clear',
  })

  const wrong = { numbers: [[1, 2, 4], [3, 5, 6], [7, 8, 9]], gameResult: null }
  assert.equal(isSolvedBoard(wrong.numbers, additionQuestion), false)
  assert.equal(repairLegacyClear(wrong, additionQuestion), wrong)
})

test('does not repair incomplete, duplicate, or already settled progress', () => {
  const incomplete = { numbers: [[1, 2, null], [4, 5, 6], [7, 8, 9]], gameResult: null }
  const duplicate = { numbers: [[1, 2, 3], [4, 5, 6], [7, 8, 8]], gameResult: null }
  const settled = { numbers: solvedNumbers, gameResult: 'giveup' }
  assert.equal(needsLegacyClearCheck(null), false)
  assert.equal(needsLegacyClearCheck(undefined), false)
  assert.equal(needsLegacyClearCheck(incomplete), false)
  assert.equal(isSolvedBoard(duplicate.numbers, additionQuestion), false)
  assert.equal(repairLegacyClear(settled, additionQuestion), settled)
})

test('ignores broken stored JSON', () => {
  const storage = { getItem: () => '{broken' }
  assert.equal(readProgress(storage, '2026-01-01'), null)
})

test('builds and moves calendar months across year boundaries', () => {
  assert.equal(shiftMonth('2025-12', 1), '2026-01')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(calendarDays('2026-02').filter(Boolean).length, 28)
})
