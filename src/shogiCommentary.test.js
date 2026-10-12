import assert from 'node:assert/strict'
import test from 'node:test'
import { commentAlternatives, commentFormChange, commentMove, commentPlan, commentPosition, lossOfPlayedMove } from './shogiCommentary.js'

const join = (parts) => parts.map((part) => part.text).join('')
const effect = (kind, ren, end, squares = [{ row: 0, col: 0 }]) => ({ kind, ren, end, squares })

test('直前の手は「▲〜と〜し、〜しました」と事実を述べる文にする', () => {
    const parts = commentMove({
        notation: '△４六角',
        mover: 'gote',
        effects: [effect('capture', '歩を取り', '歩を取る'), effect('fork', '４五の桂と１九の香に両取りをかけ', '４五の桂と１九の香に両取りをかける')],
        seed: 'a',
    })
    assert.match(join(parts), /^△４六角と歩を取り、４五の桂と１九の香に両取りをかけました。/)
    // 盤上の根拠がある部分は強調できる
    assert.equal(parts.filter((part) => part.squares.length).length, 2)
})

test('取られる形の注意と評価の悪化が続いても「ただ、」を重ねない', () => {
    const text = join(commentMove({
        notation: '▲４五金',
        mover: 'sente',
        effects: [effect('capture', '銀を取り', '銀を取る'), effect('hanging', '４五の金が取られる形になり', '４五の金が取られる形になる')],
        before: { score: 400, mate: null },
        after: { score: -150, mate: null },
        seed: 'b',
    }))
    assert.match(text, /４五の金が取られる形になりました。/)
    assert.doesNotMatch(text, /注意|気をつけ/)
    assert.ok((text.match(/ただ、/g)?.length ?? 0) <= 1, text)
    assert.match(text, /逆転|実際、/)
})

test('評価が上がった手は、指した側が形勢を引き寄せたと書く', () => {
    const text = join(commentMove({
        notation: '▲３三桂成', mover: 'sente', effects: [], before: { score: 100, mate: null }, after: { score: 600, mate: null }, seed: 'c',
    }))
    assert.match(text, /先手/)
    assert.match(text, /引き寄せ|会心/)
})

test('局面の理由を2つつなぎ、逆向きの要因は「一方で」で添える', () => {
    const clause = (text) => ({ text, squares: [] })
    const text = join(commentPosition({
        level: 'advantage',
        winner: 'sente',
        mate: null,
        reasons: [
            { side: 'sente', clauses: [clause('先手玉は金銀3枚に守られ、後手玉より堅い')] },
            { side: 'sente', clauses: [clause('先手は敵陣の5か所に利きを利かせ、盤上の30マスで利きが上回っている')] },
        ],
        counter: { side: 'gote', clauses: [clause('後手が歩3枚得している')] },
        note: null,
    }, 'd'))
    // 形勢はエンジンの判断なので言い切らない
    assert.match(text, /^(先手が有利と見られます。|形勢は先手が有利のようです。)/)
    assert.doesNotMatch(text, /有利です。/)
    assert.match(text, /堅いうえ(に)?、先手は敵陣/)
    assert.match(text, /一方で、後手が歩3枚得しているので、後手にも/)
})

test('評価値がほとんど変わらない手には、評価の一文を付けない', () => {
    const text = join(commentMove({
        notation: '▲７六歩', mover: 'sente', effects: [effect('open-line', '角道を開け', '角道を開ける')],
        before: { score: 30, mate: null }, after: { score: 40, mate: null }, seed: 'e',
    }))
    assert.equal(text, '▲７六歩と角道を開けました。')
})

