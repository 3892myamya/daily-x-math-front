// 役の方針: which yaku a hand is aiming at. Each plan has its own shanten (how far the hand is
// from that shape) and a rough value; the plan with the best "reachability × points" is chosen,
// and a player keeps their plan unless another is clearly better.
import { KIND_COUNT, kindOf, isRed, suitOf, numOf, isHonor, isYaochu, doraOf, yakuhaiCount, SUIT_NAME } from './mahjongTiles.js'
import { normalShanten, shanten, chiitoiShanten, kokushiShanten, toitoiShanten, pinfuShanten, greedyNormalShanten, greedyShanten } from './mahjongShanten.js'

const isOpenMeld = m => m.type !== 'ankan'

// Shanten counting only the tiles a plan keeps (断么九・染め手).
function keepOnly(keep, normal = normalShanten) {
    return (counts, meldCount) => normal(counts.map((n, k) => keep(k) ? n : 0), meldCount)
}

// Shanten with some sequences fixed (三色・一通): the missing tiles of those sequences plus the rest of the hand.
function withSequences(targets, normal = normalShanten) {
    return (counts, meldCount) => {
        const c = [...counts]
        let missing = 0
        for (const k of targets) {
            if (c[k] > 0) c[k]--
            else missing++
        }
        return normal(c, meldCount + targets.length / 3) + missing
    }
}

/* チャンタ: every set and the pair hold a terminal or an honor. Only 1-2-3 and 7-8-9 of a suit can
   be used (123・789 or a terminal triplet), so each suit splits into two small groups that are
   searched on their own; honors give triplets and pairs. Groups are then combined like a normal
   shanten: 8 − 2×sets − partial sets (at most 4 − sets in all) − the pair. */
// All (sets, partials, pairs among the partials) a group of three counts can give; a = the terminal.
function chantaGroup(a, b, c) {
    const out = []
    const walk = (a, b, c, m, t, h) => {
        out.push([m, t, h])
        if (a >= 3) walk(a - 3, b, c, m + 1, t, h)
        if (a && b && c) walk(a - 1, b - 1, c - 1, m + 1, t, h)
        if (a >= 2) walk(a - 2, b, c, m, t + 1, h + 1)
        if (a && b) walk(a - 1, b - 1, c, m, t + 1, h)
        if (b && c) walk(a, b - 1, c - 1, m, t + 1, h)
        if (a && c) walk(a - 1, b, c - 1, m, t + 1, h)
    }
    walk(a, b, c, 0, 0, 0)
    return out
}

export function chantaShanten(counts, meldCount) {
    const groups = []
    for (let s = 0; s < 3; s++) {
        const k = s * 9
        groups.push(chantaGroup(counts[k], counts[k + 1], counts[k + 2]))
        groups.push(chantaGroup(counts[k + 8], counts[k + 7], counts[k + 6]))
    }
    for (let k = 27; k < KIND_COUNT; k++) {
        const n = counts[k]
        groups.push([[0, 0, 0], ...(n >= 3 ? [[1, 0, 0]] : []), ...(n >= 2 ? [[0, 1, 1]] : [])])
    }
    // Combine the groups, keeping one state per (sets, partials, has a pair).
    let states = new Map([['0,0,0', [0, 0, 0]]])
    for (const options of groups) {
        const next = new Map()
        for (const [m, t, h] of states.values()) {
            for (const [gm, gt, gh] of options) {
                const st = [Math.min(4, m + gm), Math.min(5, t + gt), Math.min(1, h + gh)]
                next.set(st.join(), st)
            }
        }
        states = next
    }
    let best = 0
    for (const [m, t, h] of states.values()) {
        const room = Math.max(0, 4 - meldCount - m)
        const usable = Math.min(m, 4 - meldCount)
        best = Math.max(best, 2 * usable + Math.min(t, room), h ? 2 * usable + Math.min(t - 1, room) + 1 : 0)
    }
    return 8 - 2 * meldCount - best
}
const isChantaTile = k => isHonor(k) || [1, 2, 3, 7, 8, 9].includes(numOf(k))

/* 三元: 白・發・中 (31-33) as three triplets (大三元) or two triplets and the pair (小三元).
   Distance = the dragons still missing + how far the rest of the hand is from its sets (and pair). */
