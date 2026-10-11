// 局面の解説: 盤面から形勢の要因を数値化し、日本語の説明文を作る。
// 要因の形は explain（駒得・玉の安全度・駒の働き・速度・手番）に寄せてあり、
// 後から別の計算元を差し込めるようにしている。

import { EXPLAIN_WEIGHTS } from './shogiExplainWeights.js'

const OWNERS = ['sente', 'gote']

export const PIECE_NAMES = {
    FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉',
}

const PROMOTED_NAMES = {
    FU: 'と', KY: '成香', KE: '成桂', GI: '成銀', KA: '馬', HI: '龍',
}

const BASE_VALUES = { FU: 90, KY: 315, KE: 405, GI: 495, KI: 540, KA: 855, HI: 990, OU: 0 }
const PROMOTED_VALUES = { FU: 540, KY: 540, KE: 540, GI: 540, KA: 945, HI: 1395 }
// 取られそうな駒の判定で、玉を取られる駒として数えないための大きな値
const KING_EXCHANGE_VALUE = 10000

const FILE_LABELS = ['９', '８', '７', '６', '５', '４', '３', '２', '１']
const RANK_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

export function opponent(owner) {
    return owner === 'sente' ? 'gote' : 'sente'
}

export function insideBoard(row, col) {
    return row >= 0 && row < 9 && col >= 0 && col < 9
}

export function pieceValue(piece) {
    return piece.promoted ? PROMOTED_VALUES[piece.type] : BASE_VALUES[piece.type]
}

export function pieceName(piece) {
    return piece.promoted ? PROMOTED_NAMES[piece.type] : PIECE_NAMES[piece.type]
}

export function squareName(row, col) {
    return `${FILE_LABELS[col]}${RANK_LABELS[row]}`
}

// 盤上の駒が利いているマスを返す。飛び駒は最初に駒がある地点で止まる
export function attacksFrom(board, row, col) {
    const piece = board[row][col]
    if (!piece) return []

    const attacks = []
    const dir = piece.owner === 'sente' ? -1 : 1
    const push = (r, c) => {
        if (insideBoard(r, c)) attacks.push({ row: r, col: c })
    }
    const slide = (dr, dc) => {
        let r = row + dr
        let c = col + dc
        while (insideBoard(r, c)) {
            attacks.push({ row: r, col: c })
            if (board[r][c]) break
            r += dr
            c += dc
        }
    }

    const effectiveType = piece.promoted && ['FU', 'KY', 'KE', 'GI'].includes(piece.type)
        ? 'KI'
        : piece.type

    switch (effectiveType) {
        case 'FU':
            push(row + dir, col)
            break
        case 'KY':
            slide(dir, 0)
            break
        case 'KE':
            push(row + dir * 2, col - 1)
            push(row + dir * 2, col + 1)
            break
        case 'GI':
            push(row + dir, col)
            push(row + dir, col - 1)
            push(row + dir, col + 1)
            push(row - dir, col - 1)
            push(row - dir, col + 1)
            break
        case 'KI':
            push(row + dir, col - 1)
            push(row + dir, col)
            push(row + dir, col + 1)
            push(row, col - 1)
            push(row, col + 1)
            push(row - dir, col)
            break
        case 'OU':
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr || dc) push(row + dr, col + dc)
                }
            }
            break
        case 'KA':
            for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) slide(dr, dc)
            if (piece.promoted) {
                push(row + 1, col)
                push(row - 1, col)
                push(row, col + 1)
                push(row, col - 1)
            }
            break
        case 'HI':
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) slide(dr, dc)
            if (piece.promoted) {
                push(row + 1, col + 1)
                push(row + 1, col - 1)
                push(row - 1, col + 1)
                push(row - 1, col - 1)
            }
            break
    }
    return attacks
}

export function computeAttackCounts(board) {
    const counts = {
        sente: Array.from({ length: 9 }, () => Array(9).fill(0)),
        gote: Array.from({ length: 9 }, () => Array(9).fill(0)),
    }
    forEachPiece(board, (piece, row, col) => {
        for (const a of attacksFrom(board, row, col)) counts[piece.owner][a.row][a.col]++
    })
    return counts
}

function forEachPiece(board, callback) {
    for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
            if (board[row][col]) callback(board[row][col], row, col)
        }
    }
}

// 各マスに利いている駒の一覧（安い順）
function attackersBySquare(board) {
    const lists = { sente: new Map(), gote: new Map() }
    forEachPiece(board, (piece, row, col) => {
        for (const a of attacksFrom(board, row, col)) {
            const key = a.row * 9 + a.col
            if (!lists[piece.owner].has(key)) lists[piece.owner].set(key, [])
            lists[piece.owner].get(key).push({ piece, row, col })
        }
    })
    const value = (a) => (a.piece.type === 'OU' ? KING_EXCHANGE_VALUE : pieceValue(a.piece))
    for (const owner of OWNERS) {
        for (const list of lists[owner].values()) list.sort((a, b) => value(a) - value(b))
    }
    return lists
}

export function findKing(board, owner) {
    let found = null
    forEachPiece(board, (piece, row, col) => {
        if (piece.type === 'OU' && piece.owner === owner) found = { row, col }
    })
    return found
}

function kingRing(king) {
    const squares = []
    if (!king) return squares
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if ((dr || dc) && insideBoard(king.row + dr, king.col + dc)) {
                squares.push({ row: king.row + dr, col: king.col + dc })
            }
        }
    }
    return squares
}

function isEnemyCamp(owner, row) {
    return owner === 'sente' ? row <= 2 : row >= 6
}

// 相手に取られると損をする駒。利きの数と、取る駒・守る駒の価値で簡易的に判定する
function threatenedPieces(board, attackers, owner) {
    const enemy = opponent(owner)
    const result = []
    forEachPiece(board, (piece, row, col) => {
        if (piece.owner !== owner || piece.type === 'OU') return
        const key = row * 9 + col
        const enemyAttackers = attackers[enemy].get(key) ?? []
        if (!enemyAttackers.length) return
        const defenders = attackers[owner].get(key) ?? []
        const value = pieceValue(piece)
        const cheapest = enemyAttackers[0].piece
        const cheapestValue = cheapest.type === 'OU' ? KING_EXCHANGE_VALUE : pieceValue(cheapest)
        let loss = 0
        if (!defenders.length) {
            // 玉でしか取れない駒も、守りがなければ取られる
            loss = value
        } else if (cheapestValue < value) {
            loss = value - cheapestValue
        }
        if (loss > 0) {
            result.push({
                piece, row, col, loss,
                attackers: enemyAttackers.length,
                defenders: defenders.length,
            })
        }
    })
    return result.sort((a, b) => b.loss - a.loss)
}

function handValue(hand) {
    return Object.entries(hand ?? {}).reduce((sum, [type, count]) => sum + BASE_VALUES[type] * (count ?? 0), 0)
}

// 片方の側から見た盤面の特徴。数値が大きいほど owner に有利
function sideFeatures(board, hands, owner, attackCounts, attackers) {
    const enemy = opponent(owner)
    const ownKing = findKing(board, owner)
    const enemyKing = findKing(board, enemy)

    let material = handValue(hands[owner])
    let mobility = 0
    let majorMobility = 0
    let campAttacks = 0
    const majors = []

    forEachPiece(board, (piece, row, col) => {
        if (piece.owner !== owner) return
        material += pieceValue(piece)
        const attacks = attacksFrom(board, row, col)
        mobility += attacks.length
        campAttacks += attacks.filter((a) => isEnemyCamp(owner, a.row)).length
        if (piece.type === 'HI' || piece.type === 'KA') {
            majorMobility += attacks.length
            majors.push({ piece, row, col, squares: attacks })
        }
    })

    const ring = kingRing(ownKing)
    const ringDefense = ring.reduce((sum, s) => sum + attackCounts[owner][s.row][s.col], 0)
    const ringAttacked = ring.reduce((sum, s) => sum + attackCounts[enemy][s.row][s.col], 0)
    const guards = []
    if (ownKing) {
        forEachPiece(board, (piece, row, col) => {
            if (piece.owner !== owner) return
            const isGuard = piece.type === 'KI' || piece.type === 'GI'
                || (piece.promoted && ['FU', 'KY', 'KE'].includes(piece.type))
            if (isGuard && Math.max(Math.abs(row - ownKing.row), Math.abs(col - ownKing.col)) <= 2) {
                guards.push({ row, col })
            }
        })
    }
    // 玉の周りで相手の利きが自分の利きより多いマス（勢力図で相手色になるマス）
    const ringLosing = ring.filter((s) => attackCounts[enemy][s.row][s.col] > attackCounts[owner][s.row][s.col])
    // 盤全体と相手陣で、自分の利きが相手より多いマスの数
    let control = 0
    let campControl = 0
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (attackCounts[owner][r][c] > attackCounts[enemy][r][c]) {
                control++
                if (isEnemyCamp(owner, r)) campControl++
            }
        }
    }
    const inCheck = ownKing ? attackCounts[enemy][ownKing.row][ownKing.col] > 0 : false
    // 玉の逃げ道: 相手の利きがなく、自分の駒もいない周囲のマス
    const escapes = ring.filter((s) => (
        !attackCounts[enemy][s.row][s.col] && board[s.row][s.col]?.owner !== owner
    ))

    return {
        material,
        mobility,
        majorMobility,
        campAttacks,
        ringDefense,
        ringAttacked,
        guards: guards.length,
        escapes: escapes.length,
        ringLosing: ringLosing.length,
        control,
        campControl,
        inCheck,
        handAttack: enemyKing ? handValue(hands[owner]) : 0,
        threatened: threatenedPieces(board, attackers, owner),
        detail: { ownKing, ring, guards, majors, escapes, ringLosing },
    }
}

