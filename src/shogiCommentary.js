import { squareName } from './shogiExplain.js'
// 解説の部品（shogiExplain.js の節や指し手の効果）を、将棋の解説らしい文章につなげる。
// 文章は { text, squares } の断片の列で返し、squares がある断片は盤上の根拠を強調できる。
// 評価値の判断であることは自明なので「エンジンは」のような前置きは付けないが、
// 事実と言い切らないよう「〜と見られます」「〜ようです」で締める。

const SIDE_LABELS = { sente: '先手', gote: '後手' }
const MATE_SCORE = 3000
// 1番手と2番手の評価差で、推奨手の言い方を変える。竜王戦第1局（藤井-服部）で、
// 差300以上は5局面すべて、100〜300は66%、100未満は28〜42%で1番手が実戦と一致した
// （100未満でも候補3手まで広げれば7割以上が当たる）
const ONLY_MOVE_GAP = 300
const LIKELY_GAP = 100
// 次の一手の文で挙げる候補の最大数
const MAX_PLAN_CANDIDATES = 3
// 指した側から見た評価の変化がこれ以上なら触れる。指す前と指した後は別々の探索なので
// 200程度は最善手でも動く（竜王戦では最善手で-202の例があった）ため、300を下限にする
const NOTABLE_CHANGE = 300
const BIG_CHANGE = 500
// これ以上の大差では、王手がらみ以外の駒の取り合いは勝負に関係が薄い
const DECISIVE = 2000
const DEFENSIVE_KINDS = new Set(['escape', 'escape-king', 'king-safety', 'protect', 'prevent', 'block-line', 'defend-zone', 'guard'])
const OFFENSIVE_KINDS = new Set(['target', 'fork', 'tesuji', 'check', 'pressure', 'open-line', 'activate', 'pawn-contact', 'strip', 'cut'])
// 取る・成るといった、狙いではなく行為そのものの種類
const ACTION_KINDS = new Set(['capture', 'promote'])
// 本文の「〜し、〜する手です」に入れない種類（注意書きと次の狙いは別の文にする）
const SEPARATE_KINDS = new Set(['hanging', 'thin', 'next'])

// 攻めと受けの両方の効果がある手は「攻防の一手」と呼ぶ
function isAttackAndDefense(effects) {
    return effects.some((effect) => OFFENSIVE_KINDS.has(effect.kind)) && effects.some((effect) => DEFENSIVE_KINDS.has(effect.kind))
}

// 同じ局面では毎回同じ言い回しになるよう、局面ごとの種から言い回しを選ぶ
function pick(seed, key, variants) {
    let hash = 0
    for (const ch of `${seed}:${key}`) hash = (hash * 31 + ch.codePointAt(0)) >>> 0
    return variants[hash % variants.length]
}

function text(value, squares = []) {
    return { text: value, squares }
}

function scoreValue(evaluation) {
    if (!evaluation) return null
    if (evaluation.mate !== null && evaluation.mate !== undefined) return Math.sign(evaluation.mate) * MATE_SCORE
    return Math.max(-MATE_SCORE, Math.min(MATE_SCORE, evaluation.score))
}

// 直前の手は事実を述べる文にする:「▲７六歩と角道を開けました」「▲２四歩と２筋の歩をぶつけて仕掛け、…ました」
function pastEffects(effects) {
    const parts = []
    effects.forEach((effect, index) => {
        const last = index === effects.length - 1
        parts.push(text(last ? `${effect.ren}ました` : effect.ren, effect.squares))
        if (!last) parts.push(text('、'))
    })
    return parts
}

function mainEffects(effects) {
    return effects.filter((effect) => !SEPARATE_KINDS.has(effect.kind))
}

// 評価が詰みを示しているとき、詰ませる側（mate 0 は手番の側が詰んでいるので、その相手）
function matingSide(evaluation, sideToMove) {
    if (evaluation?.mate === null || evaluation?.mate === undefined) return null
    if (evaluation.mate === 0) return sideToMove === 'sente' ? 'gote' : 'sente'
    return evaluation.mate > 0 ? 'sente' : 'gote'
}