test('疑問手かどうかは、同じ探索での最善手との評価差で判断する', () => {
    const args = { notation: '△３六歩', mover: 'gote', effects: [effect('capture', '歩を取り', '歩を取る')], before: { score: 500, mate: null }, after: { score: 900, mate: null }, seed: 'p' }
    const candidates = (playedScore) => [
        { usi: '7g7f', score: 500, mate: null },
        { usi: '3c3d', score: playedScore, mate: null },
        { usi: '8c8d', score: 2500, mate: null },
    ]
    // 最善手なら、前後の評価が下がっていても言わない
    assert.doesNotMatch(join(commentMove({ ...args, playedLoss: lossOfPlayedMove(candidates(600), '7g7f', 'gote') })), /疑問手|損ね/)
    // 2番手でも差が小さければ言わない
    assert.doesNotMatch(join(commentMove({ ...args, playedLoss: lossOfPlayedMove(candidates(600), '3c3d', 'gote') })), /疑問手|損ね/)
    // 2番手でも最善手との差が大きければ言う（1手だけが良く、他は大きく悪い局面）
    assert.match(join(commentMove({ ...args, playedLoss: lossOfPlayedMove(candidates(1000), '3c3d', 'gote') })), /疑問手|損ね/)
    // 候補外で、最後の候補手でも最善手と大差があるなら言う
    assert.match(join(commentMove({ ...args, playedLoss: lossOfPlayedMove(candidates(1000), '1c1d', 'gote') })), /疑問手|損ね/)
})

test('攻めと受けの両方の効果がある手は「攻防の一手」と言う', () => {
    const text = join(commentMove({
        notation: '▲５五角', mover: 'sente', seed: 'i',
        effects: [effect('block-line', '相手の飛車の利きを止め', '相手の飛車の利きを止める'), effect('target', '３三の銀に狙いをつけ', '３三の銀に狙いをつける')],
    }))
    assert.match(text, /攻めと受けを兼ねた一手です。$/)
})

test('書くことがない手（効果も狙いも評価の変化もない）は何も返さない', () => {
    assert.deepEqual(commentMove({ notation: '▲２六歩', mover: 'sente', effects: [], before: { score: 20, mate: null }, after: { score: 30, mate: null }, seed: 'j' }), [])
})

test('評価の変化が小さい（200未満）ときは「悪手かも」と言わない', () => {
    const text = join(commentMove({
        notation: '▲７五歩', mover: 'sente', effects: [effect('capture', '歩を取り', '歩を取る')],
        before: { score: 350, mate: null }, after: { score: 210, mate: null }, seed: 'k',
    }))
    assert.doesNotMatch(text, /下がり|損ね/)
})

test('前置きの「エンジンは」「評価値の上では」を付けない', () => {
    const clause = (value) => ({ text: value, squares: [] })
    for (const level of ['even', 'slight', 'advantage', 'winning']) {
        for (const seed of ['a', 'b', 'c', 'd']) {
            const text = join(commentPosition({ level, winner: 'sente', mate: null, reasons: [{ side: 'sente', clauses: [clause('先手が歩得している')] }], counter: null, note: null }, seed))
            assert.doesNotMatch(text, /エンジン|評価値の上では/)
        }
    }
    assert.doesNotMatch(join(commentPlan({ candidates: [{ notation: '▲７六歩', score: 0, mate: null, effects: [] }], seed: 'x' })), /エンジン/)
})

test('直前の局面と理由が同じなら、形勢の一文だけにする', () => {
    const clause = (value) => ({ text: value, squares: [] })
    const explanation = { level: 'slight', winner: 'sente', mate: null, reasons: [{ side: 'sente', clauses: [clause('先手が歩2枚得している')] }], counter: null, note: null }
    const text = join(commentPosition(explanation, 'l', structuredClone(explanation)))
    assert.doesNotMatch(text, /歩2枚/)
    assert.match(join(commentPosition(explanation, 'l', null)), /歩2枚/)
})

test('優勢の局面では、逆向きの要因（相手にも楽しみ）を書かない', () => {
    const clause = (value) => ({ text: value, squares: [] })
    const text = join(commentPosition({
        level: 'winning', winner: 'sente', mate: null,
        reasons: [{ side: 'sente', clauses: [clause('後手玉に王手がかかっている')] }],
        counter: { side: 'gote', clauses: [clause('手番の後手が４二の馬をタダで取れる')] }, note: null,
    }, 'm'))
    assert.doesNotMatch(text, /楽しみ|反撃の余地|一方で/)
})