// 回帰に使う特徴量（先手から見た差分）
export const FEATURE_NAMES = [
    'material',
    'mobility',
    'majorMobility',
    'campAttacks',
    'kingRingDefense',
    'kingRingAttacked',
    'kingGuards',
    'kingEscapes',
    'handVsKing',
    'kingRingLosing',
    'kingDanger',
    'control',
    'campControl',
    'inCheck',
    'stmThreat',
    'oppThreat',
    'tempo',
]

export function analyzePosition(board, hands, sideToMove) {
    const attackCounts = computeAttackCounts(board)
    const attackers = attackersBySquare(board)
    const side = {
        sente: sideFeatures(board, hands, 'sente', attackCounts, attackers),
        gote: sideFeatures(board, hands, 'gote', attackCounts, attackers),
    }
    const stmSign = sideToMove === 'sente' ? 1 : -1
    const stm = side[sideToMove]
    const opp = side[opponent(sideToMove)]
    // 手番側はすぐ取れるので相手の取られそうな駒の価値をそのまま見込む。自分の駒は一つ逃がせる前提で二番目以降を数える
    const stmGain = opp.threatened[0]?.loss ?? 0
    const stmRisk = stm.threatened.slice(1).reduce((sum, t) => sum + t.loss, 0)

    const s = side.sente
    const g = side.gote
    const features = {
        material: s.material - g.material,
        mobility: s.mobility - g.mobility,
        majorMobility: s.majorMobility - g.majorMobility,
        campAttacks: s.campAttacks - g.campAttacks,
        kingRingDefense: s.ringDefense - g.ringDefense,
        // 自玉の周りへの相手の利きは不利なので符号を反転させる
        kingRingAttacked: g.ringAttacked - s.ringAttacked,
        kingGuards: s.guards - g.guards,
        kingEscapes: s.escapes - g.escapes,
        // 持ち駒は相手玉が薄いほど攻めに効く
        handVsKing: s.handAttack * g.ringAttacked - g.handAttack * s.ringAttacked,
        kingRingLosing: g.ringLosing - s.ringLosing,
        // 利き負けのマスが増えるほど急に危なくなるので二乗で数える
        kingDanger: g.ringLosing ** 2 - s.ringLosing ** 2,
        control: s.control - g.control,
        campControl: s.campControl - g.campControl,
        inCheck: (g.inCheck ? 1 : 0) - (s.inCheck ? 1 : 0),
        stmThreat: stmGain ? stmSign * stmGain : 0,
        oppThreat: stmRisk ? -stmSign * stmRisk : 0,
        tempo: stmSign,
    }
    return { features, side, attackCounts, sideToMove }
}

// 要因ごとの点数（先手から見た値）。重みは K-P の評価値に合わせて事前に決めてある
export const FACTOR_GROUPS = {
    material: ['material'],
    king: ['kingRingDefense', 'kingRingAttacked', 'kingGuards', 'kingEscapes', 'handVsKing', 'kingRingLosing', 'kingDanger', 'inCheck'],
    activity: ['mobility', 'majorMobility', 'campAttacks', 'control', 'campControl'],
    threat: ['stmThreat', 'oppThreat'],
    tempo: ['tempo'],
}

export function scoreFactors(features, weights = EXPLAIN_WEIGHTS) {
    const factors = {}
    for (const [group, names] of Object.entries(FACTOR_GROUPS)) {
        factors[group] = Math.round(names.reduce((sum, name) => sum + (weights.coef[name] ?? 0) * features[name], 0))
    }
    const total = Math.round(weights.intercept + Object.values(factors).reduce((a, b) => a + b, 0))
    return { factors, total }
}

// ---- 解説文 ----

const SIDE_LABELS = { sente: '先手', gote: '後手' }
const TEXT_NAMES = {
    FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛車', OU: '玉',
}
const HAND_ORDER = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU']
// これより小さい要因は解説に挙げない
const MIN_REASON = 60
const FACTOR_LABELS = {
    material: '駒の損得',
    king: '玉の安全度',
    activity: '駒の働き',
    threat: '駒の狙い',
    tempo: '手番',
}

export function textName(piece) {
    // 解説の文中では「と」より「と金」の方が読みやすい
    if (piece.promoted && piece.type === 'FU') return 'と金'
    return piece.promoted ? PROMOTED_NAMES[piece.type] : TEXT_NAMES[piece.type]
}

function pieceAt(item) {
    return `${squareName(item.row, item.col)}の${textName(item.piece)}`
}

function pieceCounts(board, hands, owner) {
    const counts = { ...(hands[owner] ?? {}) }
    forEachPiece(board, (piece) => {
        if (piece.owner === owner && piece.type !== 'OU') counts[piece.type] = (counts[piece.type] ?? 0) + 1
    })
    return counts
}

function countList(diffs, separator = 'と') {
    const names = diffs.slice(0, 2).map(([type, n]) => `${TEXT_NAMES[type]}${n > 1 ? `${n}枚` : ''}`).join(separator)
    return diffs.length > 2 ? `${names}など` : names
}

// 解説の節はどれも「〜している」「〜が厚い」のような言い切りの形で返す。
// 文章としてのつなぎ方は shogiCommentary.js が決める
function clause(text, squares = []) {
    return { text, squares: squares.filter(Boolean).map((s) => ({ row: s.row, col: s.col })) }
}

function materialClauses(board, hands, winner) {
    const mine = pieceCounts(board, hands, winner)
    const theirs = pieceCounts(board, hands, opponent(winner))
    const gains = []
    const losses = []
    for (const type of HAND_ORDER) {
        // 1枚取ると自分が1枚増え相手が1枚減るので、枚数の差の半分が「何枚得」にあたる
        const diff = Math.ceil(Math.abs((mine[type] ?? 0) - (theirs[type] ?? 0)) / 2)
        if (!diff) continue
        if ((mine[type] ?? 0) > (theirs[type] ?? 0)) gains.push([type, diff])
        else losses.push([type, diff])
    }
    const side = SIDE_LABELS[winner]
    // 人間の解説にならい「飛車と金の交換で駒得」のように交換の形で言う
    if (gains.length && losses.length) return [clause(`${countList(gains, '・')}と${countList(losses, '・')}の交換で${side}が駒得している`)]
    if (gains.length === 1) return [clause(`${side}が${countList(gains)}得している`)]
    if (gains.length) return [clause(`${side}が${countList(gains)}を得て駒得している`)]
    return [clause(`${side}の成駒が多い`)]
}

function kingClauses(analysis, winner, weights) {
    const c = weights.coef
    const me = analysis.side[winner]
    const enemy = analysis.side[opponent(winner)]
    const defense = (s) => c.kingRingDefense * s.ringDefense + c.kingGuards * s.guards
    const pressure = (attacker, defender) => c.kingRingAttacked * defender.ringAttacked
        + c.kingDanger * defender.ringLosing ** 2
        + c.inCheck * (defender.inCheck ? 1 : 0)
        + c.handVsKing * attacker.handAttack * defender.ringAttacked
    const defenseDiff = defense(me) - defense(enemy)
    const attackDiff = pressure(me, enemy) - pressure(enemy, me)
    const side = SIDE_LABELS[winner]
    const enemySide = SIDE_LABELS[opponent(winner)]
    const clauses = []

    if (attackDiff >= 40 || attackDiff >= defenseDiff) {
        const attacked = enemy.detail.ring.filter((s) => analysis.attackCounts[winner][s.row][s.col] > 0)
        // 対局者は利きの数ではなく「迫られている」「危ない」と感じるので、程度だけを言葉にする
        if (enemy.inCheck) {
            clauses.push(clause(`${enemySide}玉に王手がかかっている`, [enemy.detail.ownKing]))
        } else if (attackDiff >= 150 || enemy.ringLosing >= 2) {
            clauses.push(clause(`${side}の攻めが${enemySide}玉に迫っている`, attacked))
        } else {
            clauses.push(clause(`${enemySide}玉が${side}の攻めにさらされている`, attacked))
        }
        if (!enemy.inCheck && enemy.escapes <= 1 && attacked.length) {
            clauses.push(clause(`${enemySide}玉は逃げ道が少ない`, enemy.detail.ring.filter((s) => !enemy.detail.escapes.some((e) => e.row === s.row && e.col === s.col))))
        }
    }
    if (defenseDiff >= 40 || !clauses.length) {
        let text = `${side}玉の方が安定している`
        if (defenseDiff >= 150) text = `${side}玉はしっかり囲われていて堅い`
        else if (me.guards > enemy.guards) text = `${side}玉は金銀に守られていて${enemySide}玉より堅い`
        clauses.push(clause(text, me.detail.guards))
    }
    return clauses
}

function activityClauses(analysis, winner) {
    const me = analysis.side[winner]
    const side = SIDE_LABELS[winner]
    const squares = []
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (isEnemyCamp(winner, r) && analysis.attackCounts[winner][r][c] > analysis.attackCounts[opponent(winner)][r][c]) {
                squares.push({ row: r, col: c })
            }
        }
    }
    const clauses = [clause(`${side}の駒の方が働きが良く敵陣に圧力をかけている`, squares)]
    // 大きく利いている大駒は「にらみを利かせている」と言う
    const major = [...me.detail.majors].sort((a, b) => b.squares.length - a.squares.length)[0]
    if (major && major.squares.length >= 8) {
        clauses.push(clause(`${pieceAt(major)}が盤上ににらみを利かせている`, [major]))
    }
    return clauses
}

