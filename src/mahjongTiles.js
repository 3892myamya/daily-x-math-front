// Physical tiles are ids 0..135. kind = id >> 2:
// 0-8 萬子, 9-17 筒子, 18-26 索子, 27-33 東南西北白發中.
// The first copy (id % 4 === 0) of each 5 is the red five.

export const KIND_COUNT = 34
export const EAST = 27
export const HAKU = 31

export const kindOf = id => id >> 2
export const isRed = id => (id & 3) === 0 && kindOf(id) < 27 && kindOf(id) % 9 === 4
// What a discard is, as a choice: the kind, and for a five whether it is the red one (the same shape,
// one dora more). Shapes are counted by kind; choices are told apart by this.
export const tileKey = id => kindOf(id) * 2 + (isRed(id) ? 1 : 0)
export const tileName = id => kindName(kindOf(id)) + (isRed(id) ? '（赤）' : '')
export const suitOf = k => k < 27 ? Math.floor(k / 9) : 3
export const numOf = k => k < 27 ? k % 9 + 1 : k - 26
export const isHonor = k => k >= 27
export const isTerminal = k => k < 27 && (k % 9 === 0 || k % 9 === 8)
export const isYaochu = k => isHonor(k) || isTerminal(k)
export const isDragon = k => k >= HAKU

export function doraOf(indicatorKind) {
    const k = indicatorKind
    if (k < 27) return Math.floor(k / 9) * 9 + (k % 9 + 1) % 9
    if (k < HAKU) return EAST + (k - EAST + 1) % 4
    return HAKU + (k - HAKU + 1) % 3
}

// 役牌: dragons, the round wind and the seat wind (both count for a double wind).
export function yakuhaiCount(k, roundWind, seatWind) {
    if (isDragon(k)) return 1
    return (k === EAST + roundWind ? 1 : 0) + (k === EAST + seatWind ? 1 : 0)
}

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const SUIT_CHAR = ['萬', '筒', '索']
const HONOR_NAME = ['東', '南', '西', '北', '白', '發', '中']
export const WIND_NAME = ['東', '南', '西', '北']
export const SUIT_NAME = ['萬子', '筒子', '索子', '字牌']

export function kindName(k) {
    if (k >= 27) return HONOR_NAME[k - 27]
    return (suitOf(k) === 0 ? KANJI_NUM[k % 9] : String(k % 9 + 1)) + SUIT_CHAR[suitOf(k)]
}

// Two-line face for drawing a tile: { top, bottom, suit } (suit: m/p/s/z).
export function tileFace(k) {
    if (k >= 27) return { top: HONOR_NAME[k - 27], bottom: '', suit: 'z' }
    const suit = 'mps'[suitOf(k)]
    return { top: suit === 'm' ? KANJI_NUM[k % 9] : String(k % 9 + 1), bottom: SUIT_CHAR[suitOf(k)], suit }
}

export function countKinds(ids) {
    const counts = new Array(KIND_COUNT).fill(0)
    for (const id of ids) counts[kindOf(id)]++
    return counts
}

export const sortTiles = ids => [...ids].sort((a, b) => a - b)

// "123m406p..." notation used by the riichi scoring library (0 = red five).
export function toMpsz(ids) {
    const groups = [[], [], [], []]
    for (const id of sortTiles(ids)) {
        const k = kindOf(id)
        groups[suitOf(k)].push(isRed(id) ? 0 : numOf(k))
    }
    return groups.map((g, s) => g.length ? g.join('') + 'mpsz'[s] : '').join('')
}

export function kindsToMpsz(kinds) {
    return toMpsz(kinds.map(k => k * 4 + 1))
}
