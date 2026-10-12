// エンジンの読み筋（指し手の並び）を数手進めて、その手の意味を読み解く。
// 盤面からの推測ではなく、エンジンが示した具体的な手順をもとに、
// 手順で決まる手筋の名前（歩交換・突き捨て・継ぎ歩・角交換）と、数手先の駒の損得・成りを言葉にする
import { applyUsiMove, explainMove, opponent, pieceValue, textName } from './shogiExplain.js'

const FILE_LABELS = ['９', '８', '７', '６', '５', '４', '３', '２', '１']
// 読む手数の上限。駒の取り合いはたいていこの範囲で終わる
const MAX_PLIES = 8
// 数手先の駒の損得を「駒得」と言う差（歩1枚の価値90より大きい差）
const GAIN_LIMIT = 100
const BASE_NAMES = { FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛車' }
const SIDE_LABELS = { sente: '先手', gote: '後手' }
const NAME_ORDER = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU']

const same = (a, b) => a && b && a.row === b.row && a.col === b.col

// 読み筋を局面に当てはめ、1手ずつの記録にする。
// notations は読み筋の符号（「△同歩」のように同を含む表記）で、usiMoves と同じ並び
export function readLine(position, usiMoves = [], notations = []) {
    const steps = []
    let current = position
    for (let i = 0; i < Math.min(usiMoves.length, MAX_PLIES); i++) {
        const applied = applyUsiMove(current, usiMoves[i])
        if (!applied) break
        const { move } = applied
        const before = move.drop ? null : current.board[move.from.row][move.from.col]
        const piece = applied.position.board[move.to.row][move.to.col]
        // 直前と同じマスへの手は、棋譜の書き方にならって「同」で書く（▲２四歩 △同歩 ▲同飛）
        const notation = notations[i] ?? ''
        const recapture = steps.length && same(steps.at(-1).move.to, move.to)
        steps.push({
            notation: recapture && notation && notation[1] !== '同' ? `${notation[0]}同${notation.slice(3)}` : notation,
            move,
            owner: move.owner,
            piece,
            captured: move.drop ? null : current.board[move.to.row][move.to.col],
            promoted: Boolean(before && !before.promoted && piece.promoted),
            before: current,
            after: applied.position,
        })
        current = applied.position
    }
    return steps
}

// 最初の手に続く、同じマスでの駒の取り合い（取り返す手が続く間）の手数
function exchangeLength(steps) {
    let length = 1
    while (length < steps.length && steps[length].captured && same(steps[length].move.to, steps[length - 1].move.to)) length++
    return length
}

// 駒得は、取った駒を持ち駒（成る前の駒）として数える
function baseValue(piece) {
    return pieceValue({ type: piece.type, promoted: false })
}

// 取り合いで指した側が得た駒・失った駒。同じ種類どうしは打ち消す
function exchangeBalance(steps, length, mover) {
    const gained = []
    const lost = []
    for (const step of steps.slice(0, length)) {
        if (!step.captured) continue
        if (step.owner === mover) gained.push(step.captured)
        else lost.push(step.captured)
    }
    const value = gained.reduce((sum, piece) => sum + baseValue(piece), 0) - lost.reduce((sum, piece) => sum + baseValue(piece), 0)
    const gainedTypes = gained.map((piece) => piece.type)
    const lostTypes = lost.map((piece) => piece.type)
    const both = gainedTypes.filter((type) => {
        const index = lostTypes.indexOf(type)
        if (index < 0) return false
        lostTypes.splice(index, 1)
        return true
    })
    const remainingGained = [...gainedTypes]
    for (const type of both) remainingGained.splice(remainingGained.indexOf(type), 1)
    return { value, gained: remainingGained, lost: lostTypes, traded: both }
}

function nameList(types) {
    const sorted = [...types].sort((a, b) => NAME_ORDER.indexOf(a) - NAME_ORDER.indexOf(b))
    const counts = new Map()
    for (const type of sorted) counts.set(type, (counts.get(type) ?? 0) + 1)
    return [...counts].map(([type, count]) => (count > 1 ? `${BASE_NAMES[type]}${count}枚` : BASE_NAMES[type])).join('・')
}

// 指した歩の前のマス（先手なら上、後手なら下）
function frontOf(square, owner) {
    return { row: square.row + (owner === 'sente' ? -1 : 1), col: square.col }
}

function isPawn(piece) {
    return piece?.type === 'FU' && !piece.promoted
}

// 「△同歩なら▲同飛と取り返して」のように、相手の応手と指した側の次の手を条件の形で書く
function replyThen(steps) {
    const [, reply, answer] = steps
    const verb = same(answer.move.to, reply.move.to) ? '取り返して' : '指して'
    return `${reply.notation}なら${answer.notation}と${verb}`
}

// 手筋の名前で始まる読み解き。直前の手の文では主語なしで続け、次の一手の文では「▲２四歩は」を前に付ける
function subjectInsight(kind, first, text) {
    return { kind, text, planText: `${first.notation}は${text}` }
}

// 読み筋の最初の手（指した手・候補手）を読み解く。
// lastMove: その手の直前の相手の手（{ move, captured }。継ぎ歩の判定に使う）
// 返す { kind, text, planText }: text は直前の手の文に続ける形、planText は次の一手の文に添える形
export function lineInsight(steps, { lastMove = null } = {}) {
    if (!steps.length) return null
    const [first, reply, answer] = steps
    const mover = first.owner
    const enemy = opponent(mover)
    const length = exchangeLength(steps)

    // 歩交換: 突いた歩を相手の歩にぶつけ、△同歩に同じマスで取り返して終わる
    const contact = !first.move.drop && isPawn(first.piece) && !first.captured
        && isPawn(first.after.board[frontOf(first.move.to, mover).row]?.[first.move.to.col])
        && first.after.board[frontOf(first.move.to, mover).row][first.move.to.col].owner === enemy
    if (contact && reply?.captured && isPawn(reply.piece) && same(reply.move.to, first.move.to)
        && answer?.captured && answer.owner === mover && same(answer.move.to, first.move.to) && length === 3) {
        const rook = answer.piece.type === 'HI'
        const name = rook ? '飛車先の歩交換' : `${FILE_LABELS[first.move.to.col]}筋の歩交換`
        return subjectInsight('pawn-exchange', first, `${name}を狙う手で、${replyThen(steps)}歩を1枚手持ちにできます。`)
    }

    // 突き捨て: 相手の歩にぶつけた歩をその歩で取らせ、取り返さずに別の手を指す
    if (contact && reply?.captured && isPawn(reply.piece) && same(reply.move.to, first.move.to)
        && answer && answer.owner === mover && !same(answer.move.to, first.move.to)) {
        return subjectInsight('thrust', first, `歩の突き捨てで、${reply.notation}と取らせてから${answer.notation}と指す狙いのようです。`)
    }

    // 継ぎ歩: 相手が歩で取ったばかりの歩の頭に、さらに歩を打って当てる
    if (first.move.drop && isPawn(first.piece) && lastMove?.captured && lastMove.move?.type === 'FU'
        && same(frontOf(first.move.to, mover), lastMove.move.to)) {
        return subjectInsight('tsugifu', first, `継ぎ歩の手筋で、もう一度歩を当てて${FILE_LABELS[first.move.to.col]}筋を攻め続ける手です。`)
    }

    if (length < 2) return null
    const balance = exchangeBalance(steps, length, mover)
    const sequence = steps.slice(1, length).map((step) => step.notation).join('')
    const condition = length === 3 ? replyThen(steps) : `${sequence}と進めば`
    // 次の一手の文では、候補手そのものから手順を書く（▲７七角成▲同銀と進めば）
    const fromStart = `${steps.slice(0, length).map((step) => step.notation).join('')}と進めば`

    // 角交換・飛車交換: 取り合いで同じ大駒を1枚ずつ取り合う
    const major = balance.traded.find((type) => type === 'KA' || type === 'HI')
    if (major && Math.abs(balance.value) < GAIN_LIMIT) {
        const name = major === 'KA' ? '角交換' : '飛車交換'
        return { kind: 'major-trade', text: `${length === 2 ? `${reply.notation}なら` : condition}${name}になります。`, planText: `${fromStart}${name}になります。` }
    }
    // 数手先の駒得（2手の取り合いは「取り返されても〜の交換」として別に書くので、3手以上の手順だけ）
    if (length >= 3 && balance.value >= GAIN_LIMIT && balance.gained.length) {
        // 相手の手番の読み筋も書くので、どちらが得をするかを名指しする
        const pair = `${SIDE_LABELS[mover]}が${balance.lost.length ? `${nameList(balance.gained)}と${nameList(balance.lost)}の交換で駒得になります` : `${nameList(balance.gained)}を得します`}`
        return { kind: 'gain', text: `${condition}、${pair}。`, planText: `${fromStart}、${pair}。` }
    }
    // 取り合いの中で指した側の駒が成る
    // 成った駒がその後の取り合いで取られるなら、作れたとは言わない
    const promotion = steps.slice(1, length).find((step, index) => step.owner === mover && step.promoted
        && !steps.slice(index + 2, length).some((later) => same(later.move.to, step.move.to)))
    if (promotion && balance.value > -GAIN_LIMIT) {
        const made = `${SIDE_LABELS[mover]}が${textName(promotion.piece)}を作れます`
        return { kind: 'promotion', text: `${condition}、${made}。`, planText: `${fromStart}、${made}。` }
    }
    return null
}

// ---- 候補手の方針（攻めか受けか）を、読み筋の流れから決める ----
// 1手目の効果だけで決めると、玉を動かして飛車の利きが通った手を「攻め」とするような誤りが出る。
// そこで、エンジンの読み筋の最初の数手で両者が何をしているかを見る。
// 指した側の手が攻めを続け、相手の応手が受けなら「攻め」（相手に受けを強いている）。
// 相手の手が攻めで、指した側の手が受けなら「受け」。どちらとも言えなければ null（方針の文を書かない）
const STYLE_PLIES = 4
const ATTACK_KINDS = new Set(['target', 'fork', 'tesuji', 'check', 'pressure', 'strip', 'pawn-contact'])
const DEFENSE_KINDS = new Set(['escape', 'escape-king', 'king-safety', 'protect', 'prevent', 'block-line', 'defend-zone', 'guard'])

export function lineStyle(steps) {
    const plies = steps.slice(0, STYLE_PLIES)
    if (plies.length < 2) return null
    const mover = plies[0].owner
    let attack = 0
    let defense = 0
    plies.forEach((step, index) => {
        const effects = explainMove(step.before, step.after, step.move)
        const attacking = effects.some((effect) => ATTACK_KINDS.has(effect.kind))
        const defending = effects.some((effect) => DEFENSE_KINDS.has(effect.kind))
        // 攻めと受けの両方の効果がある手（攻防の手）は、どちらにも数えない
        if (attacking === defending) return
        // 候補手そのものは重く数える
        const weight = index === 0 ? 2 : 1
        const ours = step.owner === mover
        if (attacking === ours) attack += weight
        else defense += weight
    })
    // はっきり差があるときだけ決める
    if (attack >= defense + 2) return 'attack'
    if (defense >= attack + 2) return 'defense'
    return null
}

