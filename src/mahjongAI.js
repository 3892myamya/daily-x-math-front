// CPU decisions and the "standard" recommendation shown next to them.
// Each turn a player picks a 役の方針 (mahjongPlan.js); discards are then scored from a few
// explainable parts: 方針に沿った牌効率, テンパイ時の打点, ドラ・役牌, 危険度.
import {
    KIND_COUNT, kindOf, isRed, suitOf, numOf, isHonor, isYaochu, doraOf, yakuhaiCount, countKinds, kindName, SUIT_NAME, tileKey, tileName,
} from './mahjongTiles.js'
import { shanten, waitingKinds, greedyShanten } from './mahjongShanten.js'
import { scoreWin } from './mahjongScore.js'
import { choosePlan, roughPoints, RIICHI_EXTRAS, callReach } from './mahjongPlan.js'
import { winRate, WIN_SAVES } from './mahjongOdds.js'

// call: none (面前派のリン, never calls) | normal (calls when it pays, see decideCall)
// callMargin: how much better a call must make the hand before calling (<1 eager, >1 reluctant).
// prefs: how much a personality likes each kind of plan (riichi, pinfu, tanyao, yakuhai, some, toitoi,
// chiitoi, junko = 三色・一通, kokushi). reachScale < 1 favours near plans, pointsExp > 1 big ones.
const BASE = {
    // wDora / wYakuhai: the cost of throwing away a dora or breaking a yakuhai pair. Not the same as
    // the plans' points (those only choose the plan, not between two discards): 1600 hanchan without
    // them came out 0.07 worse in average rank (2026-10-20).
    wUkeire: 12, wDora: 30, wYakuhai: 60, defense: 1, call: 'normal', callMargin: 1, minkan: false,
    // リーチ判断: riichi when its expected value is at least riichiMargin × that of dama (>1 leans to dama,
    // 0 = always riichi). riichiWin: how much riichi keeps of the chance to win (others fold, the wait is fixed).
    // 1200 hanchan of ケイ with 0.7 / 0.85 / 1.0 and always-riichi came out even (2.50 each). 0.7 is the
    // one where a hand riichi hardly raises (7,700 → 8,000) goes dama, as strong players do.
    riichiMargin: 1, riichiWin: 0.7,
    // How much the points of a tenpai count against its width (0 = width only).
    wPoints: 1,
    // 大物狙い: > 1 counts a high wait for more than its points (tiles × points^this), so a narrow
    // 満貫 wait beats a wide cheap one even when it is worth less on average.
    waitPointsExp: 1,
    // 0.6 tested best for the standard AI (320 hanchan against 1.0, 0.35 and no plans at all).
    prefs: {}, reachScale: 0.6, pointsExp: 1,
    // Reads open hands (calls, 染め手) as threats, not only riichi. openScale: against open hands one
    // deals in only about half as often as the riichi table × their tenpai rate says (measured 0.51
    // over 490,000 discards, the same for 1・2・3 calls, 2026-10-20). Threats below openMin are ignored.
    readOpen: true, openScale: 0.51, openMin: 0.3,
    // Reads ツモ切り・手出し (上級 only): runs of tsumogiri after a call, the riichi declaration tile.
    readTedashi: true,
    // Skill (see LEVELS): how tiles are counted, what is known about safety, furiten, hesitation.
    efficiency: 'visible', dangerMode: 'full', furitenAware: true, planTypes: null, marginTiles: 0,
}
export const PERSONALITIES = {
    standard: { ...BASE, id: 'standard', name: '標準AI' },
    human: { ...BASE, id: 'human', name: 'あなた', color: '#8a6d3b' },
    hayate: {
        ...BASE, id: 'hayate', name: 'ハヤテ', color: '#e0703a',
        wUkeire: 16, wDora: 10, wYakuhai: 90, defense: 0.6, callMargin: 0.85, wPoints: 0.5,
        prefs: { yakuhai: 1.5, tanyao: 1.5 }, reachScale: 0.35,
    },
    gou: {
        ...BASE, id: 'gou', name: 'ゴウ', color: '#c94a5a',
        wDora: 60, wYakuhai: 50, defense: 0.1, minkan: true,
    },
    aya: {
        ...BASE, id: 'aya', name: 'アヤ', color: '#3f9b6e',
        wUkeire: 10, wDora: 25, wYakuhai: 70, defense: 0.8, prefs: { some: 3 },
    },
    mamoru: {
        ...BASE, id: 'mamoru', name: 'マモル', color: '#3d6fb6',
        defense: 2.5, callMargin: 1.2, riichiMargin: 1.3,
    },
    kei: {
        ...BASE, id: 'kei', name: 'ケイ', color: '#6b5bd2',
    },
    nana: {
        ...BASE, id: 'nana', name: 'ナナ', color: '#d0569b',
        prefs: { chiitoi: 3 },
    },
    goro: {
        ...BASE, id: 'goro', name: 'ミツル', color: '#a0662a',
        minkan: true, wDora: 40, prefs: { toitoi: 3 },
    },
    shun: {
        ...BASE, id: 'shun', name: 'シュン', color: '#2f9bb3',
        prefs: { riichi: 1.3, tanyao: 1.6, junko: 2 },
    },
    rin: {
        ...BASE, id: 'rin', name: 'リン', color: '#5d8a2f',
        call: 'none',
    },
    dai: {
        ...BASE, id: 'dai', name: 'ダイ', color: '#b08a1e',
        wUkeire: 8, wDora: 90, wYakuhai: 120, minkan: true, wPoints: 1.5, pointsExp: 1.4, waitPointsExp: 2,
        // pointsExp already draws a big-hand lover to 役満; this damps 国士 so it stays a little more
        // often than for others (in 400 hanchan: ダイ 5%, ユメ 7%, everyone else 3% of hands).
        prefs: { kokushi: 0.6 },
    },
}
// 20 characters: the ten above, each at their own strength, and for each a weaker follower who plays
// the same way. A character is a personality plus a fixed level and a one-line description of how it plays.
const CHARACTER_INFO = {
    hayate: { level: 'advanced', intro: '役牌や断么九で早めに仕掛け、疾風のように先にアガる。打点より速さを取る速攻派' },
    dai: { level: 'intermediate', intro: 'ドラと役牌を抱えて大物手を目指す。安くなる鳴きはせず、高くなる鳴きだけする' },
    gou: { level: 'intermediate', intro: 'ドラを抱えて豪快に押す。リーチを受けても自分の手を進め、ほとんど降りない' },
    mamoru: { level: 'advanced', intro: '放銃を何より嫌い、危ないと見ればすぐ守りに回る。鳴きは控えめでダマが多い' },
    aya: { level: 'intermediate', intro: '一色に寄せられそうな手は混一色・清一色で彩る。染め色の牌なら積極的に鳴く' },
    goro: { level: 'intermediate', intro: '対子が多い手は対々和を狙う。ポンで刻子を集め、ドラや大明槓で打点も上げる' },
    nana: { level: 'intermediate', intro: '対子が多い手は七対子に決め打つ。それ以外の手は素直に組み、得なら鳴きもする' },
    shun: { level: 'advanced', intro: '順子で組む手を好み、断么九・三色・一気通貫の形を見つけて育て、リーチで仕上げる' },
    rin: { level: 'advanced', intro: '鳴きに目もくれず凛と面前を貫く。手役も打点も面前で作り、リーチとダマを使い分ける' },
    kei: { level: 'advanced', intro: 'どの役にも偏らず、牌効率・打点・守りを計算して釣り合わせる。誰よりも隙のない打ち手' },
}
const FOLLOWERS = [
    { id: 'tsubame', of: 'hayate', name: 'ツバメ', level: 'beginner', color: '#ec9a6f', intro: 'とにかく早くアガりたい。役牌や断么九が見えたら、手が遠くてもすぐ鳴いて進める', },
    { id: 'yume', of: 'dai', name: 'ユメ', level: 'novice', color: '#d2b55a', intro: '狙うのはいつも大物手。ドラや役牌を手放さず、遠い高打点の手にも夢を見る', },
    { id: 'riki', of: 'gou', name: 'リキ', level: 'novice', color: '#de7f8b', intro: '降りるという考えがない。誰がリーチしても力ずくで押し、大明槓も迷わずする', },
    { id: 'shizuku', of: 'mamoru', name: 'シズク', level: 'beginner', color: '#7a9fd6', intro: '守りを第一に考える。少しでも危なそうなら手を崩してでも安全な牌を探す', },
    { id: 'midori', of: 'aya', name: 'イロハ', level: 'novice', color: '#79c29e', intro: '染め手が大好き。バラバラの配牌からでも一色を目指し、染め色ならどんどん鳴く', },
    { id: 'ponta', of: 'goro', name: 'ポンタ', level: 'novice', color: '#c99561', intro: '対々和に一直線。順子ができていても崩して対子を見ればポンしにいく', },
    { id: 'futaba', of: 'nana', name: 'フタバ', level: 'beginner', color: '#e08cbf', intro: '牌を二枚ずつそろえたがり、対子が少ない手からでも七対子を目指してしまう', },
    { id: 'jun', of: 'shun', name: 'ツムギ', level: 'beginner', color: '#6fbfd1', intro: '順子を紡ぐように組み、三色や一気通貫の形が見えると遠くても追いかける', },
    { id: 'hajime', of: 'rin', name: 'ハジメ', level: 'novice', color: '#93b86a', intro: '鳴きを使わず面前だけで打つ。テンパイしたら待ちの良し悪しを気にせず即リーチ', },
    { id: 'satoru', of: 'kei', name: 'サトル', level: 'beginner', color: '#9d92e0', intro: '好みの役を持たず、教科書どおりに打とうとする。牌効率・打点・守りを一つずつ覚え中', },
]
for (const [id, info] of Object.entries(CHARACTER_INFO)) Object.assign(PERSONALITIES[id], info)
for (const f of FOLLOWERS) PERSONALITIES[f.id] = { ...PERSONALITIES[f.of], ...f }