function threatClauses(analysis, winner) {
    const stm = analysis.sideToMove
    const side = SIDE_LABELS[winner]
    if (winner === stm) {
        const target = analysis.side[opponent(stm)].threatened[0]
        if (!target) return []
        const how = target.defenders ? '得する形で' : 'タダで'
        return [clause(`手番の${side}が${pieceAt(target)}を${how}取れる`, [target])]
    }
    const risks = analysis.side[stm].threatened
    if (risks.length < 2) return []
    return [clause(`${SIDE_LABELS[stm]}は${risks.slice(0, 3).map(pieceAt).join('と')}が同時に狙われている`, risks.slice(0, 3))]
}

function reasonFor(factor, analysis, position, winner, weights) {
    let clauses = []
    if (factor === 'material') clauses = materialClauses(position.board, position.hands, winner)
    if (factor === 'king') clauses = kingClauses(analysis, winner, weights)
    if (factor === 'activity') clauses = activityClauses(analysis, winner)
    if (factor === 'threat') clauses = threatClauses(analysis, winner)
    if (factor === 'tempo') clauses = [clause(`手番の${SIDE_LABELS[winner]}が先に指せる`)]
    if (!clauses.length) return null
    return {
        factor,
        label: FACTOR_LABELS[factor],
        side: winner,
        clauses,
        text: clauses.map((c) => c.text).join('、'),
        squares: clauses.flatMap((c) => c.squares),
    }
}

// 形勢の言い方の区切り。評価値の一般的な目安（互角〜±200、有利〜±500、優勢〜±1000）に合わせる
const EVEN_LIMIT = 200
const SLIGHT_LIMIT = 500
const ADVANTAGE_LIMIT = 1000

function levelFor(score) {
    const size = Math.abs(score)
    if (size < SLIGHT_LIMIT) return 'slight'
    if (size < ADVANTAGE_LIMIT) return 'advantage'
    return 'winning'
}

// 局面の解説。score / mate はエンジンの評価（先手基準）で、解説はその向きを支える要因だけを挙げる
export function explainPosition(position, { score = null, mate = null } = {}, weights = EXPLAIN_WEIGHTS) {
    const analysis = analyzePosition(position.board, position.hands, position.sideToMove)
    const { factors } = scoreFactors(analysis.features, weights)
    const entries = Object.entries(factors)
    const hasMate = mate !== null && mate !== undefined
    // mate 0 は、手番の側がすでに詰んでいる局面
    if (hasMate && mate === 0) {
        return { level: 'mated', winner: opponent(position.sideToMove), mate: 0, reasons: [], counter: null, note: null }
    }
    // 詰みが見えている局面は、駒得や働きを並べても意味が薄いので理由は挙げない
    if (hasMate) {
        return { level: 'mate', winner: mate > 0 ? 'sente' : 'gote', mate: Math.abs(mate), reasons: [], counter: null, note: null }
    }
    const engineScore = score

    if (engineScore === null || engineScore === undefined) return null

    if (Math.abs(engineScore) < EVEN_LIMIT) {
        // 互角: それぞれの側の一番大きな要因を挙げて、釣り合っていることを示す
        const reasons = []
        for (const owner of OWNERS) {
            const sign = owner === 'sente' ? 1 : -1
            const best = entries
                .filter(([f, v]) => f !== 'tempo' && v * sign >= MIN_REASON)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]
            const reason = best && reasonFor(best[0], analysis, position, owner, weights)
            if (reason) reasons.push(reason)
        }
        return { level: 'even', winner: null, mate: null, reasons, counter: null, note: null }
    }

    const winner = engineScore > 0 ? 'sente' : 'gote'
    const sign = engineScore > 0 ? 1 : -1
    const reasons = entries
        .filter(([f, v]) => f !== 'tempo' && v * sign >= MIN_REASON)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 3)
        .map(([f]) => reasonFor(f, analysis, position, winner, weights))
        .filter(Boolean)

    // 評価と逆向きの大きな要因は「一方で」として添える（例: 駒損だが玉が堅い）
    const counterEntry = entries
        .filter(([f, v]) => f !== 'tempo' && -v * sign >= 100)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]
    const counter = counterEntry && reasons.length
        ? reasonFor(counterEntry[0], analysis, position, opponent(winner), weights)
        : null

    let note = null
    if (!reasons.length) note = Math.abs(engineScore) < SLIGHT_LIMIT ? 'small-difference' : 'deep-reading'
    return {
        level: hasMate ? 'mate' : levelFor(engineScore),
        winner,
        mate: hasMate ? Math.abs(mate) : null,
        reasons,
        counter,
        note,
    }
}

// 指し手の効果。ren は「〜し」のようにつなぐ形、end は「〜する」の言い切りの形
function effect(kind, ren, end, squares, tone = 'good') {
    return { kind, ren, end, text: end, tone, squares: squares.filter(Boolean).map((s) => ({ row: s.row, col: s.col })) }
}

// 解説に挙げる順番。数が小さいほど先に書く（最大3つまで）
const EFFECT_PRIORITY = {
    'escape-king': 0, escape: 1, cut: 1, capture: 2, promote: 2, check: 3, fork: 4, tesuji: 4, prevent: 5, strip: 6,
    target: 7, 'pawn-contact': 8, 'block-line': 9, 'open-line': 10, protect: 11, 'defend-zone': 12,
    guard: 13, 'king-safety': 13, pressure: 14, activate: 15, 'drop-place': 16, feature: 30,
}

// ---- 「仮に相手が指さなかったら」の狙いの探索 ----
// 速さのため、候補手ごとに局面全体は分析し直さず、駒の取り合い・両取り・成り・王手だけを軽く判定する

const PROMOTABLE = ['FU', 'KY', 'KE', 'GI', 'KA', 'HI']
// 狙いとして挙げる最低限の得（だいたい銀1枚分）
const THREAT_MIN = 300

function canPromoteMove(piece, fromRow, toRow) {
    if (piece.promoted || !PROMOTABLE.includes(piece.type)) return false
    return isEnemyCamp(piece.owner, fromRow) || isEnemyCamp(piece.owner, toRow)
}

function mustPromote(piece, toRow) {
    const last = piece.owner === 'sente' ? toRow === 0 : toRow === 8
    const lastTwo = piece.owner === 'sente' ? toRow <= 1 : toRow >= 7
    return ((piece.type === 'FU' || piece.type === 'KY') && last) || (piece.type === 'KE' && lastTwo)
}

function candidateMoves(board, hands, owner) {
    const moves = []
    forEachPiece(board, (piece, row, col) => {
        if (piece.owner !== owner) return
        for (const to of attacksFrom(board, row, col)) {
            const target = board[to.row][to.col]
            if (target && (target.owner === owner || target.type === 'OU')) continue
            const base = { owner, type: piece.type, from: { row, col }, to, drop: false, pieceWasPromoted: piece.promoted }
            if (!mustPromote(piece, to.row)) moves.push({ ...base, promotes: false })
            if (canPromoteMove(piece, row, to.row)) moves.push({ ...base, promotes: true })
        }
    })
    const pawnFiles = new Set()
    forEachPiece(board, (piece, row, col) => {
        if (piece.owner === owner && piece.type === 'FU' && !piece.promoted) pawnFiles.add(col)
    })
    for (const [type, count] of Object.entries(hands[owner] ?? {})) {
        if (!count) continue
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                if (board[row][col]) continue
                const piece = { type, owner, promoted: false }
                if (mustPromote(piece, row) || (type === 'FU' && pawnFiles.has(col))) continue
                moves.push({ owner, type, from: null, to: { row, col }, drop: true, promotes: false, pieceWasPromoted: false })
            }
        }
    }
    return moves
}

function threatContext(board) {
    return { counts: computeAttackCounts(board), attackers: attackersBySquare(board) }
}

// 候補手1つの「狙い」としての価値を見積もる
function evaluateThreat(board, move, context) {
    const owner = move.owner
    const enemy = opponent(owner)
    const original = move.drop ? null : board[move.from.row][move.from.col]
    const moving = move.drop
        ? { type: move.type, owner, promoted: false }
        : { ...original, promoted: original.promoted || move.promotes }
    const captured = board[move.to.row][move.to.col]

    // 一時的に盤を動かして、動かした先の利きを調べる
    if (!move.drop) board[move.from.row][move.from.col] = null
    board[move.to.row][move.to.col] = moving
    const hits = attacksFrom(board, move.to.row, move.to.col)
    board[move.to.row][move.to.col] = captured
    if (!move.drop) board[move.from.row][move.from.col] = original

    const toKey = move.to.row * 9 + move.to.col
    const value = (piece) => (piece.type === 'OU' ? KING_EXCHANGE_VALUE : pieceValue(piece))
    const enemyHits = context.counts[enemy][move.to.row][move.to.col]
    // 動かす駒自身がもともと利いていた分は支えに数えない
    const selfSupport = !move.drop && attacksFrom(board, move.from.row, move.from.col).some((a) => a.row * 9 + a.col === toKey) ? 1 : 0
    const ownSupport = context.counts[owner][move.to.row][move.to.col] - selfSupport
    let risk = 0
    if (enemyHits) {
        const cheapest = (context.attackers[enemy].get(toKey) ?? [])[0]?.piece
        risk = ownSupport > 0 ? Math.max(0, pieceValue(moving) - (cheapest ? value(cheapest) : 0)) : pieceValue(moving)
    }
    const gain = (captured ? pieceValue(captured) : 0)
        + (move.promotes ? PROMOTED_VALUES[moving.type] - BASE_VALUES[moving.type] : 0)

    let check = false
    const targets = []
    for (const hit of hits) {
        const piece = board[hit.row][hit.col]
        if (!piece || piece.owner !== enemy || (hit.row === move.to.row && hit.col === move.to.col)) continue
        if (piece.type === 'OU') {
            check = true
            continue
        }
        // 両取り・王手○取りは歩以外の駒に使う言葉なので、成っていない歩は狙いの対象に数えない
        if (piece.type === 'FU' && !piece.promoted) continue
        const defended = context.counts[enemy][hit.row][hit.col] > 0
        if (!defended || pieceValue(piece) > pieceValue(moving)) targets.push({ row: hit.row, col: hit.col, piece })
    }
    targets.sort((a, b) => pieceValue(b.piece) - pieceValue(a.piece))
    const net = gain - risk
    // 両取りは、かけた駒が取られない（取れるのが玉だけで、こちらの駒が支えている場合を含む）ときだけ成り立つ
    const enemyAttackers = context.attackers[enemy].get(toKey) ?? []
    const onlyKing = enemyAttackers.length > 0 && enemyAttackers.every((a) => a.piece.type === 'OU')
    const forkHolds = !enemyAttackers.length || (onlyKing && ownSupport > 0)

    if (forkHolds && check && targets.length) return { kind: 'check-fork', score: net + pieceValue(targets[0].piece), targets, captured, moving, check }
    if (forkHolds && targets.length >= 2) return { kind: 'fork', score: net + pieceValue(targets[1].piece), targets, captured, moving, check }
    if (captured) return { kind: 'capture', score: net, targets, captured, moving, check }
    if (move.promotes) return { kind: 'promote', score: net, targets, captured, moving, check }
    return { kind: 'none', score: net, targets, captured, moving, check }
}