test('評価が下がっていない手で自分の駒が取られる形なら「捨てて踏み込んだ」と言う', () => {
    const hanging = { ...effect('hanging', '４二の馬が取られる形になり', '４二の馬が取られる形になる'), sacrifice: { square: '４二', name: '馬', drop: false, forcing: true } }
    const effects = [effect('cut', '当たっていた角を切り', '当たっていた角を切る'), effect('check', '王手をかけ', '王手をかける'), hanging]
    const intended = join(commentMove({ notation: '▲４二角成', mover: 'sente', effects, before: { score: 1235, mate: null }, after: { score: 1233, mate: null }, seed: 'n' }))
    assert.match(intended, /踏み込/)
    assert.doesNotMatch(intended, /注意|気をつけ/)
    // 評価が大きく下がったなら、うっかりの可能性があるので取られる形になったことを書く
    const blunder = join(commentMove({ notation: '▲４二角成', mover: 'sente', effects, before: { score: 1235, mate: null }, after: { score: 300, mate: null }, seed: 'n' }))
    assert.match(blunder, /４二の馬が取られる形になりました。/)
    // 評価が分からなくても、王手や駒を取る手なら踏み込みと見る
    const unknown = join(commentMove({ notation: '▲４二角成', mover: 'sente', effects, seed: 'n' }))
    assert.match(unknown, /踏み込/)
})

test('取り返される駒は、価値に応じて「交換」「交換で駒得」と書く', () => {
    const hanging = (given, givenValue, taken, takenValue) => ({
        ...effect('hanging', '７三の成桂が取られる形になり', '７三の成桂が取られる形になる'),
        sacrifice: { square: '７三', name: '成桂', drop: false, forcing: true, exchange: { taken, takenValue, given, givenValue } },
    })
    const say = (warn) => join(commentMove({ notation: '▲同　桂成', mover: 'sente', effects: [effect('capture', '銀を取り返し', '銀を取り返す'), warn], seed: 'o' }))
    assert.match(say(hanging('桂', 405, '銀', 495)), /取り返されても銀と桂の交換で駒得になる形です。$/)
    assert.match(say(hanging('桂', 405, '桂', 405)), /取り返されても桂の交換です。$/)
})

test('詰んだ局面と詰み筋の局面の解説', () => {
    assert.equal(join(commentPosition({ level: 'mated', winner: 'sente', mate: 0, reasons: [], counter: null, note: null }, 'q')), '後手玉は詰んでいます。先手の勝ちです。')
    assert.equal(join(commentPosition({ level: 'mate', winner: 'sente', mate: 25, reasons: [], counter: null, note: null }, 'q')), '後手玉に25手の詰みがあるようです。')
    // 詰ませた手と、詰み筋に入った手でだけ詰みの一文を書き、次の狙いは書かない
    const next = { kind: 'next', threatKind: 'capture', clause: '▲４四龍で金を取る', squares: [] }
    const finish = join(commentMove({ notation: '▲６四角成', mover: 'sente', effects: [effect('check', '王手をかけ', '王手をかける'), next], before: { score: 0, mate: 1 }, after: { score: 0, mate: 0 }, seed: 'r' }))
    assert.match(finish, /これで後手玉は詰みです。$/)
    assert.doesNotMatch(finish, /次は/)
    const enter = join(commentMove({ notation: '▲７五桂打', mover: 'sente', effects: [effect('check', '王手をかけ', '王手をかける')], before: { score: 5000, mate: null }, after: { score: 0, mate: 21 }, seed: 'r' }))
    assert.match(enter, /この手で後手玉は詰み筋に入ったようです。$/)
    // 1手前の評価が分からないときは、詰み筋に入ったとは言わない
    assert.doesNotMatch(join(commentMove({ notation: '△７四玉', mover: 'gote', effects: [effect('escape-king', '王手をかわし', '王手をかわす')], after: { score: 0, mate: 1 }, seed: 'r' })), /詰み/)
    const middle = join(commentMove({ notation: '▲８四金打', mover: 'sente', effects: [effect('check', '王手をかけ', '王手をかける')], before: { score: 0, mate: 19 }, after: { score: 0, mate: 17 }, seed: 'r' }))
    assert.doesNotMatch(middle, /詰み/)
})