// Shown in this order: opposite pairs (速攻・大物, 押し・守り), then the yaku lovers, then ケイ;
// each character followed by their follower.
export const CPU_IDS = [
    'hayate', 'tsubame', 'dai', 'yume', 'gou', 'riki', 'mamoru', 'shizuku',
    'aya', 'midori', 'goro', 'ponta', 'nana', 'futaba', 'shun', 'jun', 'rin', 'hajime', 'kei', 'satoru',
]
export const levelOf = id => PERSONALITIES[id].level ?? 'advanced'

// 強さ: weaker levels make the mistakes people make, never unnatural ones (a missed win, a wrong count).
// efficiency: kinds (only how many kinds help) | tiles (counts tiles but not the visible ones) | visible
// dangerMode: genbutsu (only 現物 is safe) | suji (スジ and honors, no 壁) | full (also 壁・ノーチャンス)
// marginTiles: 迷い — a candidate at the same plan distance whose loss is worth at most this many
// tiles of acceptance may be picked instead of the best (exact ties are picked at random at every level)
// quirk: 癖の強さ — how far a personality's leanings pull away from the standard AI (1 = as written).
// styleTiles: the personality only chooses among discards within this many tiles of the standard best.
// favDistance: how much a weak player minds that a favourite yaku is far away (1 = as usual): ポンタ
// heads for 対々和 even from a hand of sequences.
export const LEVELS = {
    advanced: { id: 'advanced', label: '上級', stars: 4, quirk: 0.3, styleTiles: 3 },
    intermediate: {
        id: 'intermediate', label: '中級', stars: 3, quirk: 0.6, marginTiles: 7, efficiency: 'tiles', dangerMode: 'suji',
        defenseScale: 0.8, openMin: 0.6, pointsScale: 0.5, planTypes: ['riichi', 'pinfu', 'tanyao', 'yakuhai', 'some', 'toitoi', 'chiitoi', 'junko', 'chanta', 'kokushi', 'sangen'],
    },
    beginner: {
        id: 'beginner', label: '初級', stars: 2, quirk: 1, favDistance: 0.6, marginTiles: 20, efficiency: 'kinds', dangerMode: 'genbutsu', riichiRule: 'mangan',
        defenseScale: 0.5, readOpen: false, pointsScale: 0, planTypes: ['riichi', 'pinfu', 'tanyao', 'yakuhai', 'some', 'toitoi', 'chiitoi', 'kokushi', 'sangen'],
    },
    // 覚えたて: never folds, wavers a lot, calls eagerly (but only into a hand with a yaku),
    // riichi at once on any closed tenpai.
    novice: {
        id: 'novice', label: '入門', stars: 1, quirk: 1.6, favDistance: 0.3, simpleShape: true, marginTiles: 40, efficiency: 'kinds', dangerMode: 'genbutsu', furitenAware: false,
        defenseScale: 0, readOpen: false, pointsScale: 0, planTypes: ['riichi', 'tanyao', 'yakuhai', 'some', 'toitoi', 'chiitoi', 'kokushi', 'sangen'],

        callMargin: 0.8, riichiMargin: 0,
    },
}
export const LEVEL_IDS = ['advanced', 'intermediate', 'beginner', 'novice']

// A personality's leanings scaled by the level's quirk: q < 1 pulls them toward the standard AI,
// q > 1 exaggerates them (a weak ミツル pons everything, a weak ゴウ never even thinks of folding).
function withQuirk(person, q) {
    const std = BASE
    const lerp = key => std[key] + (person[key] - std[key]) * q
    const ratio = key => std[key] * Math.pow(person[key] / std[key], q)
    return {
        ...person,
        quirk: q,
        prefs: Object.fromEntries(Object.entries(person.prefs).map(([type, v]) => [type, Math.pow(v, q)])),
        wUkeire: lerp('wUkeire'),
        wDora: lerp('wDora'),
        wYakuhai: lerp('wYakuhai'),
        wPoints: lerp('wPoints'),
        defense: ratio('defense'),
        reachScale: ratio('reachScale'),
        riichiMargin: ratio('riichiMargin'),
        pointsExp: lerp('pointsExp'),
        waitPointsExp: lerp('waitPointsExp'),
    }
}

// The plan kinds a personality loves (染め for アヤ, 対々和 for ミツル): known even at the lowest level.
const favourites = person => Object.entries(person.prefs).filter(([, v]) => v >= 2).map(([type]) => type)

// A personality as played at a level.
export function applyLevel(base, levelId = 'advanced') {
    const lv = LEVELS[levelId] ?? LEVELS.advanced
    if (base.id === 'standard' || base.id === 'human') return base
    const person = withQuirk(base, lv.quirk)
    if (lv.id === 'advanced') return { ...person, styleTiles: lv.styleTiles }
    return {
        ...person,
        level: lv.id,
        marginTiles: lv.marginTiles,
        efficiency: lv.efficiency,
        dangerMode: lv.dangerMode,
        furitenAware: lv.furitenAware ?? person.furitenAware,
        planTypes: [...new Set([...lv.planTypes, ...favourites(base)])],
        favourites: favourites(base),
        simpleShape: !!lv.simpleShape,
        favDistance: lv.favDistance ?? 1,
        defense: person.defense * lv.defenseScale,
        readOpen: person.readOpen && lv.readOpen !== false,
        readTedashi: false,
        openMin: Math.max(person.openMin, lv.openMin ?? 0),
        // A big-hand lover looks at the points of a wait at any level; others less the weaker they are.
        wPoints: person.waitPointsExp > 1 ? person.wPoints : person.wPoints * lv.pointsScale,
        // Eager to call at the lowest level; a personality that never calls keeps that habit.
        callMargin: Math.min(person.callMargin, lv.callMargin ?? Infinity),
        riichiMargin: lv.riichiMargin ?? person.riichiMargin,
        riichiRule: lv.riichiRule ?? null,
    }
}

export function personFor(game, p) {
    const pl = game.players[p]
    return applyLevel(PERSONALITIES[pl.personality], pl.level)
}

// "ケイ" or "ケイ（初級）".
// A character's name; the level is added only when it plays at a level other than its own.
export function displayName(personality, levelId) {
    const person = PERSONALITIES[personality]
    const own = person.level ?? 'advanced'
    return levelId && levelId !== own ? `${person.name}（${LEVELS[levelId].label}）` : person.name
}

const SHANTEN_WEIGHT = 1000

/* =====================
   見えている情報
===================== */
// Tiles a player can see: own hand, every river and meld, the dora indicators.
export function visibleCounts(game, p) {
    const counts = countKinds(game.players[p].hand)
    for (const pl of game.players) {
        for (const r of pl.river) if (!r.called) counts[kindOf(r.id)]++
        for (const m of pl.melds) for (const id of m.tiles) counts[kindOf(id)]++
    }
    for (const id of game.doraIndicators) counts[kindOf(id)]++
    return counts
}

export function doraKinds(game) {
    return game.doraIndicators.map(id => doraOf(kindOf(id)))
}

function tileValue(game, id) {
    const k = kindOf(id)
    return doraKinds(game).filter(d => d === k).length + (isRed(id) ? 1 : 0)
}

/* =====================
   危険度（リーチ者に対する目安の放銃率%）
===================== */
export function safeKinds(game, o) {
    const safe = new Set(game.players[o].river.map(r => kindOf(r.id)))
    for (const k of game.players[o].safeAfterRiichi) safe.add(k)
    return safe
}

// Deal-in rates (%) against a riichi, measured over 2,400 hanchan of the AI (2026-10-20, about 340,000
// discards; labels taken from the discarder's view before the discard). 生牌の字牌 cannot be measured
// that way (a tile in one's own hand is always seen once) and keeps the textbook figure.
const DANGER_RATES = {
    現物: 0, 字3: 0.1, 字2: 0.9, 字1: 2.8, 字0: 6,
    スジ19: 1.6, NC19: 1.9, 無スジ19: 4.9,
    スジ28: 4.4, NC28: 3.5, 無スジ28: 8.3,
    スジ37: 7.8, NC37: 7.3, 無スジ37: 11.4,
    両スジ: 4.3, 両側NC: 4.7, 片スジ: 8.1, 片側NC: 9.9, 無スジ中張: 11.5,
    // A beginner only knows 現物: every other tile is taken as the average of them.
    現物以外: 4.9,
}