function moveNotation(move) {
    const marker = move.owner === 'sente' ? '▲' : '△'
    const name = move.pieceWasPromoted ? PROMOTED_NAMES[move.type] : PIECE_NAMES[move.type]
    const suffix = move.drop ? '打' : move.promotes ? '成' : ''
    return `${marker}${squareName(move.to.row, move.to.col)}${name === '玉' ? '玉' : name}${suffix}`
}

// 探索では盤を一時的に書き換えるので、画面の（Vue のリアクティブな）盤面を直接触らないようコピーする
function plainBoard(board) {
    return board.map((row) => row.map((piece) => piece && { ...piece }))
}

// owner が（手番に関係なく）次に指せたら一番得をする手
export function findThreat(position, owner) {
    const board = plainBoard(position.board)
    const context = threatContext(board)
    let best = null
    for (const move of candidateMoves(board, position.hands, owner)) {
        const result = evaluateThreat(board, move, context)
        if (result.kind === 'none') continue
        if (!best || result.score > best.score) best = { ...result, move }
    }
    return best && best.score >= THREAT_MIN ? { ...best, notation: moveNotation(best.move) } : null
}

function sameMove(a, b) {
    return a && b && a.to.row === b.to.row && a.to.col === b.to.col && a.drop === b.drop && a.promotes === b.promotes
        && (a.drop ? a.type === b.type : a.from.row === b.from.row && a.from.col === b.from.col)
}

// 狙いを「▲３九馬が飛車と銀の両取りになる」のような節にする
function threatClause(threat) {
    const n = threat.notation
    const targets = threat.targets.slice(0, 2).map(pieceAt)
    if (threat.kind === 'check-fork') return `${n}が王手${textName(threat.targets[0].piece)}取りになる`
    if (threat.kind === 'fork') return `${n}が${targets.join('と')}の両取りになる`
    if (threat.kind === 'capture') return `${n}で${textName(threat.captured)}を取る`
    if (threat.moving.type === 'FU') return `${n}でと金を作る`
    return `${n}と成り込む`
}

function threatSquares(threat) {
    return [threat.move.to, ...threat.targets.slice(0, 2)]
}

function forward(owner, from, to) {
    return owner === 'sente' ? to.row < from.row : to.row > from.row
}

function nearKing(square, king, distance = 2) {
    return king && Math.max(Math.abs(square.row - king.row), Math.abs(square.col - king.col)) <= distance
}

