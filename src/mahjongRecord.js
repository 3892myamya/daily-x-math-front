// The game record kept across a reload: one small entry per position of the timeline. A position is the
// full game state at the start of the game and of each hand, and otherwise only what changed since the
// position before, so a whole 半荘 stays near 1MB. Rebuilding replays the changes, never the players' thinking.

// Plain JSON that keeps Sets (the tiles safe after a riichi) and numbers JSON cannot hold (Infinity).
export const toText = value => JSON.stringify(value, (_, v) => {
    if (v instanceof Set) return { __set: [...v] }
    if (typeof v === 'number' && !Number.isFinite(v)) return { __num: String(v) }
    return v
})
export const fromText = text => JSON.parse(text, (_, v) => {
    if (v && typeof v === 'object') {
        if (Array.isArray(v.__set)) return new Set(v.__set)
        if (typeof v.__num === 'string') return Number(v.__num)
    }
    return v
})

// What changed from a to b, both plain data as JSON.parse(toText(x)) gives (Sets still written out, so
// the diff itself is stored with plain JSON): a list of [path, value] (set) and [path] (delete), paths
// as dot-joined keys. Arrays change by index after their new length.
export function diffState(a, b, path = '', out = []) {
    if (a === b) return out
    const objects = a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)
    if (!objects) {
        out.push([path, b])
        return out
    }
    const at = k => path ? `${path}.${k}` : String(k)
    if (Array.isArray(a)) {
        if (a.length !== b.length) out.push([at('length'), b.length])
        for (let i = 0; i < b.length; i++) diffState(a[i], b[i], at(i), out)
    } else {
        for (const k of Object.keys(b)) {
            if (k in a) diffState(a[k], b[k], at(k), out)
            else out.push([at(k), b[k]])
        }
        for (const k of Object.keys(a)) if (!(k in b)) out.push([at(k)])
    }
    return out
}

// Applies a diff to a copy of the plain state a.
export function applyDiff(a, diff) {
    const state = structuredClone(a)
    for (const change of diff) {
        const keys = change[0].split('.')
        const last = keys.pop()
        let node = state
        for (const k of keys) node = node[k]
        if (change.length === 1) delete node[last]
        else node[last] = structuredClone(change[1])
    }
    return state
}