export function danger(k, safe, visible, mode = 'full') {
    const R = DANGER_RATES
    if (safe.has(k)) return { rate: R.現物, label: '現物' }
    // A beginner only knows that 現物 is safe; an intermediate player knows スジ and honors but not 壁.
    if (mode === 'genbutsu') return { rate: R.現物以外, label: '現物以外' }
    if (isHonor(k)) {
        const seen = Math.min(3, visible[k])
        return { rate: R[`字${seen}`], label: seen ? `字牌（${seen}枚見え）` : '生牌の字牌' }
    }
    const n = numOf(k)
    // Each side of the tile on which a 両面 could wait for it (below: k-2・k-1, above: k+1・k+2) is
    // closed by スジ (k∓3 is safe) or, for 上級, by 壁 (all four of a tile of that shape are visible:
    // ノーチャンス).
    const side = (exists, suji, a, b) => !exists ? null
        : suji ? 'suji'
            : mode === 'full' && (visible[a] >= 4 || visible[b] >= 4) ? 'kabe' : 'open'
    const sides = [side(n >= 4, safe.has(k - 3), k - 1, k - 2), side(n <= 6, safe.has(k + 3), k + 1, k + 2)].filter(Boolean)
    const closed = sides.filter(x => x !== 'open')
    const suji = closed.every(x => x === 'suji')
    const word = suji ? 'スジ' : 'ノーチャンス'
    const key = suji ? 'スジ' : 'NC'
    for (const [a, b, tail] of [[1, 9, '19'], [2, 8, '28'], [3, 7, '37']]) {
        if (n !== a && n !== b) continue
        return closed.length ? { rate: R[key + tail], label: `${word}の${a}・${b}` } : { rate: R['無スジ' + tail], label: `無スジの${a}・${b}` }
    }
    if (closed.length === 2) return suji ? { rate: R.両スジ, label: '両スジ' } : { rate: R.両側NC, label: '両側ノーチャンス・スジ' }
    if (closed.length === 1) return suji ? { rate: R.片スジ, label: '片スジ' } : { rate: R.片側NC, label: '片側ノーチャンス' }
    return { rate: R.無スジ中張, label: '無スジの中張牌' }
}

/* =====================
   警戒する相手（リーチ者と、テンパイ気配のある鳴き）
===================== */
// Tenpai rate of an open hand by number of calls and turn (≤6, ≤12, later discards),
// measured from 200 CPU hanchan.
const OPEN_TENPAI = { 1: [0.10, 0.35, 0.56], 2: [0.36, 0.60, 0.76], 3: [0.71, 0.75, 0.90], 4: [1, 1, 1] }
// A riichi counts as weight 1; an open hand by tenpai rate × its likely points against this.
// What a deal-in to a riichi costs on average: measured 6,898 points (6,572 deal-ins, 2026-10-20).
const RIICHI_POINTS = 6900

// What an open hand seems to be built for, from its calls and its river.
export function readOpenHand(game, o) {
    const pl = game.players[o]
    const meldKinds = pl.melds.flatMap(m => m.tiles.map(kindOf))
    const suits = new Set(meldKinds.filter(k => !isHonor(k)).map(suitOf))
    let some = null
    if (suits.size <= 1) {
        const per = [0, 0, 0]
        for (const r of pl.river) if (!isHonor(kindOf(r.id))) per[suitOf(kindOf(r.id))]++
        const numbers = per[0] + per[1] + per[2]
        const suit = suits.size ? [...suits][0] : per.indexOf(Math.min(...per))
        const others = [0, 1, 2].filter(x => x !== suit).map(x => per[x])
        // Hardly any tiles of that suit thrown away: probably 染め手. With only honor calls,
        // both other suits must have been thrown away too.
        const evidence = numbers >= 3 && per[suit] <= Math.max(0, Math.floor(numbers * 0.15))
        if (evidence && (suits.size || others.every(n => n >= 2))) some = suit
    }
    const toitoi = pl.melds.filter(isOpen).length >= 2 && pl.melds.every(isTriplet)
    const tanyao = meldKinds.every(k => !isYaochu(k))
    const dora = doraKinds(game)
    let han = 1 // dora and red fives that cannot be seen
    for (const m of pl.melds) {
        if (isTriplet(m)) han += yakuhaiCount(kindOf(m.tiles[0]), game.roundWind, game.seatWind(o))
        for (const id of m.tiles) han += dora.filter(d => d === kindOf(id)).length + (isRed(id) ? 1 : 0)
    }
    if (some !== null) han += 2
    if (toitoi) han += 2
    if (tanyao) han += 1
    const dealer = game.seatWind(o) === 0
    let points = roughPoints(han, dealer)
    // 大三元 / 四喜和 in sight: two dragon sets (three wind sets) called, the last one still possible.
    // About 11% of such tenpai wait on that last tile, and a win on it is a yakuman; the hand's worth is the
    // average over its waits (measured on 12,592 positions of ケイ, 2026-10-20, bench/sangenread.mjs;
    // too few wind positions came up, so they borrow the dragons' figure).
    const yakumanTile = lastHonorSet(game, pl, DRAGON_LIST, 2) ?? lastHonorSet(game, pl, WIND_LIST, 3)
    if (yakumanTile !== null) points = points * (1 - LAST_SET_WAIT) + roughPoints(13, dealer) * LAST_SET_WAIT
    return { some, toitoi, tanyao, han, points, yakumanTile }
}

const DRAGON_LIST = [31, 32, 33]
const WIND_LIST = [27, 28, 29, 30]
// How often a tenpai with two dragon sets called waits on the third dragon.
const LAST_SET_WAIT = 0.11

// The one honor of `kinds` still missing when `need` of them are called as sets, if it can still be made
// (fewer than two of it out in the open). Else null.
function lastHonorSet(game, pl, kinds, need) {
    const sets = kinds.filter(k => pl.melds.some(m => isTriplet(m) && kindOf(m.tiles[0]) === k))
    if (sets.length !== need) return null
    const rest = kinds.find(k => !sets.includes(k))
    let seen = 0
    for (const q of game.players) {
        for (const r of q.river) if (!r.called && kindOf(r.id) === rest) seen++
        for (const m of q.melds) for (const id of m.tiles) if (kindOf(id) === rest) seen++
    }
    for (const id of game.doraIndicators) if (kindOf(id) === rest) seen++
    return seen >= 2 ? null : rest
}

const isDragon = k => DRAGON_LIST.includes(k)

function describeRead(read) {
    const parts = []
    if (read.yakumanTile != null) parts.push(isDragon(read.yakumanTile) ? '大三元の気配' : '四喜和の気配')
    if (read.some !== null) parts.push(`${SUIT_NAME[read.some]}の染め`)
    if (read.toitoi) parts.push('対々和')
    if (read.tanyao && read.some === null) parts.push('断么九')
    return parts.join('・')
}

// Everyone this player should be wary of, with a weight (riichi = 1).
export function threatProfiles(game, p, person = PERSONALITIES.standard) {
    const profiles = []
    game.players.forEach((pl, o) => {
        if (o === p) return
        const name = nameOf(game, o)
        if (pl.riichi) {
            const declared = pl.river.find(r => r.riichi)
            profiles.push({
                o, kind: 'riichi', weight: 1, safe: safeKinds(game, o), text: `${name}のリーチ`,
                declared: person.readTedashi && declared ? kindOf(declared.id) : null,
            })
            return
        }
        const open = pl.melds.filter(isOpen).length
        // Anyone notices a river of 中張牌 only, so this read does not depend on the level.
        const kokushi = !open ? readKokushi(game, o) : null
        if (kokushi) {
            const weight = Math.min(1.2, kokushi.tenpai * kokushi.points / RIICHI_POINTS)
            if (weight >= person.openMin) {
                profiles.push({
                    o, kind: 'kokushi', weight, safe: safeKinds(game, o),
                    text: `${name}の国士の気配（${pl.river.length}枚切って么九牌${kokushi.yaochu ? 'は1枚だけ' : 'なし'}・テンパイ率${Math.round(kokushi.tenpai * 100)}%）`,
                })
            }
            return
        }
        if (!open || !person.readOpen) return
        const turn = pl.river.length <= 6 ? 0 : pl.river.length <= 12 ? 1 : 2
        const tells = person.readTedashi ? readDiscardsAfterCall(pl) : { factor: 1, text: '' }
        const tenpai = Math.min(1, OPEN_TENPAI[Math.min(open, 4)][turn] * tells.factor)
        const read = readOpenHand(game, o)
        const weight = Math.min(1.2, tenpai * read.points / RIICHI_POINTS) * person.openScale
        if (weight < person.openMin) return
        const what = describeRead(read)
        profiles.push({
            o, kind: 'open', weight, read, safe: safeKinds(game, o),
            text: `${name}の${open}副露（${what ? what + '・' : ''}${tells.text}テンパイ率${Math.round(tenpai * 100)}%）`,
        })
    })
    return profiles
}

// 国士の気配: a closed player whose river holds hardly any 么九牌 (most players cut them first) may be
// collecting them. Measured on 東1局 hands of ケイ (2026-10-20, .local-dev/bench/kokushihands.sh):
// KOKUSHI_AIM — how often a player is going for 国士, by 么九牌 in the river (0 or 1) and its length
// (64,000 hands); KOKUSHI_TENPAI — how often a player going for 国士 is in tenpai, by river length
// (8,000 hands dealt near 国士). Thin cells are merged into their neighbours. The threat is weighed like an
// open hand: tenpai chance × 役満 against a riichi's average.
const KOKUSHI_AIM = {
    0: { 6: 0.05, 7: 0.08, 8: 0.1, 9: 0.18, 10: 0.23, 11: 0.48, 12: 0.6 },
    1: { 6: 0.006, 7: 0.011, 8: 0.019, 9: 0.026, 10: 0.04 },
}
const KOKUSHI_TENPAI = { 6: 0.057, 7: 0.07, 8: 0.089, 9: 0.105, 10: 0.113, 11: 0.146, 12: 0.159, 13: 0.176, 14: 0.198, 15: 0.201, 16: 0.245 }
const YAOCHU_LIST = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]
// The value for a river length (the last measured one beyond the table).
const atLength = (table, n) => table[Math.min(n, Math.max(...Object.keys(table).map(Number)))]