// 指し手で何が変わったか。prev と curr は { board, hands, sideToMove }
// options.recapture: 直前に相手が駒を取ったマスで取り返す手か
export function explainMove(prev, curr, move, options = {}) {
    if (!prev || !curr || !move) return []
    const mover = move.owner
    const enemy = opponent(mover)
    const before = analyzePosition(prev.board, prev.hands, prev.sideToMove)
    const after = analyzePosition(curr.board, curr.hands, curr.sideToMove)
    // 指した後も自玉に王手がかかったまま（王手放置の反則）の手は、王手をかわしたなどと事実と違うことを書かないよう解説しない
    if (after.side[mover].inCheck) return []
    const items = []
    const to = move.to
    const moved = curr.board[to.row][to.col]
    const key = (t) => t.row * 9 + t.col
    const fromPiece = move.from ? prev.board[move.from.row][move.from.col] : null
    const taken = !move.drop && prev.board[to.row][to.col]
    const ownKingAfter = after.side[mover].detail.ownKing

    // 取る・成る（成りは将棋の言い方で意味を添える）
    if (moved && !move.drop) {
        const promoted = moved.promoted && fromPiece && !fromPiece.promoted
        const name = taken ? textName(taken) : ''
        // 取る手の活用: 取り（つなぐ）/ 取る（言い切り）/ 取って（て形）。取り返す手も同様
        const takeRen = options.recapture ? `${name}を取り返し` : `${name}を取り`
        const takeEnd = options.recapture ? `${name}を取り返す` : `${name}を取る`
        const take = options.recapture ? `${name}を取り返し` : `${name}を取っ`
        if (promoted && moved.type === 'FU') {
            // 「拠点」は、相手玉の近くに簡単には取られないように置いた駒のこと
            const enemyKing = after.side[enemy].detail.ownKing
            const safe = !after.side[mover].threatened.some((t) => t.row === to.row && t.col === to.col)
            const base = safe && nearKing(to, enemyKing, 3)
            items.push(taken
                ? effect('promote', `${take}てと金を作り`, `${take}てと金を作る`, [to], 'info')
                : base
                    ? effect('promote', 'と金を作って攻めの拠点を築き', 'と金を作って攻めの拠点を築く', [to])
                    : effect('promote', 'と金を作り', 'と金を作る', [to]))
        } else if (promoted && (moved.type === 'KA' || moved.type === 'HI')) {
            const hits = attacksFrom(curr.board, to.row, to.col)
            const both = hits.some((h) => isEnemyCamp(mover, h.row)) && hits.some((h) => nearKing(h, ownKingAfter))
            const name = `${both ? '攻防に働く' : ''}${textName(moved)}`
            items.push(taken
                ? effect('promote', `${take}て${name}を作り`, `${take}て${name}を作る`, [to], 'info')
                : effect('promote', `${name}を作り`, `${name}を作る`, [to]))
        } else if (promoted) {
            items.push(taken
                ? effect('capture', `${take}て${textName(moved)}に成り`, `${take}て${textName(moved)}に成る`, [to], 'info')
                : effect('promote', `${textName(moved)}に成り`, `${textName(moved)}に成る`, [to], 'info'))
        } else if (taken) {
            items.push(effect('capture', takeRen, takeEnd, [to], 'info'))
        }
    }

    // 玉の動き
    if (moved?.type === 'OU') {
        if (before.side[mover].inCheck) {
            // 王手をかけていた駒を玉で取る手は「かわす」ではなく、その駒を取ったと言う（両王手は除く。玉で取ったことは符号でわかる）
            const from = move.from
            const checkers = computeAttackCounts(prev.board)[enemy][from.row][from.col]
            const tookChecker = taken && checkers === 1
                && attacksFrom(prev.board, to.row, to.col).some((h) => h.row === from.row && h.col === from.col)
            if (tookChecker) {
                const capture = items.findIndex((item) => item.kind === 'capture')
                if (capture >= 0) items.splice(capture, 1)
                const took = options.recapture ? '取り返し' : '取り'
                items.push(effect('escape-king', `王手をかけていた${textName(taken)}を${took}`, `王手をかけていた${textName(taken)}を${took.replace(/し$/, 'す').replace(/り$/, 'る')}`, [to]))
            } else {
                items.push(effect('escape-king', '王手をかわし', '王手をかわす', [to]))
            }
        } else if (before.side[mover].ringAttacked - after.side[mover].ringAttacked >= 2) {
            items.push(effect('king-safety', '玉を早逃げして危険を避け', '玉を早逃げして危険を避ける', [to]))
        }
    }

    if (after.side[enemy].inCheck) {
        items.push(effect('check', '王手をかけ', '王手をかける', [after.side[enemy].detail.ownKing]))
    }

    // 相手玉の守り駒を取った
    if (taken && before.side[enemy].guards > after.side[enemy].guards) {
        items.push(effect('strip', '相手玉の守り駒をはがし', '相手玉の守り駒をはがす', [to]))
    }

    // 動かした駒以外の大駒の利きの変化（角道が開いた、相手の飛車を止めた など）
    const mobilityAt = (analysis, owner) => new Map(analysis.side[owner].detail.majors.map((m) => [m.row * 9 + m.col, m]))
    const majorsBefore = { [mover]: mobilityAt(before, mover), [enemy]: mobilityAt(before, enemy) }
    for (const m of after.side[mover].detail.majors) {
        if (m.row === to.row && m.col === to.col) continue
        const old = majorsBefore[mover].get(m.row * 9 + m.col)
        if (old && m.squares.length - old.squares.length >= 3) {
            // 「角道を開ける」は、初期位置の角の前の歩を突く手（▲７六歩・△３四歩）に使う言葉
            items.push(isInitialBishop(m)
                ? effect('open-line', '角道を開け', '角道を開ける', [m])
                : effect('open-line', `${pieceAt(m)}の利きを通し`, `${pieceAt(m)}の利きを通す`, [m]))
        }
    }
    // 相手の大駒の利きを遮った。自分の駒に当たっていた利きを止めたときは、その駒を守ったことも言う
    const ownPieceAt = (sq) => {
        const piece = curr.board[sq.row][sq.col]
        return piece && piece.owner === mover && !(sq.row === to.row && sq.col === to.col)
    }
    for (const m of after.side[enemy].detail.majors) {
        const old = majorsBefore[enemy].get(m.row * 9 + m.col)
        if (!old) continue
        const stillHits = new Set(m.squares.map((sq) => sq.row * 9 + sq.col))
        // 「守る」は取られる状態を解消したときの言葉。ひもが付いていて取られる心配のない駒に利きを遮っても
        // 守ったとは言わない。指す前に取られる状態（タダ、または取られると損）だった駒が、指した後に解消されたものだけ数える。
        // 歩を守っただけでは目的として弱いので、歩より大きな駒に限る。玉は合駒の判定に使う
        const wasThreatened = new Set(before.side[mover].threatened.map(key))
        const isThreatened = new Set(after.side[mover].threatened.map(key))
        const shielded = old.squares.filter((sq) => ownPieceAt(sq) && !stillHits.has(sq.row * 9 + sq.col))
            .map((sq) => ({ row: sq.row, col: sq.col, piece: curr.board[sq.row][sq.col] }))
            .filter((sq) => sq.piece.type === 'OU'
                || (pieceValue(sq.piece) > BASE_VALUES.FU && wasThreatened.has(key(sq)) && !isThreatened.has(key(sq))))
        const name = textName(m.piece)
        // 「止める」は利きが通っていたところをふさぐ手の言葉。もともと利きを受け止めていた駒が
        // 同じ筋を前に出ても（▲８八銀→▲８七銀）、利きが短くなるだけで止めたとは言わない
        const wasBlocking = Boolean(move.from) && old.squares.some((sq) => sq.row === move.from.row && sq.col === move.from.col)
        if (shielded.length && shielded[0].piece.type === 'OU' && before.side[mover].inCheck) {
            // 王手を駒で遮る手は「合駒」と言う
            const name = textName(moved)
            items.push(effect('block-line', `${name}を合駒にして王手を防ぎ`, `${name}を合駒にして王手を防ぐ`, [m, to]))
        } else if (shielded.length) {
            const target = pieceAt(shielded[0])
            items.push(effect('block-line', `相手の${name}の利きを止めて${target}を守り`, `相手の${name}の利きを止めて${target}を守る`, [m, shielded[0]]))
        } else if (wasBlocking) {
            continue
        } else if (old.squares.length > m.squares.length && m.squares.some((sq) => sq.row === to.row && sq.col === to.col)) {
            // 指した駒が通り道に入って遮った。将棋の言い方に合わせて「角道」「飛車先」と呼ぶ
            if (isInitialBishop(m)) {
                items.push(effect('block-line', '相手の角道を止め', '相手の角道を止める', [m, to]))
            } else if (m.piece.type === 'HI' && !m.piece.promoted && m.col === to.col && m.col === (m.piece.owner === 'sente' ? 7 : 1)) {
                items.push(effect('block-line', '相手の飛車先を止め', '相手の飛車先を止める', [m, to]))
            } else {
                items.push(effect('block-line', `相手の${name}の利きを止め`, `相手の${name}の利きを止める`, [m, to]))
            }
        } else if (old.squares.length - m.squares.length >= 3) {
            items.push(effect('block-line', `相手の${name}の利きを止め`, `相手の${name}の利きを止める`, [m]))
        }
    }

    // 新しく狙えるようになった相手の駒
    const oldTargets = new Set(before.side[enemy].threatened.map(key))
    // 歩一枚の当たりまで挙げると騒がしいので、歩より大きな損になる駒だけを数える
    const freshTargets = after.side[enemy].threatened.filter((t) => !oldTargets.has(key(t)) && t.loss > BASE_VALUES.FU)
    // 「〜に狙いをつける」は、動かした駒そのものが当たる相手の駒に使う。
    // 動かしたことで後ろの大駒の利きが通って当たった駒（空き当たり）は、その大駒の利きとして別に書く
    const movedHits = moved ? attacksFrom(curr.board, to.row, to.col) : []
    const newTargets = freshTargets.filter((t) => movedHits.some((sq) => key(sq) === key(t)))
    const discovered = freshTargets.filter((t) => !newTargets.includes(t)).map((t) => {
        let by = null
        forEachPiece(curr.board, (piece, row, col) => {
            if (by || piece.owner !== mover || (row === to.row && col === to.col)) return
            const hitsNow = attacksFrom(curr.board, row, col).some((sq) => key(sq) === key(t))
            const hitBefore = prev.board[row][col] === piece || prev.board[row][col]?.type === piece.type
                ? attacksFrom(prev.board, row, col).some((sq) => key(sq) === key(t)) : false
            if (hitsNow && !hitBefore) by = { row, col, piece }
        })
        return by ? { target: t, by } : null
    }).filter(Boolean)
    // 王手を防ぐために打った歩は合駒なので、手筋の名前は付けない
    const pawnTesuji = move.drop && moved?.type === 'FU' && !before.side[mover].inCheck ? dropPawnTesuji(curr.board, to, mover) : null
    if (pawnTesuji) {
        // 形で名前の決まる歩の手筋（焦点の歩・叩きの歩・垂れ歩）は、その名前で書く
        items.push(pawnTesuji)
    } else if (newTargets.length >= 2 && forkPieceSafe(curr.board, to, mover)) {
        // 「両取り」は2枚に使う言葉なので、価値の高い2枚を挙げる
        const pair = [...newTargets].sort((a, b) => pieceValue(b.piece) - pieceValue(a.piece)).slice(0, 2)
        const list = pair.map(pieceAt).join('と')
        // 桂の両取りは「ふんどしの桂」、打った銀が斜め後ろの2枚に当たる両取りは「割り打ちの銀」と呼ぶ
        const back = (t) => t.row === to.row + (mover === 'sente' ? 1 : -1) && Math.abs(t.col - to.col) === 1
        const name = moved?.type === 'KE' && !moved.promoted ? 'ふんどしの桂で'
            : moved?.type === 'GI' && !moved.promoted && move.drop && pair.every(back) ? '割り打ちの銀で' : ''
        items.push(effect('fork', `${name}${list}に両取りをかけ`, `${name}${list}に両取りをかける`, pair))
    } else if (newTargets.length >= 2) {
        // 当てた駒自体が取られるなら両取りとは言わず、狙いをつけただけと書く
        const list = newTargets.slice(0, 2).map(pieceAt).join('と')
        items.push(effect('target', `${list}に狙いをつけ`, `${list}に狙いをつける`, newTargets.slice(0, 2)))
    } else if (newTargets.length === 1) {
        const target = pieceAt(newTargets[0])
        items.push(effect('target', `${target}に狙いをつけ`, `${target}に狙いをつける`, newTargets))
    } else if (moved?.type === 'FU' && !moved.promoted && !taken) {
        const hit = attacksFrom(curr.board, to.row, to.col)
            .map((sq) => ({ ...sq, piece: curr.board[sq.row][sq.col] }))
            .find((sq) => sq.piece && sq.piece.owner === enemy && sq.piece.type !== 'OU')
        if (hit && move.drop) {
            // 打った歩が相手の駒に当たる手（合わせの歩など）は、歩でも目的として挙げる
            items.push(effect('target', `${pieceAt(hit)}に歩を当て`, `${pieceAt(hit)}に歩を当てる`, [hit]))
        } else if (hit && hit.piece.type === 'FU') {
            // 突いた歩を相手の歩にぶつける（仕掛け・歩交換）
            const file = FILE_LABELS[to.col]
            // 「仕掛け」は開戦の最初の攻めを指す言葉なので使わず、「歩をぶつける」と言う
            items.push(effect('pawn-contact', `${file}筋の歩をぶつけ`, `${file}筋の歩をぶつける`, [to, hit]))
        }
    }

    if (discovered.length) {
        const { target, by } = discovered[0]
        // 同じ大駒の「利きを通す」は、狙いと合わせて一度に書く
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].kind === 'open-line' && items[i].squares.some((sq) => key(sq) === key(by))) items.splice(i, 1)
        }
        items.push(effect('target', `${pieceAt(by)}の利きを通して${pieceAt(target)}に狙いをつけ`,
            `${pieceAt(by)}の利きを通して${pieceAt(target)}に狙いをつける`, [by, target]))
    }

    // 王手をかけた駒が飛車や角にも当たっていれば「王手飛車取り」「王手角取り」と呼ぶ
    if (moved && after.side[enemy].inCheck) {
        const hits = attacksFrom(curr.board, to.row, to.col)
        const major = hits.map((sq) => ({ ...sq, piece: curr.board[sq.row][sq.col] }))
            .find((sq) => sq.piece?.owner === enemy && !sq.piece.promoted && (sq.piece.type === 'HI' || sq.piece.type === 'KA'))
        const kingHit = hits.some((sq) => curr.board[sq.row][sq.col]?.owner === enemy && curr.board[sq.row][sq.col].type === 'OU')
        if (major && kingHit) {
            const name = major.piece.type === 'HI' ? '飛車' : '角'
            const king = after.side[enemy].detail.ownKing
            for (let i = items.length - 1; i >= 0; i--) {
                if (['check', 'fork', 'target'].includes(items[i].kind)) items.splice(i, 1)
            }
            items.push(effect('fork', `王手${name}取りをかけ`, `王手${name}取りをかける`, [king, major]))
        }
    }

    // 当たっていた駒を動かした。取られない場所へ動けば「かわす」、
    // 取られる場所へ飛び込んで駒を取ったり王手をかけたりすれば、その駒を「切る」
    let cutPiece = false
    if (move.from && moved && moved.type !== 'OU') {
        const wasThreatened = before.side[mover].threatened.find((t) => key(t) === key(move.from))
        const stillThreatened = after.side[mover].threatened.some((t) => key(t) === key(to))
        const name = textName(fromPiece)
        // 当たっていた相手の駒そのものを取った手は「かわす」ではなく、ただ「取る」
        const tookAttacker = taken && attacksFrom(prev.board, to.row, to.col).some((sq) => key(sq) === key(move.from))
        if (tookAttacker) {
            if (stillThreatened && pieceValue(taken) < pieceValue(fromPiece) && isMajor(fromPiece)) {
                // 取った先で取り返され、大駒を小駒と交換する（飛車で金を取る など）。「切る」は大駒に使う言葉
                cutPiece = true
                items.push(effect('cut', `${name}を切り`, `${name}を切る`, [to]))
            }
        } else if (wasThreatened && wasThreatened.loss > BASE_VALUES.FU && !stillThreatened) {
            // 中継の解説にならい「かわす」と言う
            items.push(effect('escape', `当たっていた${name}をかわし`, `当たっていた${name}をかわす`, [to]))
        } else if (wasThreatened && wasThreatened.loss > BASE_VALUES.FU && (taken || after.side[enemy].inCheck)) {
            if (taken && pieceValue(taken) >= pieceValue(fromPiece)) {
                cutPiece = true
                // 取られる場所でも、同等以上の駒を取るなら「切る」ではなく「当たっていた銀で角を取る」
                const capture = items.find((item) => item.kind === 'capture' || item.kind === 'promote')
                if (capture) {
                    capture.ren = `当たっていた${name}で${capture.ren}`
                    capture.end = `当たっていた${name}で${capture.end}`
                    capture.text = capture.end
                }
            } else if (isMajor(fromPiece)) {
                cutPiece = true
                items.push(effect('cut', `当たっていた${name}を切り`, `当たっていた${name}を切る`, [to]))
            }
            // 小駒を渡す手は「切る」とは言わず、取られる形として書く（評価しだいで「捨てて踏み込んだ」になる）
        }
    }

    // 取られそうだった自分の駒を守った（動かした駒は除く）
    const movedFrom = move.from ? key(move.from) : -1
    const alreadyShielded = new Set(items.filter((item) => item.kind === 'block-line').flatMap((item) => item.squares.map(key)))
    const protectable = before.side[mover].threatened.filter((t) => (
        !alreadyShielded.has(key(t))
        && key(t) !== movedFrom
        && curr.board[t.row][t.col] === t.piece
        && !after.side[mover].threatened.some((u) => key(u) === key(t))
    ))
    // 歩を守る手は、ほかに目的がないときだけ挙げる（「当然、２四の歩を守る」）
    const protectedPieces = protectable.filter((t) => t.loss > BASE_VALUES.FU)
    const protectedList = protectedPieces.length ? protectedPieces : (items.length ? [] : protectable)
    if (protectedList.length) {
        const list = protectedList.slice(0, 2).map(pieceAt).join('と')
        items.push(effect('protect', `${list}を守り`, `${list}を守る`, protectedList.slice(0, 2)))
    }

    // 受けに利かせる: 自玉の近くで相手が利かせているマスに、新しく利きを足した
    if (move.from && moved && moved.type !== 'OU' && !taken && ownKingAfter) {
        const oldHits = new Set(attacksFrom(prev.board, move.from.row, move.from.col).map(key))
        const newHits = attacksFrom(curr.board, to.row, to.col)
            .filter((h) => !oldHits.has(key(h)) && nearKing(h, ownKingAfter) && after.attackCounts[enemy][h.row][h.col] > 0)
        if (newHits.length >= 2) {
            const name = sideName(moved, move.from, mover)
            items.push(effect('defend-zone', `${name}を受けに利かせ`, `${name}を受けに利かせる`, newHits))
        }
    }

    // 玉の周り
    if (moved?.type !== 'OU' && after.side[mover].guards > before.side[mover].guards) {
        items.push(effect('guard', '玉の守りを固め', '玉の守りを固める', after.side[mover].detail.guards))
    } else if (moved?.type === 'OU' && after.side[mover].guards > before.side[mover].guards
        // 王手への対応や駒を取った玉の移動、相手の攻めが迫る中での玉の移動は「囲いに入れる」とは言わない
        && !before.side[mover].inCheck && !taken && before.side[mover].ringAttacked <= 1) {
        items.push(effect('guard', '玉を囲いの中に入れ', '玉を囲いの中に入れる', after.side[mover].detail.guards))
    } else if (
        // 玉自身が動いても周りが補強されたとは言わない
        moved?.type !== 'OU'
        && after.side[mover].ringDefense - before.side[mover].ringDefense >= 2
        && nearKing(to, ownKingAfter)
    ) {
        items.push(effect('guard', '玉の周りを補強し', '玉の周りを補強する', [to]))
    }
    if (after.side[enemy].ringAttacked - before.side[enemy].ringAttacked >= 2 && !after.side[enemy].inCheck) {
        items.push(effect('pressure', '相手玉に迫り', '相手玉に迫る', after.side[enemy].detail.ring))
    }

    // 自陣で眠っていた駒が働き出す手は「活用」と言う
    if (move.from && moved && moved.type !== 'OU' && !move.drop && !taken) {
        const homeRow = mover === 'sente' ? move.from.row >= 6 : move.from.row <= 2
        const beforeHits = attacksFrom(prev.board, move.from.row, move.from.col).length
        const afterHits = attacksFrom(curr.board, to.row, to.col).length
        const knight = moved.type === 'KE' && !moved.promoted
        // 自陣の中での駒組み（囲いなど）は活用とは言わないので、桂以外は自陣の外へ出た手に限る
        const leftCamp = mover === 'sente' ? to.row <= 5 : to.row >= 3
        if (homeRow && forward(mover, move.from, to) && (knight || (leftCamp && afterHits - beforeHits >= 2))
            && !items.some((item) => item.kind === 'escape')) {
            items.push(effect('activate', `${sideName(moved, move.from, mover)}を活用し`, `${sideName(moved, move.from, mover)}を活用する`, [to]))
        }
    }

    // 相手の狙いを防いだ: 指す前に相手が次に指せた得な手が、指した後には成立しない
    // 王手を受けていた手では、相手の「狙い」を防ぐという考え方は当てはまらない。
    // また、その局面で相手に手番を渡すと玉を取れる反則の局面になり、エンジンで確かめられない
    const threatBefore = before.side[mover].inCheck ? null : findThreat(prev, enemy)
    if (threatBefore) {
        const coveredByEscape = threatBefore.captured && move.from && key(threatBefore.move.to) === key(move.from)
        const capturedAttacker = !threatBefore.move.drop && key(threatBefore.move.from) === key(to)
        const stillWorks = findThreatMove(curr, threatBefore.move)
        if (!coveredByEscape && !capturedAttacker && (!stillWorks || stillWorks.score < THREAT_MIN)) {
            // threatUsi は、指す前の局面で相手のこの狙いが本当に好手だったかをエンジンで確かめるために使う
            items.push({
                ...effect('prevent', `${threatBefore.notation}を防ぎ`, `${threatBefore.notation}を防ぐ`, threatSquares(threatBefore)),
                threatUsi: moveToUsi(threatBefore.move),
            })
        }
    }

    // 打ち駒で目的が見つからないときは、置いた場所から狙いを推し量る
    if (move.drop && moved && !items.length) {
        const purpose = dropPurpose(curr, moved, to, mover, after)
        if (purpose) items.push(purpose)
    }

    // ほかに書くことがない手でも、駒の動きの特徴と想定される意図を書く
    if (!items.length && moved) {
        const feature = quietFeature(prev, curr, move, moved, fromPiece, mover, before, after)
        if (feature) items.push(feature)
    }

    items.sort((a, b) => (EFFECT_PRIORITY[a.kind] ?? 20) - (EFFECT_PRIORITY[b.kind] ?? 20))
    const result = items.slice(0, 3)
    const forcing = Boolean(taken) || after.side[enemy].inCheck

    // 注意: 取られる形になった駒、薄くなった自玉
    const oldRisks = new Set(before.side[mover].threatened.map(key))
    // 歩を突いて当たりになるのは普通のことなので、歩より大きな損になる駒だけを注意する
    const newRisks = after.side[mover].threatened.filter((t) => (!oldRisks.has(key(t)) || key(t) === key(to)) && t.loss > BASE_VALUES.FU)
    // 「切る」と書いた駒は、取られるのを承知で指しているので注意しない（交換になる場合は交換として書く）
    const exchanged = taken && fromPiece && pieceValue(taken) >= pieceValue(fromPiece)
    const risks = cutPiece && !exchanged ? newRisks.filter((t) => key(t) !== key(to)) : newRisks
    if (risks.length) {
        const list = risks.slice(0, 2).map(pieceAt).join('と')
        const hanging = effect('hanging', `${list}が取られる形になり`, `${list}が取られる形になる`, risks.slice(0, 2), 'warn')
        // 動かした駒そのものが取られる形なら、評価しだいで「捨てて踏み込んだ手」と言える
        const own = risks.find((t) => key(t) === key(to))
        if (own) {
            // 攻めの手か受けの手か（捨てる手の言い方を変える）。王手・守り駒をはがす・狙い・相手玉に迫る・成るといった
            // 攻めの効果があるか、相手陣の側（盤の半分より先）に指していれば攻めとみなす
            const attackKinds = ['check', 'fork', 'tesuji', 'strip', 'pressure', 'target', 'pawn-contact', 'promote']
            const enemyHalf = mover === 'sente' ? to.row <= 3 : to.row >= 5
            const attacking = items.some((item) => attackKinds.includes(item.kind)) || enemyHalf
            hanging.sacrifice = { square: squareName(to.row, to.col), name: textName(own.piece), drop: Boolean(move.drop), forcing, attacking }
            // 駒を取った手なら、取り返されたときの駒の交換として言える
            if (taken && fromPiece) {
                hanging.sacrifice.exchange = {
                    taken: textName(taken), takenValue: pieceValue(taken),
                    given: TEXT_NAMES[fromPiece.type], givenValue: pieceValue(fromPiece),
                }
            }
        }
        result.push(hanging)
    } else if (moved?.type !== 'OU' && fromPiece && nearKing(move.from, before.side[mover].detail.ownKing)
        && after.side[mover].guards < before.side[mover].guards
        // 序盤の駒組みで金銀が動くのは普通なので、相手の利きが玉の周りに来ているときだけ注意する
        && after.side[mover].ringAttacked >= 2) {
        result.push(effect('thin', '玉の守りが薄くなり', '玉の守りが薄くなる', before.side[mover].detail.guards, 'warn'))
    }

    // 次の狙い: 指した後に、もう一手指せたら得をする手（指す前にはなかったもの）。
    // 王手をかけた手では、相手はまず王手に応じるしかないので書かない
    const threatAfter = after.side[enemy].inCheck ? null : findThreat(curr, mover)
    if (threatAfter) {
        const existed = findThreat(prev, mover)
        if (!existed || !sameMove(existed.move, threatAfter.move)) {
            const clause = threatClause(threatAfter)
            // threatUsi は、相手が何もしなかった局面でこの手が本当に好手かをエンジンで確かめるために使う
            result.push({ kind: 'next', threatKind: threatAfter.kind, threatUsi: moveToUsi(threatAfter.move), clause, text: clause, squares: threatSquares(threatAfter).map((s) => ({ row: s.row, col: s.col })), tone: 'good' })
        }
    }
    return result
}