// 詰みに関わる一文。詰み筋に入った手と、詰ませた手でだけ書く（詰み筋の途中では繰り返さない）
function mateSentence(mover, before, after) {
    const enemy = mover === 'sente' ? 'gote' : 'sente'
    const after_ = matingSide(after, enemy)
    if (after_ === null) return null
    if (after?.mate === 0) return `これで${SIDE_LABELS[enemy]}玉は詰みです。`
    // 1手前の評価が分からなければ、この手で詰み筋に入ったのかは判断できない
    if (!before) return ''
    const before_ = matingSide(before, mover)
    if (after_ === before_) return ''
    return after_ === mover
        ? `この手で${SIDE_LABELS[enemy]}玉は詰み筋に入ったようです。`
        : `ただ、これで${SIDE_LABELS[mover]}玉に詰みが生じたようです。`
}

// 指した側から見た評価の変化。評価が分からなければ null
function moverGain(mover, before, after) {
    const prev = scoreValue(before)
    const curr = scoreValue(after)
    if (prev === null || curr === null) return null
    return (curr - prev) * (mover === 'sente' ? 1 : -1)
}

// 実戦の手が最善手よりどれだけ悪いか。playedLoss は指す前の局面の探索から求めたもの:
//   exact   … 実戦の手が候補手に入っていたときの、最善手との評価差（同じ探索なのでぶれない）
//   atLeast … 候補外のときの、最善手と最後の候補手との差（少なくともこれだけは悪い）
// どちらも分からなければ、指す前と指した後の評価の差（別々の探索なので200程度はぶれる）で判断する
function isBadMove(mover, before, after, playedLoss) {
    if (playedLoss?.exact !== null && playedLoss?.exact !== undefined) return playedLoss.exact >= NOTABLE_CHANGE
    if ((playedLoss?.atLeast ?? 0) >= NOTABLE_CHANGE) return true
    const gain = moverGain(mover, before, after)
    return gain !== null && gain <= -NOTABLE_CHANGE
}

// 取られる形の駒が、承知の上で捨てた駒かどうか。悪手でなければ承知の上と見る。
// 評価が何も分からないときは、駒を取る手や王手の手（相手に応じる手を強いる手）なら踏み込んだと見る
function isIntentionalSacrifice(warn, mover, before, after, playedLoss) {
    if (!warn?.sacrifice) return false
    const known = playedLoss || moverGain(mover, before, after) !== null
    return known ? !isBadMove(mover, before, after, playedLoss) : warn.sacrifice.forcing
}

function evaluationChange(seed, mover, before, after, afterWarning = false, playedLoss = null) {
    const prev = scoreValue(before)
    const curr = scoreValue(after)
    if (prev === null || curr === null) return []
    const side = SIDE_LABELS[mover]
    const sign = mover === 'sente' ? 1 : -1
    const gain = (curr - prev) * sign
    if (Math.sign(prev) !== Math.sign(curr) && Math.abs(prev) >= 200 && Math.abs(curr) >= 200) {
        return [text(gain > 0 ? `この手で${side}が形勢を逆転したようです。` : 'この手で形勢が入れ替わったようです。')]
    }
    if (gain >= BIG_CHANGE) return [text(pick(seed, 'gain-big', [`この手で${side}が形勢を大きく引き寄せたようです。`, `${side}にとって会心の一手と言えそうです。`]))]
    if (gain >= NOTABLE_CHANGE) return [text(pick(seed, 'gain', [`${side}が少しポイントを稼いだようです。`, `${side}にとって形勢を良くする手と見られます。`]))]
    // 直前に「ただ、」で注意を書いたときは、同じ書き出しが続かないようにする
    const but = afterWarning ? '実際、' : 'ただ、'
    if (isBadMove(mover, before, after, playedLoss)) {
        return [text(but + pick(seed, 'loss', ['評価は大きく下がっており、疑問手だったかもしれません。', 'ここで形勢を損ねたようです。']))]
    }
    // 評価がほとんど動かないのは自然な手なので、あえて触れない
    return []
}

