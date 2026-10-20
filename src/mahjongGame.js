// A hanchan for four seats (CPUs, or three CPUs and a human), advanced one visible action per step().
// Fixed rules: 四麻半荘・25000点持ち・喰いタンあり・赤3枚・頭ハネ・トビあり・オーラス親のアガリやめあり・
// カンドラ即乗り・流し満貫あり・途中流局（九種九牌・四風連打・四家立直・四槓散了）あり.
// 三家和了 does not arise: 頭ハネ means only one player wins on a discard.
// When the human has to decide, `prompt` is set and step() waits for one of the human*() calls.
import { kindOf, doraOf, countKinds, sortTiles, WIND_NAME, kindName } from './mahjongTiles.js'
import { shanten, waitingKinds } from './mahjongShanten.js'
import { scoreWin } from './mahjongScore.js'
import {
    PERSONALITIES, decideDiscard, decideCall, decideSelfKan, selfKanOptions, callOptions,
    analyzeChoice, hintFor, displayName, callAdvice, canKyuushu, kyuushuAdvice, decideKyuushu,
} from './mahjongAI.js'

// mulberry32. The state is a plain number so a game can be copied with structuredClone.
function nextRandom(state) {
    const a = (state + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return [a, ((t ^ (t >>> 14)) >>> 0) / 4294967296]
}

export function createRng(seed) {
    let state = seed >>> 0
    return () => {
        let value
        ;[state, value] = nextRandom(state)
        return value
    }
}

export const START_POINTS = 25000
export const HUMAN = 'human'
const CALL_NAME = { chi: 'チー', pon: 'ポン', minkan: 'カン', ankan: '暗槓', kakan: '加槓' }

export function emptyStats() {
    // decisions: discards (with the riichi choice) and call chances; decisionsAgreed: those that
    // followed the recommendation (推奨判断率).
    return { hands: 0, wins: 0, winPoints: 0, dealIns: 0, riichi: 0, calledHands: 0, discards: 0, agreed: 0, decisions: 0, decisionsAgreed: 0 }
}

export class MahjongGame {
    // seats: personality ids in seat order (seat 0 is the first dealer); 'human' marks the player.
    // levels: 強さ per seat ('advanced' | 'intermediate' | 'beginner').
    // length: 'hanchan' (東南戦, 8 hands) or 'tonpu' (東風戦, 4 hands).
    constructor({ seed = Date.now(), seats, levels = seats.map(() => 'advanced'), length = 'hanchan' }) {
        this.seed = seed
        this.rngState = seed >>> 0
        this.scores = seats.map(() => START_POINTS)
        this.seats = seats
        this.levels = levels
        this.humanSeat = seats.indexOf(HUMAN) >= 0 ? seats.indexOf(HUMAN) : null
        this.roundIndex = 0
        this.length = length
        this.lastRound = length === 'tonpu' ? 3 : 7
        this.honba = 0
        this.kyotaku = 0
        this.phase = 'roundStart'
        this.over = false
        this.stats = seats.map(() => emptyStats())
        this.history = []
        this.players = []
        this.wall = []
        this.doraIndicators = []
        this.uraIndicators = []
        this.prompt = null
    }

    // A copy of a game taken with structuredClone (which keeps only the data) made playable again.
    static restore(snapshot) {
        return Object.assign(Object.create(MahjongGame.prototype), structuredClone(snapshot))
    }

    random() {
        let value
        ;[this.rngState, value] = nextRandom(this.rngState)
        return value
    }

    get roundWind() { return Math.floor(this.roundIndex / 4) }
    get dealer() { return this.roundIndex % 4 }
    seatWind(p) { return (p - this.dealer + 4) % 4 }
    get roundName() { return `${WIND_NAME[this.roundWind]}${this.roundIndex % 4 + 1}局` }
    nameOf(p) { return displayName(this.seats[p], this.levels[p]) }
    isHuman(p) { return this.seats[p] === HUMAN }

    step() {
        if (this.over || this.prompt) return null
        if (this.phase === 'roundStart') return this.startRound()
        if (this.phase === 'roundEnd') return this.nextRound()
        if (this.pendingCall) return this.executeCall()
        if (this.awaitingDiscard) return this.turnAction()
        return this.draw()
    }

    /* =====================
       局の開始
    ===================== */
    startRound() {
        const tiles = [...Array(136).keys()]
        for (let i = tiles.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1))
            ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
        }
        // 王牌: 4 replacement tiles for kans, then dora and ura indicators (one more of each per kan).
        const dead = tiles.splice(0, 14)
        this.rinshanTiles = dead.slice(0, 4)
        this.doraPool = dead.slice(4, 9)
        this.uraPool = dead.slice(9, 14)
        this.doraIndicators = [this.doraPool[0]]
        this.uraIndicators = [this.uraPool[0]]
        this.kanCount = 0
        this.kanPlayers = []
        this.players = this.seats.map((personality, p) => ({
            personality,
            level: this.levels[p],
            hand: [],
            melds: [],
            river: [],
            riichi: false,
            doubleRiichi: false,
            ippatsu: false,
            riichiFuriten: false,
            tempFuriten: false,
            safeAfterRiichi: new Set(),
            firstGo: true,
            lastDraw: null,
            lastCall: null,
            called: false,
            seat: p,
        }))
        for (let n = 0; n < 13; n++) {
            for (let i = 0; i < 4; i++) this.players[(this.dealer + i) % 4].hand.push(tiles.pop())
        }
        for (const pl of this.players) pl.hand = sortTiles(pl.hand)
        this.wall = tiles
        this.turn = this.dealer
        this.anyCall = false
        this.pendingCall = null
        this.awaitingDiscard = false
        this.kuikae = null
        this.rinshan = false
        this.prompt = null
        this.lastDiscard = null
        this.result = null
        this.phase = 'play'
        for (const s of this.stats) s.hands++
        return { type: 'start', text: `${this.roundName} ${this.honba}本場 開始（親：${this.nameOf(this.dealer)}）` }
    }

    /* =====================
       ツモ
    ===================== */
    drawTile(p, fromDeadWall) {
        const pl = this.players[p]
        const id = fromDeadWall ? this.rinshanTiles.pop() : this.wall.pop()
        // The dead wall stays at 14 tiles: the last live tile moves into it.
        if (fromDeadWall) this.wall.shift()
        pl.hand.push(id)
        pl.lastDraw = id
        this.rinshan = fromDeadWall
        return id
    }

    draw() {
        const p = this.turn
        if (!this.wall.length) return this.exhaustiveDraw()
        const id = this.drawTile(p, false)
        return this.afterDraw(p, { type: 'drawTile', player: p, tile: id, text: `${this.nameOf(p)}：ツモ ${kindName(kindOf(id))}` })
    }

    // After a draw (normal or replacement): a CPU wins at once if it can; the human is asked.
    afterDraw(p, event) {
        const pl = this.players[p]
        this.awaitingDiscard = true
        if (this.isHuman(p)) {
            // In riichi the human is only asked when there is something besides ツモ切り.
            if (!pl.riichi || this.canTsumo(p) || selfKanOptions(this, p).length) this.prompt = { kind: 'turn' }
            return event
        }
        if (this.canTsumo(p)) {
            this.awaitingDiscard = false
            return this.settleWin(p, null, pl.lastDraw, this.score(p, pl.lastDraw, true))
        }
        return event
    }

    canTsumo(p) {
        const pl = this.players[p]
        if (pl.lastDraw === null || shanten(countKinds(pl.hand), pl.melds.length) !== -1) return false
        return !!this.score(p, pl.lastDraw, true)?.hasYaku
    }

    turnAction() {
        const p = this.turn
        if (!this.isHuman(p) && this.players[p].lastDraw !== null) {
            if (decideKyuushu(this, p)) return this.kyuushu(p)
            const kan = decideSelfKan(this, p)
            if (kan) return this.selfKan(p, kan)
        }
        return this.discard(p)
    }

    /* =====================
       カン
    ===================== */
    revealKanDora() {
        this.kanCount++
        this.doraIndicators.push(this.doraPool[this.kanCount])
        this.uraIndicators.push(this.uraPool[this.kanCount])
    }

    interrupt() {
        this.anyCall = true
        for (const other of this.players) {
            other.ippatsu = false
            other.firstGo = false
        }
    }

    selfKan(p, option) {
        const pl = this.players[p]
        this.awaitingDiscard = false
        pl.hand = pl.hand.filter(x => !option.tiles.includes(x))
        if (option.type === 'ankan') {
            pl.melds.push({ type: 'ankan', tiles: sortTiles(option.tiles), calledTile: null, from: p })
        } else {
            const meld = pl.melds.find(m => m.type === 'pon' && kindOf(m.tiles[0]) === option.kind)
            meld.type = 'kakan'
            meld.tiles = sortTiles([...meld.tiles, option.tiles[0]])
            meld.addedTile = option.tiles[0]
        }
        this.kanPlayers.push(p)
        this.interrupt()
        const event = { type: 'kan', player: p, text: `${this.nameOf(p)}：${CALL_NAME[option.type]}（${kindName(option.kind)}）` }

        // 槍槓: another player may win on the tile added to a pon.
        if (option.type === 'kakan') {
            const robbed = this.checkRon(p, option.tiles[0], { chankan: true })
            if (robbed) return robbed
        }
        this.revealKanDora()
        this.drawTile(p, true)
        return this.afterDraw(p, event)
    }

    /* =====================
       打牌
    ===================== */
    // choice: { id, riichi } from the human; otherwise the CPU decides (or ツモ切り in riichi).
    discard(p, choice = null) {
        const pl = this.players[p]
        const forbidden = new Set(this.kuikae ?? [])
        let id
        let riichi = false
        let analysis = null
        if (choice) {
            id = choice.id
            riichi = !!choice.riichi
            analysis = analyzeChoice(this, p, id, riichi, forbidden)
        } else if (pl.riichi) {
            id = pl.lastDraw
        } else {
            const decision = decideDiscard(this, p, forbidden)
            id = decision.id
            riichi = decision.riichi
            analysis = decision.analysis
        }
        if (analysis) {
            this.stats[p].discards++
            if (analysis.choice.same) this.stats[p].agreed++
            this.countDecision(p, analysis.choice.same && !analysis.choice.riichiDiffers)
        }
        const drawn = pl.lastDraw
        const tsumogiri = id === drawn
        this.awaitingDiscard = false
        this.kuikae = null
        this.rinshan = false
        this.prompt = null
        pl.hand = sortTiles(pl.hand.filter(x => x !== id))
        pl.lastDraw = null
        if (pl.riichi) pl.ippatsu = false
        if (riichi) {
            pl.riichi = true
            pl.ippatsu = true
            pl.doubleRiichi = pl.firstGo && !this.anyCall
            this.stats[p].riichi++
        }
        // afterCall: the discard right after a pon/chi, so others can tell what came after the call.
        pl.river.push({ id, riichi, tsumogiri, called: false, afterCall: !!pl.lastCall })
        pl.firstGo = false
        if (!pl.riichi) pl.tempFuriten = false
        const k = kindOf(id)
        for (const other of this.players) if (other.riichi && other !== pl) other.safeAfterRiichi.add(k)
        this.lastDiscard = { player: p, id }

        const drawText = drawn !== null ? `ツモ${kindName(kindOf(drawn))} → ` : ''
        const event = {
            type: 'discard', player: p, tile: id, riichi, analysis, drawn,
            text: `${this.nameOf(p)}：${drawText}${riichi ? 'リーチ！ ' : ''}${kindName(k)}${tsumogiri ? 'ツモ切り' : '切り'}`,
            call: pl.lastCall,
        }
        pl.lastCall = null
        return this.afterDiscard(p, id, riichi, event)
    }

    // Ron, then the riichi stick, 四槓散了 and calls. Pauses when the human has a choice.
    afterDiscard(from, id, riichi, event, humanPassedRon = false) {
        const ron = this.checkRon(from, id, { humanPassed: humanPassedRon, riichi, event })
        if (ron) return ron
        if (this.prompt) return event

        if (riichi) {
            this.scores[from] -= 1000
            this.kyotaku++
        }
        if (this.kanCount === 4 && new Set(this.kanPlayers).size > 1) return this.abortiveDraw('四槓散了')
        if (this.players.every(q => q.riichi)) return this.abortiveDraw('四家立直')
        // 四風連打: the first four discards, with no call, are the same wind.
        const firsts = this.players.map(q => q.river)
        if (!this.anyCall && firsts.every(r => r.length === 1) && kindOf(id) >= 27 && kindOf(id) <= 30
            && firsts.every(r => kindOf(r[0].id) === kindOf(id))) return this.abortiveDraw('四風連打')

        const next = (from + 1) % 4
        if (!this.wall.length) {
            this.turn = next
            return event
        }
        const { call: cpuCall, chances } = this.findCall(from, id)
        // Every player who could call this tile, with the recommendation and what they did.
        event.callChances = chances
        for (const c of chances) this.countDecision(c.player, c.choice === c.advice.action)
        const h = this.humanSeat
        if (h !== null && h !== from && !this.players[h].riichi) {
            let options = callOptions(this, h, id, from)
            // A CPU pon or kan beats the human's chi.
            if (cpuCall && cpuCall.type !== 'chi') options = options.filter(o => o.type !== 'chi')
            if (options.length) {
                this.prompt = {
                    kind: 'react', from, id, ron: false, cpuCall,
                    calls: options.map(o => ({ ...o, forbidden: [...o.forbidden] })),
                    advice: callAdvice(this, h, id, from),
                }
                return event
            }
        }
        this.pendingCall = cpuCall
        this.turn = cpuCall ? cpuCall.player : next
        return event
    }

    /* =====================
       鳴き
    ===================== */
    // The call the CPUs make (pon and kan before chi), and every CPU's call chance:
    // { player, tile, advice, choice } where choice is the call type or 'skip'.
    findCall(from, id) {
        const calls = []
        const chances = []
        for (let i = 1; i < 4; i++) {
            const q = (from + i) % 4
            if (this.isHuman(q)) continue
            const advice = callAdvice(this, q, id, from)
            if (!advice) continue
            const call = decideCall(this, q, id, from)
            if (call) calls.push({ ...call, forbidden: [...call.forbidden], player: q, from, id, advice })
            chances.push({ player: q, tile: id, advice, choice: call ? call.type : 'skip' })
        }
        return { call: calls.find(c => c.type !== 'chi') ?? calls[0] ?? null, chances }
    }

    executeCall() {
        const call = this.pendingCall
        this.pendingCall = null
        const p = call.player
        const pl = this.players[p]
        const river = this.players[call.from].river
        river[river.length - 1].called = true
        pl.hand = pl.hand.filter(x => !call.tiles.includes(x))
        pl.melds.push({ type: call.type, tiles: sortTiles([...call.tiles, call.id]), calledTile: call.id, from: call.from })
        if (!pl.called) this.stats[p].calledHands++
        pl.called = true
        pl.lastDraw = null
        this.interrupt()
        this.turn = p
        const callInfo = { type: call.type, reason: call.reason ?? null, advice: call.advice ?? null }
        const event = {
            type: 'call', player: p, call: callInfo,
            text: `${this.nameOf(p)}：${CALL_NAME[call.type]}（${kindName(kindOf(call.id))}）`,
        }
        if (call.type === 'minkan') {
            this.kanPlayers.push(p)
            this.revealKanDora()
            this.drawTile(p, true)
            return this.afterDraw(p, event)
        }
        pl.lastCall = callInfo
        this.kuikae = call.forbidden
        this.awaitingDiscard = true
        if (this.isHuman(p)) this.prompt = { kind: 'turn' }
        return event
    }

    /* =====================
       人の操作
    ===================== */
    // What the human may do on their turn.
    humanTurnOptions() {
        const h = this.humanSeat
        const pl = this.players[h]
        const forbidden = this.kuikae ?? []
        return {
            canTsumo: this.canTsumo(h),
            kans: pl.lastDraw === null ? [] : selfKanOptions(this, h),
            forbidden,
            riichiLocked: pl.riichi,
            hint: pl.riichi ? null : hintFor(this, h, new Set(forbidden)),
            // 九種九牌: null when it cannot be declared, else whether the recommendation throws the hand in.
            kyuushu: canKyuushu(this, h) ? kyuushuAdvice(this, h) : null,
            // The kan the recommendation would declare (null = none).
            recKan: pl.lastDraw === null ? null : decideSelfKan(this, h),
        }
    }

    humanTsumo() {
        const h = this.humanSeat
        this.prompt = null
        this.awaitingDiscard = false
        const pl = this.players[h]
        return this.settleWin(h, null, pl.lastDraw, this.score(h, pl.lastDraw, true))
    }

    humanKyuushu() {
        this.prompt = null
        return this.kyuushu(this.humanSeat)
    }

    kyuushu(p) {
        const pl = this.players[p]
        const kinds = new Set(pl.hand.map(kindOf).filter(k => [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33].includes(k))).size
        return this.abortiveDraw('九種九牌', { player: p, hand: sortTiles(pl.hand), kinds })
    }

    humanKan(option) {
        this.prompt = null
        return this.selfKan(this.humanSeat, option)
    }

    humanDiscard(id, riichi = false) {
        return this.discard(this.humanSeat, { id, riichi })
    }

    // choice: 'ron' | 'skip' | index into prompt.calls
    humanReact(choice) {
        const pr = this.prompt
        const h = this.humanSeat
        this.prompt = null
        if (pr.ron) {
            if (choice === 'ron') return this.settleWin(h, pr.from, pr.id, this.score(h, pr.id, false, { chankan: pr.chankan }))
            if (pr.chankan) {
                this.markPassed(h)
                return this.continueKan(pr.from)
            }
            return this.afterDiscard(pr.from, pr.id, pr.riichi, { type: 'pass', text: null }, true)
        }
        if (choice === 'skip') {
            this.pendingCall = pr.cpuCall
            this.turn = pr.cpuCall ? pr.cpuCall.player : (pr.from + 1) % 4
            if (pr.advice) this.countDecision(h, pr.advice.action === 'skip')
            return { type: 'pass', text: null, callChances: [{ player: h, tile: pr.id, advice: pr.advice, choice: 'skip' }] }
        }
        if (pr.advice) this.countDecision(h, pr.advice.action === pr.calls[choice].type)
        this.pendingCall = { ...pr.calls[choice], player: h, from: pr.from, id: pr.id, advice: pr.advice }
        return this.executeCall()
    }

    // After the human declined 槍槓, the kan goes on.
    continueKan(p) {
        this.revealKanDora()
        this.drawTile(p, true)
        return this.afterDraw(p, { type: 'pass', text: null })
    }

    /* =====================
       和了
    ===================== */
    furiten(q) {
        const pl = this.players[q]
        if (pl.riichiFuriten || pl.tempFuriten) return true
        const waits = waitingKinds(countKinds(pl.hand), pl.melds.length)
        return pl.river.some(r => waits.includes(kindOf(r.id)))
    }

    countDecision(p, agreed) {
        const s = this.stats[p]
        s.decisions = (s.decisions ?? 0) + 1
        if (agreed) s.decisionsAgreed = (s.decisionsAgreed ?? 0) + 1
    }

    markPassed(q) {
        const pl = this.players[q]
        if (pl.riichi) pl.riichiFuriten = true
        else pl.tempFuriten = true
    }

    score(q, winTile, tsumo, { chankan = false } = {}) {
        const pl = this.players[q]
        const concealed = tsumo ? pl.hand.filter(x => x !== winTile) : pl.hand
        return scoreWin({
            concealed, winTile, melds: pl.melds, tsumo,
            roundWind: this.roundWind, seatWind: this.seatWind(q),
            riichi: pl.riichi, doubleRiichi: pl.doubleRiichi, ippatsu: pl.ippatsu,
            last: !this.wall.length && !(tsumo && this.rinshan) && !chankan,
            kan: (tsumo && this.rinshan) || chankan,
            blessing: tsumo && pl.firstGo && !this.anyCall,
            doraKinds: this.doraIndicators.map(id => doraOf(kindOf(id))),
            uraKinds: this.uraIndicators.map(id => doraOf(kindOf(id))),
        })
    }

    // Players after `from` in turn order who can win on the tile; the first CPU wins (頭ハネ),
    // the human is asked. Players who let a winning tile pass become furiten.
    checkRon(from, id, { humanPassed = false, chankan = false, riichi = false, event = null } = {}) {
        const k = kindOf(id)
        for (let i = 1; i < 4; i++) {
            const q = (from + i) % 4
            const pl = this.players[q]
            if (!waitingKinds(countKinds(pl.hand), pl.melds.length).includes(k)) continue
            const result = this.furiten(q) ? null : this.score(q, id, false, { chankan })
            if (result?.hasYaku) {
                if (!this.isHuman(q)) return this.settleWin(q, from, id, result)
                if (!humanPassed) {
                    this.prompt = { kind: 'react', from, id, riichi, ron: true, chankan, calls: [] }
                    return chankan ? { type: 'kan', player: from, text: `${this.nameOf(from)}：加槓（${kindName(k)}）` } : null
                }
            }
            this.markPassed(q)
        }
        return null
    }

    settleWin(winner, loser, tile, result) {
        const deltas = [0, 0, 0, 0]
        const dealerWin = winner === this.dealer
        if (loser === null) {
            for (let q = 0; q < 4; q++) {
                if (q === winner) continue
                const base = dealerWin ? result.payments[0] : (q === this.dealer ? result.payments[0] : result.payments[1])
                const pay = base + 100 * this.honba
                deltas[q] -= pay
                deltas[winner] += pay
            }
        } else {
            const pay = result.payments[0] + 300 * this.honba
            deltas[loser] -= pay
            deltas[winner] += pay
            this.stats[loser].dealIns++
        }
        deltas[winner] += this.kyotaku * 1000
        this.kyotaku = 0
        for (let q = 0; q < 4; q++) this.scores[q] += deltas[q]
        this.stats[winner].wins++
        this.stats[winner].winPoints += result.points

        this.finishRound({
            kind: 'win', winner, loser, tile, result, deltas, renchan: dealerWin,
            hand: [...this.players[winner].hand], melds: this.players[winner].melds,
            ura: this.players[winner].riichi ? this.uraIndicators : [],
        })
        const how = loser === null ? 'ツモ' : `ロン（放銃：${this.nameOf(loser)}）`
        return { type: 'win', player: winner, text: `${this.nameOf(winner)}：${how} ${result.points}点`, result: this.result }
    }

    exhaustiveDraw() {
        const tenpai = this.players.map(pl => waitingKinds(countKinds(pl.hand), pl.melds.length).length > 0)
        const count = tenpai.filter(Boolean).length
        const deltas = [0, 0, 0, 0]
        // 流し満貫: every discard a 么九牌 and none of them called. Paid as a 満貫 tsumo (no 本場,
        // the riichi sticks stay), in place of the ノーテン罰符; the dealer stays when tenpai.
        const nagashi = [0, 1, 2, 3].filter(q => {
            const river = this.players[q].river
            return river.length && river.every(r => !r.called && [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33].includes(kindOf(r.id)))
        })
        if (nagashi.length) {
            for (const q of nagashi) {
                for (let o = 0; o < 4; o++) {
                    if (o === q) continue
                    const pay = q === this.dealer || o === this.dealer ? 4000 : 2000
                    deltas[o] -= pay
                    deltas[q] += pay
                }
            }
        } else if (count > 0 && count < 4) {
            for (let q = 0; q < 4; q++) deltas[q] = tenpai[q] ? 3000 / count : -3000 / (4 - count)
        }
        for (let q = 0; q < 4; q++) this.scores[q] += deltas[q]
        this.finishRound({ kind: 'draw', tenpai, deltas, renchan: tenpai[this.dealer], nagashi })
        const names = list => list.map(q => this.nameOf(q)).join('・')
        const text = nagashi.length
            ? `流局・流し満貫（${names(nagashi)}）`
            : `流局（テンパイ：${names([0, 1, 2, 3].filter(q => tenpai[q])) || 'なし'}）`
        return { type: 'draw', text, result: this.result }
    }

    // detail: for 九種九牌, who threw the hand in and the hand.
    abortiveDraw(reason, detail = null) {
        this.finishRound({ kind: 'abort', reason, deltas: [0, 0, 0, 0], renchan: true, ...(detail ? { abortBy: detail } : {}) })
        const by = detail ? `${this.nameOf(detail.player)}：` : ''
        return { type: 'draw', text: `途中流局（${by}${reason}）`, result: this.result }
    }

    finishRound(result) {
        this.awaitingDiscard = false
        this.prompt = null
        this.result = { ...result, roundName: this.roundName, honba: this.honba }
        this.history.push({ roundName: this.roundName, honba: this.honba, kind: result.kind, winner: result.winner, loser: result.loser, points: result.result?.points ?? 0, deltas: result.deltas })
        this.phase = 'roundEnd'
    }

    /* =====================
       次の局・終局
    ===================== */
    nextRound() {
        const { renchan, kind } = this.result
        const top = this.ranking()[0]
        if (this.scores.some(s => s < 0)) return this.endGame('トビ終了')
        // オーラス: the dealer stops when renchan would keep them in first place.
        if (this.roundIndex === this.lastRound && renchan && kind !== 'abort' && top === this.dealer) {
            return this.endGame(kind === 'win' ? '親のアガリやめ' : '親のテンパイやめ')
        }
        if (renchan || kind !== 'win') this.honba++
        else this.honba = 0
        if (!renchan) this.roundIndex++
        if (this.roundIndex > this.lastRound) return this.endGame(`${this.length === 'tonpu' ? '東' : '南'}4局終了`)
        this.phase = 'roundStart'
        return this.startRound()
    }

    // Seat order breaks ties.
    ranking() {
        return [0, 1, 2, 3].sort((a, b) => this.scores[b] - this.scores[a] || a - b)
    }

    endGame(reason) {
        const order = this.ranking()
        this.scores[order[0]] += this.kyotaku * 1000
        this.kyotaku = 0
        this.over = true
        this.phase = 'over'
        this.finalRanking = this.ranking()
        return { type: 'end', text: `終局（${reason}）`, reason }
    }
}