// 両取りをかけた駒が相手に取られないか。取れるのが玉だけで、こちらの駒がその地点を支えていれば取られない
// 打った歩の形で名前の決まる手筋。
// 焦点の歩: 相手の駒の利きが2つ以上集まるマスに打つ（どれで取っても形が崩れる急所）
// 叩きの歩: 相手の金・銀・桂・香の頭に打ち、その駒で取らせて位置をずらす（飛車や角を追う歩は叩きと呼ばない）
// 垂れ歩: 前が空いた敵陣の手前に、取られない形で打ち、次に成る
function dropPawnTesuji(board, to, owner) {
    const enemy = opponent(owner)
    const attackers = []
    forEachPiece(board, (piece, row, col) => {
        if (piece.owner !== enemy || piece.type === 'OU') return
        if (attacksFrom(board, row, col).some((sq) => sq.row === to.row && sq.col === to.col)) attackers.push({ row, col, piece })
    })
    const front = { row: to.row + (owner === 'sente' ? -1 : 1), col: to.col }
    const ahead = insideBoard(front.row, front.col) ? board[front.row][front.col] : null
    if (attackers.length >= 2) {
        const list = `${pieceAt(attackers[0])}と${pieceAt(attackers[1])}`
        return effect('tesuji', `${list}の利きが集まる焦点に歩を打ち`, `${list}の利きが集まる焦点に歩を打つ`, [to, attackers[0], attackers[1]])
    }
    if (ahead && ahead.owner === enemy && !ahead.promoted && ['KI', 'GI', 'KE', 'KY'].includes(ahead.type)
        && attackers.some((sq) => sq.row === front.row && sq.col === front.col)) {
        const target = pieceAt({ ...front, piece: ahead })
        return effect('tesuji', `叩きの歩で${target}に当て`, `叩きの歩で${target}に当てる`, [to, front])
    }
    if (!ahead && insideBoard(front.row, front.col) && isEnemyCamp(owner, front.row) && !attackers.length) {
        return effect('tesuji', '垂れ歩を打ち', '垂れ歩を打つ', [to])
    }
    return null
}