// 次の狙いの文。「次は▲３九馬が飛車と銀の両取りになる手を見ています」
function nextThreatParts(seed, next) {
    return [
        text('次は'),
        text(next.clause, next.squares),
        text(pick(seed, 'next-end', ['手を見ています。', '手を狙っています。'])),
    ]
}

// 直前の手の解説。書くことがない手（目立つ効果も狙いも評価の変化もない手）は空を返す
// plannedNext: 実戦の手がエンジンの候補手だったとき、その読み筋のうち実戦の手と連動する続き
//   { next: 指した側の次の手, reply: 相手の応手, replyMatters: 応手が前提になるか }（連動しなければ null）
// includeEvaluation: 評価の変化の一文を含めるか（解説を1つの文章にまとめるときは、形勢の変化として最後に書くので含めない）
// insight: 実戦の手がエンジンの候補手だったとき、その読み筋から読み解いた手筋・数手先の結果（shogiLine.js の lineInsight）。
//   あれば、1手先の「次は〜を狙っています」や「〜と続ける構想」より具体的なので、そちらを書く
export function commentMove({ notation, mover, effects, before = null, after = null, seed = '', playedLoss = null, plannedNext = null, insight = null, includeEvaluation = true }) {
    if (!notation) return []
    const warn = effects.find((effect) => effect.kind === 'hanging') ?? effects.find((effect) => effect.kind === 'thin')
    // 詰みが見えている局面では、駒の取り合いの「次の狙い」は意味がないので書かない
    const mate = mateSentence(mover, before, after)
    const decisive = Math.abs(scoreValue(after) ?? 0) >= DECISIVE
    const nextEffect = effects.find((effect) => effect.kind === 'next')
    // 大差の局面でも、王手がらみの狙いなら書く。読み筋の読み解きがあれば、王手がらみ以外の狙いはそちらに任せる
    const usableInsight = mate === null ? insight : null
    const next = mate === null && nextEffect && (!decisive || nextEffect.threatKind === 'check-fork')
        && (!usableInsight || nextEffect.threatKind === 'check-fork') ? nextEffect : null
    // 次の狙いを書くときは、同じ駒を指す「〜に狙いをつける」は具体的な次の狙いに任せる
    const aimed = new Set((next?.squares ?? []).map((sq) => sq.row * 9 + sq.col))
    const main = mainEffects(effects).filter((effect) => !(next && effect.kind === 'target'
        && effect.squares.every((sq) => aimed.has(sq.row * 9 + sq.col))))
    const parts = []
    if (main.length) {
        // 「△同銀とと金を取りました」のように「と」が重なるときは「で、」でつなぐ
        parts.push(text(main[0].ren.startsWith('と') ? `${notation}で、` : `${notation}と`), ...pastEffects(main), text('。'))
        if (isAttackAndDefense(main)) parts.push(text('攻めと受けを兼ねた一手です。'))
        if (next) parts.push(...nextThreatParts(seed, next))
    } else if (next) {
        // 目に見える変化はなくても、次の狙いがあればそれを主題にする
        parts.push(text(`${notation}で、`), ...nextThreatParts(seed, next))
    }
    if (usableInsight) {
        if (!parts.length) parts.push(text(`${notation}。`))
        parts.push(text(usableInsight.text))
    }
    // 次の狙いが見つからなくても、読み筋に実戦の手と連動する続きがあれば意図として添える。
    // 相手の応手が前提になる続き（△同歩なら▲２四飛）は、その前提も書く
    if (!usableInsight && !next && mate === null && plannedNext?.next && parts.length) {
        // 直前と同じマスへの手は、棋譜の書き方にならって「同」で書く（▲２四歩 △同歩 ▲同飛）
        const sameSquare = (move) => (move[1] === '同' ? move : `${move[0]}同${move.slice(3)}`)
        const followUp = plannedNext.nextOnReplySquare ? sameSquare(plannedNext.next) : plannedNext.next
        const condition = plannedNext.replyMatters && plannedNext.reply ? `${sameSquare(plannedNext.reply)}なら` : 'このあと'
        // 「含み」は攻めの可能性を残すときの言葉なので、攻めの手のときだけ使い、それ以外は「構想」と言う
        const attacking = main.some((effect) => OFFENSIVE_KINDS.has(effect.kind))
        parts.push(text(`${condition}${followUp}と続ける${attacking ? '含みがありそうです' : '構想のようです'}。`))
    }
    // 角交換や数手先の駒得を書いたときは、取り返される形の一文（取り返されても〜の交換）と重なるので書かない
    const coveredExchange = usableInsight && ['major-trade', 'gain'].includes(usableInsight.kind)
    const sacrifice = !coveredExchange && isIntentionalSacrifice(warn, mover, before, after, playedLoss)
    if (sacrifice) {
        const { square, name, exchange } = warn.sacrifice
        if (!parts.length) parts.push(text(`${notation}で、`))
        if (exchange && exchange.takenValue >= exchange.givenValue) {
            // 駒を取り返されるだけなら、踏み込みではなく駒の交換として書く
            const pair = exchange.taken === exchange.given ? exchange.taken : `${exchange.taken}と${exchange.given}`
            // 銀桂交換（差90）は駒得、金銀交換（差45）はほぼ互角の交換として扱う
            parts.push(text(exchange.takenValue - exchange.givenValue > 60
                ? `取り返されても${pair}の交換で駒得になる形です。`
                : `取り返されても${pair}の交換です。`, warn.squares))
        } else {
            // 自分から取られる場所に指した手は、注意ではなく、攻めの手なら「捨てて踏み込んだ」、受けの手なら「駒損を承知で受けた」と言う
            const variants = warn.sacrifice.attacking === false
                ? [`${square}の${name}は取られる形ですが、駒損を承知で受けに回っています。`, `${name}を手放してでも受けを優先した形です。`]
                : [`${square}に${name}を捨てて踏み込んだ形です。`, `${square}の${name}は取られる形ですが、承知の上で踏み込んでいます。`]
            parts.push(text(pick(seed, 'sacrifice', variants), warn.squares))
        }
    } else if (warn && !coveredExchange) {
        // 指した後なので「注意が必要」ではなく、起きたことを事実として書く（ただ、〜が取られる形になりました）
        if (!parts.length) parts.push(text(`${notation}で、`))
        parts.push(
            text(parts.length > 1 ? pick(seed, 'warn-start', ['ただ、', 'その代わり、']) : ''),
            text(`${warn.ren}ました。`, warn.squares),
        )
    }
    // 詰みが絡む局面では評価値の増減より詰みの一文を優先する
    let change = mate ? [text(mate)] : []
    if (mate === null && includeEvaluation) change = evaluationChange(seed, mover, before, after, Boolean(warn) && !sacrifice, playedLoss)
    if (change.length && !parts.length) parts.push(text(`${notation}。`))
    parts.push(...change)
    return parts.filter((part) => part.text)
}

