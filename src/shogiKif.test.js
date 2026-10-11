import assert from 'node:assert/strict'
import test from 'node:test'
import { exportKifu, formatMove, moveQualifier, parseKif, validateMoves } from './shogiKif.js'

test('平手KIFの通常手・同・成・打を解析して再出力する', () => {
    const source = `手合割：平手
手数----指手---------
1 ７六歩(77)
2 ３四歩(33)
3 ２二角成(88)
4 同　銀(31)
5 ８八角打
`
    const moves = parseKif(source)
    assert.equal(moves.length, 5)
    assert.equal(moves[2].promotes, true)
    assert.equal(moves[4].drop, true)
    assert.equal(validateMoves(moves).valid, true)
    const output = exportKifu(moves)
    assert.match(output, /# KIF version=2\.0 encoding=UTF-8/)
    assert.match(output, /5 ８八角打/)
})

test('駒落ちKIFを拒否する', () => {
    assert.throws(() => parseKif('手合割：角落ち\n1 ７六歩(77)\n'), /平手以外/)
})

test('二手指しと二歩を拒否する', () => {
    assert.throws(
        () => parseKif('手合割：平手\n1 ▲７六歩(77)\n2 ▲２六歩(27)\n'),
        /手番が一致/,
    )
})

test('略字の「竜」で書かれた成り駒の手も読み込める', () => {
    const moves = parseKif(`手合割：平手
手数----指手---------
1 ２六歩(27)
2 ８四歩(83)
3 ２五歩(26)
4 ８五歩(84)
5 ２四歩(25)
6 同　歩(23)
7 同　飛(28)
8 ８六歩(85)
9 同　歩(87)
10 同　飛(82)
11 ２三飛成(24)
12 ８七飛成(86)
13 ３三竜(23)
14 ７八竜(87)
`)
    assert.equal(moves[12].pieceWasPromoted, true)
    assert.equal(moves[13].pieceWasPromoted, true)
    assert.equal(validateMoves(moves).valid, true)
})

const piece = (type, owner, promoted = false) => ({ type, owner, promoted })
const emptyBoard = () => Array.from({ length: 9 }, () => Array(9).fill(null))
const sq = (file, rank) => ({ row: rank - 1, col: 9 - file })
const qualifier = (pieces, from, to, owner = 'sente') => {
    const board = emptyBoard()
    for (const [type, file, rank, promoted] of pieces) board[rank - 1][9 - file] = piece(type, owner, promoted)
    const p = board[from[1] - 1][9 - from[0]]
    return moveQualifier(board, { owner, type: p.type, from: sq(...from), to: sq(...to), drop: false })
}

test('同種の駒が1枚しか動けなければ何も付けない', () => {
    assert.equal(qualifier([['KI', 6, 9]], [6, 9], [5, 8]), '')
})

test('動作（上・寄・引）で区別できればそれを付ける（連盟の例: ８２金上・８２金寄、８８銀上・８８銀引）', () => {
    const golds = [['KI', 9, 3], ['KI', 7, 2]]
    assert.equal(qualifier(golds, [9, 3], [8, 2]), '上')
    assert.equal(qualifier(golds, [7, 2], [8, 2]), '寄')
    const silvers = [['GI', 8, 9], ['GI', 7, 7]]
    assert.equal(qualifier(silvers, [8, 9], [8, 8]), '上')
    assert.equal(qualifier(silvers, [7, 7], [8, 8]), '引')
})

test('真っすぐ上がる金・銀は「直」、もう一方は「左」「右」（連盟の例: ７８金直）', () => {
    const golds = [['KI', 8, 9], ['KI', 7, 9]]
    assert.equal(qualifier(golds, [7, 9], [7, 8]), '直')
    assert.equal(qualifier(golds, [8, 9], [7, 8]), '左')
})

test('動作が同じなら、指す側から見た「右」「左」で区別する（後手は盤の向きが逆）', () => {
    const silvers = [['GI', 6, 7], ['GI', 4, 7]]
    assert.equal(qualifier(silvers, [6, 7], [5, 6]), '左')
    assert.equal(qualifier(silvers, [4, 7], [5, 6]), '右')
    const goteSilvers = [['GI', 6, 2], ['GI', 4, 2]]
    assert.equal(qualifier(goteSilvers, [6, 2], [5, 3], 'gote'), '右')
    assert.equal(qualifier(goteSilvers, [4, 2], [5, 3], 'gote'), '左')
})

test('竜・馬は動作を優先し、「直」は使わない', () => {
    const dragons = [['HI', 8, 1, true], ['HI', 8, 5, true]]
    assert.equal(qualifier(dragons, [8, 1], [8, 2]), '引')
    assert.equal(qualifier(dragons, [8, 5], [8, 2]), '上')
})

test('表示では「同歩」とスペースを入れず、KIFの出力では「同　歩(23)」とする', () => {
    const move = { owner: 'gote', type: 'FU', from: sq(2, 3), to: sq(2, 4), drop: false, promotes: false, pieceWasPromoted: false }
    assert.equal(formatMove(move, sq(2, 4)), '同歩')
    assert.equal(formatMove(move, sq(2, 4), true), '同　歩(23)')
})
