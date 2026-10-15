import assert from 'node:assert/strict'
import test from 'node:test'
import { firstPhaseEntry, gamePhase, positionProgress, readProgressWeights } from './shogiProgress.js'
import { createStandardPosition } from './shogiKif.js'

test('進行度を8段階に分け、0〜1を序盤、2〜4を中盤、5〜7を終盤とする', () => {
    assert.equal(gamePhase(0.03), 'opening')
    assert.equal(gamePhase(0.24), 'opening')
    assert.equal(gamePhase(0.25), 'middle')
    assert.equal(gamePhase(0.62), 'middle')
    assert.equal(gamePhase(0.63), 'end')
    assert.equal(gamePhase(null), null)
})

test('段階の一文は初めてその段階に入ったときだけ（境目で行ったり来たりしても繰り返さない）', () => {
    const phases = ['opening', 'opening', 'middle', 'opening', 'middle', 'end', 'middle', 'end']
    assert.equal(firstPhaseEntry(phases, 1), null)
    assert.equal(firstPhaseEntry(phases, 2), 'middle')
    assert.equal(firstPhaseEntry(phases, 4), null)
    assert.equal(firstPhaseEntry(phases, 5), 'end')
    assert.equal(firstPhaseEntry(phases, 7), null)
})

test('進行度は、玉の位置と各駒の重みの和をシグモイド関数で0〜1にしたもの', () => {
    // 重みがすべて0なら和は0、進行度は0.5
    const zero = new Float64Array(81 * 1548)
    const buffer = new ArrayBuffer(81 * 1548 * 8)
    const weights = readProgressWeights(buffer)
    assert.equal(weights.length, zero.length)
    const { board, capturedPieces } = createStandardPosition()
    assert.equal(positionProgress(weights, board, capturedPieces), 0.5)
    // 大きさの違うファイルは読まない
    assert.throws(() => readProgressWeights(new ArrayBuffer(8)))
})

test('同梱の progress.bin では、開始局面は序盤（進行度0.1未満）', async () => {
    const { readFile } = await import('node:fs/promises')
    const file = await readFile(new URL('./shogi-engine/tsuyo11mini-progress.bin', import.meta.url))
    const weights = readProgressWeights(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
    const { board, capturedPieces } = createStandardPosition()
    const progress = positionProgress(weights, board, capturedPieces)
    assert.ok(progress > 0 && progress < 0.1, String(progress))
    assert.equal(gamePhase(progress), 'opening')
})