function forkPieceSafe(board, square, owner) {
    const enemy = opponent(owner)
    const attackers = []
    let support = 0
    forEachPiece(board, (piece, row, col) => {
        if (row === square.row && col === square.col) return
        if (!attacksFrom(board, row, col).some((a) => a.row === square.row && a.col === square.col)) return
        if (piece.owner === enemy) attackers.push(piece)
        else support++
    })
    if (!attackers.length) return true
    return attackers.every((piece) => piece.type === 'OU') && support > 0
}

// 特定の手が、その局面でまだ狙いとして成り立つか
function findThreatMove(position, move) {
    const piece = move.drop ? null : position.board[move.from.row][move.from.col]
    if (!move.drop && (!piece || piece.owner !== move.owner || piece.type !== move.type)) return null
    if (move.drop && (!position.hands[move.owner]?.[move.type] || position.board[move.to.row][move.to.col])) return null
    const target = position.board[move.to.row][move.to.col]
    if (target && target.owner === move.owner) return null
    if (!move.drop && !attacksFrom(position.board, move.from.row, move.from.col).some((a) => a.row === move.to.row && a.col === move.to.col)) return null
    const board = plainBoard(position.board)
    return evaluateThreat(board, move, threatContext(board))
}

// 目立った効果のない手の特徴。意図の推測はアプリ側の判断になるので書かず、盤面の事実だけを書く
// （意図は、エンジンの読み筋から拾う「含み」に任せる）。戦型の名前も使わない
function quietFeature(prev, curr, move, moved, fromPiece, mover, before, after) {
    const to = move.to
    const file = FILE_LABELS[to.col]
    const square = squareName(to.row, to.col)
    const ownKing = after.side[mover].detail.ownKing
    const toward = (from) => (mover === 'sente' ? from.row - to.row : to.row - from.row)
    // restates: 指し手を言い直しているだけで、符号に添えても情報が増えない説明（次の一手では使わない）
    const say = (ren, end, restates = false) => ({ ...effect('feature', ren, end, [to]), restates })

    if (move.drop) {
        const name = TEXT_NAMES[moved.type]
        return say(`${square}に${name}を打ち`, `${square}に${name}を打つ`, true)
    }
    const from = move.from
    const forward = toward(from)

    if (moved.type === 'FU' && !moved.promoted) {
        // 桂が跳ねる地点を空けた（盤面の事実）
        const knightBehind = [[-2, -1], [-2, 1]].map(([dr, dc]) => {
            const r = mover === 'sente' ? from.row - dr : from.row + dr
            return { row: r, col: from.col + dc }
        }).find((sq) => insideBoard(sq.row, sq.col) && curr.board[sq.row][sq.col]?.owner === mover
            && curr.board[sq.row][sq.col].type === 'KE' && !curr.board[sq.row][sq.col].promoted)
        // 端の筋は、桂の地点が空いても「端歩を突く」と言うのが普通
        if (to.col === 0 || to.col === 8) return say('端歩を突き', '端歩を突く')
        if (knightBehind) return say(`${file}筋の歩を突いて桂の跳ねる地点を空け`, `${file}筋の歩を突いて桂の跳ねる地点を空ける`)
        // 「飛車先」は初期位置の筋（先手２筋・後手８筋）にいる飛車の前の歩
        const rookFile = mover === 'sente' ? 7 : 1
        const ownRookBehind = to.col === rookFile && curr.board.some((row, r) => {
            const piece = row[to.col]
            return piece?.owner === mover && piece.type === 'HI' && !piece.promoted && (mover === 'sente' ? r > to.row : r < to.row)
        })
        if (ownRookBehind) return say('飛車先の歩を伸ばし', '飛車先の歩を伸ばす')
        if (to.col === 0 || to.col === 8) return say('端歩を突き', '端歩を突く')
        // 「玉頭」は玉の上部（相手側）のこと
        const aboveKing = ownKing && (mover === 'sente' ? to.row < ownKing.row : to.row > ownKing.row)
        if (aboveKing && Math.abs(ownKing.col - to.col) <= 1 && Math.abs(ownKing.row - to.row) <= 2) return say('玉頭の歩を突き', '玉頭の歩を突く')
        if (to.row === 4) return say(`${file}筋の位を取り`, `${file}筋の位を取る`)
        return say(`${file}筋の歩を突き`, `${file}筋の歩を突く`, true)
    }
    if ((moved.type === 'KI' || moved.type === 'GI') && !moved.promoted) {
        const name = sideName(moved, from, mover)
        const kingBefore = before.side[mover].detail.ownKing
        const dist = (sq, king) => (king ? Math.max(Math.abs(sq.row - king.row), Math.abs(sq.col - king.col)) : 9)
        if (dist(to, ownKing) < dist(from, kingBefore) && dist(to, ownKing) <= 2) return say(`${name}を玉に寄せ`, `${name}を玉に寄せる`)
        if (forward > 0 && moved.type === 'GI') return say(`${name}を前に出し`, `${name}を前に出す`, true)
        if (forward > 0) return say(`${name}を上がり`, `${name}を上がる`, true)
        if (forward < 0) return say(`${name}を引き`, `${name}を引く`, true)
        return say(`${name}を寄り`, `${name}を寄る`, true)
    }
    if (moved.type === 'HI' && !moved.promoted) {
        if (from.col !== to.col) return say(`飛車を${file}筋に回り`, `飛車を${file}筋に回る`, true)
        // 「浮く」は飛車を1つ上がる手に使う（浮き飛車）。大きく進む手は「前に出す」
        if (forward === 1) return say('飛車を浮き', '飛車を浮く', true)
        if (forward > 1) return say('飛車を前に出し', '飛車を前に出す', true)
        return say('飛車を引き', '飛車を引く', true)
    }
    if (moved.type === 'KA' && !moved.promoted) {
        const campHits = (board, sq) => attacksFrom(board, sq.row, sq.col).filter((h) => isEnemyCamp(mover, h.row)).length
        if (campHits(curr.board, to) > campHits(prev.board, from)) return say(`角を${square}に移して利きを敵陣に通し`, `角を${square}に移して利きを敵陣に通す`)
        // 「自陣に引く」は自陣の外にいた角が自陣に戻るときの言葉。もともと自陣にいた角が下がるのは「引く」だけ
        const ownCamp = (row) => isEnemyCamp(opponent(mover), row)
        if (forward < 0 && !ownCamp(from.row) && ownCamp(to.row)) return say('角を自陣に引き', '角を自陣に引く')
        if (forward < 0) return say('角を引き', '角を引く', true)
        return say(`角を${square}に移し`, `角を${square}に移す`, true)
    }
    if (moved.type === 'OU') return say(`玉を${square}に移し`, `玉を${square}に移す`, true)
    const name = textName(moved)
    const enemyKing = after.side[opponent(mover)].detail.ownKing
    if (enemyKing && nearKing(to, enemyKing, 3) && forward >= 0) return say(`${name}を相手玉に近づけ`, `${name}を相手玉に近づける`)
    if (forward > 0) return say(`${name}を前に進め`, `${name}を前に進める`, true)
    return say(`${name}を${square}に移し`, `${name}を${square}に移す`, true)
}