const DRAGONS = [31, 32, 33]
// gone: tiles of each kind out of reach for everyone (in rivers, calls, dora indicators); a dragon
// whose missing copies are gone makes the plan impossible.
export function sangenDistance(counts, melds, small, gone = []) {
    const melded = new Set(melds.filter(m => m.type !== 'chi').map(m => kindOf(m.tiles[0])).filter(k => DRAGONS.includes(k)))
    const others = melds.length - melded.size
    const rest = counts.map((n, k) => DRAGONS.includes(k) ? 0 : n)
    const need = (k, n) => {
        if (melded.has(k)) return 0
        const missing = Math.max(0, n - counts[k])
        return missing > 4 - counts[k] - (gone[k] ?? 0) ? 99 : missing
    }
    if (!small) {
        if (others > 1) return 99
        return DRAGONS.reduce((sum, k) => sum + need(k, 3), 0) + normalShanten(rest, 3 + others)
    }
    if (others > 2) return 99
    let best = 99
    for (const pair of DRAGONS) {
        if (melded.has(pair)) continue
        const missing = DRAGONS.reduce((sum, k) => sum + need(k, k === pair ? 2 : 3), 0)
        // The pair is the dragon one: give the rest a stand-in pair so it only counts its sets.
        const withPair = [...rest]
        withPair[pair] = 2
        best = Math.min(best, missing + normalShanten(withPair, 2 + others))
    }
    return best
}

const chiitoiPlan = (counts, meldCount) => meldCount ? 99 : chiitoiShanten(counts)
const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]
// 国士 is impossible once every copy of a 么九牌 the hand lacks is gone.
const kokushiPlan = gone => (counts, meldCount) => meldCount || YAOCHU.some(k => !counts[k] && (gone[k] ?? 0) >= 4) ? 99 : kokushiShanten(counts)

// Tiles of each kind everyone has seen: rivers (not called), calls and dora indicators.
function goneTiles(game) {
    const gone = new Array(KIND_COUNT).fill(0)
    for (const pl of game.players) {
        for (const r of pl.river) if (!r.called) gone[kindOf(r.id)]++
        for (const m of pl.melds) for (const id of m.tiles) gone[kindOf(id)]++
    }
    for (const id of game.doraIndicators) gone[kindOf(id)]++
    return gone
}
const menzenOnly = m => m.type === 'ankan'

// Whether a tile is part of a plan ('on') or something the plan wants gone ('off'),
// so that hesitation never swaps one for the other. Plans without such a split return undefined.
const pairRole = (k, counts) => counts[k] >= 2 ? 'on' : 'off'
const keepRole = keep => k => keep(k) ? 'on' : 'off'

const NUMS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

// type: groups plans for personality preferences. han(menzen) is the plan's own yaku.
// simple: the player reads shapes the way a beginner does (greedy splitting, mahjongShanten.js).
// Plans whose sets may include honors (and are not built of pairs), which so also take 役牌.
const WITH_YAKUHAI = ['some', 'toitoi', 'chanta', 'junko']
// Set by allPlans for the player and round being looked at.
let yakuhaiHan = () => 0

