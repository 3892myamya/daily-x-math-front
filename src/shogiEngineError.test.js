import assert from 'node:assert/strict'
import test from 'node:test'
import { isEngineWorkerError, isFatalEngineEvent, isUnwindError } from './shogiEngineError.js'

const workerUrl = '/assets/yaneuraou.material.worker-abc123.js'

test('unwindだけをEmscriptenの致命的な未処理例外として判定する', () => {
    assert.equal(isUnwindError('unwind'), true)
    assert.equal(isFatalEngineEvent({ error: 'unwind' }, workerUrl), true)
    assert.equal(isFatalEngineEvent({ reason: 'unwind' }, workerUrl), true)
    assert.equal(isUnwindError(new Error('unwind')), false)
})

test('評価エンジンのWorker由来エラーを判定する', () => {
    assert.equal(isEngineWorkerError({ filename: workerUrl }, workerUrl), true)
    assert.equal(isEngineWorkerError({
        filename: `https://example.test${workerUrl}?worker=1`,
    }, workerUrl), true)
})

test('無関係なアプリケーション例外は無視する', () => {
    assert.equal(isFatalEngineEvent({
        error: new Error('application error'),
        filename: '/assets/app.js',
    }, workerUrl), false)
})