test('大差で負けている側の候補は「苦しい局面で〜などで粘る」と言い、王手がらみ以外の次の狙いは書かない', () => {
    const plan = join(commentPlan({
        sideToMove: 'gote',
        candidates: [{ notation: '△６一玉', score: 3600, mate: null, effects: [] }, { notation: '△５一玉', score: 3620, mate: null, effects: [] }, { notation: '△４一玉', score: 3650, mate: null, effects: [] }],
    }))
    assert.equal(plan, '苦しい局面で、△６一玉、△５一玉、△４一玉などで粘ることになりそうです。')
    const next = { kind: 'next', threatKind: 'capture', clause: '▲４四龍で金を取る', squares: [] }
    const move = join(commentMove({ notation: '▲４三龍', mover: 'sente', effects: [effect('capture', '金を取り', '金を取る'), next], after: { score: 4200, mate: null }, seed: 's' }))
    assert.doesNotMatch(move, /次は/)
})

test('読み筋に続きの手があれば意図として添え、攻めの手なら「含み」、それ以外は「構想」と言う', () => {
    const text = join(commentMove({ notation: '▲３六歩', mover: 'sente', effects: [effect('feature', '３筋の歩を突いて桂の跳ねる地点を空け', '３筋の歩を突いて桂の跳ねる地点を空ける')], plannedNext: { next: '▲３七桂', reply: '△４二玉', replyMatters: false }, seed: 't' }))
    // 攻めの手でなければ「含み」ではなく「構想」
    assert.match(text, /このあと▲３七桂と続ける構想のようです。$/)
    // 相手の応手が前提になる続きは、その前提も書く
    const exchange = join(commentMove({ notation: '▲２四歩', mover: 'sente', effects: [effect('pawn-contact', '２筋の歩をぶつけ', '２筋の歩をぶつけて仕掛ける')], plannedNext: { next: '▲２四飛', reply: '△２四歩', replyMatters: true, nextOnReplySquare: true }, seed: 't' }))
    assert.match(exchange, /△同歩なら▲同飛と続ける含みがありそうです。$/)
})

test('同じ局面では同じ言い回しになる', () => {
    const clause = (value) => ({ text: value, squares: [] })
    const explanation = { level: 'advantage', winner: 'sente', mate: null, reasons: [{ side: 'sente', clauses: [clause('先手が歩得している')] }], counter: null, note: null }
    assert.equal(join(commentPosition(explanation, 'same')), join(commentPosition(explanation, 'same')))
})

test('次の一手は、説明を先に書いてから符号を置き、評価差で「一手」「有力」「考えられます」を言い分ける', () => {
    const plan = (second, effects = []) => join(commentPlan({
        sideToMove: 'gote',
        candidates: [
            { notation: '△７三飛', score: -200, mate: null, effects },
            { notation: '△８二飛', score: second, mate: null, effects: [effect('escape', '当たっていた飛車をかわし', '当たっていた飛車をかわす')] },
            { notation: '△８四飛', score: second + 10, mate: null, effects: [] },
        ],
    }))
    const recapture = [effect('capture', '成桂を取り返し', '成桂を取り返す')]
    assert.equal(plan(300, recapture), 'ここは成桂を取り返す△７三飛の一手です。')
    assert.equal(plan(-50, recapture), '成桂を取り返す△７三飛が有力です。')
    assert.equal(plan(-170, recapture), '成桂を取り返す△７三飛、当たっていた飛車をかわす△８二飛が考えられます。ほかに△８四飛もあります。')
    // 説明がなければ符号だけ
    assert.equal(plan(300), 'ここは△７三飛の一手です。')
})

test('次の一手では、指し手を言い直しているだけの説明は付けず、用語の説明は付ける', () => {
    const text = join(commentPlan({
        sideToMove: 'sente',
        candidates: [
            { notation: '▲２六歩', score: 30, mate: null, effects: [{ ...effect('feature', '飛車先の歩を伸ばし', '飛車先の歩を伸ばす'), restates: false }] },
            { notation: '▲７八金', score: 25, mate: null, effects: [{ ...effect('feature', '左金を上がり', '左金を上がる'), restates: true }] },
            { notation: '▲７六歩', score: 20, mate: null, effects: [effect('open-line', '角道を開け', '角道を開ける')] },
        ],
    }))
    // 説明のない候補（▲７八金）は、説明のある候補の間に挟まず、別の文にする
    assert.equal(text, '飛車先の歩を伸ばす▲２六歩、角道を開ける▲７六歩が考えられます。ほかに▲７八金もあります。')
})

