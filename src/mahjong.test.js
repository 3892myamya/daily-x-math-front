import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shanten, waitingKinds } from './mahjongShanten.js'
import { scoreWin } from './mahjongScore.js'
import { MahjongGame } from './mahjongGame.js'
import { CPU_IDS, decideDiscard, readOpenHand, callAdvice, aimChoices, hintFor, tenpaiInfo } from './mahjongAI.js'
import { danger } from './mahjongAI.js'

// "123m456p" → kind counts.
function counts(text) {
    const c = new Array(34).fill(0)
    for (const [, nums, suit] of text.matchAll(/(\d+)([mpsz])/g)) {
        for (const n of nums) c['mpsz'.indexOf(suit) * 9 + Number(n) - 1]++
    }
    return c
}

// Physical tile ids for a notation (0 = red five).
function ids(text) {
    const used = new Set()
    const out = []
    for (const [, nums, suit] of text.matchAll(/(\d+)([mpsz])/g)) {
        for (const ch of nums) {
            const k = 'mpsz'.indexOf(suit) * 9 + (ch === '0' ? 5 : Number(ch)) - 1
            let id = k * 4 + (ch === '0' ? 0 : 1)
            while (used.has(id)) id++
            used.add(id)
            out.push(id)
        }
    }
    return out
}

test('shanten of standard, seven pairs and thirteen orphans shapes', () => {
    assert.equal(shanten(counts('123m456p789s11122z')), -1)
    assert.equal(shanten(counts('123m456p789s1112z')), 0)
    assert.equal(shanten(counts('1133557799m1144z')), -1)
    assert.equal(shanten(counts('19m19p19s1234567z')), 0)
    assert.equal(shanten(counts('147m258p369s1234z')), 6)
    assert.equal(shanten(counts('23m456p11z'), 2), 0)
})

test('waits of a nine-sided wait', () => {
    assert.deepEqual(waitingKinds(counts('1112345678999m')), [0, 1, 2, 3, 4, 5, 6, 7, 8])
})

test('ron scoring with riichi, red five and honba-free payment', () => {
    const result = scoreWin({
        concealed: ids('234m406p23467s55p'), winTile: ids('5s')[0], melds: [], tsumo: false,
        roundWind: 0, seatWind: 1, riichi: true, doraKinds: [], uraKinds: [],
    })
    assert.equal(result.han, 4)
    assert.equal(result.points, 7700)
    assert.deepEqual(result.payments, [7700])
})

test('an open hand without yaku cannot win', () => {
    const result = scoreWin({
        concealed: ids('11z45p'), winTile: ids('3p')[0], melds: [{ tiles: ids('234s') }, { tiles: ids('567s') }, { tiles: ids('406m') }],
        tsumo: false, roundWind: 0, seatWind: 1, doraKinds: [], uraKinds: [],
    })
    assert.equal(result.hasYaku, false)
})

test('danger labels for genbutsu and suji', () => {
    const visible = new Array(34).fill(0)
    const safe = new Set([3]) // 4m
    assert.equal(danger(3, safe, visible).label, '現物')
    assert.equal(danger(0, safe, visible).label, 'スジの1・9')
    assert.equal(danger(6, safe, visible).label, 'スジの3・7')
    assert.equal(danger(4, safe, visible).label, '無スジの中張牌')
})

test('simulated hanchans keep 136 tiles and 100000 points', () => {
    for (let g = 0; g < 3; g++) {
        const game = new MahjongGame({ seed: 42 + g, seats: CPU_IDS.slice(g, g + 4) })
        let steps = 0
        while (!game.over) {
            game.step()
            structuredClone(game)
            assert.ok(++steps < 5000)
            assert.equal(game.scores.reduce((a, b) => a + b, 0) + game.kyotaku * 1000, 100000)
            if (game.phase !== 'play') continue
            const tiles = game.players.reduce((n, pl) => n + pl.hand.length + pl.river.filter(r => !r.called).length
                + pl.melds.reduce((a, m) => a + m.tiles.length, 0), 0) + game.wall.length + 14
            assert.equal(tiles, 136)
        }
        assert.equal(game.finalRanking.length, 4)
    }
})

