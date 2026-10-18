// Pictures for 筒子 and 索子 as simple shapes in a 60×84 box, laid out and coloured like real tiles.
// 2・3・4・6・8索 are green only (緑一色), 1・5・7・9索 have red, a red five is all red.

const GREEN = '#1e7a45'
const BLUE = '#1f5fa8'
const RED = '#c8102e'

const circle = (x, y, r, color) => ({ shape: 'circle', x, y, r, color })
const stick = (x, y, color = GREEN, h = 22, rotate = 0, w = 9) => ({ shape: 'stick', x, y, h, w, color, rotate })

function pins(n) {
    switch (n) {
        case 1: return [{ shape: 'big', x: 30, y: 42 }]
        case 2: return [circle(30, 22, 14, GREEN), circle(30, 62, 14, BLUE)]
        case 3: return [circle(14, 17, 10, BLUE), circle(30, 42, 10, RED), circle(46, 67, 10, GREEN)]
        case 4: return [circle(17, 22, 10, BLUE), circle(43, 22, 10, GREEN), circle(17, 62, 10, GREEN), circle(43, 62, 10, BLUE)]
        case 5: return [circle(16, 18, 9, BLUE), circle(44, 18, 9, GREEN), circle(30, 42, 9, RED), circle(16, 66, 9, GREEN), circle(44, 66, 9, BLUE)]
        case 6: return [circle(18, 14, 8, GREEN), circle(42, 14, 8, GREEN), ...[46, 70].flatMap(y => [circle(18, y, 8, RED), circle(42, y, 8, RED)])]
        case 7: return [circle(12, 12, 7, GREEN), circle(30, 21, 7, GREEN), circle(48, 30, 7, GREEN),
            ...[53, 72].flatMap(y => [circle(19, y, 7, RED), circle(41, y, 7, RED)])]
        case 8: return [12, 32, 52, 72].flatMap(y => [circle(18, y, 8, BLUE), circle(42, y, 8, BLUE)])
        case 9: return [15, 42, 69].flatMap(y => [12, 30, 48].map(x => circle(x, y, 7, y === 42 ? RED : BLUE)))
    }
    return []
}

function sous(n) {
    switch (n) {
        case 1: return [{ shape: 'bird', x: 30, y: 44 }]
        case 2: return [stick(30, 22, GREEN, 34, 0, 11), stick(30, 62, GREEN, 34, 0, 11)]
        case 3: return [stick(30, 22, GREEN, 34, 0, 11), stick(17, 62, GREEN, 34, 0, 11), stick(43, 62, GREEN, 34, 0, 11)]
        case 4: return [stick(17, 22, GREEN, 34, 0, 11), stick(43, 22, GREEN, 34, 0, 11), stick(17, 62, GREEN, 34, 0, 11), stick(43, 62, GREEN, 34, 0, 11)]
        case 5: return [stick(13, 20, GREEN, 30, 0, 10), stick(47, 20, GREEN, 30, 0, 10), stick(30, 42, RED, 30, 0, 10), stick(13, 64, GREEN, 30, 0, 10), stick(47, 64, GREEN, 30, 0, 10)]
        case 6: return [22, 62].flatMap(y => [12, 30, 48].map(x => stick(x, y, GREEN, 34, 0, 10)))
        case 7: return [stick(30, 13, RED, 20), ...[44, 70].flatMap(y => [12, 30, 48].map(x => stick(x, y, GREEN, 24)))]
        // 8索: | \/ | above and | /\ | below.
        case 8: return [
            stick(8, 22, GREEN, 32, 0, 8), stick(23, 22, GREEN, 32, -22, 8), stick(37, 22, GREEN, 32, 22, 8), stick(52, 22, GREEN, 32, 0, 8),
            stick(8, 62, GREEN, 32, 0, 8), stick(23, 62, GREEN, 32, 22, 8), stick(37, 62, GREEN, 32, -22, 8), stick(52, 62, GREEN, 32, 0, 8),
        ]
        case 9: return [15, 42, 69].flatMap(y => [12, 30, 48].map(x => stick(x, y, x === 30 ? RED : GREEN, 24, 0, 10)))
    }
    return []
}

// suit: 'p' or 's'; n: 1-9. Returns shapes for MahjongTile to draw.
export function tileArt(suit, n, red) {
    const shapes = suit === 'p' ? pins(n) : sous(n)
    return red ? shapes.map(s => ({ ...s, color: RED, red: true })) : shapes
}

export const ART_COLORS = { GREEN, BLUE, RED }
