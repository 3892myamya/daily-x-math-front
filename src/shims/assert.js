// The browser stand-in for Node's assert, for the scoring library (riichi), which tells 一盃口 by
// whether assert.deepStrictEqual throws on two sets. Only what it uses: plain arrays and values.
const same = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i])))

export function deepStrictEqual(actual, expected) {
    if (!same(actual, expected)) throw new Error('not deep-strict-equal')
}

export default { deepStrictEqual }