function allPlans(game, p, simple = false) {
    const normal = simple ? greedyNormalShanten : normalShanten
    const all = simple ? greedyShanten : shanten
    const roundWind = game.roundWind
    const seatWind = game.seatWind(p)
    // 役牌 in the hand: pairs (they may become sets) and called sets.
    yakuhaiHan = (counts, melds) => {
        let han = 0
        for (let k = 27; k < KIND_COUNT; k++) {
            const inMeld = melds.some(m => m.type !== 'chi' && kindOf(m.tiles[0]) === k)
            if (counts[k] >= 2 || inMeld) han += yakuhaiCount(k, roundWind, seatWind)
        }
        return han
    }
    // The player's own calls count as gone too, but sangenDistance treats a called dragon as done.
    const gone = goneTiles(game)
    const plans = [
        // Ordinary shapes only: 七対子 and 国士 are plans of their own, with their own (slower) steps.
        { id: 'riichi', type: 'riichi', name: '面前リーチ', fn: normal, han: () => 0, allows: menzenOnly },
        {
            id: 'pinfu', type: 'pinfu', name: '平和', han: () => 1, allows: () => false,
            fn: (counts, meldCount) => pinfuShanten(counts, meldCount, k => yakuhaiCount(k, roundWind, seatWind) > 0),
        },
        {
            id: 'tanyao', type: 'tanyao', name: '断么九', fn: keepOnly(k => !isYaochu(k), normal), han: () => 1,
            allows: m => m.tiles.every(id => !isYaochu(kindOf(id))), keep: k => !isYaochu(k), role: keepRole(k => !isYaochu(k)),
        },
        { id: 'yakuhai', type: 'yakuhai', name: '役牌', fn: normal, allows: () => true, han: (menzen, counts, melds) => yakuhaiHan(counts, melds) },
        { id: 'toitoi', type: 'toitoi', name: '対々和', fn: toitoiShanten, han: () => 2, allows: m => m.type !== 'chi', role: pairRole },
        { id: 'chiitoi', type: 'chiitoi', name: '七対子', fn: chiitoiPlan, han: () => 2, allows: () => false, role: pairRole },
        { id: 'kokushi', type: 'kokushi', name: '国士無双', fn: kokushiPlan(gone), han: () => 13, allows: () => false, role: keepRole(isYaochu) },
        {
            id: 'chanta', type: 'chanta', name: 'チャンタ', fn: chantaShanten, han: menzen => menzen ? 2 : 1,
            allows: m => m.tiles.some(id => isYaochu(kindOf(id))), keep: isChantaTile, role: keepRole(isChantaTile),
        },
        {
            id: 'junchan', type: 'chanta', name: '純チャン', fn: keepOnly(k => !isHonor(k), chantaShanten), han: menzen => menzen ? 3 : 2,
            allows: m => m.tiles.some(id => isYaochu(kindOf(id))) && m.tiles.every(id => !isHonor(kindOf(id))),
            keep: k => !isHonor(k) && isChantaTile(k), role: keepRole(k => !isHonor(k) && isChantaTile(k)),
        },
        // 小三元 counts its two dragon triplets as well (2 + 2 翻).
        {
            id: 'shousangen', type: 'sangen', name: '小三元', fn: (counts) => sangenDistance(counts, game.players[p].melds, true, gone),
            han: () => 4, allows: () => true, role: keepRole(k => DRAGONS.includes(k)),
        },
        {
            id: 'daisangen', type: 'sangen', name: '大三元', fn: (counts) => sangenDistance(counts, game.players[p].melds, false, gone),
            han: () => 13, allows: () => true, role: keepRole(k => DRAGONS.includes(k)),
        },
    ]
    for (let s = 0; s < 3; s++) {
        const inSuit = k => !isHonor(k) && suitOf(k) === s
        plans.push({
            id: `honitsu${s}`, type: 'some', name: `混一色（${SUIT_NAME[s]}）`, fn: keepOnly(k => inSuit(k) || isHonor(k), normal),
            han: menzen => menzen ? 3 : 2, allows: m => m.tiles.every(id => inSuit(kindOf(id)) || isHonor(kindOf(id))),
            keep: k => inSuit(k) || isHonor(k), role: keepRole(k => inSuit(k) || isHonor(k)),
        })
        plans.push({
            id: `chinitsu${s}`, type: 'some', name: `清一色（${SUIT_NAME[s]}）`, fn: keepOnly(inSuit, normal),
            han: menzen => menzen ? 6 : 5, allows: m => m.tiles.every(id => inSuit(kindOf(id))), keep: inSuit, role: keepRole(inSuit),
        })
        const ittsu = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => s * 9 + n)
        plans.push({
            id: `ittsu${s}`, type: 'junko', name: `一気通貫（${SUIT_NAME[s]}）`,
            fn: withSequences(ittsu, normal), han: () => 2, allows: menzenOnly, role: keepRole(k => ittsu.includes(k)),
        })
    }
    for (let n = 0; n < 7; n++) {
        const sanshoku = [0, 9, 18].flatMap(base => [base + n, base + n + 1, base + n + 2])
        plans.push({
            id: `sanshoku${n}`, type: 'junko', name: `三色（${NUMS[n + 1]}${NUMS[n + 2]}${NUMS[n + 3]}）`,
            fn: withSequences(sanshoku, normal), han: () => 2, allows: menzenOnly, role: keepRole(k => sanshoku.includes(k)),
        })
    }
    return plans
}

