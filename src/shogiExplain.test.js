import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzePosition, canCaptureKing, computeAttackCounts, explainMove, explainPosition, findThreat, followUpRelation } from './shogiExplain.js'
import { createStandardPosition } from './shogiKif.js'

const piece = (type, owner, promoted = false) => ({ type, owner, promoted })
const emptyBoard = () => Array.from({ length: 9 }, () => Array(9).fill(null))
const startPosition = () => {
    const { board, capturedPieces, sideToMove } = createStandardPosition()
    return { board, hands: capturedPieces, sideToMove }
}

test('初期局面の利きは先後対称で、特徴量は手番以外0になる', () => {
    const { board, hands, sideToMove } = startPosition()
    const counts = computeAttackCounts(board)
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) assert.equal(counts.sente[r][c], counts.gote[8 - r][8 - c])
    }
    // ７六（6段目の7筋）には先手の歩だけが利く
    assert.equal(counts.sente[5][2], 1)
    const { features } = analyzePosition(board, hands, sideToMove)
    for (const [name, value] of Object.entries(features)) assert.equal(value, name === 'tempo' ? 1 : 0, name)
})

test('▲７六歩で角道が開いたことを解説する', () => {
    const prev = startPosition()
    const curr = structuredClone(prev)
    curr.board[5][2] = curr.board[6][2]
    curr.board[6][2] = null
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: { row: 6, col: 2 }, to: { row: 5, col: 2 }, drop: false })
    assert.ok(items.some((item) => item.kind === 'open-line' && item.end === '角道を開ける'))
})

test('タダで取れる駒を、手番側の有利の理由として挙げる', () => {
    const board = emptyBoard()
    board[8][4] = piece('OU', 'sente')
    board[0][4] = piece('OU', 'gote')
    board[4][0] = piece('HI', 'sente')
    board[4][6] = piece('GI', 'gote')
    const result = explainPosition({ board, hands: { sente: {}, gote: {} }, sideToMove: 'sente' }, { score: 600 })
    const threat = result.reasons.find((r) => r.factor === 'threat')
    assert.ok(threat, JSON.stringify(result))
    assert.match(threat.text, /３五の銀をタダで取れる/)
    assert.deepEqual(threat.squares, [{ row: 4, col: 6 }])
})

test('理由はエンジンの評価で良い側のものだけを挙げ、逆向きは「ただし」に回す', () => {
    const board = emptyBoard()
    // 後手は駒得だが、玉が裸で先手の利きに囲まれている
    board[8][4] = piece('OU', 'sente')
    board[7][3] = piece('KI', 'sente')
    board[7][5] = piece('KI', 'sente')
    board[0][4] = piece('OU', 'gote')
    board[2][4] = piece('KI', 'sente')
    board[1][2] = piece('GI', 'sente')
    const hands = { sente: {}, gote: { HI: 2, KA: 1 } }
    const result = explainPosition({ board, hands, sideToMove: 'sente' }, { score: 1200 })
    assert.equal(result.level, 'winning')
    assert.equal(result.winner, 'sente')
    assert.ok(result.reasons.length > 0)
    for (const reason of result.reasons) assert.equal(reason.side, 'sente')
    assert.equal(result.counter?.factor, 'material')
    assert.match(result.counter.text, /後手が(.+を得て)?駒得している$/)
})

test('相手の駒2枚に同時に当てた手を両取りとして解説する', () => {
    const prev = { board: emptyBoard(), hands: { sente: { KE: 1 }, gote: {} }, sideToMove: 'sente' }
    prev.board[8][8] = piece('OU', 'sente')
    prev.board[0][0] = piece('OU', 'gote')
    prev.board[2][3] = piece('KI', 'gote')
    prev.board[2][5] = piece('GI', 'gote')
    const curr = structuredClone(prev)
    curr.board[4][4] = piece('KE', 'sente')
    curr.hands.sente = {}
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: null, to: { row: 4, col: 4 }, drop: true })
    // 打ったこと自体は書かず、目的（両取り）を書く
    assert.ok(!items.some((item) => item.text.includes('打')))
    const fork = items.find((item) => item.kind === 'fork')
    assert.ok(fork, JSON.stringify(items))
    assert.equal(fork.squares.length, 2)
})

test('駒得は取った枚数で数える（飛車を1枚取れば「飛車得」）', () => {
    const position = startPosition()
    // 先手が後手の飛車と歩3枚を取り、後手が先手の金を取った局面
    position.board[1][1] = null
    for (const col of [0, 1, 2]) position.board[2][col] = null
    position.board[8][3] = null
    position.hands = { sente: { HI: 1, FU: 3 }, gote: { KI: 1 } }
    const result = explainPosition(position, { score: 800 })
    const material = result.reasons.find((r) => r.factor === 'material')
    assert.ok(material, JSON.stringify(result))
    assert.equal(material.text, '飛車・歩3枚と金の交換で先手が駒得している')
})

