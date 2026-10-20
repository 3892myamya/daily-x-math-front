// Wraps the riichi library (MIT) for 役・符・点数.
import Riichi from 'riichi'
import { kindOf, kindsToMpsz, toMpsz } from './mahjongTiles.js'

// Fixed rules: 喰いタンあり・赤3枚・ローカル役なし・ダブル役満あり.
// win: { concealed (ids without the winning tile), winTile, melds: [{ tiles }], tsumo,
//        roundWind, seatWind (0=東), riichi, ippatsu, doubleRiichi, last (海底/河底), kan (嶺上開花/槍槓), blessing (天和/地和),
//        doraKinds, uraKinds }
// The library's names written the usual way.
const YAKU_NAMES = { 搶槓: '槍槓' }

export function scoreWin(win) {
    let text = toMpsz(win.concealed)
    text += (win.tsumo ? '' : '+') + toMpsz([win.winTile])
    // The library writes a concealed kan as two tiles and an open kan as four.
    for (const meld of win.melds) text += '+' + toMpsz(meld.type === 'ankan' ? meld.tiles.slice(0, 2) : meld.tiles)
    const doraKinds = [...win.doraKinds, ...(win.riichi ? win.uraKinds : [])]
    if (doraKinds.length) text += '+d' + kindsToMpsz(doraKinds)
    let flags = ''
    if (win.blessing) flags += 't'
    if (win.doubleRiichi) flags += 'w'
    else if (win.riichi) flags += 'r'
    if (win.ippatsu) flags += 'i'
    if (win.last) flags += 'h'
    if (win.kan) flags += 'k'
    text += '+' + flags + (win.roundWind + 1) + (win.seatWind + 1)

    const result = new Riichi(text).calc()
    if (result.error || !result.isAgari) return null
    const yaku = Object.entries(result.yaku).map(([name, value]) => ({ name: YAKU_NAMES[name] ?? name, value }))
    // The library counts ura dora together with dora; split them for display.
    if (win.riichi && result.han && !result.yakuman) {
        const all = [...win.concealed, win.winTile, ...win.melds.flatMap(m => m.tiles)].map(kindOf)
        const ura = win.uraKinds.reduce((n, d) => n + all.filter(k => k === d).length, 0)
        const dora = yaku.find(y => y.name === 'ドラ')
        if (ura && dora) {
            const rest = parseInt(dora.value) - ura
            if (rest > 0) dora.value = `${rest}飜`
            else yaku.splice(yaku.indexOf(dora), 1)
            yaku.push({ name: '裏ドラ', value: `${ura}飜` })
        }
    }
    return {
        yaku,
        han: result.han,
        fu: result.fu,
        yakuman: result.yakuman,
        points: result.ten,
        name: result.name,
        // Payments before 本場: ron → [from loser]; tsumo by dealer → [each]; tsumo by non-dealer → [dealer, others].
        payments: win.seatWind === 0 ? result.oya : result.ko,
        hasYaku: result.han > 0 || result.yakuman > 0,
    }
}