// What a closed hand gains from riichi, measured on 2,023 wins after riichi (2026-10-20): beyond riichi's
// own han, per win 裏ドラ 0.41, 一発 0.20 and 門前ツモ 0.43 han. A closed plan counts all of them; the riichi
// decision (mahjongAI.js) counts only 裏ドラ and 一発, since a closed dama hand may win by tsumo as well.
export const RIICHI_EXTRAS = { ura: 0.41, ippatsu: 0.20, tsumo: 0.43 }
const MENZEN_HAN = 1 + RIICHI_EXTRAS.ura + RIICHI_EXTRAS.ippatsu + RIICHI_EXTRAS.tsumo

// Rough points of a non-dealer ron at 30 fu (dealers get 1.5×), enough to compare plans.
const POINTS = [0, 1000, 2000, 3900, 7700, 8000, 12000, 12000, 16000, 16000, 16000, 24000, 24000, 32000]
export function roughPoints(han, dealer) {
    const base = POINTS[Math.max(0, Math.min(13, Math.round(han)))]
    return dealer ? base * 1.5 : base
}

function doraIn(game, ids, keep) {
    const dora = game.doraIndicators.map(id => doraOf(kindOf(id)))
    let n = 0
    for (const id of ids) {
        const k = kindOf(id)
        if (keep && !keep(k)) continue
        n += dora.filter(d => d === k).length + (isRed(id) ? 1 : 0)
    }
    return n
}

// How much one extra shanten costs, by how much of the wall is left.
// Not the measured win rates of ordinary hands (those are milder, about 0.6 per step early): a plan's
// distance counts only its own tiles and is nearer than the hand really is. 800 hanchan with the
// measured ratios came out much weaker (2.725 against 2.49), so this stays (2026-10-20). Tried again
// once breadth was measured per distance: still much weaker (2.486 against 2.355, 1600 hanchan, 2026-10-21).
function reachFactor(game, person) {
    const left = game.wall.length
    const base = left >= 40 ? 0.4 : left >= 20 ? 0.3 : 0.2
    return base * (person.reachScale ?? 1)
}

// 七対子 and 国士 are not built of sets: a step means one more pair or one more 么九牌, waiting for one
// particular kind at a time, and it comes slower than a step of an ordinary hand at the same distance.
// The chance per turn of a step while the plan is the one chosen, by distance (measured over 400
// hanchan of ケイ, 2026-10-20, .local-dev/bench/planspeed.sh; cells under 100 samples left out),
// against 面前リーチ's. Ordinary plans keep their distance: their speed includes the calls they will
// make, which would hide what a call gains.
const PLAN_SPEED = {
    riichi: { 1: 0.12, 2: 0.27, 3: 0.45, 4: 0.6 },
    chiitoi: { 1: 0.08, 2: 0.14, 3: 0.19, 4: 0.24, 5: 0.29 },
    kokushi: { 1: 0.1, 2: 0.12, 3: 0.16, 4: 0.19, 5: 0.28, 6: 0.38 },
}

// The chance of a step from distance k (the nearest distance measured).
function speed(key, k) {
    const table = PLAN_SPEED[key]
    const near = Object.keys(table).map(Number).reduce((a, b) => Math.abs(b - k) < Math.abs(a - k) ? b : a)
    return table[near]
}