test('詰みの局面では候補を並べず、詰ませる側・詰まされる側で書き分ける', () => {
    const mated = [{ notation: '▲６三銀打', score: 0, mate: 9, effects: [] }, { notation: '▲６四角成', score: 0, mate: 9, effects: [] }]
    assert.equal(join(commentPlan({ candidates: [{ ...mated[0], mate: 1 }, mated[1]], sideToMove: 'sente' })), '▲６三銀打で詰みです。')
    assert.equal(join(commentPlan({ candidates: mated, sideToMove: 'sente' })), '▲６三銀打から9手で詰むようです。')
    assert.equal(join(commentPlan({ candidates: [{ ...mated[0], notation: '△７五桂' }, mated[1]], sideToMove: 'gote' })), 'どう応じても詰みのようです。△７五桂が最も長く粘る手のようです。')
})

test('次の一手で同じ説明の候補はまとめる', () => {
    const escape = () => effect('escape', '当たっていた角をかわし', '当たっていた角をかわす')
    const text = join(commentPlan({
        sideToMove: 'sente',
        candidates: ['▲６六角', '▲７七角', '▲８八角'].map((notation, i) => ({ notation, score: 30 - i, mate: null, effects: [escape()] })),
    }))
    assert.equal(text, '当たっていた角をかわす▲６六角・▲７七角・▲８八角が考えられます。')
})

test('「と」で始まる説明は「〜とと金を」とならないよう「で、」でつなぐ', () => {
    const text = join(commentMove({ notation: '△同　銀', mover: 'gote', effects: [effect('capture', 'と金を取り', 'と金を取る')], seed: 'u' }))
    assert.equal(text, '△同　銀で、と金を取りました。')
})

test('解説を1つにまとめるときは、直前の手の文に評価の変化を含めない', () => {
    const args = { notation: '▲３三桂成', mover: 'sente', effects: [], before: { score: 100, mate: null }, after: { score: 600, mate: null }, seed: 'c' }
    assert.doesNotMatch(join(commentMove({ ...args, includeEvaluation: false })), /引き寄せ|会心/)
})

test('形勢の変化は、形勢の段階がどこからどこへ動いたかで言い方を変える', () => {
    const clause = (value) => ({ text: value, squares: [] })
    const position = (level, winner) => ({ level, winner, mate: null, reasons: [{ side: 'sente', clauses: [clause('先手が歩2枚得している')] }], counter: null, note: null })
    const ev = (score) => ({ score, mate: null })
    const change = (prev, curr, before, after, extra = {}) => join(commentFormChange({
        notation: '▲３三桂成', mover: 'sente', seed: 'f', before: ev(before), after: ev(after),
        // 疑問手かどうかは最善手との差で決まる。既定では最善手を指した（差0）ことにする
        previousExplanation: position(...prev), explanation: position(...curr), playedLoss: { exact: 0, atLeast: null }, ...extra,
    }))
    // 段階が変わらず、疑問手でもなければ書かない
    assert.equal(change(['advantage', 'sente'], ['advantage', 'sente'], 600, 650), '')
    // 段階が変わらなくても、疑問手だったことだけは書く
    assert.equal(change(['winning', 'sente'], ['winning', 'sente'], 2000, 1300, { playedLoss: { exact: 700, atLeast: null } }), '▲３三桂成は疑問手だったかもしれません。')
    // 互角から良くなった・悪くなった
    assert.match(change(['even', null], ['winning', 'sente'], 100, 1200), /^▲３三桂成で先手が形勢を引き寄せたようです。先手が/)
    assert.match(change(['even', null], ['advantage', 'gote'], 0, -600), /^▲３三桂成で形勢を損ねたようです。/)
    // まだ優勢・有利なまま評価を落とした手は「損ねた」と言わない
    const shrink = change(['winning', 'sente'], ['advantage', 'sente'], 1500, 800)
    assert.match(shrink, /^▲３三桂成で先手のリードが縮まったようです。/)
    assert.doesNotMatch(shrink, /損ね/)
    assert.match(change(['winning', 'sente'], ['advantage', 'sente'], 1500, 800, { playedLoss: { exact: 700, atLeast: null } }), /^▲３三桂成は疑問手だったかもしれず、先手のリードが縮まったようです。/)
    assert.match(change(['slight', 'sente'], ['advantage', 'sente'], 400, 700), /^▲３三桂成で先手がリードを広げたようです。/)
    // 互角に戻った
    assert.match(change(['advantage', 'sente'], ['even', null], 700, 100), /^▲３三桂成で先手のリードが消えたようです。/)
    assert.match(change(['advantage', 'gote'], ['even', null], -700, -100), /^▲３三桂成で先手が追いついたようです。/)
    // 劣勢のまま差が縮まった・広がった
    assert.match(change(['winning', 'gote'], ['advantage', 'gote'], -1500, -800), /^▲３三桂成で先手が差を詰めたようです。/)
    assert.match(change(['slight', 'gote'], ['advantage', 'gote'], -300, -700), /^▲３三桂成で差が広がったようです。/)
    // 段階の境目をまたいだだけ（評価の動きが300未満）なら、動きは言わず今の形勢だけ
    assert.match(change(['slight', 'sente'], ['advantage', 'sente'], 300, 580), /^(先手が有利と見られます。|形勢は先手が有利のようです。)/)
    // 優劣が入れ替わった
    assert.match(change(['slight', 'gote'], ['advantage', 'sente'], -300, 700), /^▲３三桂成で先手が形勢を逆転したようです。/)
    assert.match(change(['slight', 'sente'], ['advantage', 'gote'], 300, -700), /^▲３三桂成で形勢が入れ替わったようです。/)
    // 直前の評価がなければ変化は語れない
    assert.deepEqual(commentFormChange({ notation: '▲３三桂成', mover: 'sente', after: ev(1200), explanation: position('winning', 'sente') }), [])
    // 棋譜の手を選んでいないときは今の形勢を書く
    assert.match(join(commentFormChange({ explanation: position('slight', 'sente'), seed: 'f', standalone: true })), /先手/)
})