function levelSentence(seed, explanation) {
    const side = SIDE_LABELS[explanation.winner]
    switch (explanation.level) {
        case 'even': return pick(seed, 'level-even', ['ほぼ互角の形勢と見られます。', '形勢はほぼ互角のようです。'])
        case 'slight': return pick(seed, 'level-slight', [`${side}が少し指しやすいようです。`, `わずかに${side}が指しやすい形勢と見られます。`])
        case 'advantage': return pick(seed, 'level-advantage', [`${side}が有利と見られます。`, `形勢は${side}が有利のようです。`])
        case 'winning': return pick(seed, 'level-winning', [`${side}が優勢と見られます。`, `${side}がはっきりリードしているようです。`])
        case 'mate': return `${SIDE_LABELS[explanation.winner === 'sente' ? 'gote' : 'sente']}玉に${explanation.mate}手の詰みがあるようです。`
        case 'mated': return `${SIDE_LABELS[explanation.winner === 'sente' ? 'gote' : 'sente']}玉は詰んでいます。${side}の勝ちです。`
        default: return ''
    }
}

function clauseParts(clause) {
    return text(clause.text, clause.squares)
}

// 理由の顔ぶれ（どちら側の、どの節か）。直前の局面と同じなら繰り返さない
function reasonSignature(explanation) {
    if (!explanation) return ''
    const clauses = [...explanation.reasons, explanation.counter].filter(Boolean)
        .map((reason) => `${reason.side}:${reason.clauses[0].text}`)
    return `${explanation.level}|${explanation.winner ?? ''}|${explanation.note ?? ''}|${clauses.join('|')}`
}