test('a restored snapshot replays the same game', () => {
    const game = new MahjongGame({ seed: 7, seats: CPU_IDS.slice(0, 4) })
    for (let i = 0; i < 150; i++) game.step()
    const snapshot = structuredClone(game)
    while (!game.over) game.step()
    const copy = MahjongGame.restore(snapshot)
    while (!copy.over) copy.step()
    assert.deepEqual(copy.scores, game.scores)
    assert.deepEqual(copy.history, game.history)
})

// Plays the human seat with the hint (and sometimes calls) to cover the human paths.
function playHumanGame(seed) {
    const game = new MahjongGame({ seed, seats: ['kei', 'goro', 'human', 'dai'] })
    let steps = 0
    let prompts = 0
    while (!game.over) {
        assert.ok(++steps < 8000)
        if (game.prompt) {
            prompts++
            if (game.prompt.kind === 'turn') {
                const o = game.humanTurnOptions()
                const pl = game.players[game.humanSeat]
                if (o.canTsumo) game.humanTsumo()
                else if (o.kans.length) game.humanKan(o.kans[0])
                else if (o.riichiLocked) game.humanDiscard(pl.lastDraw)
                else {
                    const kind = o.hint.recommendation.kind
                    const id = pl.hand.find(x => x >> 2 === kind)
                    game.humanDiscard(id, o.hint.recommendation.riichi)
                }
            } else {
                const pr = game.prompt
                game.humanReact(pr.ron ? 'ron' : (steps % 3 === 0 ? 0 : 'skip'))
            }
        } else {
            assert.ok(game.step(), 'a step without a prompt makes progress')
        }
        assert.equal(game.scores.reduce((a, b) => a + b, 0) + game.kyotaku * 1000, 100000)
        // The screen keeps a copy of every position (棋譜・戻る); the state must stay plain data.
        structuredClone(game)
        if (game.phase !== 'play') continue
        const tiles = game.players.reduce((n, pl) => n + pl.hand.length + pl.river.filter(r => !r.called).length
            + pl.melds.reduce((a, m) => a + m.tiles.length, 0), 0) + game.wall.length + 14
        assert.equal(tiles, 136)
    }
    return prompts
}

test('a game with a human seat finishes and keeps the invariants', () => {
    for (let seed = 1; seed <= 3; seed++) assert.ok(playHumanGame(seed) > 10)
})

test('scoring a concealed kan and a rinshan win', () => {
    const result = scoreWin({
        concealed: ids('234m678p5s'), winTile: ids('5s')[0], melds: [{ type: 'ankan', tiles: ids('1111z') }, { type: 'ankan', tiles: ids('9999p') }],
        tsumo: true, kan: true, roundWind: 0, seatWind: 1, doraKinds: [], uraKinds: [],
    })
    assert.ok(result.yaku.some(y => y.name === '嶺上開花'))
    assert.ok(result.yaku.some(y => y.name === '門前清自摸和'))
})

test('tenpai candidates carry the points of each wait', () => {
    const game = new MahjongGame({ seed: 3, seats: CPU_IDS.slice(0, 4) })
    game.step()
    // Cutting 東 leaves 234m 567p 234s 55s 89m: a closed 7m wait, counted with riichi.
    game.players[game.dealer].hand = ids('234m567p23455s89m1z')
    const decision = decideDiscard(game, game.dealer)
    const row = decision.analysis.candidates.find(c => c.kind === 27)
    assert.deepEqual(row.waits.map(w => w.kind), [6])
    assert.ok(row.waits[0].yaku.includes('立直'))
    assert.ok(row.waits[0].points >= 1000)
})

test('reading 染め手 from calls and the river', () => {
    const game = new MahjongGame({ seed: 1, seats: CPU_IDS.slice(0, 4) })
    game.step()
    const pl = game.players[1]
    const read = (melds, river) => {
        pl.melds = melds.map(text => ({ type: 'pon', tiles: ids(text) }))
        pl.river = ids(river).map(id => ({ id }))
        return readOpenHand(game, 1).some
    }
    // A 東 pon with a river of honors and one 9m: not enough to call it 染め.
    assert.equal(read(['111z'], '67z9m5z'), null)
    // A 白 pon, man and sou thrown away twice each, no pin: pin 染め.
    assert.equal(read(['555z'], '26m17s2z'), 1)
})