test('次の一手は、直前の手に続けるときは「これに対して後手は、」のように手番の側を名指しして書き出す', () => {
    const candidates = [{ notation: '△７三飛', score: 100, mate: null, effects: [] }, { notation: '△８二飛', score: 600, mate: null, effects: [] }]
    const reply = join(commentPlan({ seed: 'r', candidates, sideToMove: 'gote', lead: 'reply' }))
    assert.match(reply, /^(これに対して後手は|対する後手は|後手としては)△７三飛の一手です。$/)
    assert.equal(join(commentPlan({ seed: 'r', candidates, sideToMove: 'gote', lead: 'turn' })), '後手は△７三飛の一手です。')
    // 書き出しがないときは従来どおり
    assert.equal(join(commentPlan({ seed: 'r', candidates, sideToMove: 'gote' })), 'ここは△７三飛の一手です。')
})

test('次の一手では、最善手と大差のある候補は挙げず、候補がいくつあっても最大3手にする', () => {
    const c = (notation, score) => ({ notation, score, mate: null, effects: [] })
    // 1・2番手は+500前後、3番手は-100：3番手は挙げない
    const text = join(commentPlan({ seed: 'g', candidates: [c('▲２四歩', 520), c('▲７六歩', 480), c('▲１六歩', -100)], sideToMove: 'sente' }))
    assert.match(text, /▲２四歩/)
    assert.match(text, /▲７六歩/)
    assert.doesNotMatch(text, /▲１六歩/)
    // 5手とも僅差でも、挙げるのは3手まで
    const five = join(commentPlan({ seed: 'g', candidates: [c('▲２四歩', 50), c('▲７六歩', 45), c('▲１六歩', 40), c('▲９六歩', 35), c('▲４八銀', 30)], sideToMove: 'sente' }))
    assert.equal((five.match(/▲/g) ?? []).length, 3)
})