// Plans that can use only some tiles are slow too, closed or open: チャンタ・純チャン (123・789 and 么九牌
// triplets), 混一色 (one suit and honors) and 清一色 (one suit). Measured apart for closed hands (steps by
// draws) and open ones (draws and calls), against a closed 面前リーチ from the same games (400 hanchan of
// ケイ each, 2026-10-20, planspeed.sh split / split2; cells under 100 samples left out). Without them the
// AI chi'd into 純チャン three times as often as strong players, and went for 清一色 (rarely made) rather
// than 混一色.
const SHAPE_SPEED = {
    riichi: { 1: 0.12, 2: 0.23, 3: 0.36, 4: 0.56 },
    chanta: { closed: { 1: 0.07, 2: 0.13, 3: 0.2, 4: 0.33 }, open: { 1: 0.11, 2: 0.2, 3: 0.24, 4: 0.37 } },
    honitsu: { closed: { 1: 0.12, 2: 0.14, 3: 0.15, 4: 0.19 }, open: { 1: 0.15, 2: 0.25, 3: 0.29, 4: 0.34 } },
    chinitsu: { closed: { 2: 0.14, 3: 0.09, 4: 0.19 }, open: { 1: 0.11, 2: 0.14, 3: 0.17, 4: 0.19, 5: 0.25 } },
}
const cell = (table, k) => table[Object.keys(table).map(Number).reduce((a, b) => Math.abs(b - k) < Math.abs(a - k) ? b : a)]
const shapeKey = r => r.type === 'some' ? (r.id.startsWith('chinitsu') ? 'chinitsu' : 'honitsu') : r.type

// A plan's distance in ordinary steps: each step of a slow plan counts as many as it is slower than a
// 面前リーチ step from the same distance.
function stepsOf(type, distance, open = false) {
    if (distance <= 0) return distance
    const shape = SHAPE_SPEED[type]
    if (shape && type !== 'riichi') {
        let steps = 0
        for (let k = 1; k <= distance; k++) steps += cell(SHAPE_SPEED.riichi, k) / cell(open ? shape.open : shape.closed, k)
        return steps
    }
    if (!PLAN_SPEED[type] || type === 'riichi') return distance
    let steps = 0
    for (let k = 1; k <= distance; k++) steps += speed('riichi', k) / speed(type, k)
    return steps
}

// How much a plan's acceptance (the tiles that bring it closer, weighted by calls: reach) counts: its score
// is multiplied by ((reach + 4) / (the average reach at that distance + 4)) ^ PLAN_BREADTH, so a plan with
// half the useful tiles of a usual plan as far is worth less. Against the average of its own distance: far
// plans always have more useful tiles than near ones (a tenpai waits on 7 on average, a plan 4 steps away
// takes 25), which says nothing about how good they are. Averages over every plan of every decision of 160
// hanchan of ケイ (2026-10-21, .local-dev/bench/planreach.mjs).
// The exponent itself was then measured: at the same distance, how much more often a hand wins with a
// plan twice as wide (log win rate against log relative breadth, 400 hanchan of ケイ, 2026-10-21,
// .local-dev/bench/breadthwin.mjs): about 0.9 up to three steps away, 0.4 at four (and beyond).
const PLAN_BREADTH = [0.95, 0.89, 0.89, 0.97, 0.4]
const AVERAGE_REACH = [7.1, 15, 21.5, 24.4, 25.2, 26.7, 28.2, 28.7, 29.1]
const breadthOf = r => {
    const d = Math.max(0, Math.min(8, r.distance))
    return Math.pow((r.reach + 4) / (AVERAGE_REACH[d] + 4), PLAN_BREADTH[Math.min(d, PLAN_BREADTH.length - 1)])
}

// Evaluates every plan for the player's current hand. Returns the chosen plan and a table for display.
// memoryKey names the field on the player that remembers the plan between turns ('plan' or 'recPlan').
// Of the tiles players draw, the share they throw away again, by sort of tile (ケイ, 160 hanchan,
// 2026-10-20, .local-dev/bench/discarded.mjs): 字牌 0.90, 1・9 0.67, 2・8 0.49, 3-7 0.37.
const thrownShare = k => isHonor(k) ? 0.9 : [1, 9].includes(numOf(k)) ? 0.67 : [2, 8].includes(numOf(k)) ? 0.49 : 0.37
const kindTiles = (...kinds) => kinds.map(k => k * 4 + 1)