export function readKokushi(game, o) {
    const pl = game.players[o]
    if (pl.melds.length || pl.river.length < 6) return null
    const yaochu = pl.river.filter(r => isYaochu(kindOf(r.id))).length
    if (yaochu > 1) return null
    // Impossible once all four of some 么九牌 are out in the open.
    const gone = new Array(KIND_COUNT).fill(0)
    for (const q of game.players) {
        for (const r of q.river) if (!r.called) gone[kindOf(r.id)]++
        for (const m of q.melds) for (const id of m.tiles) gone[kindOf(id)]++
    }
    for (const id of game.doraIndicators) gone[kindOf(id)]++
    if (YAOCHU_LIST.some(k => gone[k] >= 4)) return null
    const tenpai = atLength(KOKUSHI_AIM[yaochu], pl.river.length) * atLength(KOKUSHI_TENPAI, pl.river.length)
    return { tenpai, yaochu, points: game.seatWind(o) === 0 ? 48000 : 32000 }
}

// ツモ切り・手出し after the last call: a run of tsumogiri means the drawn tiles are not needed
// (likely tenpai); cutting a 4-6 from the hand later on means the hand has just come together.
function readDiscardsAfterCall(pl) {
    let start = -1
    pl.river.forEach((r, i) => { if (r.afterCall) start = i })
    if (start < 0) return { factor: 1, text: '' }
    const after = pl.river.slice(start + 1)
    let streak = 0
    for (let i = after.length - 1; i >= 0 && after[i].tsumogiri; i--) streak++
    if (streak >= 3) return { factor: 1.4, text: `鳴いた後ツモ切り${streak}回・` }
    if (streak === 2) return { factor: 1.25, text: '鳴いた後ツモ切り2回・' }
    const middle = after.some(r => !r.tsumogiri && !isHonor(kindOf(r.id)) && numOf(kindOf(r.id)) >= 4 && numOf(kindOf(r.id)) <= 6)
    if (middle) return { factor: 1.2, text: '鳴いた後に中張牌を手出し・' }
    return { factor: 1, text: '' }
}

// Danger of a tile against one threat. Against an open hand the read narrows it down.
function dangerAgainst(k, t, visible, mode) {
    if (t.kind === 'kokushi') {
        if (t.safe.has(k)) return { rate: 0, label: '現物' }
        if (!isYaochu(k)) return { rate: 0, label: '国士に当たらない中張牌' }
        // The wait is one of the 么九牌 that could still be missing from the hand.
        const open = YAOCHU_LIST.filter(y => !t.safe.has(y) && visible[y] < 4).length
        return { rate: 100 / Math.max(open, 1), label: '国士の待ちになりうる么九牌' }
    }
    if (t.kind === 'riichi' && t.declared != null && mode === 'full') {
        // Tiles near the riichi declaration tile (same suit, within two) are said to be more dangerous.
        const base = danger(k, t.safe, visible, mode)
        const d = t.declared
        const near = base.rate > 0 && !isHonor(k) && !isHonor(d) && suitOf(k) === suitOf(d) && Math.abs(numOf(k) - numOf(d)) <= 2 && k !== d
        // Measured: about 1.13× (weighted over the labels, 2026-10-20).
        return near ? { rate: base.rate * 1.13, label: `${base.label}（宣言牌の近く）` } : base
    }
    if (t.kind === 'riichi' || !t.read || mode === 'genbutsu') return danger(k, t.safe, visible, mode)
    const read = t.read
    if (t.safe.has(k)) return { rate: 0, label: '現物' }
    // The last dragon (wind) for a 大三元 (四喜和) in sight: its chance of being the winning tile, measured.
    if (k === read.yakumanTile) return { rate: 100 * LAST_SET_WAIT, label: isDragon(k) ? '大三元の残りの三元牌' : '四喜和の残りの風牌' }
    if (read.some !== null && !isHonor(k) && suitOf(k) !== read.some) return { rate: 1, label: '染め色以外' }
    if (read.tanyao && read.some === null && isYaochu(k)) return { rate: 1, label: '断么九に不要な么九牌' }
    // 対々和 waits on pairs, so suji says nothing.
    const base = danger(k, read.toitoi ? new Set() : t.safe, visible, mode)
    if (read.some !== null) return { rate: base.rate * 1.5, label: `染め色の${base.label}` }
    return base
}

// Total weight of what this player should fear; calls and kans stop above 0.5.
function threatLevel(game, p, person) {
    return threatProfiles(game, p, person).reduce((sum, t) => sum + t.weight, 0)
}

/* =====================
   鳴き
===================== */
export const isTriplet = m => m.type !== 'chi'
export const isOpen = m => m.type !== 'ankan'

/* =====================
   テンパイ時の打点
===================== */
// Points of a ron on each wait. A closed hand is counted with riichi (it would declare);
// ura dora and tsumo are left out, so this is a plain, comparable figure.
// Furiten: a wait that is already in the player's river (counting the tile about to be discarded)
// blocks every ron, so the hand can only win by tsumo. Waits with no tiles left count too.
function isFuriten(game, p, rest, discardKind) {
    const pl = game.players[p]
    if (pl.riichiFuriten) return true
    const river = new Set(pl.river.map(r => kindOf(r.id)))
    river.add(discardKind)
    return waitingKinds(countKinds(rest), pl.melds.length).some(k => river.has(k))
}

// About 4 in 10 wins are by tsumo (measured 0.379 over 6,794 wins, 2026-10-20); a furiten tenpai keeps only those.
const TSUMO_SHARE = 0.38

// Points of each wait. A closed hand is counted with riichi (it would declare); ura dora are left out.
// A normal tenpai is valued as a ron, a furiten one as a tsumo.
function tenpaiWaits(game, p, rest, accept, visible, furiten) {
    const pl = game.players[p]
    const riichi = pl.riichi || pl.melds.every(m => !isOpen(m))
    const dora = doraKinds(game)
    return accept.map(k => {
        const winTile = [1, 2, 3, 0].map(j => k * 4 + j).find(id => !rest.includes(id))
        const result = scoreWin({
            concealed: rest, winTile, melds: pl.melds, tsumo: furiten,
            roundWind: game.roundWind, seatWind: game.seatWind(p),
            riichi, doubleRiichi: pl.riichi && pl.doubleRiichi,
            doraKinds: dora, uraKinds: [],
        })
        const ok = !!result?.hasYaku
        // A closed hand not yet in riichi: also the points without riichi (役がなければ0).
        let damaPoints = ok ? result.points : 0
        if (riichi && !pl.riichi) {
            const dama = scoreWin({
                concealed: rest, winTile, melds: pl.melds, tsumo: furiten,
                roundWind: game.roundWind, seatWind: game.seatWind(p), doraKinds: dora, uraKinds: [],
            })
            damaPoints = dama?.hasYaku ? dama.points : 0
        }
        return {
            kind: k,
            left: 4 - visible[k],
            points: ok ? result.points : 0,
            riichiExtra: ok ? riichiExtraFor(result.han, !!result.yakuman) : 1,
            damaPoints,
            yaku: ok ? result.yaku.map(y => y.name === 'ドラ' || y.name === '赤ドラ' ? `${y.name}${parseInt(y.value)}` : y.name) : [],
            name: ok ? result.name : '',
            furiten,
        }
    })
}

// A tile worth 2000 points counts as one tile of width.
const POINT_UNIT = 2000