test('符号の前の説明が2つ続くときは読点を付けない（後ろがマスの数字で始まるときだけ付ける）', () => {
    const c = (notation, score, effects) => ({ notation, score, mate: null, effects })
    const escape = effect('escape', '当たっていた飛車をかわし', '当たっていた飛車をかわす')
    const take = effect('capture', '歩を取り', '歩を取る')
    const target = effect('target', '９七の角に狙いをつけ', '９七の角に狙いをつける')
    const plan = (effects) => join(commentPlan({ seed: 's', candidates: [c('▲６四飛', 500, effects), c('▲２八飛', 0, [])], sideToMove: 'sente' }))
    assert.match(plan([escape, take]), /当たっていた飛車をかわし歩を取る▲６四飛/)
    assert.match(plan([take, target]), /歩を取り、９七の角に狙いをつける▲６四飛/)
})

test('次の一手で、別々の駒を取る候補は「・」でまとめず、場所を付けて区別する', () => {
    const c = (notation, score, effects) => ({ notation, score, mate: null, effects })
    const takeAt = (row, col) => [effect('capture', '歩を取り', '歩を取る', [{ row, col }])]
    // ３五の歩を取る▲３五歩と、７五の歩を取る▲７五角
    const text = join(commentPlan({ seed: 'h', candidates: [c('▲４五桂', 300, []), c('▲３五歩', 290, takeAt(4, 6)), c('▲７五角', 280, takeAt(4, 2))], sideToMove: 'sente' }))
    assert.match(text, /３五の歩を取る▲３五歩、７五の歩を取る▲７五角/)
    // 同じ駒を取る候補はこれまでどおりまとめる
    const same = join(commentPlan({ seed: 'h', candidates: [c('▲３五歩', 300, takeAt(4, 6)), c('▲３五角', 290, takeAt(4, 6))], sideToMove: 'sente' }))
    assert.match(same, /歩を取る▲３五歩・▲３五角/)
})

test('合法手が1つしかないときは「〜しかありません」と言う', () => {
    const only = [{ notation: '△４二玉', score: 1500, mate: null, effects: [effect('escape-king', '王手をかけていた馬を取り返し', '王手をかけていた馬を取り返す')] }]
    assert.equal(join(commentPlan({ seed: 'o', candidates: only, sideToMove: 'gote', lead: 'turn', onlyMove: true })), '後手は王手をかけていた馬を取り返す△４二玉しかありません。')
    // 探索が終わっていない（onlyMove でない）ときは従来どおり
    assert.match(join(commentPlan({ seed: 'o', candidates: only, sideToMove: 'gote', lead: 'turn' })), /有力です/)
    // 詰まされる側
    assert.equal(join(commentPlan({ seed: 'o', candidates: [{ ...only[0], mate: 5 }], sideToMove: 'gote', onlyMove: true })), 'ここは王手をかけていた馬を取り返す△４二玉しかありません。この先は詰みのようです。')
})

test('取られる場所に指す手は、攻めの手なら「踏み込んだ」、受けの手なら「受けに回った」と書き分ける', () => {
    const warn = (attacking) => ({ kind: 'hanging', ren: '４五の馬が取られる形になり', end: '４五の馬が取られる形になる', squares: [{ row: 4, col: 5 }],
        sacrifice: { square: '４五', name: '馬', drop: false, forcing: true, attacking } })
    const args = (attacking) => ({ notation: '▲４五馬', mover: 'sente', effects: [effect('capture', '金を取り', '金を取る'), warn(attacking)],
        before: { score: 100, mate: null }, after: { score: 120, mate: null }, playedLoss: { exact: 0, atLeast: null }, seed: 's' })
    assert.match(join(commentMove(args(true))), /踏み込/)
    const defensive = join(commentMove(args(false)))
    assert.match(defensive, /受け/)
    assert.doesNotMatch(defensive, /踏み込/)
})

test('疑問手には「▲〜では▲〜が有力でした」と指すべきだった手とその理由を添える', () => {
    const clause = (value) => ({ text: value, squares: [] })
    const position = (level, winner) => ({ level, winner, mate: null, reasons: [{ side: 'sente', clauses: [clause('後手が歩2枚得している')] }], counter: null, note: null })
    const betterMove = {
        notation: '▲２四歩', usi: '2e2d',
        effects: [effect('pawn-contact', '２筋の歩をぶつけ', '２筋の歩をぶつける')],
        insight: { kind: 'pawn-exchange', planText: '▲２四歩は飛車先の歩交換を狙う手です。' },
    }
    const args = { notation: '▲７九金', mover: 'sente', seed: 'b', before: { score: 100, mate: null }, after: { score: -400, mate: null },
        playedLoss: { exact: 500, atLeast: null }, previousExplanation: position('even', null), explanation: position('slight', 'gote'), betterMove }
    const text = join(commentFormChange(args))
    assert.match(text, /▲７九金は疑問手だったかもしれず、形勢を損ねたようです。▲７九金では２筋の歩をぶつける▲２四歩が有力でした。▲２四歩は飛車先の歩交換を狙う手です。/)
    // 疑問手でなければ書かない
    assert.doesNotMatch(join(commentFormChange({ ...args, after: { score: 50, mate: null }, playedLoss: { exact: 0, atLeast: null }, explanation: position('even', null) })), /有力でした/)
})

