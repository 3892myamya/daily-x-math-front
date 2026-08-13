import test from 'node:test'
import assert from 'node:assert/strict'
import { formatUsiPv, positionToSfen } from './shogiEvaluation.js'

const piece = (type, owner) => ({ type, owner, promoted: false })

function standardBoard() {
    return [
        ['KY', 'KE', 'GI', 'KI', 'OU', 'KI', 'GI', 'KE', 'KY'].map((type) => piece(type, 'gote')),
        [null, piece('HI', 'gote'), null, null, null, null, null, piece('KA', 'gote'), null],
        Array.from({ length: 9 }, () => piece('FU', 'gote')),
        ...Array.from({ length: 3 }, () => Array(9).fill(null)),
        Array.from({ length: 9 }, () => piece('FU', 'sente')),
        [null, piece('KA', 'sente'), null, null, null, null, null, piece('HI', 'sente'), null],
        ['KY', 'KE', 'GI', 'KI', 'OU', 'KI', 'GI', 'KE', 'KY'].map((type) => piece(type, 'sente')),
    ]
}

test('初期局面をSFENへ変換する', () => {
    assert.equal(
        positionToSfen(standardBoard(), { sente: {}, gote: {} }, 'sente'),
        'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1',
    )
})

test('通常手を先後の日本語表記へ変換する', () => {
    assert.deepEqual(
        formatUsiPv(['2g2f', '3c3d'], standardBoard(), 'sente'),
        ['▲２六歩', '△３四歩'],
    )
})

test('後手番から始まる読み筋を変換する', () => {
    assert.deepEqual(
        formatUsiPv(['3c3d'], standardBoard(), 'gote'),
        ['△３四歩'],
    )
})

test('駒打ちを日本語表記へ変換する', () => {
    assert.deepEqual(
        formatUsiPv(['P*5e'], standardBoard(), 'sente'),
        ['▲５五歩打'],
    )
})

test('駒取りを伴う成りを日本語表記へ変換する', () => {
    assert.deepEqual(
        formatUsiPv(['7g7f', '3c3d', '8h2b+'], standardBoard(), 'sente'),
        ['▲７六歩', '△３四歩', '▲２二角成'],
    )
})