// 局面の解説。previous（直前の局面の解説）と理由が同じなら、形勢の一文だけにする
export function commentPosition(explanation, seed = '', previous = null) {
    if (!explanation) return []
    const parts = [text(levelSentence(seed, explanation))]
    if (previous && reasonSignature(previous) === reasonSignature(explanation)) return parts
    if (explanation.level === 'mate' || explanation.level === 'mated') return parts

    if (explanation.level === 'even') {
        const [first, second] = explanation.reasons.map((reason) => reason.clauses[0])
        if (first && second) {
            parts.push(clauseParts(first), text('一方で、'), clauseParts(second), text('ので、バランスが取れています。'))
        } else if (first) {
            parts.push(clauseParts(first), text('ものの、全体としては釣り合っています。'))
        }
        return parts
    }

    // 各要因の最初の節を理由として使い、残りは「また」で補う
    const clauses = explanation.reasons.map((reason) => reason.clauses[0])
    const extras = explanation.reasons.flatMap((reason) => reason.clauses.slice(1))
    if (clauses.length === 1) {
        parts.push(clauseParts(clauses[0]), text(pick(seed, 'reason-one', ['ことが大きいでしょう。', 'のが主な理由と考えられます。'])))
    } else if (clauses.length >= 2) {
        parts.push(
            clauseParts(clauses[0]),
            text(pick(seed, 'reason-join', ['うえに、', 'うえ、'])),
            clauseParts(clauses[1]),
            text(pick(seed, 'reason-two', ['ことが理由と考えられます。', 'のが大きいようです。'])),
        )
    }
    const more = [...clauses.slice(2), ...extras].slice(0, 1)
    if (more.length) parts.push(text('また、'), clauseParts(more[0]), text('点も見逃せません。'))

    // 大差のときに逆向きの要因を挙げても誤解を招くだけなので、優勢以上では書かない
    if (explanation.counter && explanation.level !== 'winning') {
        const loser = SIDE_LABELS[explanation.counter.side]
        // 大差のときに「相手にも楽しみ」と言うと誤解を招くので、優位は動かないと添える
        const ending = pick(seed, 'counter', [`ので、${loser}にも楽しみがあります。`, `ので、${loser}にも反撃の余地があります。`])
        parts.push(text('一方で、'), clauseParts(explanation.counter.clauses[0]), text(ending))
    }
    if (explanation.note === 'small-difference') {
        parts.push(text('差はわずかで、盤面の形にはまだ目立った違いはありません。'))
    } else if (explanation.note === 'deep-reading') {
        parts.push(text('盤面の形だけでは差が見えにくく、数手先の読みによる評価のようです。'))
    }
    return parts
}

// 候補手の評価差（手番側から見た値）。大きければ「〜の一手」、小さければ「〜も有力」と言える
function candidateGap(candidates, sideToMove) {
    const [best, second] = candidates
    if (!best || !second) return null
    const sign = sideToMove === 'sente' ? 1 : -1
    return (scoreValue(best) - scoreValue(second)) * sign
}

