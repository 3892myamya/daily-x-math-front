// Shanten on kind counts (34 entries). -1 means a complete hand.
import { KIND_COUNT, isYaochu } from './mahjongTiles.js'

// Each suit is split into (mentsu, taatsu, head) options once and cached by its counts.
// seqOnly (平和): no triplets, and a pair can only be the head (it would grow into a triplet).
const suitCache = new Map()
const seqSuitCache = new Map()

function addOption(out, m, t, p) {
    t = Math.min(t, 4)
    for (const [om, ot, op] of out) {
        if (om >= m && ot >= t && op >= p) return
    }
    for (let i = out.length - 1; i >= 0; i--) {
        const [om, ot, op] = out[i]
        if (om <= m && ot <= t && op <= p) out.splice(i, 1)
    }
    out.push([m, t, p])
}

function searchSuit(c, i, m, t, p, out, seqOnly = false) {
    while (i < 9 && c[i] === 0) i++
    if (i === 9) {
        addOption(out, m, t, p)
        return
    }
    if (c[i] >= 3 && !seqOnly) {
        c[i] -= 3
        searchSuit(c, i, m + 1, t, p, out, seqOnly)
        c[i] += 3
    }
    if (i < 7 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--
        searchSuit(c, i, m + 1, t, p, out, seqOnly)
        c[i]++; c[i + 1]++; c[i + 2]++
    }
    if (c[i] >= 2) {
        c[i] -= 2
        if (!p) searchSuit(c, i, m, t, 1, out, seqOnly)
        if (!seqOnly) searchSuit(c, i, m, t + 1, p, out, seqOnly)
        c[i] += 2
    }
    if (i < 8 && c[i + 1]) {
        c[i]--; c[i + 1]--
        searchSuit(c, i, m, t + 1, p, out, seqOnly)
        c[i]++; c[i + 1]++
    }
    if (i < 7 && c[i + 2]) {
        c[i]--; c[i + 2]--
        searchSuit(c, i, m, t + 1, p, out, seqOnly)
        c[i]++; c[i + 2]++
    }
    c[i]--
    searchSuit(c, i + 1, m, t, p, out, seqOnly)
    c[i]++
}

function suitOptions(counts, base, seqOnly = false) {
    let key = 0
    for (let i = 0; i < 9; i++) key = key * 5 + counts[base + i]
    const cache = seqOnly ? seqSuitCache : suitCache
    let options = cache.get(key)
    if (!options) {
        options = []
        searchSuit(counts.slice(base, base + 9), 0, 0, 0, 0, options, seqOnly)
        cache.set(key, options)
    }
    return options
}

function honorOptions(counts) {
    let m = 0
    let pairs = 0
    for (let k = 27; k < KIND_COUNT; k++) {
        if (counts[k] >= 3) m++
        else if (counts[k] === 2) pairs++
    }
    const out = [[m, Math.min(pairs, 4), 0]]
    if (pairs) out.push([m, Math.min(pairs - 1, 4), 1])
    return out
}

function combine(groups, meldCount) {
    let states = [[meldCount, 0, 0]]
    for (const options of groups) {
        const next = []
        for (const [m, t, p] of states) {
            for (const [om, ot, op] of options) {
                if (p + op > 1) continue
                addOption(next, m + om, t + ot, p + op)
            }
        }
        states = next
    }
    let best = 8
    for (const [m, t, p] of states) {
        // More than four sets (possible when some sets are given, as for 大三元) still make only four.
        const sets = Math.min(m, 4)
        best = Math.min(best, 8 - 2 * sets - Math.min(t, 4 - sets) - p)
    }
    return best
}

export function normalShanten(counts, meldCount = 0) {
    return combine([suitOptions(counts, 0), suitOptions(counts, 9), suitOptions(counts, 18), honorOptions(counts)], meldCount)
}