/* =====================
   打牌候補の評価
===================== */
// Facts about each distinct discard under a plan's shanten (shapeFn), shared by every personality.
// plan: the plan the acceptance is counted for (its calls make some tiles likelier, see callReach).
function discardFeatures(game, p, forbidden = new Set(), shapeFn = shanten, person = PERSONALITIES.standard, plan = null) {
    const pl = game.players[p]
    const hand = pl.hand
    const meldCount = pl.melds.length
    const counts = countKinds(hand)
    const visible = visibleCounts(game, p)
    // Weaker players count tiles left from their own hand only, or just count kinds.
    const own = countKinds(hand)
    const leftOf = d => person.efficiency === 'visible' ? 4 - visible[d] : person.efficiency === 'tiles' ? 4 - own[d] : 1
    const threatList = threatProfiles(game, p, person)
    const roundWind = game.roundWind
    const seatWind = game.seatWind(p)

    const seen = new Set()
    const features = []
    // One candidate per choice: a red five and a normal five of the same tile are two choices.
    for (const id of [...hand].sort((a, b) => tileKey(a) - tileKey(b))) {
        const k = kindOf(id)
        const key = tileKey(id)
        if (seen.has(key) || forbidden.has(k)) continue
        seen.add(key)
        counts[k]--
        const s = shapeFn(counts, meldCount)
        // The usual shape as this player reads it (a beginner may misread complex shapes).
        const normal = shapeFn === shanten ? s : (person.simpleShape ? greedyShanten : shanten)(counts, meldCount)
        let ukeireTypes = 0
        let ukeire = 0
        // reach: the acceptance with each tile weighted by how much likelier calls make it.
        let reach = 0
        const weight = plan ? callReach(plan, person, counts) : () => 1
        const accept = []
        for (let d = 0; d < KIND_COUNT; d++) {
            if (counts[d] >= 4) continue
            const left = leftOf(d)
            if (left <= 0) continue
            const w = weight(d)
            counts[d]++
            if (shapeFn(counts, meldCount) < s) {
                ukeireTypes++
                ukeire += left
                reach += left * w
                accept.push(d)
            }
            counts[d]--
        }
        const yakuhaiPairBreak = counts[k] === 1 && yakuhaiCount(k, roundWind, seatWind) > 0 ? 1 : 0
        counts[k]++
        const rest = hand.filter(x => x !== id)
        const furiten = s === 0 && person.furitenAware && isFuriten(game, p, rest, k)
        // At tenpai the real waits count, not only the plan's (a 純チャン tenpai on 6・9索 also wins
        // on 6索, and is furiten if either is in the river); tiles all out of sight stay, with 0 left.
        const waitKinds = s === 0 ? waitingKinds(countKinds(rest), meldCount) : null
        const waits = s === 0 ? tenpaiWaits(game, p, rest, waitKinds, visible, furiten) : null
        if (waits) {
            ukeireTypes = waitKinds.filter(d => leftOf(d) > 0).length
            ukeire = waitKinds.reduce((n, d) => n + Math.max(0, leftOf(d)), 0)
        }
        const share = furiten ? TSUMO_SHARE : 1
        const dangers = threatList.map(t => {
            const d = dangerAgainst(k, t, visible, person.dangerMode)
            return { ...d, weighted: d.rate * t.weight, label: threatList.length > 1 ? `${nameOf(game, t.o)}に${d.label}` : d.label }
        })
        features.push({
            id, key, kind: k, shanten: s, normal, ukeire, reach, ukeireTypes, accept, waits,
            // Sum of tiles × points over the waits that have a yaku; a furiten tenpai keeps its tsumo share.
            winValue: waits ? share * waits.reduce((sum, w) => sum + w.left * w.points, 0) : 0,
            winTiles: waits ? share * waits.reduce((sum, w) => sum + (w.points ? w.left : 0), 0) : 0,
            furiten,
            share,
            value: tileValue(game, id),
            yakuhaiPairBreak,
            dangers,
            danger: dangers.reduce((sum, d) => sum + d.weighted, 0),
        })
    }
    const minShanten = Math.min(...features.map(f => f.normal))
    // 好形変化 of a discard, worked out only when needed (to tell apart discards of the same acceptance):
    // over the draws that do not bring the hand nearer, how much wider the acceptance can become (keeping
    // the best tile and cutting another), × the tiles left of that draw.
    const change = f => {
        const c = countKinds(hand)
        c[f.kind]--
        const s = shapeFn(c, meldCount)
        const accept = () => {
            let n = 0
            for (let e = 0; e < KIND_COUNT; e++) {
                if (c[e] >= 4 || leftOf(e) <= 0) continue
                c[e]++
                if (shapeFn(c, meldCount) < s) n += leftOf(e)
                c[e]--
            }
            return n
        }
        const base = accept()
        let total = 0
        for (let d = 0; d < KIND_COUNT; d++) {
            const left = leftOf(d)
            if (left <= 0 || c[d] >= 4) continue
            c[d]++
            if (shapeFn(c, meldCount) === s) {
                let best = base
                for (let x = 0; x < KIND_COUNT; x++) {
                    if (!c[x] || x === d) continue
                    c[x]--
                    if (shapeFn(c, meldCount) === s) best = Math.max(best, accept())
                    c[x]++
                }
                total += left * (best - base)
            }
            c[d]--
        }
        return total
    }
    return { features, threatList, minShanten, change }
}


function defenseFactor(person, info) {
    if (!info.threatList.length) return 0
    const s = info.minShanten
    // How many score units 1% of deal-in risk is worth: its cost in points (1% of what a deal-in
    // costs) against what one shanten step costs this hand (its value × how much the win rate drops,
    // measured), with one step = SHANTEN_WEIGHT units. With an average hand this gives about 37 at
    // tenpai, 105 at 1-shanten and 217 at 2-shanten in the middle of a hand, where hand-set 30・120・300
    // stood before (2026-10-20: 800 hanchan each, 2.435 against 2.425); late in a hand and with a cheap
    // hand it folds more, with a big hand it pushes more.
    const value = Math.max(info.handPoints ?? 0, 1000) + WIN_SAVES
    const step = value * (winRate(s, info.wall) - winRate(s + 1, info.wall))
    return person.defense * (RIICHI_POINTS / 100) * SHANTEN_WEIGHT / Math.max(step, 1)
}

// At tenpai only waits with a yaku count, weighted by their points.
function effUkeire(person, f) {
    if (!f.waits) return (f.reach ?? f.ukeire) * person.wUkeire
    const m = Math.min(1, person.wPoints)
    return person.wUkeire * ((1 - m) * f.winTiles + m * winValueFor(person, f) / POINT_UNIT)
}

// tiles × points over the waits, with a high wait counted for more by a big-hand lover.
function winValueFor(person, f) {
    const e = person.waitPointsExp ?? 1
    if (e === 1) return f.winValue
    return f.share * f.waits.reduce((sum, w) => sum + w.left * w.points * Math.pow(w.points / POINT_UNIT, e - 1), 0)
}

function scoreParts(person, f, info) {
    return {
        eff: -f.shanten * SHANTEN_WEIGHT + effUkeire(person, f),
        value: -f.value * person.wDora - f.yakuhaiPairBreak * person.wYakuhai,
        danger: -f.danger * defenseFactor(person, info),
    }
}

const PARTS = ['danger', 'eff', 'value']
const total = parts => PARTS.reduce((sum, key) => sum + parts[key], 0)

function rank(person, info) {
    const ranked = info.features
        .map(f => ({ f, parts: scoreParts(person, f, info) }))
        .map(c => ({ ...c, score: total(c.parts) }))
        .sort((a, b) => b.score - a.score)
    // Discards rated exactly the same at the top, short of tenpai: the one whose shape can improve most
    // (好形変化) comes first. Only for those, as it takes some counting.
    const top = ranked.filter(c => ranked[0].score - c.score <= TIE)
    if (top.length > 1 && top[0].f.shanten > 0 && info.change) {
        for (const c of top) {
            c.f.change ??= info.change(c.f)
            c.score += c.f.change * CHANGE_WEIGHT
        }
        ranked.sort((a, b) => b.score - a.score)
    }
    return ranked
}
// Small against a tile of acceptance (wUkeire 12 per tile), large against TIE: it only orders discards
// that were otherwise equal.
const CHANGE_WEIGHT = 1e-4

/* =====================
   リーチ判断
===================== */
// Riichi adds a han (counted in its points), and 裏ドラ and 一発 more on average (measured, mahjongPlan.js);
// below 満貫 points about double with each han.
// What 裏ドラ and 一発 (0.61 翻 on average) add to a riichi win of `han` 翻, read off the points table:
// about 2^0.61 below 満貫, less near a limit, nothing on a yakuman (which riichi cannot raise).
function riichiExtraFor(han, yakuman) {
    if (yakuman || han >= 13) return 1
    const h = han + RIICHI_EXTRAS.ura + RIICHI_EXTRAS.ippatsu
    const lo = Math.floor(h)
    const t = h - lo
    const at = x => roughPoints(Math.min(13, x), false)
    return Math.max(1, Math.exp((1 - t) * Math.log(at(lo)) + t * Math.log(at(lo + 1))) / at(han))
}

// The waits of a discard that leaves a real (usual-shape) tenpai.
function waitsOf(game, p, f) {
    if (f.waits && f.shanten === 0) return f.waits
    const pl = game.players[p]
    const rest = pl.hand.filter(x => x !== f.id)
    return tenpaiWaits(game, p, rest, waitingKinds(countKinds(rest), pl.melds.length), visibleCounts(game, p), f.furiten)
}

// Expected value of riichi and of dama (tiles × points), both as rons (or tsumo when furiten).
function riichiValues(person, waits) {
    const tiles = w => Math.max(0, w.left)
    return {
        riichi: waits.reduce((sum, w) => sum + tiles(w) * w.points * w.riichiExtra, 0) * person.riichiWin,
        dama: waits.reduce((sum, w) => sum + tiles(w) * w.damaPoints, 0),
        damaBest: Math.max(0, ...waits.map(w => w.damaPoints)),
        riichiBest: Math.max(0, ...waits.map(w => w.points)),
    }
}

// リーチの判断 for a closed tenpai: { riichi, text }, or null when there is nothing to decide.
// person decides how values are weighed (the standard AI for the recommendation).
function riichiAdvice(game, p, f, person = PERSONALITIES.standard) {
    const pl = game.players[p]
    if (pl.riichi || f.normal !== 0 || pl.melds.some(isOpen)) return null
    if (game.scores[p] < 1000) return { riichi: false, text: '持ち点が1000点未満なのでダマ' }
    if (game.wall.length < 4) return { riichi: false, text: '残りのツモが少ないのでダマ' }
    const waits = waitsOf(game, p, f)
    if (!waits.some(w => w.left > 0)) return { riichi: false, text: '待ち牌が残っていないのでダマ' }
    const v = riichiValues(person, waits)
    const fmt = n => `${n.toLocaleString()}点`
    if (!v.damaBest) return { riichi: true, text: '役がないのでリーチ' }
    // 初級: no weighing of values, just a rule of thumb: dama only on a 満貫 that is already there.
    if (person.riichiRule === 'mangan') {
        const mangan = game.seatWind(p) === 0 ? 12000 : 8000
        return v.damaBest >= mangan ? { riichi: false, text: `ダマで満貫${fmt(v.damaBest)}あるのでダマ` } : { riichi: true, text: 'テンパイしたのでリーチ' }
    }
    if (v.riichi >= v.dama * person.riichiMargin) {
        return { riichi: true, text: `ダマ${fmt(v.damaBest)}がリーチで${fmt(v.riichiBest)}に上がるのでリーチ` }
    }
    return { riichi: false, text: `ダマでも${fmt(v.damaBest)}あり、リーチしても${fmt(v.riichiBest)}なのでダマ` }
}