test('歩を打って相手の飛車の利きを止めた手は、守った駒とあわせて受けとして解説する', () => {
    const prev = { board: emptyBoard(), hands: { sente: { FU: 1 }, gote: {} }, sideToMove: 'sente' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[0][4] = piece('OU', 'gote')
    prev.board[7][1] = piece('GI', 'sente')
    prev.board[1][1] = piece('HI', 'gote')
    const curr = structuredClone(prev)
    curr.board[5][1] = piece('FU', 'sente')
    curr.hands.sente = {}
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: null, to: { row: 5, col: 1 }, drop: true })
    assert.ok(items.some((item) => item.kind === 'block-line' && item.end === '相手の飛車の利きを止めて８八の銀を守る'), JSON.stringify(items))
})

test('歩を突いて相手の角の通り道を遮った手は「角道を止める」と言う', () => {
    const prev = startPosition()
    // ▲７六歩のあとで△４四歩と突いた局面（先手の角道が後手陣へ通っている）
    prev.board[5][2] = prev.board[6][2]
    prev.board[6][2] = null
    prev.sideToMove = 'gote'
    const curr = structuredClone(prev)
    curr.board[3][5] = curr.board[2][5]
    curr.board[2][5] = null
    curr.sideToMove = 'sente'
    const items = explainMove(prev, curr, { owner: 'gote', from: { row: 2, col: 5 }, to: { row: 3, col: 5 }, drop: false })
    assert.ok(items.some((item) => item.end === '相手の角道を止める'), JSON.stringify(items))
})

test('取られそうだった駒を安全な場所へ動かした手は「かわす」と言う', () => {
    const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'gote' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[0][4] = piece('OU', 'gote')
    // △７四の飛車に▲７五の歩が当たっている
    prev.board[3][2] = piece('HI', 'gote')
    prev.board[4][2] = piece('FU', 'sente')
    const curr = structuredClone(prev)
    curr.board[3][1] = curr.board[3][2]
    curr.board[3][2] = null
    curr.sideToMove = 'sente'
    const items = explainMove(prev, curr, { owner: 'gote', from: { row: 3, col: 2 }, to: { row: 3, col: 1 }, drop: false })
    assert.equal(items[0]?.end, '当たっていた飛車をかわす', JSON.stringify(items))
})

test('自陣の桂が跳ねて働き出す手は「右桂を活用する」のように言う', () => {
    const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[0][4] = piece('OU', 'gote')
    prev.board[8][7] = piece('KE', 'sente')
    // ▲３七桂: ２九の桂（先手から見て右側）が跳ねる
    const curr = structuredClone(prev)
    curr.board[6][6] = curr.board[8][7]
    curr.board[8][7] = null
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: { row: 8, col: 7 }, to: { row: 6, col: 6 }, drop: false })
    assert.ok(items.some((item) => item.kind === 'activate' && item.end === '右桂を活用する'), JSON.stringify(items))
})

test('自陣の中での金銀の移動（駒組み）は「活用」と言わない', () => {
    const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[0][4] = piece('OU', 'gote')
    prev.board[8][6] = piece('GI', 'sente')
    const curr = structuredClone(prev)
    curr.board[7][6] = curr.board[8][6]
    curr.board[8][6] = null
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: { row: 8, col: 6 }, to: { row: 7, col: 6 }, drop: false })
    assert.ok(!items.some((item) => item.kind === 'activate'), JSON.stringify(items))
})

test('相手の狙いを消した手は「〜を防ぐ」、新しい狙いは「次は〜」として返す', () => {
    // 後手の角が先手の飛車を狙っている（△５五角で飛車を取れる）ところを、先手が飛車をかわさず金で受ける
    const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[0][0] = piece('OU', 'gote')
    prev.board[4][4] = piece('HI', 'sente')
    prev.board[1][7] = piece('KA', 'gote')
    prev.board[5][4] = piece('KI', 'sente')
    const curr = structuredClone(prev)
    // ▲４四金: 角の通り道（２二→３三→４四→５五）を遮る
    curr.board[3][5] = curr.board[5][4]
    curr.board[5][4] = null
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: { row: 5, col: 4 }, to: { row: 3, col: 5 }, drop: false })
    assert.ok(items.some((item) => item.kind === 'prevent' || item.kind === 'block-line'), JSON.stringify(items))
    // 防いだ狙いには、エンジンで確かめるための狙いの手（USI）が付く
    for (const item of items.filter((i) => i.kind === 'prevent')) assert.match(item.threatUsi, /^[1-9][a-i][1-9][a-i]\+?$|^[PLNSGBR]\*[1-9][a-i]$/)
})

