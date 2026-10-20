// Measured odds used where the AI would otherwise need hand-set weights.
//
// From 640 hanchan of four ケイ (2026-10-19, about 230,000 closed-hand discards): after a discard,
// how often that hand went on to win, by its shanten and the stage of the hand.
// stage by tiles left in the wall: early 55+ (taken as 62), middle 35-54 (45), late 0-34 (17).
// Rows the games hardly reached (fewer than ~300 cases) continue at about half per step.
const WIN_RATE = {
    62: [0.646, 0.365, 0.227, 0.165, 0.124, 0.085, 0.051],
    45: [0.530, 0.215, 0.105, 0.052, 0.018, 0.008, 0.004],
    17: [0.313, 0.073, 0.018, 0.004, 0.002, 0.001, 0.0005],
}
const WALL_POINTS = [62, 45, 17]

// Win rate for a hand `shanten` steps from tenpai with `wall` tiles left, interpolated on a log scale
// between the measured stages.
export function winRate(shanten, wall) {
    const s = Math.max(0, shanten)
    const at = row => {
        const last = row.length - 1
        const i = Math.min(Math.floor(s), last)
        const lo = Math.log(row[i])
        const hi = i < last ? Math.log(row[i + 1]) : lo + Math.log(0.5)
        return lo + (Math.min(s, last) - i) * (hi - lo) + Math.max(0, s - last) * Math.log(0.5)
    }
    const w = Math.max(WALL_POINTS[2], Math.min(WALL_POINTS[0], wall))
    const [a, b] = w >= WALL_POINTS[1] ? [62, 45] : [45, 17]
    const t = (a - w) / (a - b)
    return Math.exp(at(WIN_RATE[a]) * (1 - t) + at(WIN_RATE[b]) * t)
}

// In a hand one does not win one pays on average about this much (measured over 80 hanchan of four
// ケイ: 1,573 points a player per hand not won, draws included); winning saves it.
export const WIN_SAVES = 1573