function canRiichi(game, p) {
    const pl = game.players[p]
    return !pl.riichi && pl.melds.every(m => !isOpen(m)) && game.scores[p] >= 1000 && game.wall.length >= 4
}


/* =====================
   打牌の決定
===================== */
const nameOf = (game, o) => displayName(game.players[o].personality, game.players[o].level)

function bestWait(f) {
    return f.waits.reduce((a, b) => b.points > a.points ? b : a)
}

function effText(f) {
    if (f.shanten === 0 && !f.waits.length) return 'テンパイだが待ち牌が残っていない'
    if (f.shanten === 0) {
        const best = bestWait(f)
        const points = best.points ? `・最高${best.points.toLocaleString()}点` : '・役なし'
        const furiten = f.furiten ? '・フリテンでツモのみ' : ''
        return `${f.accept.map(kindName).join('・')}待ちのテンパイ（残り${f.ukeire}枚${points}${furiten}）`
    }
    return `${f.shanten}シャンテン・受け入れ${f.ukeireTypes}種${f.ukeire}枚`
}

// "役牌狙い（見込み3,900点）で": the plan and its rough worth, which is what chose the plan. At tenpai the
// real points of the waits are given instead.
const planPrefix = (plan, f) => {
    const worth = f.shanten > 0 && plan.points ? `（見込み${plan.points.toLocaleString()}点）` : ''
    return `${plan.id === 'riichi' ? '面前リーチ' : plan.name}狙い${worth}で`
}

function describeRecommendation(game, rec, effBest, info, plan) {
    const f = rec.f
    if (info.threatList.length && rec.f.kind !== effBest.f.kind && f.danger < effBest.f.danger) {
        const who = info.threatList.map(t => t.text).join('と')
        return { mode: 'defend', text: `${who}に対して${f.dangers.map(d => d.label).join('・')}で守る` }
    }
    // A tenpai chosen over a wider one: say that the points decided it.
    const wider = info.features.find(o => o.shanten === 0 && o.winTiles > f.winTiles)
    const furitenOther = info.features.find(o => o.shanten === 0 && o.furiten && o.ukeire > f.ukeire)
    if (f.shanten === 0 && !f.furiten && furitenOther) {
        return { mode: 'points', text: `${effText(f)}。${kindName(furitenOther.kind)}切りの方が待ちは広いがフリテンになる` }
    }
    if (f.shanten === 0 && wider) {
        return { mode: 'points', text: `${effText(f)}。${kindName(wider.kind)}切りの方が待ちは広いが和了時の点数で上回る` }
    }
    return { mode: 'efficiency', text: `${planPrefix(plan, f)}${effText(f)}が最も良い` }
}

// Which part made this personality leave the standard recommendation.
function describeDeviation(person, choice, recF, info, plan, recPlan) {
    const f = choice.f
    if (plan.id !== recPlan.id) {
        return `${plan.name}を狙って手を進めた（推奨は${recPlan.name}狙い）。${effText(f)}`
    }
    const mine = scoreParts(person, f, info)
    const theirs = scoreParts(person, recF, info)
    const diff = key => mine[key] - theirs[key]
    const key = PARTS.reduce((a, b) => diff(b) > diff(a) ? b : a)
    switch (key) {
        case 'danger':
            return `守りを重視して${f.dangers.map(d => d.label).join('・')}の${tileName(f.id)}を選んだ`
        case 'eff':
            if (info.threatList.length && f.danger > recF.danger) {
                return `警戒すべき相手がいても押して手を進めた（${effText(f)}）`
            }
            if (f.shanten === 0 && recF.shanten === 0 && f.furiten !== recF.furiten) {
                return f.furiten ? `フリテンでも広い待ちを選んだ（${effText(f)}）` : `フリテンを避けた（${effText(f)}）`
            }
            if (f.shanten === 0 && recF.shanten === 0) {
                return f.winTiles > recF.winTiles
                    ? `点数より待ちの広さを優先した（${effText(f)}）`
                    : `待ちの広さより点数を優先した（${effText(f)}）`
            }
            return `受け入れの広さを優先した（${effText(f)}）`
        case 'value':
            return 'ドラや役牌を手に残して打点を優先した'
    }
    return '性格の違いで判断が分かれた'
}

// limit: 6 for the analyses kept with every discard; the live hint keeps them all, so the human's
// picked tile can be shown even when it is not among the best.
function candidateRows(ranked, recommendedKey, chosenKey, limit = 6) {
    return ranked.slice(0, limit).map(c => ({
        kind: c.f.kind,
        id: c.f.id,
        key: c.f.key,
        shanten: c.f.shanten,
        ukeire: c.f.ukeire,
        ukeireTypes: c.f.ukeireTypes,
        danger: c.f.dangers.length ? c.f.dangers.map(d => d.label).join('・') : '',
        dangerRate: c.f.danger,
        waits: c.f.waits,
        recommended: c.f.key === recommendedKey,
        chosen: c.f.key === chosenKey,
    }))
}

function featuresFor(game, p, forbidden, plan, person = PERSONALITIES.standard) {
    const info = discardFeatures(game, p, forbidden, plan.fn, person, plan)
    const all = info.features.length ? info : discardFeatures(game, p, new Set(), plan.fn, person, plan)
    // For weighing the risk against this hand: its rough value and the stage.
    return { ...all, handPoints: plan.points, wall: game.wall.length }
}

// The standard AI's plan and recommendation.
function recommend(game, p, forbidden) {
    const planned = choosePlan(game, p, PERSONALITIES.standard, 'recPlan')
    const info = featuresFor(game, p, forbidden, planned.plan)
    const standardRanked = rank(PERSONALITIES.standard, info)
    const effRanked = [...info.features].sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire)
    const rec = standardRanked[0]
    const effBest = standardRanked.find(c => c.f === effRanked[0])
    // Discards the standard AI rates exactly as high as its recommendation.
    const tied = standardRanked.filter(c => rec.score - c.score <= TIE).map(c => c.f.key)
    const recommendation = {
        kind: rec.f.kind,
        id: rec.f.id,
        key: rec.f.key,
        // The other discards rated as high, as tiles.
        ties: standardRanked.filter(c => c !== rec && rec.score - c.score <= TIE).map(c => c.f.id),
        riichi: !!riichiAdvice(game, p, rec.f)?.riichi,
        riichiAdvice: riichiAdvice(game, p, rec.f),
        plan: planned.plan.name,
        ...describeRecommendation(game, rec, effBest, info, planned.plan),
    }
    return { rec, recommendation, standardRanked, info, planned, tied }
}

// Settings that change the facts about a discard, not just how they are weighed.
const FEATURE_KEYS = ['readOpen', 'openScale', 'openMin', 'efficiency', 'dangerMode', 'furitenAware', 'readTedashi', 'simpleShape']

// Scores closer than this are the same evaluation.
const TIE = 1e-6

// Picks among the best and the candidates as good as it (so no level has a fixed habit such as
// "萬子 first"), and for weaker levels also among slightly worse ones: same plan distance and a
// loss of at most marginTiles tiles of acceptance, more likely the smaller the loss (迷い).
// roleOf (from the plan) keeps the choice on the same side as the best: someone going for 染め
// may waver over which off-suit tile to cut, never cut their own suit instead.
// Uses the game's random state, so replays stay the same.
function hesitate(game, person, ranked, roleOf = null) {
    const best = ranked[0]
    // A beginner counts kinds; one kind is worth about three tiles.
    const tiles = person.efficiency === 'kinds' ? person.marginTiles / 3 : person.marginTiles
    const reach = tiles * person.wUkeire
    const role = roleOf?.(best.f.kind)
    const pool = ranked.filter(c => c.f.shanten === best.f.shanten && best.score - c.score <= reach + TIE
        && (!role || roleOf(c.f.kind) === role))
    if (pool.length < 2) return best
    const spread = Math.max(reach / 3, TIE)
    const weights = pool.map(c => Math.exp(-(best.score - c.score) / spread))
    let r = game.random() * weights.reduce((a, b) => a + b, 0)
    for (let i = 0; i < pool.length; i++) {
        r -= weights[i]
        if (r <= 0) return pool[i]
    }
    return pool[0]
}

const threatTexts = info => info.threatList.map(t => ({ o: t.o, text: t.text, weight: Math.round(t.weight * 100) / 100 }))

const planTable = (planned, mine) => ({ rows: planned.table, recommended: planned.plan.id, chosen: mine?.plan.id ?? null })