test('a tenpai whose wait is already discarded is furiten and valued as tsumo only', () => {
    const game = new MahjongGame({ seed: 3, seats: CPU_IDS.slice(0, 4) })
    game.step()
    const p = game.dealer
    // 45678m 66p 666s 東東東 + 9p: cutting 9p waits on 3m・6m・9m.
    game.players[p].hand = ids('45678m66p666s111z9p')
    const row = () => decideDiscard(game, p).analysis.candidates.find(c => c.kind === 17)
    assert.equal(row().waits[0].furiten, false)
    // With 9m in the river every wait is furiten, and the points are those of a tsumo.
    game.players[p].river = ids('9m').map(id => ({ id }))
    const furiten = row()
    assert.ok(furiten.waits.every(w => w.furiten))
    assert.ok(furiten.waits.find(w => w.kind === 5).yaku.includes('門前清自摸和'))
})

test('hesitation never swaps an off-plan tile for one of the plan (入門アヤ染め手)', () => {
    const game = new MahjongGame({ seed: 5, seats: ['kei', 'goro', 'nana', 'aya'], levels: ['advanced', 'novice', 'novice', 'novice'] })
    game.step()
    const p = 3
    const pl = game.players[p]
    // The screenshot: calls 123s and 456s, hand 7p 1s 3s 9s 9s 西 發 + 5s drawn.
    pl.melds = [
        { type: 'chi', tiles: ids('123s').map(id => id + 2), calledTile: ids('2s')[0] + 2, from: 2 },
        { type: 'chi', tiles: ids('456s').map(id => id + 2), calledTile: ids('6s')[0] + 2, from: 2 },
    ]
    pl.hand = ids('7p1399s37z5s')
    for (let state = 1; state <= 40; state++) {
        game.rngState = state * 7919
        const kind = decideDiscard(game, p).id >> 2
        assert.ok(kind < 18 || kind >= 27, `cut ${kind} from the 索子 being collected`)
    }
})

test('the human\'s 狙い役 leads the plan and the call advice', () => {
    const game = new MahjongGame({ seed: 5, seats: CPU_IDS.slice(0, 4) })
    game.step()
    const from = game.dealer
    const p = (from + 1) % 4
    const pl = game.players[p]
    pl.hand = ids('77z11m55p99s24m6p8s3s')
    const chun = ids('7777z')[2]
    const auto = aimChoices(game, p)
    assert.equal(auto.active, auto.auto)
    pl.aim = 'chiitoi'
    assert.equal(aimChoices(game, p).active, 'chiitoi')
    const advice = callAdvice(game, p, chun, from)
    assert.equal(advice.action, 'skip')
    assert.match(advice.text, /七対子が狙えなくなる/)
    // A plan that is not possible is ignored.
    pl.aim = 'kokushi'
    const lost = aimChoices(game, p)
    assert.ok(lost.lost)
    assert.equal(lost.active, auto.auto)
})

test('壁 (no-chance) for 上級, honors by sight for 中級', () => {
    const safe = new Set()
    const visible = new Array(34).fill(0)
    visible[6] = 4 // 7m all visible: 8m and 9m cannot be a 両面 wait
    assert.equal(danger(8, safe, visible, 'full').label, 'ノーチャンスの1・9')
    assert.equal(danger(7, safe, visible, 'full').label, 'ノーチャンスの2・8')
    assert.equal(danger(8, safe, visible, 'suji').label, '無スジの1・9')
    // 6m: the side 7m・8m is closed, the side 4m・5m is open.
    assert.equal(danger(5, safe, visible, 'full').label, '片側ノーチャンス')
    visible[27] = 2
    assert.equal(danger(27, safe, visible, 'suji').label, '字牌（2枚見え）')
})

test('東風戦 ends after 東4局 (or earlier on トビ or the dealer stopping)', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const game = new MahjongGame({ seed, seats: CPU_IDS.slice(0, 4), length: 'tonpu' })
        while (!game.over) game.step()
        assert.ok(game.history.every(h => h.roundName.startsWith('東')))
        assert.equal(game.scores.reduce((a, b) => a + b, 0) + game.kyotaku * 1000, 100000)
    }
})