// How much likelier a tile that would bring a plan nearer is to come when it can also be called: it comes
// by the player's own draw, and for a pon (a pair in hand) from any of the other three when they throw it
// away, for a chi from the player before. (1 + 3 × share) or (1 + share) times a draw alone. Only for
// plans that allow that call, and players who call at all.
export function callReach(plan, person, counts) {
    if (person.call === 'none') return () => 1
    return d => {
        const share = thrownShare(d)
        if (counts[d] >= 2 && plan.allows({ type: 'pon', tiles: kindTiles(d, d, d) })) return 1 + 3 * share
        if (isHonor(d)) return 1
        const n = numOf(d)
        for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
            if (n + a < 1 || n + b > 9 || !counts[d + a] || !counts[d + b]) continue
            if (plan.allows({ type: 'chi', tiles: kindTiles(d + a, d, d + b) })) return 1 + share
        }
        return 1
    }
}

// What a win under each kind of plan is really worth against what the plan was valued at (the points of
// the wins over the plan's points at the winner's last decision, as for a non-dealer), with 役牌 counted in
// every plan that can hold them. Measured on 400 hanchan of ケイ (2026-10-20, .local-dev/bench/planpts.mjs;
// kinds with fewer than 40 wins stay at 1). 平和 comes in lower than counted, 面前リーチ and 対々和 higher
// (裏ドラ beyond the average, 三暗刻).
const POINT_RATIO = { yakuhai: 1, pinfu: 0.82, tanyao: 1.08, riichi: 1.17, honitsu: 0.98, junko: 0.92, chiitoi: 0.98, toitoi: 1.17 }
const pointsOf = (plan, han, dealer) => Math.round(roughPoints(han, dealer) * (POINT_RATIO[shapeKey(plan)] ?? 1) / 100) * 100

// Plans whose steps are measured apart for open hands, which this player could finish by calling.
const callable = (plan, person) => person.call !== 'none' && !!SHAPE_SPEED[shapeKey(plan)] && shapeKey(plan) !== 'riichi'