// Returns { id, riichi, analysis } for the player to move (hand holds 14 tiles minus melds).
export function decideDiscard(game, p, forbidden = new Set()) {
    const pl = game.players[p]
    const person = personFor(game, p)
    const { rec, recommendation, standardRanked, info, planned, tied } = recommend(game, p, forbidden)

    const mine = choosePlan(game, p, person, 'plan')
    const std = PERSONALITIES.standard
    const shared = mine.plan.id === planned.plan.id && FEATURE_KEYS.every(key => person[key] === std[key])
    const myInfo = shared ? info : featuresFor(game, p, forbidden, mine.plan, person)
    let ranked = rank(person, myInfo)
    // A strong player's style only shows among discards about as good as the best one.
    if (person.styleTiles) {
        const near = new Set(standardRanked
            .filter(c => rec.score - c.score <= person.styleTiles * PERSONALITIES.standard.wUkeire + TIE)
            .map(c => c.f.key))
        const allowed = ranked.filter(c => near.has(c.f.key))
        if (allowed.length) ranked = allowed
    }
    const handCounts = countKinds(pl.hand)
    const roleOf = mine.plan.role ? k => mine.plan.role(k, handCounts) : null
    const choice = hesitate(game, person, ranked, roleOf)

    // Riichi on a real closed tenpai when it is worth more than dama (weighed by this personality).
    let riichi = false
    let riichiText = null
    const rest = pl.hand.filter(x => x !== choice.f.id)
    const tenpaiNow = pl.melds.every(m => !isOpen(m)) && waitingKinds(countKinds(rest), pl.melds.length).length > 0
    // choice.f.normal is the tenpai as this player reads it (a beginner may not notice one).
    if (tenpaiNow && !pl.riichi && choice.f.normal === 0) {
        const mine = riichiAdvice(game, p, choice.f, person)
        if (mine) {
            riichi = mine.riichi
            riichiText = mine.text
        }
    }
    const recRiichi = recommendation.riichiAdvice
    const riichiDiffers = !!recRiichi && riichiText !== null && riichi !== recRiichi.riichi

    // A discard rated as high as the recommendation counts as agreeing with it.
    const same = tied.includes(choice.f.key)
    const recMine = myInfo.features.find(f => f.key === rec.f.key) ?? rec.f
    let reason = same
        ? (riichi ? 'テンパイなのでリーチ' : choice.f.key === rec.f.key ? '推奨と同じ' : '推奨と同じ評価の候補から選んだ')
        : describeDeviation(person, choice, recMine, myInfo, mine.plan, planned.plan)
    if (!same && ranked[0].score - choice.score > TIE) {
        reason = `迷って次点の${tileName(choice.f.id)}を選んだ（本命は${tileName(ranked[0].f.id)}）`
    }
    // A beginner who split the hand wrongly may go back a step without noticing.
    if (!same && person.simpleShape) {
        const real = shanten(countKinds(pl.hand.filter(x => x !== choice.f.id)), pl.melds.length)
        const best = Math.min(...info.features.map(f => f.normal))
        if (real > best) reason = `手の形を見誤った（実際はシャンテン数が${real - best}つ戻る）`
    }
    if (!same && person.level) reason += `［${LEVELS[person.level].label}］`
    return {
        id: choice.f.id,
        riichi,
        analysis: {
            recommendation,
            choice: { kind: choice.f.kind, id: choice.f.id, key: choice.f.key, riichi, same, reason, plan: mine.plan.name, riichiText, riichiDiffers },
            candidates: candidateRows(standardRanked, rec.f.key, choice.f.key),
            threats: threatTexts(info),
            plans: planTable(planned, mine),
        },
    }
}

// The standard recommendation for a player who decides alone (the human), without choosing.
// The waits of a tenpai hand and how many of each are left, counted by what viewer can see: rivers,
// calls, dora indicators and the viewer's own hand (null = every hand, for watching with all hands
// open, where what is left is what is still in the wall). Null when the hand is not tenpai.
export function tenpaiInfo(game, p, viewer) {
    const pl = game.players[p]
    if (pl.hand.length + pl.melds.length * 3 !== 13) return null
    const kinds = waitingKinds(countKinds(pl.hand), pl.melds.length)
    if (!kinds.length) return null
    const seen = new Array(KIND_COUNT).fill(0)
    game.players.forEach((q, i) => {
        if (viewer === null || i === viewer) for (const id of q.hand) seen[kindOf(id)]++
        for (const r of q.river) if (!r.called) seen[kindOf(r.id)]++
        for (const m of q.melds) for (const id of m.tiles) seen[kindOf(id)]++
    })
    for (const id of game.doraIndicators) seen[kindOf(id)]++
    const waits = kinds.map(k => ({ kind: k, left: Math.max(0, 4 - seen[k]) }))
    // A closed hand can always win by tsumo or riichi; only an open hand can be stuck without a yaku.
    const yakuless = pl.melds.some(isOpen) && !kinds.some(k => {
        const id = [1, 2, 3, 0].map(j => k * 4 + j).find(x => !pl.hand.includes(x))
        return !!game.score(p, id, false)?.hasYaku
    })
    return { waits, total: waits.reduce((n, w) => n + w.left, 0), furiten: game.furiten(p), yakuless, inWall: viewer === null }
}

// The plans the human can pick as 狙い役, valued as the recommendation values them:
// { rows: [{ id, name, distance, points }], auto, active, aim, lost }.
export function aimChoices(game, p) {
    const planned = choosePlan(game, p, PERSONALITIES.standard, 'recPlan', false)
    return { rows: planned.rows, auto: planned.auto, active: planned.plan.id, aim: game.players[p].aim ?? null, lost: planned.aimLost }
}

export function hintFor(game, p, forbidden = new Set()) {
    const { rec, recommendation, standardRanked, info, planned } = recommend(game, p, forbidden)
    return {
        recommendation,
        candidates: candidateRows(standardRanked, rec.f.key, null, Infinity),
        threats: threatTexts(info),
        plans: planTable(planned, null),
        tenpaiKinds: info.features.filter(f => f.normal === 0).map(f => f.kind),
        canRiichi: canRiichi(game, p),
    }
}

// Compares the human's discard with the recommendation, in the same shape as a CPU analysis.
export function analyzeChoice(game, p, id, riichi, forbidden = new Set()) {
    const { rec, recommendation, standardRanked, info, planned, tied } = recommend(game, p, forbidden)
    const f = info.features.find(x => x.key === tileKey(id)) ?? rec.f
    const r = rec.f
    const same = tied.includes(f.key)
    // A closed tenpai the human could have declared riichi on, compared with the recommendation.
    const humanRiichi = !!recommendation.riichiAdvice && f.normal === 0 && canRiichi(game, p)
    let reason = f.key === r.key ? '推奨と同じ' : '推奨と同じ評価の牌'
    if (same && humanRiichi && riichi !== recommendation.riichiAdvice.riichi) {
        reason = recommendation.riichiAdvice.riichi ? '推奨はリーチ（ダマにした）' : `推奨はダマ（${recommendation.riichiAdvice.text}）`
    }
    if (!same) {
        if (f.normal > r.normal) reason = `推奨よりシャンテン数が${f.normal - r.normal}つ戻る`
        else if (f.shanten > r.shanten) reason = `推奨の${planned.plan.name}狙いの形から外れる`
        else if (info.threatList.length && f.danger > r.danger) reason = `推奨より危険度が高い（${f.dangers.map(d => d.label).join('・')}）`
        else if (f.shanten === 0 && r.shanten === 0 && f.furiten && !r.furiten) {
            reason = `フリテンになりツモでしか和了れない（${effText(f)}）`
        }
        else if (f.shanten === 0 && r.shanten === 0 && f.winValue < r.winValue) {
            reason = f.winTiles > r.winTiles
                ? `待ちは推奨より広いが和了時の点数を考えると推奨の方が上（${effText(f)}）`
                : `推奨より和了時の点数が低い（${effText(f)}）`
        }
        else if (f.value > r.value) reason = `推奨よりドラを${f.value - r.value}枚多く手放す（${tileName(f.id)}）`
        else if (f.ukeire < r.ukeire) reason = `推奨より受け入れが${r.ukeire - f.ukeire}枚少ない（${effText(f)}）`
        else reason = '牌効率では推奨と同等（打点や役の判断の違い）'
    }
    return {
        recommendation,
        choice: {
            kind: f.kind, id, key: f.key, riichi, same, reason,
            riichiText: humanRiichi ? (riichi ? 'リーチ' : 'ダマ') : null,
            riichiDiffers: humanRiichi && riichi !== recommendation.riichiAdvice.riichi,
            // How far below the recommendation, in tiles of acceptance (a step back in shanten is about 80).
            loss: same ? 0 : Math.round(Math.max(0, rec.score - (standardRanked.find(c => c.f.key === f.key)?.score ?? rec.score)) / PERSONALITIES.standard.wUkeire * 10) / 10,
        },
        candidates: candidateRows(standardRanked, r.key, f.key),
        threats: threatTexts(info),
        plans: planTable(planned, null),
    }
}

/* =====================
   カンの判断
===================== */
// 暗槓・加槓 the player to move could declare now.
export function selfKanOptions(game, p) {
    const pl = game.players[p]
    if (!game.wall.length || game.kanCount >= 4) return []
    const counts = countKinds(pl.hand)
    const options = []
    for (let k = 0; k < KIND_COUNT; k++) {
        if (counts[k] !== 4) continue
        if (pl.riichi) {
            // In riichi only the drawn tile may be konged, and only if the waits stay the same.
            if (kindOf(pl.lastDraw) !== k) continue
            const before = waitingKinds(countKinds(pl.hand.filter(x => x !== pl.lastDraw)), pl.melds.length)
            const after = countKinds(pl.hand)
            after[k] = 0
            if (waitingKinds(after, pl.melds.length + 1).join() !== before.join()) continue
        }
        options.push({ type: 'ankan', kind: k, tiles: pl.hand.filter(x => kindOf(x) === k) })
    }
    if (!pl.riichi) {
        for (const m of pl.melds) {
            if (m.type !== 'pon') continue
            const k = kindOf(m.tiles[0])
            const id = pl.hand.find(x => kindOf(x) === k)
            if (id !== undefined) options.push({ type: 'kakan', kind: k, tiles: [id] })
        }
    }
    return options
}

function bestDiscardShanten(counts, meldCount) {
    let best = 9
    for (let k = 0; k < KIND_COUNT; k++) {
        if (!counts[k]) continue
        counts[k]--
        best = Math.min(best, shanten(counts, meldCount))
        counts[k]++
    }
    return best
}

