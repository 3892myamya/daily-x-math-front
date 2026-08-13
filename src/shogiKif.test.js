import assert from 'node:assert/strict'
import test from 'node:test'
import { exportKifu, parseKif, validateMoves } from './shogiKif.js'

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