// 大駒（飛車・角。成った龍・馬を含む）か
function isMajor(piece) {
    return piece?.type === 'HI' || piece?.type === 'KA'
}

// 初期位置（先手８八・後手２二）にいる成っていない角か
function isInitialBishop(item) {
    if (item.piece.type !== 'KA' || item.piece.promoted) return false
    return item.piece.owner === 'sente' ? item.row === 7 && item.col === 1 : item.row === 1 && item.col === 7
}

// 桂・銀・金・香は、指す側から見た左右を付けて「右桂」「左銀」のように呼ぶ
function sideName(piece, from, owner) {
    if (!['KE', 'GI', 'KI', 'KY'].includes(piece.type) || piece.promoted) return textName(piece)
    const file = 9 - from.col
    const right = owner === 'sente' ? file <= 4 : file >= 6
    const left = owner === 'sente' ? file >= 6 : file <= 4
    if (right) return `右${TEXT_NAMES[piece.type]}`
    if (left) return `左${TEXT_NAMES[piece.type]}`
    return textName(piece)
}

// 打ち駒で目立った効果がないとき、置いた場所を事実として書く（目的の推測はしない）
function dropPurpose(position, piece, to, owner, analysis) {
    const distance = (a, b) => (a && b ? Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col)) : Infinity)
    const enemyKing = analysis.side[opponent(owner)].detail.ownKing
    const ownKing = analysis.side[owner].detail.ownKing
    const name = textName(piece)
    // 「利きを通す」は間の駒がどいて利きが通るときの言葉なので、大駒を打つ手には使わない。
    // 自陣に打つ大駒は「自陣角」「自陣飛車」と呼ぶので、その場所を書く
    if ((piece.type === 'KA' || piece.type === 'HI') && isEnemyCamp(opponent(owner), to.row)) {
        return effect('drop-place', `自陣に${name}を打ち`, `自陣に${name}を打つ`, [to])
    }
    if (distance(to, enemyKing) <= 2) return effect('drop-place', `相手玉の近くに${name}を打ち`, `相手玉の近くに${name}を打つ`, [to])
    if (distance(to, ownKing) <= 2) return effect('drop-place', `自玉の近くに${name}を打ち`, `自玉の近くに${name}を打つ`, [to])
    if (isEnemyCamp(owner, to.row)) return effect('drop-place', `敵陣に${name}を打ち込み`, `敵陣に${name}を打ち込む`, [to])
    return null
}

const USI_PIECES = { P: 'FU', L: 'KY', N: 'KE', S: 'GI', G: 'KI', B: 'KA', R: 'HI' }

function usiSquare(file, rank) {
    return { row: rank.charCodeAt(0) - 'a'.charCodeAt(0), col: 9 - Number(file) }
}

// USI 形式の指し手を局面に適用する。元の局面は変更しない
export function applyUsiMove(position, usi) {
    const owner = position.sideToMove
    // Vue のリアクティブな盤面も渡されるので、structuredClone ではなく手で複製する
    const board = position.board.map((row) => row.map((piece) => piece && { ...piece }))
    const hands = { sente: { ...position.hands.sente }, gote: { ...position.hands.gote } }
    const drop = usi.match(/^([PLNSGBR])\*([1-9])([a-i])$/)
    let move
    if (drop) {
        const type = USI_PIECES[drop[1]]
        const to = usiSquare(drop[2], drop[3])
        if (!hands[owner]?.[type] || board[to.row][to.col]) return null
        board[to.row][to.col] = { type, owner, promoted: false }
        hands[owner][type]--
        if (!hands[owner][type]) delete hands[owner][type]
        move = { owner, type, from: null, to, drop: true }
    } else {
        const normal = usi.match(/^([1-9])([a-i])([1-9])([a-i])(\+)?$/)
        if (!normal) return null
        const from = usiSquare(normal[1], normal[2])
        const to = usiSquare(normal[3], normal[4])
        const piece = board[from.row][from.col]
        if (!piece || piece.owner !== owner) return null
        const captured = board[to.row][to.col]
        if (captured) hands[owner][captured.type] = (hands[owner][captured.type] ?? 0) + 1
        board[to.row][to.col] = { ...piece, promoted: piece.promoted || Boolean(normal[5]) }
        board[from.row][from.col] = null
        move = { owner, type: piece.type, from, to, drop: false }
    }
    return { position: { board, hands, sideToMove: opponent(owner) }, move }
}

const USI_CODES = Object.fromEntries(Object.entries(USI_PIECES).map(([code, type]) => [type, code]))

// 盤上の指し手（{ from, to, drop, type, promotes }）を USI 形式にする
export function moveToUsi(move) {
    const square = (sq) => `${9 - sq.col}${'abcdefghi'[sq.row]}`
    if (move.drop) return `${USI_CODES[move.type]}*${square(move.to)}`
    return `${square(move.from)}${square(move.to)}${move.promotes ? '+' : ''}`
}

// 実戦の手のあとの読み筋（相手の応手 reply → 指した側の次の手 next、どちらも USI）が、
// 実戦の手と連動しているか。連動していれば { replyMatters } を返し、無関係なら null を返す。
// 連動とみなすのは: 同じ駒が続けて動く / 実戦の手で空いたマスを使う / 実戦の手と同じマスで取り返す /
// 実戦の手で通り道が開いた大駒が動く
export function followUpRelation(position, played, replyUsi, nextUsi) {
    if (!played || !replyUsi || !nextUsi) return null
    const replied = applyUsiMove(position, replyUsi)
    if (!replied) return null
    const following = applyUsiMove(replied.position, nextUsi)
    if (!following) return null
    const next = following.move
    const reply = replied.move
    const same = (a, b) => a && b && a.row === b.row && a.col === b.col
    // 相手の応手が実戦の手の駒を取った・同じマスに関わったなら、その応手が前提になる
    const replyMatters = same(reply.to, played.to)
    // 相手の応手が実戦の手の駒に当ててきた（利きが増えた）なら、続きの手はその応手への対応であって、
    // 実戦の手の狙いとは言えないので書かない（▲６四飛 △６三銀 ▲６五飛 の▲６五飛は飛車を逃がしているだけ）
    if (!replyMatters) {
        const enemy = opponent(position.board[played.to.row][played.to.col]?.owner ?? played.owner)
        const attackedBefore = computeAttackCounts(position.board)[enemy][played.to.row][played.to.col]
        const attackedAfter = computeAttackCounts(replied.position.board)[enemy][played.to.row][played.to.col]
        if (attackedAfter > attackedBefore) return null
    }

    // 玉が続けて動くのは逃げ続けているだけなので、連動とは言わない
    const movedPiece = position.board[played.to.row][played.to.col]
    const samePiece = !next.drop && same(next.from, played.to) && !replyMatters && movedPiece?.type !== 'OU'
    const usesVacated = same(next.to, played.from)
    const recaptures = same(next.to, played.to)
    let opensLine = false
    if (!next.drop && played.from) {
        // 次の手の駒が、実戦の手で空いたマスを通って動く（飛び駒の通り道が開いた）
        const dr = Math.sign(next.to.row - next.from.row)
        const dc = Math.sign(next.to.col - next.from.col)
        const straight = next.to.row === next.from.row || next.to.col === next.from.col
            || Math.abs(next.to.row - next.from.row) === Math.abs(next.to.col - next.from.col)
        if (straight) {
            for (let r = next.from.row + dr, c = next.from.col + dc; r !== next.to.row || c !== next.to.col; r += dr, c += dc) {
                if (r === played.from.row && c === played.from.col) opensLine = true
            }
        }
    }
    // 「△同歩なら▲同飛」と書けるよう、同じマスへの手かどうかも返す
    return samePiece || usesVacated || recaptures || opensLine
        ? { replyMatters, nextOnReplySquare: same(next.to, reply.to) }
        : null
}

// side の手番で、相手の玉を取れる（相手の玉に王手がかかったまま side の手番になっている）か。
// こうした王手放置の局面は将棋として成り立たず、エンジンに渡すと異常終了することがある
export function canCaptureKing(board, side) {
    const king = findKing(board, opponent(side))
    if (!king) return false
    return computeAttackCounts(board)[side][king.row][king.col] > 0
}