// What the human sees (recommendations, 狙い役, call advice, the count of their waits) may depend only
// on what the human can see. Swapping the hidden tiles (the CPUs' hands, the wall, the unrevealed dead
// wall) around must not change any of it; a difference means hidden information leaks to the screen.
function humanView(game) {
    const h = game.humanSeat
    const pr = game.prompt
    return JSON.stringify({
        turn: pr?.kind === 'turn' ? game.humanTurnOptions() : null,
        call: pr?.kind === 'react' && !pr.ron ? callAdvice(game, h, pr.id, pr.from) : null,
        aim: aimChoices(game, h),
        waits: tenpaiInfo(game, h, h),
    })
}

function shuffleHidden(game, rng) {
    const h = game.humanSeat
    const revealed = new Set(game.doraIndicators)
    const places = [
        ...game.players.filter((_, p) => p !== h).map(pl => pl.hand),
        game.wall, game.rinshanTiles, game.uraPool, game.uraIndicators,
    ]
    const hidden = [...new Set([...places.flat(), ...game.doraPool.filter(id => !revealed.has(id))])]
    const shuffled = [...hidden]
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const map = new Map(hidden.map((id, i) => [id, shuffled[i]]))
    const swap = id => map.get(id) ?? id
    for (const list of places) list.splice(0, list.length, ...list.map(swap))
    game.doraPool = game.doraPool.map(id => revealed.has(id) ? id : swap(id))
    game.players.forEach((pl, p) => { if (p !== h && pl.lastDraw !== null) pl.lastDraw = swap(pl.lastDraw) })
}

test('nothing hidden leaks into what the human is shown', () => {
    let checked = 0
    for (let seed = 1; seed <= 4; seed++) {
        const game = new MahjongGame({ seed, seats: ['kei', 'goro', 'human', 'dai'] })
        let rngState = seed * 7919
        const rng = () => ((rngState = (rngState * 48271) % 2147483647) / 2147483647)
        let steps = 0
        while (!game.over && ++steps < 8000) {
            if (game.prompt) {
                if (game.phase === 'play') {
                    const copy = MahjongGame.restore(structuredClone(game))
                    shuffleHidden(copy, rng)
                    assert.equal(humanView(copy), humanView(game), `seed ${seed} step ${steps}: hidden tiles changed what the human sees`)
                    checked++
                }
                if (game.prompt.kind === 'turn') {
                    const o = game.humanTurnOptions()
                    const pl = game.players[game.humanSeat]
                    if (o.canTsumo) game.humanTsumo()
                    else if (o.riichiLocked) game.humanDiscard(pl.lastDraw)
                    else {
                        const kind = o.hint.recommendation.kind
                        game.humanDiscard(pl.hand.find(x => x >> 2 === kind), o.hint.recommendation.riichi)
                    }
                } else {
                    game.humanReact(game.prompt.ron ? 'ron' : (steps % 3 === 0 ? 0 : 'skip'))
                }
            } else {
                game.step()
            }
        }
    }
    assert.ok(checked > 200, `checked ${checked} decisions`)
})

test('チャンタ and 三元 plan distances', async () => {
    const { chantaShanten, sangenDistance } = await import('./mahjongPlan.js')
    assert.equal(chantaShanten(counts('12311m789p999s111z'), 0), -1)
    assert.equal(chantaShanten(counts('1231m789p999s111z'), 0), 0)
    // 4-5-6 are no use to チャンタ.
    assert.ok(chantaShanten(counts('456m456p456s5566z'), 0) >= 4)
    // An open 789 chi counts as one of the sets.
    assert.equal(chantaShanten(counts('12311m789p11z'), 1), 0)
    assert.equal(sangenDistance(counts('555666777z12344p'), [], false), -1)
    assert.equal(sangenDistance(counts('55566677z123m456p'), [], true), -1)
    assert.equal(sangenDistance(counts('55566677z123m456p'), [], false), 1)
    // With 白 already called: 發 and 中 pairs plus 123m 456p is one tile from 小三元.
    const pon = [{ type: 'pon', tiles: ids('555z') }]
    assert.equal(sangenDistance(counts('6677z123m456p'), pon, true), 0)
})

test('大三元 and 国士 are out of reach once the tiles they need are gone', async () => {
    const { sangenDistance } = await import('./mahjongPlan.js')
    const gone = new Array(34).fill(0)
    gone[33] = 2 // two 中 in the rivers: one 中 in hand can never become a triplet
    assert.equal(sangenDistance(counts('5556667z123m456p'), [], false, gone), 99)
    assert.ok(sangenDistance(counts('5556667z123m456p'), [], false) < 99)
})