test('同じマスで取り返す手は「取り返す」と言う', () => {
    const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[0][4] = piece('OU', 'gote')
    prev.board[5][2] = piece('GI', 'gote')
    prev.board[6][2] = piece('KI', 'sente')
    const curr = structuredClone(prev)
    curr.board[5][2] = curr.board[6][2]
    curr.board[6][2] = null
    curr.hands.sente = { GI: 1 }
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: { row: 6, col: 2 }, to: { row: 5, col: 2 }, drop: false }, { recapture: true })
    assert.ok(items.some((item) => item.kind === 'capture' && item.end === '銀を取り返す'), JSON.stringify(items))
})

test('突いた歩を相手の歩にぶつける手は「〜筋の歩をぶつける」と言う（「仕掛け」は開戦の意味なので使わない）', () => {
    const prev = startPosition()
    // ▲２六歩・▲２五歩と伸ばしたあとの▲２四歩
    prev.board[4][7] = prev.board[6][7]
    prev.board[6][7] = null
    const curr = structuredClone(prev)
    curr.board[3][7] = curr.board[4][7]
    curr.board[4][7] = null
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: { row: 4, col: 7 }, to: { row: 3, col: 7 }, drop: false })
    assert.ok(items.some((item) => item.kind === 'pawn-contact' && item.end === '２筋の歩をぶつける'), JSON.stringify(items))
})

test('と金は、相手玉の近くで取られないときだけ「攻めの拠点」と言う', () => {
    const promote = (gotePieces) => {
        const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
        prev.board[8][4] = piece('OU', 'sente')
        prev.board[3][6] = piece('FU', 'sente')
        gotePieces(prev.board)
        const curr = structuredClone(prev)
        curr.board[2][6] = { ...curr.board[3][6], promoted: true }
        curr.board[3][6] = null
        curr.sideToMove = 'gote'
        return explainMove(prev, curr, { owner: 'sente', from: { row: 3, col: 6 }, to: { row: 2, col: 6 }, drop: false })
    }
    // 相手玉（２一）の近くで、取られない
    const near = promote((b) => { b[0][7] = piece('OU', 'gote') })
    assert.ok(near.some((item) => item.end === 'と金を作って攻めの拠点を築く'), JSON.stringify(near))
    // 相手玉（９一）から遠い
    const far = promote((b) => { b[0][0] = piece('OU', 'gote') })
    assert.ok(far.some((item) => item.end === 'と金を作る'), JSON.stringify(far))
})

test('「切る」は大駒を小駒と交換するときだけ使う', () => {
    // △５三の歩が▲５四の銀に当たっている。銀で４三の歩を取ると、△同金で取り返される
    const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[0][0] = piece('OU', 'gote')
    prev.board[3][4] = piece('GI', 'sente')
    prev.board[2][4] = piece('FU', 'gote')
    prev.board[2][5] = piece('FU', 'gote')
    prev.board[1][5] = piece('KI', 'gote')
    const curr = structuredClone(prev)
    curr.board[2][5] = curr.board[3][4]
    curr.board[3][4] = null
    curr.hands.sente = { FU: 1 }
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: { row: 3, col: 4 }, to: { row: 2, col: 5 }, drop: false })
    assert.ok(!items.some((item) => item.kind === 'cut'), JSON.stringify(items))
})

test('解説の処理は渡された盤面を書き換えない（画面の盤面を壊さない）', () => {
    const deepFreeze = (value) => {
        if (value && typeof value === 'object') {
            Object.values(value).forEach(deepFreeze)
            Object.freeze(value)
        }
        return value
    }
    const prev = startPosition()
    const curr = structuredClone(prev)
    curr.board[5][2] = curr.board[6][2]
    curr.board[6][2] = null
    curr.sideToMove = 'gote'
    deepFreeze(prev)
    deepFreeze(curr)
    // 凍結した盤面に書き込もうとするとエラーになる
    assert.doesNotThrow(() => explainMove(prev, curr, { owner: 'sente', from: { row: 6, col: 2 }, to: { row: 5, col: 2 }, drop: false }))
    assert.doesNotThrow(() => findThreat(curr, 'sente'))
    assert.doesNotThrow(() => explainPosition(curr, { score: 100 }))
})

