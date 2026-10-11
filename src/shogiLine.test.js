import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUsiPv } from './shogiEvaluation.js'
import { lineInsight, readLine } from './shogiLine.js'
import { createStandardPosition } from './shogiKif.js'

const piece = (type, owner, promoted = false) => ({ type, owner, promoted })
const emptyBoard = () => Array.from({ length: 9 }, () => Array(9).fill(null))
const insightOf = (position, usi, options = {}) => lineInsight(readLine(position, usi, formatUsiPv(usi, position.board, position.sideToMove, options.previousTo)), options)

// 平手から先手の２筋の歩を２五まで伸ばした局面
const pawnOn25 = () => {
    const { board, capturedPieces } = createStandardPosition()
    board[4][7] = board[6][7]
    board[6][7] = null
    return { board, hands: capturedPieces, sideToMove: 'sente' }
}

test('▲２四歩△同歩▲同飛の読み筋は「飛車先の歩交換」と読み、同の符号で書く', () => {
    const insight = insightOf(pawnOn25(), ['2e2d', '2c2d', '2h2d'])
    assert.equal(insight.kind, 'pawn-exchange')
    assert.equal(insight.text, '飛車先の歩交換を狙う手で、△同歩なら▲同飛と取り返して歩を1枚手持ちにできます。')
    assert.equal(insight.planText, `▲２四歩は${insight.text}`)
})

test('ぶつけた歩を取らせて取り返さずに別の手を指す読み筋は「突き捨て」', () => {
    assert.equal(insightOf(pawnOn25(), ['2e2d', '2c2d', '7g7f']).kind, 'thrust')
})

test('相手が歩で取ったばかりの歩の頭に歩を打つ手は「継ぎ歩」', () => {
    const position = pawnOn25()
    position.board[3][7] = piece('FU', 'gote')
    position.board[2][7] = null
    position.board[4][7] = null
    position.hands.sente = { FU: 1 }
    const lastMove = { move: { type: 'FU', owner: 'gote', to: { row: 3, col: 7 }, drop: false }, captured: true }
    assert.equal(insightOf(position, ['P*2e'], { lastMove }).kind, 'tsugifu')
})

test('大駒を取り合う読み筋は「角交換」と書く', () => {
    const { board, capturedPieces } = createStandardPosition()
    board[5][2] = board[6][2]
    board[6][2] = null
    board[3][6] = board[2][6]
    board[2][6] = null
    const insight = insightOf({ board, hands: capturedPieces, sideToMove: 'sente' }, ['8h2b+', '3a2b'])
    assert.equal(insight.kind, 'major-trade')
    assert.equal(insight.text, '△同銀なら角交換になります。')
})

test('3手以上の取り合いで駒得になる読み筋は、手順と駒得を書く', () => {
    const board = emptyBoard()
    board[8][8] = piece('OU', 'sente')
    board[0][0] = piece('OU', 'gote')
    board[8][4] = piece('HI', 'sente')
    board[3][4] = piece('FU', 'sente')
    board[2][4] = piece('GI', 'gote')
    board[1][5] = piece('KI', 'gote')
    const insight = insightOf({ board, hands: { sente: {}, gote: {} }, sideToMove: 'sente' }, ['5d5c+', '4b5c', '5i5c+'])
    assert.equal(insight.kind, 'gain')
    assert.equal(insight.text, '△同金なら▲同飛成と取り返して、先手が金・銀と歩の交換で駒得になります。')
})

test('駒の取り合いが同じマスで続かない読み筋は、まとめて駒得とは言わない', () => {
    // ▲２四歩△同歩▲７六歩 は取り合いが1手で終わるので、駒得の文にはならない（突き捨てとして読む）
    assert.notEqual(insightOf(pawnOn25(), ['2e2d', '2c2d', '7g7f'])?.kind, 'gain')
})