// 平和: four sequences and a pair that is not a 役牌 (closed only; the 両面 wait is left to scoring).
// isYakuhai(k) tells which honors cannot be the pair.
export function pinfuShanten(counts, meldCount, isYakuhai) {
    if (meldCount) return 99
    const honors = [[0, 0, 0]]
    for (let k = 27; k < KIND_COUNT; k++) if (counts[k] >= 2 && !isYakuhai(k)) { honors.push([0, 0, 1]); break }
    return combine([suitOptions(counts, 0, true), suitOptions(counts, 9, true), suitOptions(counts, 18, true), honors], 0)
}

export function chiitoiShanten(counts) {
    let pairs = 0
    let kinds = 0
    for (const c of counts) {
        if (c) kinds++
        if (c >= 2) pairs++
    }
    return 6 - pairs + Math.max(0, 7 - kinds)
}

export function kokushiShanten(counts) {
    let kinds = 0
    let pair = 0
    for (let k = 0; k < KIND_COUNT; k++) {
        if (!isYaochu(k) || !counts[k]) continue
        kinds++
        if (counts[k] >= 2) pair = 1
    }
    return 13 - kinds - pair
}

export function shanten(counts, meldCount = 0) {
    const normal = normalShanten(counts, meldCount)
    if (meldCount) return normal
    return Math.min(normal, chiitoiShanten(counts), kokushiShanten(counts))
}

// Kinds that complete a tenpai hand (13-tile equivalent). Waits on a kind the hand already holds 4 of are not counted.
export function waitingKinds(counts, meldCount = 0) {
    const waits = []
    for (let k = 0; k < KIND_COUNT; k++) {
        if (counts[k] >= 4) continue
        counts[k]++
        if (shanten(counts, meldCount) === -1) waits.push(k)
        counts[k]--
    }
    return waits
}

// 対々和 shape: only triplets and one pair (meldCount counts pon/kan melds; no chi allowed).
export function toitoiShanten(counts, meldCount = 0) {
    let sets = meldCount
    let pairs = 0
    for (const c of counts) {
        if (c >= 3) sets++
        else if (c === 2) pairs++
    }
    return 8 - 2 * sets - Math.min(pairs, 5 - sets)
}

// 七対子 only, for hands that aim at it.
export function chiitoiOnly(counts, meldCount = 0) {
    return meldCount ? 99 : chiitoiShanten(counts)
}

/* =====================
   見た目のシャンテン（入門者の読み方）
===================== */
// A beginner splits each suit left to right: sets first (a triplet before a run), then pairs,
// then partial sets, and never looks for a better split of complex shapes (3445, 2344, …).
// It is one possible split, so it is never smaller than the real shanten.
function greedySuit(counts, base) {
    const c = counts.slice(base, base + 9)
    let sets = 0
    let pairs = 0
    let partials = 0
    for (let i = 0; i < 9; i++) {
        while (c[i] >= 3) { c[i] -= 3; sets++ }
        while (i < 7 && c[i] && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; sets++ }
    }
    for (let i = 0; i < 9; i++) if (c[i] >= 2) { c[i] -= 2; pairs++ }
    for (let i = 0; i < 9; i++) {
        while (i < 8 && c[i] && c[i + 1]) { c[i]--; c[i + 1]--; partials++ }
        while (i < 7 && c[i] && c[i + 2]) { c[i]--; c[i + 2]--; partials++ }
    }
    return { sets, pairs, partials }
}

export function greedyNormalShanten(counts, meldCount = 0) {
    let sets = meldCount
    let pairs = 0
    let partials = 0
    for (const base of [0, 9, 18]) {
        const r = greedySuit(counts, base)
        sets += r.sets
        pairs += r.pairs
        partials += r.partials
    }
    for (let k = 27; k < KIND_COUNT; k++) {
        if (counts[k] >= 3) sets++
        else if (counts[k] === 2) pairs++
    }
    const head = pairs ? 1 : 0
    const t = partials + pairs - head
    return 8 - 2 * sets - Math.min(t, 4 - sets) - head
}

export function greedyShanten(counts, meldCount = 0) {
    const normal = greedyNormalShanten(counts, meldCount)
    if (meldCount) return normal
    return Math.min(normal, chiitoiShanten(counts), kokushiShanten(counts))
}
