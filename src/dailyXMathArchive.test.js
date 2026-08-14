import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calendarDays, getDateFromSearch, isDateInRange, isDateString,
  progressStatus, readProgress, resolvedGameResult, shiftMonth, shouldPersistProgress,
  shouldStartWithEmptyBoard,
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

test('ignores broken stored JSON', () => {
  const storage = { getItem: () => '{broken' }
  assert.equal(readProgress(storage, '2026-01-01'), null)
})

test('builds and moves calendar months across year boundaries', () => {
  assert.equal(shiftMonth('2025-12', 1), '2026-01')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(calendarDays('2026-02').filter(Boolean).length, 28)
})