test('駒を取りながら王手をかける手では、次の狙いを書かない', () => {
    const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[0][4] = piece('OU', 'gote')
    // ▲４二角は後手玉の守りの金を取りながら王手になる
    prev.board[4][4] = piece('KA', 'sente')
    prev.board[2][6] = piece('KE', 'gote')
    prev.board[1][3] = piece('KI', 'gote')
    const curr = structuredClone(prev)
    curr.board[1][3] = curr.board[4][4]
    curr.board[4][4] = null
    curr.hands.sente = { KI: 1 }
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: { row: 4, col: 4 }, to: { row: 1, col: 3 }, drop: false })
    assert.ok(items.some((item) => item.kind === 'check'), JSON.stringify(items))
    assert.ok(!items.some((item) => item.kind === 'next'), JSON.stringify(items))
})

test('当たっていた相手の駒そのものを取る手は「かわす」と言わない', () => {
    const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'gote' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[0][0] = piece('OU', 'gote')
    // △８三の飛車に▲７三の成桂が当たっている（成桂は横に動けるので８三に利く）
    prev.board[2][1] = piece('HI', 'gote')
    prev.board[2][2] = piece('KE', 'sente', true)
    const curr = structuredClone(prev)
    curr.board[2][2] = curr.board[2][1]
    curr.board[2][1] = null
    curr.hands.gote = { KE: 1 }
    curr.sideToMove = 'sente'
    const items = explainMove(prev, curr, { owner: 'gote', from: { row: 2, col: 1 }, to: { row: 2, col: 2 }, drop: false })
    assert.ok(!items.some((item) => item.kind === 'escape' || item.text.includes('当たっていた')), JSON.stringify(items))
    assert.ok(items.some((item) => item.kind === 'capture'), JSON.stringify(items))
})

test('目立った効果のない手でも、駒の動きの特徴を事実として書く', () => {
    const play = (mutate, move) => {
        const prev = startPosition()
        const curr = structuredClone(prev)
        mutate(curr)
        curr.sideToMove = 'gote'
        return explainMove(prev, curr, { owner: 'sente', drop: false, ...move })
    }
    // ▲２六歩: 飛車先の歩を伸ばす
    const pawn = play((c) => { c.board[5][7] = c.board[6][7]; c.board[6][7] = null }, { from: { row: 6, col: 7 }, to: { row: 5, col: 7 } })
    assert.ok(pawn.some((item) => item.end === '飛車先の歩を伸ばす'), JSON.stringify(pawn))
    // ▲７八金: 意図（陣形を整える・攻めの準備）は推測せず、動きの事実だけを書く
    const gold = play((c) => { c.board[7][2] = c.board[8][3]; c.board[8][3] = null }, { from: { row: 8, col: 3 }, to: { row: 7, col: 2 } })
    assert.ok(gold.some((item) => item.kind === 'feature' && item.end === '左金を上がる'), JSON.stringify(gold))
})

test('読み筋の続きが実戦の手と連動するときだけ「含み」として扱う', () => {
    const after = (mutate) => {
        const position = startPosition()
        mutate(position)
        position.sideToMove = 'gote'
        return position
    }
    // ▲２六歩のあとの▲７六歩は、２六歩と関係がない
    const pawn26 = after((p) => { p.board[5][7] = p.board[6][7]; p.board[6][7] = null })
    assert.equal(followUpRelation(pawn26, { from: { row: 6, col: 7 }, to: { row: 5, col: 7 } }, '8c8d', '7g7f'), null)
    // ▲２六歩のあとの▲２五歩は、同じ歩が続けて動く
    assert.deepEqual(followUpRelation(pawn26, { from: { row: 6, col: 7 }, to: { row: 5, col: 7 } }, '8c8d', '2f2e'), { replyMatters: false, nextOnReplySquare: false })
    // ▲３六歩のあとの▲３七桂は、空いたマスを使う
    const pawn36 = after((p) => { p.board[5][6] = p.board[6][6]; p.board[6][6] = null })
    assert.deepEqual(followUpRelation(pawn36, { from: { row: 6, col: 6 }, to: { row: 5, col: 6 } }, '8c8d', '2i3g'), { replyMatters: false, nextOnReplySquare: false })
    // ▲２四歩 △同歩 ▲同飛は、相手の応手（△同歩）が前提になる
    const pawn24 = after((p) => {
        p.board[3][7] = p.board[6][7]
        p.board[6][7] = null
    })
    assert.deepEqual(followUpRelation(pawn24, { from: { row: 4, col: 7 }, to: { row: 3, col: 7 } }, '2c2d', '2h2d'), { replyMatters: true, nextOnReplySquare: true })
})

