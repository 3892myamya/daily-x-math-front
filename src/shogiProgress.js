// 局面の進行度（0 = 序盤 〜 1 = 終盤）。つようら王11の評価関数に付属する progress.bin（MIT License）を使い、
// やねうら王（SFNN の進行度、eval/nnue/evaluate_nnue.cpp の Progress::Parameters）と同じ計算をする。
// 計算: 先手玉の位置×各駒（先手から見た番号）と、後手玉の位置（盤を反転）×各駒（後手から見た番号）の重みを
// 玉以外の38枚について足し、シグモイド関数で 0〜1 にする。エンジンはこれを8段階に分けて評価関数を切り替えている

const SQUARES = 81
const FE_END = 1548
const FE_HAND_END = 90
// 盤上の駒の番号（BonaPiece）。先手の駒の f_* の 81 個あとが後手の e_*。成った小駒は金と同じ扱い
const BOARD_ORDER = { FU: 0, KY: 1, KE: 2, GI: 3, KI: 4, KA: 5, UMA: 6, HI: 7, RYU: 8 }
// 持ち駒の番号。[先手の1枚目, 後手の1枚目]、2枚目以降は1ずつ増える
const HAND_BASE = {
    FU: [1, 20], KY: [39, 44], KE: [49, 54], GI: [59, 64], KI: [69, 74], KA: [79, 82], HI: [85, 88],
}

// progress.bin（ヘッダーなし・リトルエンディアンの倍精度、[玉の位置 81][駒の番号 1548]）を読む
export function readProgressWeights(buffer) {
    const view = new DataView(buffer)
    if (view.byteLength !== SQUARES * FE_END * 8) throw new Error('progress.bin の大きさが想定と違います')
    const weights = new Float64Array(SQUARES * FE_END)
    for (let i = 0; i < weights.length; i++) weights[i] = view.getFloat64(i * 8, true)
    return weights
}

// アプリの盤（row 0 = 一段、col 0 = 9筋）のマスを、やねうら王のマスの番号（SQ_11 = 0、筋ごとに9つ）にする
function squareIndex(row, col) {
    return (8 - col) * 9 + row
}

function boardKind(piece) {
    if (!piece.promoted) return piece.type
    if (piece.type === 'KA') return 'UMA'
    if (piece.type === 'HI') return 'RYU'
    return 'KI'
}

// 先手から見た番号（fb）と後手から見た番号（fw）
function boardPieceIndex(piece, square) {
    const base = FE_HAND_END + BOARD_ORDER[boardKind(piece)] * 162
    const own = base
    const other = base + 81
    const inverse = SQUARES - 1 - square
    return piece.owner === 'sente' ? [own + square, other + inverse] : [other + square, own + inverse]
}

// 進行度（0〜1）。board: アプリの盤、hands: { sente: { FU: 2, ... }, gote: {...} }
export function positionProgress(weights, board, hands) {
    let senteKing = null
    let goteKing = null
    const pieces = []
    board.forEach((row, r) => row.forEach((piece, c) => {
        if (!piece) return
        const square = squareIndex(r, c)
        if (piece.type === 'OU') {
            if (piece.owner === 'sente') senteKing = square
            else goteKing = square
            return
        }
        pieces.push(boardPieceIndex(piece, square))
    }))
    for (const owner of ['sente', 'gote']) {
        for (const [type, count] of Object.entries(hands?.[owner] ?? {})) {
            const base = HAND_BASE[type]
            if (!base) continue
            const [fb, fw] = owner === 'sente' ? base : [base[1], base[0]]
            for (let i = 0; i < count; i++) pieces.push([fb + i, fw + i])
        }
    }
    if (senteKing === null || goteKing === null) return null
    const blackKing = senteKing
    const whiteKing = SQUARES - 1 - goteKing
    let sum = 0
    for (const [fb, fw] of pieces) sum += weights[blackKing * FE_END + fb] + weights[whiteKing * FE_END + fw]
    return 1 / (1 + Math.exp(-sum))
}

// 進行度から対局の段階を決める。エンジンは進行度を8段階に分けて評価関数を切り替えており、
// その段階0〜1を序盤、2〜4を中盤、5〜7を終盤とする（3局で評価値と局面の要素の関係が変わる区切りと一致した）
export function gamePhase(progress) {
    if (progress === null || progress === undefined) return null
    const stage = Math.min(7, Math.floor(progress * 8))
    if (stage <= 1) return 'opening'
    if (stage <= 4) return 'middle'
    return 'end'
}

// 棋譜の各局面の段階の列から、index の局面で初めて入った段階を返す（入っていなければ null）。
// 段階の境目では行ったり来たりするので、それより前に一度でも同じか先の段階に入っていれば書かない
const PHASE_ORDER = { opening: 0, middle: 1, end: 2 }
export function firstPhaseEntry(phases, index) {
    const phase = phases[index]
    if (!phase || phase === 'opening') return null
    const earlier = phases.slice(0, index).filter(Boolean)
    if (earlier.some((item) => PHASE_ORDER[item] >= PHASE_ORDER[phase])) return null
    return phase
}