export function decideSelfKan(game, p) {
    const pl = game.players[p]
    const person = personFor(game, p)
    const options = selfKanOptions(game, p)
    if (!options.length) return null
    if (pl.riichi) return options[0]
    // A kan gives everyone a new dora; careful players skip it against a riichi.
    if (threatLevel(game, p, person) >= 0.5 && person.defense >= 1) return null
    const counts = countKinds(pl.hand)
    const now = bestDiscardShanten(counts, pl.melds.length)
    for (const option of options) {
        const rest = [...counts]
        rest[option.kind] -= option.tiles.length
        const meldCount = pl.melds.length + (option.type === 'ankan' ? 1 : 0)
        if (shanten(rest, meldCount) <= now) return option
    }
    return null
}

/* =====================
   鳴きの判断
===================== */
function callOptions(game, p, id, from) {
    const pl = game.players[p]
    const k = kindOf(id)
    const options = []
    const byKind = kind => pl.hand.filter(x => kindOf(x) === kind)
    // One tile of each sort (a red five is a choice of its own), the normal one first.
    const sorts = kind => {
        const tiles = byKind(kind)
        return [tiles.find(x => !isRed(x)), tiles.find(isRed)].filter(x => x !== undefined)
    }
    const same = byKind(k)
    if (same.length >= 3 && game.wall.length && game.kanCount < 4) {
        options.push({ type: 'minkan', tiles: same.slice(0, 3), forbidden: new Set() })
    }
    if (same.length >= 2) {
        // Two normal tiles, and (with a red five) a normal one and the red one: separate choices.
        const normals = same.filter(x => !isRed(x))
        const red = same.find(isRed)
        if (normals.length >= 2) options.push({ type: 'pon', tiles: normals.slice(0, 2), forbidden: new Set([k]) })
        if (red !== undefined && normals.length) options.push({ type: 'pon', tiles: [normals[0], red], forbidden: new Set([k]) })
    }
    if (from === (p + 3) % 4 && !isHonor(k)) {
        const n = numOf(k)
        for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
            if (n + a < 1 || n + b > 9) continue
            const forbidden = new Set([k])
            // 筋喰い替え: chi 34 with 2 cannot discard 5, chi 23 with 4 cannot discard 1.
            if (a === 1 && n + 3 <= 9) forbidden.add(k + 3)
            if (b === -1 && n - 3 >= 1) forbidden.add(k - 3)
            for (const ta of sorts(k + a)) {
                for (const tb of sorts(k + b)) options.push({ type: 'chi', tiles: [ta, tb], forbidden: new Set(forbidden) })
            }
        }
    }
    return options
}

export { callOptions }

// The plan after a call and the following discard, chosen the same way as on the player's own turn
// (keeping the current plan unless another is clearly better), found by trying it on the hand.
function planAfterCall(game, p, person, option, calledId, memoryKey) {
    const pl = game.players[p]
    const saved = { hand: pl.hand, melds: pl.melds }
    pl.hand = pl.hand.filter(x => !option.tiles.includes(x))
    pl.melds = [...pl.melds, { type: option.type, tiles: [...option.tiles, calledId], calledTile: calledId, from: -1 }]
    try {
        return choosePlan(game, p, person, memoryKey, false).plan
    } finally {
        Object.assign(pl, saved)
    }
}

const distanceText = d => d < 0 ? '和了形' : d === 0 ? 'テンパイ' : `${d}シャンテン`

const CALL_NAME = { pon: 'ポン', chi: 'チー', minkan: 'カン' }

// 鳴きの損得, judged with the same plans as the discards: the starting point is the plan the player
// holds now (the one shown with the discard recommendation), the plan after the call is chosen by
// the same rule, and their values (見込み打点 × 近さ, as in choosing a plan) are compared. A call
// gives up riichi and some han, so it pays when it brings the hand enough closer.
// Personalities differ through how they value plans (近さ・打点・好きな役) and callMargin;
// only 面前派 never call. Returns every option's evaluation and the one to make (or null).
function evaluateCall(game, p, calledId, from, person, memoryKey) {
    const pl = game.players[p]
    const options = callOptions(game, p, calledId, from).filter(o => o.type !== 'minkan' || person.minkan)
    if (pl.riichi || !options.length) return null
    const now = choosePlan(game, p, person, memoryKey, false).plan
    // The human's 狙い役, while it is possible: a call must keep it.
    const aim = memoryKey === 'recPlan' && pl.aim === now.id ? now.id : null
    const evaluated = options.map(option => {
        const after = planAfterCall(game, p, person, option, calledId, memoryKey)
        const gain = after.id === 'none' ? 0 : after.value / now.value
        return { option, after, gain }
    })
    let blocked = null
    if (person.call === 'none') blocked = '面前で打つ'
    else if (threatLevel(game, p, person) >= 0.5 && person.defense >= 1) blocked = '警戒すべき相手がいて手も遠い'
    else if (now.distance <= 0) blocked = 'すでにテンパイ'
    let best = null
    if (!blocked) {
        for (const e of evaluated) {
            // No yaku left after the call.
            if (e.after.id === 'none') continue
            if (aim && e.after.id !== aim) continue
            // A kan does not bring the hand closer; it is made when it costs nothing.
            // Other calls must make the hand worth more than it is now (a tie is not worth opening the hand).
            if (e.option.type === 'minkan' ? e.after.distance > now.distance : e.gain <= person.callMargin) continue
            if (!best || e.gain > best.gain) best = e
        }
    }
    return { now, evaluated, best, blocked, aim }
}

function callText(now, e) {
    const call = CALL_NAME[e.option.type]
    const how = e.after.id === now.id ? `${e.after.name}狙いで${call}` : `${now.name}狙いから${e.after.name}に切り替えて${call}`
    return `${how}：${distanceText(now.distance)}→${distanceText(e.after.distance)}、見込み打点${now.points.toLocaleString()}→${e.after.points.toLocaleString()}点`
}

// Returns { type, tiles, forbidden, reason } or null — only plain data, as the call is kept in the
// game state, which is copied for every position.
/* =====================
   九種九牌
===================== */
const YAOCHU_KINDS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

// At the first draw, before any call: 9 or more kinds of 么九牌 may be thrown in (途中流局).
export function canKyuushu(game, p) {
    const pl = game.players[p]
    if (!pl.firstGo || game.anyCall || pl.lastDraw === null || pl.melds.length) return false
    return new Set(pl.hand.map(kindOf).filter(k => YAOCHU_KINDS.includes(k))).size >= 9
}

// The average worth of a fresh 14-tile hand for this player and seat, from REDEAL_SAMPLES random
// hands (a fixed seed of its own, so the game's random state and replays are untouched).
const REDEAL_SAMPLES = 1000
const redealCache = new Map()
function redealValue(game, p, person) {
    const dealer = game.seatWind(p) === 0
    const key = person.id + '/' + (person.level ?? '')
    let byPerson = redealCache.get(key)
    if (!byPerson) redealCache.set(key, byPerson = {})
    if (byPerson[dealer] !== undefined) return byPerson[dealer]
    const pl = game.players[p]
    const saved = { hand: pl.hand, river: pl.river, planName: pl.planName }
    let state = 20261020
    const random = () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    let total = 0
    try {
        pl.river = []
        for (let n = 0; n < REDEAL_SAMPLES; n++) {
            const tiles = [...Array(136).keys()]
            for (let i = 0; i < 14; i++) {
                const j = i + Math.floor(random() * (136 - i))
                ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
            }
            pl.hand = tiles.slice(0, 14)
            total += choosePlan(game, p, person, 'plan', false, true).value
        }
    } finally {
        Object.assign(pl, saved)
    }
    return (byPerson[dealer] = total / REDEAL_SAMPLES)
}

// Throw the hand in when it is worth less than a fresh one. Both are valued the same way as the
// plans (points × the chance to get there), so no setting of its own is needed: a big-hand lover
// keeps more 国士 hands simply because it values 国士 more.
export function kyuushuAdvice(game, p, person = PERSONALITIES.standard) {
    if (!canKyuushu(game, p)) return null
    const now = choosePlan(game, p, person, 'plan', false)
    const redeal = redealValue(game, p, person)
    return { abort: now.value < redeal, plan: now.best.name, ratio: now.value / redeal }
}

export function decideKyuushu(game, p) {
    return !!kyuushuAdvice(game, p, personFor(game, p))?.abort
}

export function decideCall(game, p, calledId, from) {
    const ev = evaluateCall(game, p, calledId, from, personFor(game, p), 'plan')
    if (!ev?.best) return null
    const { option } = ev.best
    return { type: option.type, tiles: option.tiles, forbidden: option.forbidden, reason: callText(ev.now, ev.best) }
}

// The recommendation for a call chance, judged the standard way: { action: 'pon' | 'chi' | 'minkan' | 'skip', text }.
export function callAdvice(game, p, calledId, from) {
    const ev = evaluateCall(game, p, calledId, from, PERSONALITIES.standard, 'recPlan')
    if (!ev) return null
    if (ev.best) return { action: ev.best.option.type, tiles: ev.best.option.tiles, text: callText(ev.now, ev.best) }
    if (ev.blocked) return { action: 'skip', text: `スルー：${ev.blocked}` }
    if (ev.aim && !ev.evaluated.some(e => e.after.id === ev.aim)) return { action: 'skip', text: `スルー：鳴くと${ev.now.name}が狙えなくなる` }
    const withYaku = ev.evaluated.filter(e => e.after.id !== 'none' && (!ev.aim || e.after.id === ev.aim)).sort((a, b) => b.gain - a.gain)[0]
    if (!withYaku) return { action: 'skip', text: 'スルー：鳴くと役がなくなる' }
    return { action: 'skip', text: `スルー：${callText(ev.now, withYaku)}で割に合わない` }
}