test('両取りをかけた駒が相手に取られるなら、両取りとは言わない', () => {
    const prev = { board: emptyBoard(), hands: { sente: { KE: 1 }, gote: {} }, sideToMove: 'sente' }
    prev.board[8][8] = piece('OU', 'sente')
    prev.board[0][0] = piece('OU', 'gote')
    prev.board[2][3] = piece('KI', 'gote')
    prev.board[2][5] = piece('GI', 'gote')
    // ５五に打つ桂に、後手の歩（５四）が利いている
    prev.board[3][4] = piece('FU', 'gote')
    const curr = structuredClone(prev)
    curr.board[4][4] = piece('KE', 'sente')
    curr.hands.sente = {}
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: null, to: { row: 4, col: 4 }, drop: true })
    assert.ok(!items.some((item) => item.kind === 'fork'), JSON.stringify(items))
})

test('形勢の区切り: 200未満は互角、500未満は少し指しやすい、1000未満は有利、それ以上は優勢', () => {
    const position = startPosition()
    assert.equal(explainPosition(position, { score: 150 }).level, 'even')
    assert.equal(explainPosition(position, { score: 250 }).level, 'slight')
    assert.equal(explainPosition(position, { score: 700 }).level, 'advantage')
    assert.equal(explainPosition(position, { score: 1200 }).level, 'winning')
})

test('王手を受けていた手では「〜を防ぐ」を判定しない（相手に手番を渡すと反則の局面になるため）', () => {
    const prev = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'gote' }
    prev.board[8][4] = piece('OU', 'sente')
    prev.board[1][4] = piece('OU', 'gote')
    // △５二玉に▲５四香で王手。後手の飛車（２二）は▲２四歩で取られそうな形
    prev.board[3][4] = piece('KY', 'sente')
    prev.board[1][7] = piece('HI', 'gote')
    prev.hands.sente = { FU: 1 }
    const curr = structuredClone(prev)
    curr.board[1][5] = curr.board[1][4]
    curr.board[1][4] = null
    curr.sideToMove = 'sente'
    const items = explainMove(prev, curr, { owner: 'gote', from: { row: 1, col: 4 }, to: { row: 1, col: 5 }, drop: false })
    assert.ok(!items.some((item) => item.kind === 'prevent'), JSON.stringify(items))
})

test('手番の側が相手の玉を取れる（王手放置の）局面を見分ける', () => {
    const board = emptyBoard()
    board[8][4] = piece('OU', 'sente')
    board[0][4] = piece('OU', 'gote')
    board[5][4] = piece('KY', 'sente')
    assert.equal(canCaptureKing(board, 'sente'), true)
    assert.equal(canCaptureKing(board, 'gote'), false)
    board[2][4] = piece('FU', 'gote')
    assert.equal(canCaptureKing(board, 'sente'), false)
})