test('王手でないのにどう応じても詰む形にした手は「必至」、王手なら「詰み筋に入った」と書く', () => {
    const args = { notation: '▲５二金', mover: 'sente', effects: [effect('target', '４一の金に狙いをつけ', '４一の金に狙いをつける')], seed: 'm',
        before: { score: 1500, mate: null }, after: { score: 0, mate: 9 } }
    assert.match(join(commentMove({ ...args, enemyInCheck: false })), /後手玉に必至がかかったようです/)
    assert.match(join(commentMove({ ...args, enemyInCheck: true })), /詰み筋に入ったようです/)
})

test('詰めろ・詰めろの解消・詰めろ逃れの詰めろを書き分ける', () => {
    const args = { notation: '▲５二金', mover: 'sente', effects: [effect('target', '４一の金に狙いをつけ', '４一の金に狙いをつける')], seed: 'm',
        before: { score: 800, mate: null }, after: { score: 900, mate: null } }
    assert.match(join(commentMove({ ...args, mateNet: { threat: '▲６二金打', resolved: false } })), /この手は詰めろで、次に▲６二金打からの詰みがあります。/)
    assert.match(join(commentMove({ ...args, mateNet: { threat: null, resolved: true } })), /この手で自玉の詰めろを解消しました。/)
    assert.match(join(commentMove({ ...args, mateNet: { threat: '▲６二金打', resolved: true } })), /詰めろ逃れの詰め/)
    // 詰めろを書くときは、駒を取る程度の「次は〜」は書かない
    const next = { kind: 'next', threatKind: 'capture', clause: '▲４一金で金を取る', squares: [] }
    assert.doesNotMatch(join(commentMove({ ...args, effects: [...args.effects, next], mateNet: { threat: '▲６二金打', resolved: false } })), /次は▲４一金/)
})

test('候補に入らない自然に見える手は「〜したくなりますが、〜と返されるのが厳しいようです」と書く', () => {
    const text = join(commentAlternatives([
        { notation: '△同歩', verb: 'recapture', pieceName: '歩', refutation: '▲２三歩打', insight: null },
        { notation: '△２九龍', verb: 'capture', pieceName: '桂', refutation: '▲５五角', insight: { planText: '▲５五角は王手飛車取りです。' } },
    ]))
    assert.equal(text, '△同歩と取り返したくなりますが、▲２三歩打と返されるのが厳しいようです。△２九龍で桂を取りたくなりますが、▲５五角と返されるのが厳しいようです。▲５五角は王手飛車取りです。')
})

test('僅差の候補の方針（読み筋から決めたもの）が攻めと受けに割れているときは「方針が分かれる」と書く', () => {
    const c = (notation, score, style) => ({ notation, score, mate: null, effects: [], style })
    const plan = (candidates, comparePlans = true) => join(commentPlan({ seed: 'p', candidates, sideToMove: 'sente', comparePlans }))
    assert.match(plan([c('▲２四歩', 50, 'attack'), c('▲６八銀', 40, 'defense')]), /攻める▲２四歩と、受ける▲６八銀で方針が分かれるところです。/)
    // 読み筋から方針が決まらない候補があれば書かない
    assert.doesNotMatch(plan([c('▲２四歩', 50, 'attack'), c('▲５八玉', 40, null)]), /方針が分かれる/)
    // 比べない設定では書かない
    assert.doesNotMatch(plan([c('▲２四歩', 50, 'attack'), c('▲６八銀', 40, 'defense')], false), /方針/)
})