// 符号の前に置く説明（「飛車先の歩を伸ばす▲２六歩」の「飛車先の歩を伸ばす」）。
// 指し手を言い直しているだけの説明（玉を４一に移す など）は付けない
function planDescription(effects = [], limit = 1) {
    const main = mainEffects(effects).filter((effect) => !effect.restates).slice(0, limit)
    if (!main.length) return ''
    if (main.length === 1) return main[0].end
    // 符号の前の説明の中に読点があると候補の区切りに見えるので付けない。
    // ただし後ろがマスの数字で始まると「取り９七」とくっついて読みにくいので、そのときだけ残す
    const separator = /^[１-９]/.test(main[1].end) ? '、' : ''
    return `${main[0].ren}${separator}${main[1].end}`
}

// 次の一手。candidates は評価順の候補手（{ notation, score, mate, effects }）で、
// 説明を先に書いてから符号を置く（直前の手の「▲２六歩と飛車先の歩を伸ばしました」とそろえる）。
// 1番手と2番手の評価差が大きいほど言い切り、小さければ候補を並べる
// lead: 直前の手の文に続けるときの書き出し。'reply' は「これに対して後手は、」のように応手として、
// 'turn' は「先手は、」のように手番の側を名指しして始め、直前の手の文との境目をわかりやすくする
// onlyMove: 合法手がこの1手しかない（王手の応手が1つだけ など）。評価差による「一手」より強く「しかありません」と言う
// insight: 1番手の候補手の読み筋から読み解いた手筋・数手先の結果。詰みの局面以外では、候補の文のあとに添える
export function commentPlan({ insight = null, ...options }) {
    const parts = planSentences(options)
    const best = options.candidates?.[0]
    const mateLine = best && best.mate !== null && best.mate !== undefined
    if (!parts.length || mateLine || !insight?.planText) return parts
    return [...parts, text(insight.planText)]
}