test('「角道を開ける」は初期位置の角に限り、それ以外は「角の利きを通す」と言う', () => {
    // 角が初期位置（８八）にいるときの▲７六歩
    const prev = startPosition()
    const curr = structuredClone(prev)
    curr.board[5][2] = curr.board[6][2]
    curr.board[6][2] = null
    curr.sideToMove = 'gote'
    assert.ok(explainMove(prev, curr, { owner: 'sente', from: { row: 6, col: 2 }, to: { row: 5, col: 2 }, drop: false })
        .some((item) => item.end === '角道を開ける'))
    // 角が９七にいるときに、前の歩（８六）を動かして利きが通る手
    const prev2 = { board: emptyBoard(), hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    prev2.board[8][4] = piece('OU', 'sente')
    prev2.board[0][4] = piece('OU', 'gote')
    prev2.board[6][0] = piece('KA', 'sente')
    prev2.board[5][1] = piece('FU', 'sente')
    const curr2 = structuredClone(prev2)
    curr2.board[4][1] = curr2.board[5][1]
    curr2.board[5][1] = null
    curr2.sideToMove = 'gote'
    const items = explainMove(prev2, curr2, { owner: 'sente', from: { row: 5, col: 1 }, to: { row: 4, col: 1 }, drop: false })
    assert.ok(!items.some((item) => item.end.includes('角道')), JSON.stringify(items))
    assert.ok(items.some((item) => item.end === '９七の角の利きを通す'), JSON.stringify(items))
})

test('ひもが付いていて取られる心配のない駒に、相手の大駒の利きを遮っても「守る」とは言わない', () => {
    const play = (withSupport) => {
        const prev = { board: emptyBoard(), hands: { sente: {}, gote: { FU: 1 } }, sideToMove: 'gote' }
        prev.board[8][4] = piece('OU', 'sente')
        prev.board[0][8] = piece('OU', 'gote')
        // ▲９七の角の利きが△６四の銀に通っている
        prev.board[6][0] = piece('KA', 'sente')
        prev.board[3][3] = piece('GI', 'gote')
        if (withSupport) prev.board[2][3] = piece('KI', 'gote') // ６三の金が銀にひもを付けている
        const curr = structuredClone(prev)
        // △７五歩打で角の利きを止める
        curr.board[4][2] = piece('FU', 'gote')
        curr.hands.gote = {}
        curr.sideToMove = 'sente'
        return explainMove(prev, curr, { owner: 'gote', from: null, to: { row: 4, col: 2 }, drop: true })
    }
    // ひもがない銀（タダで取られる）なら守ったと言う
    assert.ok(play(false).some((item) => item.end === '相手の角の利きを止めて６四の銀を守る'), JSON.stringify(play(false)))
    // ひもがある銀（角で取っても角損）なら守ったとは言わない
    const supported = play(true)
    assert.ok(!supported.some((item) => item.end.includes('守る')), JSON.stringify(supported))
    assert.ok(supported.some((item) => item.end === '相手の角の利きを止める'), JSON.stringify(supported))
})

test('評価値が互角ならそれぞれの良い点を挙げる', () => {
    const { board, hands, sideToMove } = startPosition()
    const result = explainPosition({ board, hands, sideToMove }, { score: 20 })
    assert.equal(result.level, 'even')
})

test('エンジンの評価がまだなければ解説しない', () => {
    assert.equal(explainPosition(startPosition(), {}), null)
})

test('王手をかけていた駒を玉で取る手は「かわす」と言わず、その駒を取ったと言う', () => {
    const board = emptyBoard()
    board[8][4] = piece('OU', 'sente')
    board[7][4] = piece('KI', 'gote')
    board[0][4] = piece('OU', 'gote')
    const prev = { board, hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    const curr = structuredClone(prev)
    curr.board[7][4] = curr.board[8][4]
    curr.board[8][4] = null
    curr.sideToMove = 'gote'
    const items = explainMove(prev, curr, { owner: 'sente', from: { row: 8, col: 4 }, to: { row: 7, col: 4 }, drop: false })
    assert.ok(items.some((item) => item.ren === '王手をかけていた金を取り'))
    assert.ok(!items.some((item) => /かわ/.test(item.ren)))
    assert.ok(!items.some((item) => item.kind === 'capture'))

    // 王手をかけていない駒を取って逃げる手は、これまでどおり「王手をかわし」
    const board2 = emptyBoard()
    board2[8][4] = piece('OU', 'sente')
    board2[5][4] = piece('HI', 'gote')
    board2[7][3] = piece('FU', 'gote')
    board2[0][4] = piece('OU', 'gote')
    const prev2 = { board: board2, hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    const curr2 = structuredClone(prev2)
    curr2.board[7][3] = curr2.board[8][4]
    curr2.board[8][4] = null
    curr2.sideToMove = 'gote'
    const items2 = explainMove(prev2, curr2, { owner: 'sente', from: { row: 8, col: 4 }, to: { row: 7, col: 3 }, drop: false })
    assert.ok(items2.some((item) => item.ren === '王手をかわし'))
})

test('相手の応手が実戦の手の駒に当てる手なら、続きの手は応手への対応なので「構想」としない', () => {
    // ▲６四飛（６四の歩を取った飛車） △６三銀 ▲６五飛：▲６五飛は当てられた飛車を逃がしているだけ
    const board = emptyBoard()
    board[8][4] = piece('OU', 'sente')
    board[0][4] = piece('OU', 'gote')
    board[3][3] = piece('HI', 'sente')
    board[1][3] = piece('GI', 'gote')
    const position = { board, hands: { sente: {}, gote: {} }, sideToMove: 'gote' }
    const played = { owner: 'sente', from: { row: 3, col: 7 }, to: { row: 3, col: 3 } }
    assert.equal(followUpRelation(position, played, '6b6c', '6d6e'), null)
    // 当ててこない応手なら、同じ駒が続けて動く手は従来どおり連動とみなす
    assert.deepEqual(followUpRelation(position, played, '5a4a', '6d6e'), { replyMatters: false, nextOnReplySquare: false })
})

test('もともと飛車の利きを受けていた駒が前に出る手は「飛車先を止める」と言わない', () => {
    const base = () => {
        const board = emptyBoard()
        board[8][4] = piece('OU', 'sente')
        board[0][4] = piece('OU', 'gote')
        board[1][1] = piece('HI', 'gote')
        board[7][1] = piece('GI', 'sente')
        board[8][2] = piece('KI', 'sente')
        return { board, hands: { sente: { FU: 1 }, gote: {} }, sideToMove: 'sente' }
    }
    // ▲８八銀→▲８七銀：利きが短くなるだけ
    const prev = base()
    const curr = structuredClone(prev)
    curr.board[6][1] = curr.board[7][1]
    curr.board[7][1] = null
    curr.sideToMove = 'gote'
    const silver = explainMove(prev, curr, { owner: 'sente', from: { row: 7, col: 1 }, to: { row: 6, col: 1 }, drop: false })
    assert.ok(!silver.some((item) => item.kind === 'block-line'), JSON.stringify(silver))
    // ▲８五歩打：利きの通り道をふさぐので「飛車先を止める」
    const prev2 = base()
    const curr2 = structuredClone(prev2)
    curr2.board[4][1] = piece('FU', 'sente')
    curr2.hands.sente.FU = 0
    curr2.sideToMove = 'gote'
    const pawn = explainMove(prev2, curr2, { owner: 'sente', from: null, to: { row: 4, col: 1 }, drop: true, type: 'FU' })
    assert.ok(pawn.some((item) => item.end === '相手の飛車先を止める'), JSON.stringify(pawn))
})

test('「角を自陣に引く」は自陣の外から戻るときだけ。自陣の中で下がるのは「角を引く」', () => {
    const play = (from, to) => {
        const board = emptyBoard()
        board[0][4] = piece('OU', 'gote')
        board[8][4] = piece('OU', 'sente')
        board[from.row][from.col] = piece('KA', 'gote')
        const prev = { board, hands: { sente: {}, gote: {} }, sideToMove: 'gote' }
        const curr = structuredClone(prev)
        curr.board[to.row][to.col] = curr.board[from.row][from.col]
        curr.board[from.row][from.col] = null
        curr.sideToMove = 'sente'
        return explainMove(prev, curr, { owner: 'gote', from, to, drop: false }).map((item) => item.end)
    }
    // △４二角→△３一角：もともと自陣にいた
    const inside = play({ row: 1, col: 5 }, { row: 0, col: 6 })
    assert.ok(inside.includes('角を引く'), JSON.stringify(inside))
    assert.ok(!inside.includes('角を自陣に引く'))
    // △５五角→△３三角：自陣の外から戻る
    assert.ok(play({ row: 4, col: 4 }, { row: 2, col: 6 }).includes('角を自陣に引く'))
})

test('指した後も自玉に王手がかかったままの手（反則）は解説しない', () => {
    const board = emptyBoard()
    board[8][4] = piece('OU', 'sente')
    board[0][4] = piece('OU', 'gote')
    board[2][4] = piece('HI', 'gote')
    const prev = { board, hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    // ５九玉→５八玉：５筋の飛車の王手が続いている
    const curr = structuredClone(prev)
    curr.board[7][4] = curr.board[8][4]
    curr.board[8][4] = null
    curr.sideToMove = 'gote'
    assert.deepEqual(explainMove(prev, curr, { owner: 'sente', from: { row: 8, col: 4 }, to: { row: 7, col: 4 }, drop: false }), [])
    // ５九玉→４八玉：王手をかわしている
    const escaped = structuredClone(prev)
    escaped.board[7][5] = escaped.board[8][4]
    escaped.board[8][4] = null
    escaped.sideToMove = 'gote'
    assert.ok(explainMove(prev, escaped, { owner: 'sente', from: { row: 8, col: 4 }, to: { row: 7, col: 5 }, drop: false }).some((item) => item.ren === '王手をかわし'))
})

test('形で名前の決まる手筋（叩き・焦点・垂れ歩・ふんどしの桂・王手飛車取り）を名前で書く', () => {
    const drop = (setup, type, to, hand = {}) => {
        const board = emptyBoard()
        board[8][8] = piece('OU', 'sente')
        board[0][0] = piece('OU', 'gote')
        setup(board)
        const prev = { board, hands: { sente: { [type]: 1, ...hand }, gote: {} }, sideToMove: 'sente' }
        const curr = structuredClone(prev)
        curr.board[to.row][to.col] = piece(type, 'sente')
        curr.hands.sente[type] -= 1
        curr.sideToMove = 'gote'
        return explainMove(prev, curr, { owner: 'sente', type, from: null, to, drop: true }).map((item) => item.ren ?? '')
    }
    // ３二の金の頭に歩を打つ → 叩きの歩
    assert.ok(drop((b) => { b[1][6] = piece('KI', 'gote') }, 'FU', { row: 2, col: 6 }).some((ren) => ren.startsWith('叩きの歩で３二の金に当て')))
    // ３二の金と４二の銀が利く３三に歩を打つ → 焦点の歩
    assert.ok(drop((b) => { b[1][6] = piece('KI', 'gote'); b[1][5] = piece('GI', 'gote') }, 'FU', { row: 2, col: 6 }).some((ren) => ren.includes('焦点に歩を打ち')))
    // 前が空いた２四に、取られない形で歩を打つ → 垂れ歩
    assert.ok(drop(() => {}, 'FU', { row: 3, col: 7 }).includes('垂れ歩を打ち'))
    // 飛車を追う歩は叩きとは呼ばない
    assert.ok(!drop((b) => { b[1][6] = piece('HI', 'gote') }, 'FU', { row: 2, col: 6 }).some((ren) => ren.includes('叩き')))
    // ５五の桂が４三の金と６三の銀に当たる → ふんどしの桂
    assert.ok(drop((b) => { b[2][5] = piece('KI', 'gote'); b[2][3] = piece('GI', 'gote') }, 'KE', { row: 4, col: 4 }).some((ren) => ren.startsWith('ふんどしの桂で')))
    // ５五の角が９一の玉と２二の飛車に当たる → 王手飛車取り
    assert.ok(drop((b) => { b[1][7] = piece('HI', 'gote') }, 'KA', { row: 4, col: 4 }).includes('王手飛車取りをかけ'))
})

test('動かした駒が当たらず、後ろの大駒の利きが通って当たった駒は「〜の利きを通して〜に狙いをつけ」と書く', () => {
    const board = emptyBoard()
    board[8][0] = piece('OU', 'sente')
    board[0][0] = piece('OU', 'gote')
    board[8][7] = piece('HI', 'sente')
    board[7][7] = piece('GI', 'sente')
    board[4][7] = piece('KI', 'gote')
    const prev = { board, hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    const curr = structuredClone(prev)
    curr.board[6][6] = curr.board[7][7]
    curr.board[7][7] = null
    curr.sideToMove = 'gote'
    const rens = explainMove(prev, curr, { owner: 'sente', type: 'GI', from: { row: 7, col: 7 }, to: { row: 6, col: 6 }, drop: false }).map((item) => item.ren ?? '')
    assert.ok(rens.includes('２九の飛車の利きを通して２五の金に狙いをつけ'), JSON.stringify(rens))
    assert.ok(!rens.includes('２五の金に狙いをつけ'))
})

test('両取り・王手○取りの対象に歩は数えず、両取りは2枚までにする', () => {
    // 持ち駒の角を３三に打つと王手になるが、もう一方の利きの先は歩だけ → 王手歩取りとは言わない
    const board = emptyBoard()
    board[8][8] = piece('OU', 'sente')
    board[0][4] = piece('OU', 'gote')
    board[1][7] = piece('FU', 'gote')
    const threat = findThreat({ board, hands: { sente: { KA: 1 }, gote: {} }, sideToMove: 'sente' }, 'sente')
    assert.ok(threat?.kind !== 'check-fork', JSON.stringify(threat && { kind: threat.kind, notation: threat.notation }))

    // ５五の角がいくつの駒に当たっても、両取りに挙げるのは価値の高い2枚
    const board2 = emptyBoard()
    board2[8][8] = piece('OU', 'sente')
    board2[0][0] = piece('OU', 'gote')
    // ５五の角を取れない位置に、７三の飛車・３三の金・４六の桂を置く
    board2[2][2] = piece('HI', 'gote')
    board2[2][6] = piece('KI', 'gote')
    board2[5][5] = piece('KE', 'gote')
    const prev = { board: board2, hands: { sente: { KA: 1 }, gote: {} }, sideToMove: 'sente' }
    const curr = structuredClone(prev)
    curr.board[4][4] = piece('KA', 'sente')
    curr.hands.sente.KA = 0
    curr.sideToMove = 'gote'
    const fork = explainMove(prev, curr, { owner: 'sente', type: 'KA', from: null, to: { row: 4, col: 4 }, drop: true }).find((item) => item.kind === 'fork')
    assert.match(fork?.ren ?? '', /^７三の飛車と[^と]+に両取りをかけ$/)
    assert.equal(fork.squares.length, 2)
})

test('手番の側に王手がかかっているときは「手番で〜を取れる」を理由に挙げない', () => {
    const make = (check) => {
        const board = emptyBoard()
        board[8][4] = piece('OU', 'sente')
        board[0][0] = piece('OU', 'gote')
        board[8][7] = piece('HI', 'sente')
        board[4][7] = piece('GI', 'gote')
        // 王手ありは５一の飛車が５九の玉に利く。王手なしは飛車を７一に置く
        board[0][check ? 4 : 2] = piece('HI', 'gote')
        return { board, hands: { sente: {}, gote: {} }, sideToMove: 'sente' }
    }
    const reasons = (position) => {
        const explanation = explainPosition(position, { score: 700, mate: null })
        return [...explanation.reasons.flatMap((r) => r.clauses), ...(explanation.counter?.clauses ?? [])].map((c) => c.text).join('／')
    }
    assert.match(reasons(make(false)), /手番の先手が２五の銀をタダで取れる/)
    assert.doesNotMatch(reasons(make(true)), /取れる/)
})