// valueOnly: just the hand's worth (`value`), skipping the acceptance counts.
export function choosePlan(game, p, person, memoryKey, remember = true, valueOnly = false) {
    const pl = game.players[p]
    const counts = new Array(KIND_COUNT).fill(0)
    for (const id of pl.hand) counts[kindOf(id)]++
    const meldCount = pl.melds.length
    const menzen = !pl.melds.some(isOpenMeld)
    const dealer = game.seatWind(p) === 0
    const allIds = [...pl.hand, ...pl.melds.flatMap(m => m.tiles)]
    // Tiles left for this player: everything public and the own hand counted as seen.
    const seen = goneTiles(game)
    for (const id of pl.hand) seen[kindOf(id)]++
    // reach: the same, each tile weighted by how much likelier calls make it (callReach).
    const acceptance = (fn, distance, plan = null) => {
        if (valueOnly) return { n: 0, reach: 0 }
        const weight = plan ? callReach(plan, person, counts) : () => 1
        let n = 0
        let reach = 0
        for (let d = 0; d < KIND_COUNT; d++) {
            const left = 4 - seen[d]
            if (left <= 0 || counts[d] >= 4) continue
            const w = weight(d)
            counts[d]++
            if (fn(counts, meldCount) < distance) {
                n += left
                reach += left * w
            }
            counts[d]--
        }
        return { n, reach }
    }
    const rows = []
    const all = person.simpleShape ? greedyShanten : shanten
    for (const plan of allPlans(game, p, person.simpleShape)) {
        if (!pl.melds.every(plan.allows)) continue
        // Plans this player does not think of (三色・一通・国士 for a beginner).
        if (person.planTypes && !person.planTypes.includes(plan.type)) continue
        let han = plan.han(menzen, counts, pl.melds)
        if (plan.type === 'yakuhai' && han === 0) continue
        // Yaku that come along: a plan that can hold honors also scores the 役牌 the hand has (pairs and called
        // sets, counted as the 役牌 plan counts them), so 混一色 with 東東中中 is worth more than 混一色 alone.
        if (WITH_YAKUHAI.includes(plan.type)) han += yakuhaiHan(counts, pl.melds)
        const distance = plan.fn(counts, meldCount)
        if (distance > 8) continue
        const dora = plan.id !== 'kokushi' ? doraIn(game, allIds, plan.keep) : 0
        han += dora
        if (menzen && plan.id !== 'kokushi') han += MENZEN_HAN // riichi and its extras (裏ドラ・一発・ツモ)
        // A closed hand may also finish such a plan by calling: its open worth (no riichi, the open han).
        const openHan = menzen && callable(plan, person) ? plan.han(false, counts, pl.melds) + dora : null
        const acc = acceptance(plan.fn, distance, plan)
        rows.push({ ...plan, distance, han, points: pointsOf(plan, han, dealer), openPoints: openHan === null ? null : pointsOf(plan, openHan, dealer), ukeire: acc.n, reach: acc.reach })
    }
    if (!rows.length) {
        // An open hand with no yaku left: just keep the shape.
        const distance = all(counts, meldCount)
        const acc = acceptance(all, distance)
        rows.push({ id: 'none', type: 'none', name: '役なし', fn: all, allows: () => true, distance, han: 0, points: 0, ukeire: acc.n, reach: acc.reach })
    }
    for (const r of rows) {
        r.steps = stepsOf(shapeKey(r), r.distance, !menzen)
        if (r.openPoints !== null) r.openSteps = stepsOf(shapeKey(r), r.distance, true)
    }
    const nearest = Math.min(...rows.map(r => Math.min(r.steps, r.openSteps ?? Infinity)))
    // The chance to get there from `steps` away: a fixed factor per step by how much of the wall is left
    // (reachFactor, with reachScale making a personality mind distance more or less).
    const factor = reachFactor(game, person)
    const reachOf = steps => Math.pow(factor, steps)
    // A closed hand going for a plan it can also finish by calling takes the better of the two ways:
    // closed (riichi's worth, steps by draws) or open (the open worth, steps by draws and calls).
    const worth = (points, steps) => Math.pow(points || 100, person.pointsExp ?? 1) * reachOf(steps) / reachOf(nearest)
    for (const r of rows) {
        if (r.openSteps === undefined || worth(r.openPoints, r.openSteps) <= worth(r.points, r.steps)) continue
        r.points = r.openPoints
        r.steps = r.openSteps
        r.byCalling = true
    }
    for (const r of rows) {
        const prefer = person.prefs?.[r.type] ?? 1
        // A weak player hardly minds that a favourite yaku is still far away.
        const blind = person.favourites?.includes(r.type) ? person.favDistance ?? 1 : 1
        const base = prefer * Math.pow(r.points || 100, person.pointsExp ?? 1) * Math.pow(reachOf(r.steps) / reachOf(nearest), blind)
        // Breadth only weighs plans of the same hand against each other.
        r.score = base * breadthOf(r)
        // Counted from zero distance, so two positions can be compared (calling or not). Without breadth:
        // a hand that has just called always holds fewer tiles, so its acceptance would look smaller.
        r.value = base * reachOf(nearest)
    }
    rows.sort((a, b) => b.score - a.score)
    // The best plan is chosen afresh every turn. (A rule keeping the current plan until another was
    // 1.3× better was dropped on 2026-10-20: 800 hanchan with and without it came out even.)
    const auto = rows[0]
    // The recommendation follows the plan the human picked (狙い役) while that plan is still possible.
    const aimed = memoryKey === 'recPlan' && pl.aim ? rows.find(r => r.id === pl.aim) : null
    const chosen = aimed ?? auto
    // A CPU's plan is shown on the table while watching.
    if (remember && memoryKey === 'plan') pl.planName = chosen.name
    return {
        plan: chosen,
        // The best plan regardless of the one remembered, and its value.
        best: rows[0],
        table: rows.slice(0, 5).map(r => ({ id: r.id, name: r.name, distance: r.distance, points: r.points, ukeire: r.ukeire })),
        // For choosing a 狙い役: every plan, the one chosen without the human's pick, and whether that pick is possible.
        rows: rows.map(r => ({ id: r.id, name: r.name, distance: r.distance, points: r.points, ukeire: r.ukeire, reach: r.reach })),
        auto: auto.id,
        // The hand's worth from zero distance (the best plan by value), comparable between two hands.
        value: Math.max(...rows.map(r => r.value)),
        aimLost: !!(memoryKey === 'recPlan' && pl.aim && !aimed),
    }
}

export function planById(game, p, id) {
    return allPlans(game, p).find(plan => plan.id === id)
}