function planSentences({ seed = '', candidates = [], sideToMove = 'sente', lead = null, onlyMove = false }) {
    const best = candidates[0]
    if (!best?.notation) return []
    const notation = best.notation
    const gap = candidateGap(candidates, sideToMove)
    const side = SIDE_LABELS[sideToMove]
    // 書き出しのあとに読点は付けない方がリズムがよい（「対する後手は△７三飛の一手です」）
    const opener = lead === 'reply'
        ? pick(seed, 'plan-lead', [`これに対して${side}は`, `対する${side}は`, `${side}としては`])
        : lead === 'turn' ? `${side}は` : ''

    if (onlyMove) {
        const forced = `${opener || 'ここは'}${planDescription(best.effects, 2)}${notation}しかありません。`
        if (best.mate === null || best.mate === undefined || best.mate === 0) return [text(forced)]
        const winning = (best.mate > 0) === (sideToMove === 'sente')
        const moves = Math.abs(best.mate)
        return [text(forced + (winning ? (moves === 1 ? '' : `ここから${moves}手で詰むようです。`) : 'この先は詰みのようです。'))]
    }

    // 詰みが見えている局面は、候補を並べず詰みとして書く
    if (best.mate !== null && best.mate !== undefined && best.mate !== 0) {
        const winning = (best.mate > 0) === (sideToMove === 'sente')
        const moves = Math.abs(best.mate)
        if (winning) {
            if (!lead) return [text(moves === 1 ? `${notation}で詰みです。` : `${notation}から${moves}手で詰むようです。`)]
            return [text(moves === 1 ? `${opener}${notation}で詰みです。` : `${opener}${notation}から${moves}手で詰ませられるようです。`)]
        }
        const doomed = lead ? `${side}玉はどう応じても詰みのようです。` : 'どう応じても詰みのようです。'
        return [text(moves > 2 ? `${doomed}${notation}が最も長く粘る手のようです。` : doomed)]
    }

    if (gap !== null && gap >= ONLY_MOVE_GAP) {
        // 他の手では形勢を損ねる
        return [text(`${opener || 'ここは'}${planDescription(best.effects, 2)}${notation}の一手です。`)]
    }
    if (gap === null || gap >= LIKELY_GAP) {
        return [text(`${opener}${planDescription(best.effects, 2)}${notation}が有力です。`)]
    }
    // 差が小さいときは1つに決めつけず、説明つきで候補を並べる。
    // 挙げるのは最善手との差が LIKELY_GAP 未満の手だけ（1番手と2番手の言い分けと同じ基準）で、
    // 読む人が迷わないよう、候補手がいくつ出ていても最大3手にする
    const sign = sideToMove === 'sente' ? 1 : -1
    const close = (candidate) => scoreValue(candidate) === null || (scoreValue(best) - scoreValue(candidate)) * sign < LIKELY_GAP
    const seen = new Set()
    const listed = candidates.filter((candidate) => candidate.notation && close(candidate) && !seen.has(candidate.notation) && seen.add(candidate.notation))
        .slice(0, MAX_PLAN_CANDIDATES)
    // 同じ説明の候補はまとめる（当たっていた角をかわす▲６六角・▲７七角・▲８八角）。
    // ただし「歩を取る」は取る駒の場所を言わないので、別々の駒を取る候補が同じ説明になったときは
    // まとめず、場所を付けて区別する（３五の歩を取る▲３五歩、７五の歩を取る▲７五角）
    const captureSquare = (candidate) => {
        const main = mainEffects(candidate.effects).filter((effect) => !effect.restates)[0]
        const square = main?.kind === 'capture' ? main.squares?.[0] : null
        return square ? squareName(square.row, square.col) : ''
    }
    const describe = (candidate) => planDescription(candidate.effects, 1)
    const ambiguous = new Set(listed.map(describe).filter((description, index, all) => description
        && new Set(listed.filter((candidate, i) => all[i] === description).map(captureSquare)).size > 1))
    const groups = []
    for (const candidate of listed) {
        const plain = describe(candidate)
        const description = ambiguous.has(plain) && captureSquare(candidate) ? `${captureSquare(candidate)}の${plain}` : plain
        const group = description && groups.find((g) => g.description === description)
        if (group) group.notations.push(candidate.notation)
        else groups.push({ description, notations: [candidate.notation] })
    }
    // 説明のある候補を先に並べ、説明のない候補は別の文にする。
    // 説明のない符号が、直前の候補の説明を共有しているように読まれないようにするため
    const described = groups.filter((group) => group.description).map((group) => `${group.description}${group.notations.join('・')}`)
    const bare = groups.filter((group) => !group.description).flatMap((group) => group.notations)
    // 手番の側が大差で負けている局面では、手が広いのではなく、どの手も苦しい
    const bestValue = scoreValue(best)
    const losing = bestValue !== null && bestValue * (sideToMove === 'sente' ? 1 : -1) <= -DECISIVE
    const struggling = opener ? `${opener.replace(/、$/, '')}苦しく、` : '苦しい局面で、'
    if (!described.length) {
        return [text(losing ? `${struggling}${bare.join('、')}などで粘ることになりそうです。` : `${opener}${bare.join('、')}などが考えられます。`)]
    }
    const first = losing ? `${struggling}${described.join('、')}などで粘ることになりそうです。` : `${opener}${described.join('、')}が考えられます。`
    return [text(bare.length ? `${first}ほかに${bare.join('、')}もあります。` : first)]
}

// 指す前の局面の候補手（評価順、{ usi, score, mate }、評価は先手基準）から、
// 実戦の手が最善手よりどれだけ悪いかを求める（commentMove の playedLoss）
export function lossOfPlayedMove(candidates, playedUsi, mover) {
    if (!candidates?.length || !playedUsi) return null
    const sign = mover === 'sente' ? 1 : -1
    const best = scoreValue(candidates[0])
    const played = candidates.find((candidate) => candidate.usi === playedUsi)
    if (played) return { exact: (best - scoreValue(played)) * sign, atLeast: null }
    return { exact: null, atLeast: (best - scoreValue(candidates.at(-1))) * sign }
}

// 形勢の段階を、指した側から見た数にする（互角 0、指しやすい 1、有利 2、優勢 3、詰み 4。相手が良ければ負の数）
const LEVEL_RANKS = { even: 0, slight: 1, advantage: 2, winning: 3, mate: 4 }
function levelRank(explanation, mover) {
    const rank = LEVEL_RANKS[explanation?.level]
    if (rank === undefined) return null
    return explanation.winner === mover || rank === 0 ? rank : -rank
}

// 形勢の変化。解説の最後に置き、形勢の段階（互角・指しやすい・有利・優勢）が直前の局面から変わったときだけ、
// どう変わったかの一文と、今の形勢とその理由を書く。言い方は評価値の差ではなく、どの段階からどの段階へ
// 動いたかで決める（まだ優勢なのに「形勢を損ねた」とは言わない）。
// 段階が変わらなくても、最善手より大きく悪い手（疑問手）だったことだけは書く。
// standalone: 比べる直前の局面がない（棋譜の手を選んでいない）ときは、今の形勢をそのまま書く
export function commentFormChange({ notation, mover, before = null, after = null, playedLoss = null, explanation, previousExplanation = null, seed = '', standalone = false }) {
    if (!explanation) return []
    if (standalone) return commentPosition(explanation, seed)
    // 詰みの局面は、直前の手と次の一手の文で詰みに触れているので書かない
    if (explanation.level === 'mate' || explanation.level === 'mated') return []
    if (!notation || !previousExplanation) return []

    const prevRank = levelRank(previousExplanation, mover)
    const currRank = levelRank(explanation, mover)
    if (prevRank === null || currRank === null) return []
    const side = SIDE_LABELS[mover]
    const bad = isBadMove(mover, before, after, playedLoss)
    // 悪くなった変化は、疑問手なら「〜は疑問手だったかもしれず、」と前に付ける
    const worse = (result) => (bad ? `${notation}は疑問手だったかもしれず、${result}` : `${notation}で${result}`)

    if (prevRank === currRank) {
        return bad ? [text(`${notation}は疑問手だったかもしれません。`)] : []
    }
    // 評価の動きが疑問手の判定と同じ NOTABLE_CHANGE（300）に届かないときは、段階の境目をまたいだだけと見て
    // 「形勢を損ねた」「リードを広げた」のように動きを言わず、今の形勢だけを書く
    const gain = moverGain(mover, before, after)
    if (gain !== null && Math.abs(gain) < NOTABLE_CHANGE && Math.abs(prevRank) !== 4) return commentPosition(explanation, seed)
    let change
    if (prevRank === 4) change = worse('詰みを逃したようです。')
    else if (prevRank === -4) change = `${notation}で${side}が詰み筋から逃れたようです。`
    else if (prevRank < 0 && currRank > 0) change = `${notation}で${side}が形勢を逆転したようです。`
    else if (prevRank > 0 && currRank < 0) change = worse('形勢が入れ替わったようです。')
    else if (prevRank === 0) change = currRank > 0 ? `${notation}で${side}が形勢を引き寄せたようです。` : worse('形勢を損ねたようです。')
    else if (currRank === 0) change = prevRank > 0 ? worse(`${side}のリードが消えたようです。`) : `${notation}で${side}が追いついたようです。`
    else if (prevRank > 0) change = currRank > prevRank ? `${notation}で${side}がリードを広げたようです。` : worse(`${side}のリードが縮まったようです。`)
    else change = currRank > prevRank ? `${notation}で${side}が差を詰めたようです。` : worse('差が広がったようです。')
    return [text(change), ...commentPosition(explanation, seed)]
}

