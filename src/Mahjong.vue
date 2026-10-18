<script setup>
import { ref, shallowRef, triggerRef, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import MahjongTile from './components/MahjongTile.vue'
import MahjongAnalysis from './components/MahjongAnalysis.vue'
import { MahjongGame, createRng, HUMAN } from './mahjongGame.js'
import { PERSONALITIES, CPU_IDS, LEVELS, LEVEL_IDS, displayName, hintFor, levelOf, aimChoices, callAdvice, tenpaiInfo } from './mahjongAI.js'
import { WIND_NAME, kindOf, kindName, countKinds, KIND_COUNT } from './mahjongTiles.js'
import { waitingKinds } from './mahjongShanten.js'
import { playSound, soundEnabled, setSoundEnabled } from './mahjongSound.js'

const SPEEDS = [
    { id: 'slow', label: 'ゆっくり', ms: 1400 },
    { id: 'normal', label: 'ふつう', ms: 650 },
    { id: 'fast', label: '速い', ms: 150 },
]
const CALL_NAME = { chi: 'チー', pon: 'ポン', minkan: 'カン', ankan: '暗槓', kakan: '加槓' }

/* =====================
   卓の設定
===================== */
// Playing yourself is the main use; watching four CPUs is the other mode.
const mode = ref('play')
// 半荘戦 (東南, 8 hands) or 東風戦 (4 hands); the stats are kept apart for each.
const LENGTHS = { hanchan: '半荘戦', tonpu: '東風戦' }
const gameLength = ref('hanchan')
// The CPUs at the table; empty until the first 新しい対局 is chosen in the dialog,
// afterwards the dialog starts from the same line-up.
const members = ref([])
const seatCount = m => m === 'play' ? 3 : 4
const showHint = ref(true)

const stars = id => LEVELS[levelOf(id)].stars
const starText = id => '★'.repeat(stars(id))

function shuffled(list, rng) {
    const out = [...list]
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
}

// The chosen characters plus random ones for the open places; the seat order is random.
// Each character plays at its own level. Returns { seats, levels } in seat order.
function seatsFor(seed, chosen, count, withHuman) {
    const rng = createRng(seed ^ 0x9e3779b9)
    const pool = shuffled(CPU_IDS.filter(id => !chosen.includes(id)), rng)
    const cpus = chosen.slice(0, count)
    while (cpus.length < count) cpus.push(pool.shift())
    const players = cpus.map(id => ({ id, level: levelOf(id) }))
    if (withHuman) players.push({ id: HUMAN, level: 'advanced' })
    const order = shuffled(players, rng)
    return { seats: order.map(o => o.id), levels: order.map(o => o.level) }
}

/* =====================
   面子選び（ダイアログ）
===================== */
const memberDialog = ref(null)
const manualDialog = ref(null)
const statsDialog = ref(null)
const draftMode = ref('play')
const draftLength = ref('hanchan')
const draft = ref([])
const draftCount = computed(() => seatCount(draftMode.value))

function openMembers() {
    stop()
    draftMode.value = mode.value
    draftLength.value = gameLength.value
    draft.value = [...members.value]
    memberDialog.value?.showModal()
}

watch(draftMode, () => { draft.value = draft.value.slice(0, draftCount.value) })

function toggleDraft(id) {
    if (draft.value.includes(id)) draft.value = draft.value.filter(x => x !== id)
    else if (draft.value.length < draftCount.value) draft.value = [...draft.value, id]
}

const pickRandom = (ids, n) => shuffled(ids, Math.random).slice(0, n)
// Characters that play the same way at a different strength (ハヤテ and ツバメ, …).
const STRONG = CPU_IDS.filter(id => !PERSONALITIES[id].of)
const weakerOf = id => CPU_IDS.find(x => PERSONALITIES[x].of === id)
const PRESETS = [
    { label: 'おまかせ', title: '全員からランダムに選ぶ', pick: n => pickRandom(CPU_IDS, n) },
    { label: '★1・★2', title: '★1と★2から選ぶ', pick: n => pickRandom(CPU_IDS.filter(id => stars(id) <= 2), n) },
    { label: '★4', title: '★4から選ぶ', pick: n => pickRandom(CPU_IDS.filter(id => stars(id) === 4), n) },
    { label: '同じ打ち方の強弱', title: '同じ打ち方で強さの違う2人を2組', pick: n => pickRandom(STRONG, 2).flatMap(id => [id, weakerOf(id)]).slice(0, n) },
    { label: '対極の4人', title: '速攻・大物手・押し・守り', pick: n => ['hayate', 'dai', 'gou', 'mamoru'].slice(0, n) },
]

function startWithDraft() {
    mode.value = draftMode.value
    gameLength.value = draftLength.value
    members.value = [...draft.value]
    memberDialog.value?.close()
    newGame()
}

/* =====================
   対局と牌譜
===================== */
// One "手" on screen = a discard plus the next player's draw, so the player to move always shows 14 tiles.
// Every position is kept in the timeline so the viewer can go back; the game is deterministic,
// so stepping forward again from an earlier position replays the same game.
const game = shallowRef(null)
const timeline = shallowRef([])
const cursor = ref(0)
const log = shallowRef([])
// Every call chance the human decided ({ agreed }), including passes that leave no 牌譜 line.
let callDecisions = []
const playing = ref(false)
const speed = ref('normal')
let timer = null
let logId = 0

function newGame() {
    stop()
    const seed = Math.floor(Math.random() * 2 ** 31)
    const playMode = mode.value === 'play'
    game.value = new MahjongGame({ seed, length: gameLength.value, ...seatsFor(seed, members.value, seatCount(mode.value), playMode) })
    log.value = []
    callDecisions = []
    reviewAll.value = false
    timeline.value = []
    riichiMode.value = false
    detailEntry.value = null
    advanceEngine()
    if (playMode) play()
}

/* =====================
   和了点のカウントアップ
===================== */
const shownPoints = ref(0)
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
watch(() => game.value?.result, r => {
    const target = r?.kind === 'win' ? r.result.points : 0
    if (!target || reduceMotion()) {
        shownPoints.value = target
        return
    }
    const start = performance.now()
    const run = now => {
        const t = Math.min(1, (now - start) / 700)
        shownPoints.value = Math.round(target * (1 - Math.pow(1 - t, 3)) / 100) * 100
        if (t < 1 && game.value?.result === r) requestAnimationFrame(run)
        else shownPoints.value = target
    }
    requestAnimationFrame(run)
})

/* =====================
   演出（宣言の文字・効果音）
===================== */
// Shown only as the game moves on (not when jumping around the 牌譜).
const announcements = ref({})
const centerText = ref(null)
const flash = ref(false)
const soundOn = ref(soundEnabled())
let announceId = 0

function toggleSound() {
    soundOn.value = !soundOn.value
    setSoundEnabled(soundOn.value)
    if (soundOn.value) playSound('call')
}

function announce(seat, text, kind) {
    const id = ++announceId
    announcements.value = { ...announcements.value, [seat]: { text, kind, id } }
    setTimeout(() => {
        if (announcements.value[seat]?.id !== id) return
        const { [seat]: _, ...rest } = announcements.value
        announcements.value = rest
    }, kind === 'win' ? 1600 : 1100)
}

function announceCenter(text) {
    const id = ++announceId
    centerText.value = { text, id }
    setTimeout(() => { if (centerText.value?.id === id) centerText.value = null }, 1500)
}

function effectsFor(event) {
    switch (event.type) {
        case 'discard':
            if (event.riichi) {
                announce(event.player, 'リーチ', 'riichi')
                playSound('riichi')
            } else {
                playSound('discard')
            }
            break
        case 'call':
            announce(event.player, CALL_NAME[event.call.type], 'call')
            playSound(event.call.type === 'minkan' ? 'kan' : 'call')
            break
        case 'kan':
            announce(event.player, 'カン', 'call')
            playSound('kan')
            break
        case 'win':
            announce(event.player, event.result.loser === null ? 'ツモ' : 'ロン', 'win')
            flash.value = false
            requestAnimationFrame(() => { flash.value = true })
            setTimeout(() => { flash.value = false }, 900)
            playSound('win')
            break
        case 'draw':
            announceCenter(event.text.startsWith('途中流局') ? '途中流局' : '流局')
            playSound('draw')
            break
    }
}

function handleEvent(event, pos) {
    effectsFor(event)
    const g = game.value
    // A draw is shown on the table; its log line comes with the discard.
    if (event.text && event.type !== 'drawTile') {
        log.value.push({ ...event, id: ++logId, pos, roundName: g.roundName, honba: g.honba })
    }
    // A call that was recommended but let go gets its own 牌譜 line (a call made shows on the call itself).
    for (const c of event.callChances ?? []) {
        if (c.choice !== 'skip' || c.advice.action === 'skip') continue
        const name = CALL_NAME[c.advice.action]
        log.value.push({
            type: 'callcheck', id: ++logId, pos, player: c.player, roundName: g.roundName, honba: g.honba,
            text: `${playerName(c.player)}：${kindName(kindOf(c.tile))}の${name}を見送り（推奨は${name}）`,
        })
    }
    const h = g.humanSeat
    if (h !== null) {
        const round = roundOf(g)
        if (event.type === 'call' && event.player === h && event.call?.advice) callDecisions.push({ round, agreed: event.call.advice.action === event.call.type })
        for (const c of event.callChances ?? []) if (c.player === h) callDecisions.push({ round, agreed: c.advice.action === 'skip' })
    }
    if (event.type === 'end') addTotals(g)
}

// Runs the engine (after an optional human action) to the next stopping point and records it as a new position.
function advanceEngine(action = null) {
    const g = game.value
    const pos = timeline.value.length
    const types = []
    try {
        do {
            const event = action ? action(g) : g.step()
            action = null
            if (!event) break
            types.push(event.type)
            handleEvent(event, pos)
        } while (!g.over && g.phase === 'play' && !g.awaitingDiscard && !g.pendingCall && !g.prompt)
        timeline.value = [...timeline.value, { snap: structuredClone(g), types }]
        cursor.value = pos
        // A soft sound when it is the human's turn to decide.
        if (g.prompt) playSound('turn')
        return timeline.value[pos]
    } catch (e) {
        // Never leave the screen showing an old position while the game has moved on.
        stop()
        throw e
    } finally {
        triggerRef(log)
        triggerRef(game)
    }
}

function goTo(i) {
    const entry = timeline.value[i]
    game.value = MahjongGame.restore(entry.snap)
    cursor.value = i
    riichiMode.value = false
}

const atLatest = computed(() => cursor.value === timeline.value.length - 1)
const waitingHuman = computed(() => atLatest.value && !!game.value?.prompt)
const canForward = computed(() => !atLatest.value || !(game.value?.over || game.value?.prompt))

function forward() {
    if (!atLatest.value) {
        goTo(cursor.value + 1)
        return timeline.value[cursor.value]
    }
    if (!canForward.value) return null
    return advanceEngine()
}

function back() {
    if (cursor.value > 0) goTo(cursor.value - 1)
}

const startsRound = entry => entry.types.includes('start')

function prevRound() {
    let i = cursor.value - 1
    while (i > 0 && !startsRound(timeline.value[i])) i--
    // From the first position of a round, go to the round before it.
    goTo(Math.max(i, 0))
}

function stepToRoundEnd() {
    do {
        if (!forward()) break
    } while (!game.value.over && game.value.phase === 'play')
}

function delayFor(entry) {
    const ms = SPEEDS.find(s => s.id === speed.value).ms
    if (!entry) return ms
    if (entry.types.includes('win') || entry.types.includes('draw')) return Math.max(ms * 4, 2500)
    if (entry.types.includes('start')) return ms * 1.5
    return ms
}

// A finished hand waits for 「次の局へ」 even during autoplay, so the result can be read.
const endsRound = entry => !!entry && (entry.types.includes('win') || entry.types.includes('draw'))

function schedule(entry) {
    clearTimeout(timer)
    if (!playing.value) return
    // Waiting for the human: the next tick is scheduled after they act.
    if (waitingHuman.value) return
    if (endsRound(entry)) return
    if (!canForward.value) {
        stop()
        return
    }
    timer = setTimeout(tick, delayFor(entry))
}

function tick() {
    schedule(forward())
}

const resultOpen = ref(true)
watch(() => game.value?.result, () => { resultOpen.value = true })

function nextHand() {
    const entry = forward()
    if (playing.value) schedule(entry)
}

function play() {
    if (!canForward.value && !waitingHuman.value) newGame()
    playing.value = true
    clearTimeout(timer)
    timer = setTimeout(tick, 50)
}

function stop() {
    playing.value = false
    clearTimeout(timer)
}

function onKey(e) {
    if (!game.value || playing.value || e.target.closest?.('input, textarea, select, dialog')) return
    if (e.key === 'ArrowRight' && canForward.value) { forward(); e.preventDefault() }
    if (e.key === 'ArrowLeft') { back(); e.preventDefault() }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
    stop()
    window.removeEventListener('keydown', onKey)
})

/* =====================
   人の操作
===================== */
const riichiMode = ref(false)

function humanAct(action) {
    if (!waitingHuman.value) return
    riichiMode.value = false
    schedule(advanceEngine(action))
}

const humanSeat = computed(() => game.value?.humanSeat ?? null)
const turnOptions = computed(() => waitingHuman.value && game.value.prompt.kind === 'turn' ? game.value.humanTurnOptions() : null)
const reactPrompt = computed(() => waitingHuman.value && game.value.prompt.kind === 'react' ? game.value.prompt : null)

function canDiscard(id) {
    const o = turnOptions.value
    if (!o) return false
    const pl = game.value.players[humanSeat.value]
    if (o.riichiLocked) return id === pl.lastDraw
    if (o.forbidden.includes(kindOf(id))) return false
    if (riichiMode.value) return o.hint.tenpaiKinds.includes(kindOf(id))
    return true
}

// With a finger the first tap only picks a tile (it rises) and a second tap on it discards, as in
// most mahjong apps on phones and tablets; a mouse click discards at once (hovering shows the tile).
const picked = ref(null)
const hovered = ref(null)
let lastPointer = 'mouse'
const notePointer = e => { lastPointer = e.pointerType || 'mouse' }
onMounted(() => window.addEventListener('pointerdown', notePointer, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', notePointer, true))

function clickTile(pl, id) {
    if (pl.seat !== humanSeat.value || !canDiscard(id)) return
    if (lastPointer !== 'mouse' && picked.value !== id) {
        picked.value = id
        return
    }
    discardTile(id)
}

function discardTile(id) {
    picked.value = null
    hovered.value = null
    const riichi = riichiMode.value
    humanAct(g => g.humanDiscard(id, riichi))
}

function hoverTile(pl, id, e) {
    if (e.pointerType === 'mouse' && pl.seat === humanSeat.value) hovered.value = id
}
// A new decision (or going back in the record) starts without a picked tile.
watch(() => game.value?.prompt, () => { picked.value = null; hovered.value = null })
watch(riichiMode, () => { if (picked.value !== null && !canDiscard(picked.value)) picked.value = null })
// The tile shown in the candidates: the picked one, else the one under the mouse.
const focusKind = computed(() => {
    const id = picked.value ?? hovered.value
    return id !== null && turnOptions.value && canDiscard(id) ? kindOf(id) : null
})

const canDeclareRiichi = computed(() => {
    const o = turnOptions.value
    return !!o && !o.riichiLocked && o.hint?.canRiichi && o.hint.tenpaiKinds.length > 0
})

// The recommended tile in the hand of the player to move (the first copy of that kind).
const hintTile = computed(() => {
    const hint = live.value?.hint
    if (!hint) return null
    const pl = game.value.players[live.value.player]
    return pl.hand.find(id => kindOf(id) === hint.recommendation.kind) ?? null
})

/* =====================
   表示用
===================== */
const roundLabel = computed(() => {
    const g = game.value
    if (!g || !g.players.length) return ''
    return `${g.roundName} ${g.honba}本場`
})

// With a human at the table, they sit at the bottom and the others follow in turn order above.
const seatOrder = computed(() => {
    const h = humanSeat.value
    return h === null ? [0, 1, 2, 3] : [1, 2, 3, 0].map(i => (h + i) % 4)
})

// 4方向の卓 when playing on a wide screen (the CPUs' hands are face down anyway). Watching, where
// every hand is open and read, and phones keep the list of four panels.
const WIDE = '(min-width: 1100px)'
const wide = ref(window.matchMedia?.(WIDE).matches ?? true)
const onWide = e => { wide.value = e.matches }
onMounted(() => window.matchMedia?.(WIDE).addEventListener('change', onWide))
onBeforeUnmount(() => window.matchMedia?.(WIDE).removeEventListener('change', onWide))
const square = computed(() => humanSeat.value !== null && wide.value)
// Seats around the square table, as seen from the human: 下家 right, 対面 top, 上家 left.
const around = computed(() => {
    const h = humanSeat.value
    return { right: (h + 1) % 4, top: (h + 2) % 4, left: (h + 3) % 4, bottom: h }
})
const OPPONENTS = ['top', 'left', 'right']

// How a CPU's call tile is turned on screen so it faces the centre; lying = the called tile,
// which lies sideways from that player's point of view.
function oppTileTurn(pos, lying) {
    if (pos === 'top') return { sideways: lying, flip: true }
    if (pos === 'left') return lying ? { sideways: false, flip: true } : { sideways: true, flip: false }
    return lying ? { sideways: false, flip: false } : { sideways: true, flip: true }
}
const RIVERS = ['top', 'left', 'right', 'bottom']
const panelPlayers = computed(() => square.value
    ? [game.value.players[humanSeat.value]]
    : seatOrder.value.map(p => game.value.players[p]))

const gameFinished = computed(() => !!timeline.value[timeline.value.length - 1]?.snap.over)
// Other hands and CPU analyses stay hidden while the human plays, except at a round's result.
const hidden = computed(() => humanSeat.value !== null && !gameFinished.value)
function showHand(pl) {
    return !hidden.value || pl.seat === humanSeat.value || game.value.phase !== 'play'
}
const showsAnalysis = e => !!e.analysis && (!hidden.value || e.player === humanSeat.value)

// While the human plays, the other players' draws stay secret in the 牌譜 too.
function kifuText(e) {
    if (e.type === 'start') return `― ${e.text} ―`
    if (hidden.value && e.player !== humanSeat.value) return e.text.replace(/ツモ[^ ]+ → /, '')
    if (callDiffers(e)) return `${e.text}（推奨は${adviceName(e.call.advice)}）`
    return e.text
}

const adviceName = advice => advice.action === 'skip' ? 'スルー' : CALL_NAME[advice.action]
// The call advice of an entry may be shown (CPU calls stay private while the human plays).
const showsCall = e => !!e.call?.advice && (!hidden.value || e.player === humanSeat.value)
const callDiffers = e => e.type === 'call' && showsCall(e) && e.call.advice.action !== e.call.type
// Call chances around a discard that may be shown.
const visibleChances = e => (e.callChances ?? []).filter(c => !hidden.value || c.player === humanSeat.value)
// 牌譜 lines: a let-go call of a CPU stays private while the human plays.
const kifuLines = computed(() => {
    void log.value.length
    return log.value.filter(e => e.type !== 'callcheck' || !hidden.value || e.player === humanSeat.value)
})

function playerName(p) {
    return displayName(game.value.seats[p], game.value.levels[p])
}

function personOf(p) {
    return PERSONALITIES[game.value.seats[p]]
}

const lastDiscardId = computed(() => game.value?.lastDiscard?.id ?? null)

function handTiles(pl) {
    const draw = game.value.turn === pl.seat && pl.hand.length % 3 === 2 ? pl.lastDraw : null
    const rest = pl.hand.filter(id => id !== draw)
    return { rest, draw: pl.hand.includes(draw) ? draw : null }
}

// Tiles of a meld laid out as on a real table: the called tile lies sideways on the side of the
// player it came from (上家 left, 対面 second, 下家 right); a 加槓 tile sits on top of it;
// a concealed kan shows its two ends face down.
function meldTiles(meld, owner) {
    if (meld.type === 'ankan') {
        return meld.tiles.map((id, i) => ({ id, back: i === 0 || i === 3 }))
    }
    const others = meld.tiles.filter(id => id !== meld.calledTile && id !== meld.addedTile)
    const called = { id: meld.calledTile, sideways: true, added: meld.addedTile ?? null }
    const from = (meld.from - owner + 4) % 4
    const at = from === 3 ? 0 : from === 2 ? 1 : others.length
    const items = others.map(id => ({ id }))
    items.splice(at, 0, called)
    return items
}

function meldLabel(meld) {
    return { chi: 'チー', pon: 'ポン', minkan: '明槓', kakan: '加槓', ankan: '暗槓' }[meld.type]
}

function scoreDelta(d) {
    if (!d) return '±0'
    return (d > 0 ? '+' : '') + d
}

/* =====================
   狙い役
===================== */
// The plans the human can aim for, shown all through a hand so the place does not jump around.
// Picking one makes the discard, call and riichi recommendations follow it.
const AIM_ROWS = 6
const showAllAims = ref(false)
const aim = computed(() => {
    const g = game.value
    const h = humanSeat.value
    if (h === null || !showHint.value || g?.phase !== 'play' || !g.players.length) return null
    const pl = g.players[h]
    if (pl.riichi) return { riichi: true }
    const c = aimChoices(g, h)
    let rows = showAllAims.value ? c.rows : c.rows.slice(0, AIM_ROWS)
    const picked = c.rows.find(r => r.id === c.aim)
    if (picked && !rows.includes(picked)) rows = [...rows, picked]
    return { ...c, rows, more: c.rows.length > AIM_ROWS, aimName: picked?.name ?? null }
})

const lostAimName = computed(() => {
    const a = aim.value
    if (!a?.lost) return null
    return planNames[a.aim] ?? '選んだ役'
})
// Names of plans seen this hand, so a plan that is no longer possible can still be named.
const planNames = {}
watch(aim, a => { for (const r of a?.rows ?? []) planNames[r.id] = r.name })

function setAim(id) {
    const g = game.value
    const h = humanSeat.value
    if (h === null || !atLatest.value) return
    g.players[h].aim = id
    // A call chance waiting for the human is judged again for the new plan.
    if (g.prompt?.kind === 'react' && g.prompt.advice) g.prompt.advice = callAdvice(g, h, g.prompt.id, g.prompt.from)
    const entry = timeline.value[cursor.value]
    if (entry) entry.snap = structuredClone(g)
    triggerRef(game)
}

/* =====================
   手番の推奨・直前の打牌・打牌の解説
===================== */
// The player to move and the standard recommendation for them, shown before they discard
// (as a 将棋中継 shows the best move). Computed on a copy so the live game is left untouched.
const live = computed(() => {
    const g = game.value
    if (!g?.players.length || g.phase !== 'play') return null
    // Paused on a discard someone is about to call: say so; the call is shown on the next step.
    if (g.pendingCall) {
        const c = g.pendingCall
        const advice = hidden.value && c.player !== humanSeat.value ? null : c.advice
        return { player: c.player, name: playerName(c.player), color: personOf(c.player).color, drawn: null, hint: null,
            calling: `${playerName(c.from)}の${kindName(kindOf(c.id))}を${CALL_NAME[c.type]}します`,
            advice, agrees: advice?.action === c.type }
    }
    if (!g.awaitingDiscard) return null
    const p = g.turn
    const pl = g.players[p]
    const base = { player: p, name: playerName(p), color: personOf(p).color, drawn: pl.lastDraw, riichi: pl.riichi }
    if (hidden.value && p !== humanSeat.value) return { ...base, hint: null, secret: true }
    if (pl.riichi || (p === humanSeat.value && !showHint.value)) return { ...base, hint: null }
    return { ...base, hint: hintFor(MahjongGame.restore(g), p, new Set(g.kuikae ?? [])) }
})

// The latest discard up to the shown position.
const lastEntry = computed(() => {
    void log.value.length
    for (let i = log.value.length - 1; i >= 0; i--) {
        const e = log.value[i]
        if (e.pos <= cursor.value && e.type === 'discard') return e
        if (e.pos <= cursor.value && e.type === 'start') return null
    }
    return null
})

function lastSummary(e) {
    const tile = `${kindName(kindOf(e.tile))}切り${e.riichi ? '（リーチ）' : ''}`
    if (!showsAnalysis(e)) return tile
    const c = e.analysis.choice
    if (c.same) return `${tile}：推奨どおり`
    return `${tile}：推奨は${kindName(e.analysis.recommendation.kind)}`
}

// A discard opened from the 牌譜 (or the line above it); shown while its position is on screen.
const detailEntry = ref(null)
const detail = computed(() => {
    const e = detailEntry.value
    return e && e.pos === cursor.value && showsAnalysis(e) ? e : null
})

function openEntry(e) {
    stop()
    goTo(e.pos)
    detailEntry.value = e.analysis ? e : null
}

/* =====================
   振り返り（自分が打った半荘）
===================== */
const reviewDialog = ref(null)
const REVIEW_ROWS = 15
const reviewAll = ref(false)
const roundOf = e => `${e.roundName}${e.honba ? ` ${e.honba}本場` : ''}`
const lossSize = loss => loss >= 20 ? '大' : loss >= 5 ? '中' : '小'

// 放銃 judged from what could be seen at the time and, afterwards, the winner's waits:
// 事故 (no one to be wary of), 押し判断どおり (the recommendation would have pushed as well, or its tile
// dealt in too), 避けられた (the recommendation was a safer tile that was not a winning tile).
function judgeDealIn(discard, win) {
    const r = win.result
    const waits = waitingKinds(countKinds(r.hand), r.melds.length)
    const a = discard?.analysis
    if (!discard || discard.type !== 'discard') return { verdict: '事故', note: '槍槓（加槓した牌でのロン）' }
    if (!a) return { verdict: '押し判断どおり', note: 'リーチ後の放銃（リーチした時点で押すと決めている）' }
    const rec = a.recommendation.kind
    if (!a.threats.length) return { verdict: '事故', note: '警戒すべき相手がいなかった（ダマや気配のない手）' }
    if (a.choice.same) return { verdict: '押し判断どおり', note: `推奨も同じ牌で押していた（警戒：${a.threats.map(t => t.text).join('、')}）` }
    if (waits.includes(rec)) return { verdict: '押し判断どおり', note: `推奨の${kindName(rec)}でも当たっていた` }
    return { verdict: '避けられた', note: `推奨は${kindName(rec)}（${a.recommendation.text}）` }
}

// Everything the review needs, each item tagged with its hand (局).
const reviewData = computed(() => {
    void log.value.length
    const h = humanSeat.value
    if (h === null) return null
    const rounds = []
    const discards = []
    const issues = []
    const dealIns = []
    let lastDiscard = null
    for (const e of log.value) {
        const round = roundOf(e)
        if (e.player === h && e.type === 'discard') lastDiscard = e
        if (e.type === 'win' && e.result?.loser === h) {
            const j = judgeDealIn(lastDiscard, e)
            dealIns.push({ ...j, round, entry: lastDiscard ?? e, tile: lastDiscard?.tile ?? null, points: e.result.result.points, winner: playerName(e.player) })
        }
        if (e.player !== h) continue
        if (e.type === 'discard' && e.analysis) {
            if (!rounds.includes(round)) rounds.push(round)
            const c = e.analysis.choice
            discards.push({ round, same: c.same, riichi: !!c.riichiText, riichiAgreed: !!c.riichiText && !c.riichiDiffers })
            if (!c.same) issues.push({ entry: e, round, kind: 'discard', tile: e.tile, loss: c.loss, text: c.reason, rec: e.analysis.recommendation.kind })
            else if (c.riichiDiffers) issues.push({ entry: e, round, kind: 'riichi', tile: e.tile, loss: 5, text: c.reason, rec: null })
        }
        // Call chances that went against the advice: a call made, or a recommended call let go.
        if (e.type === 'call' && e.call?.advice && e.call.advice.action !== e.call.type) {
            issues.push({ entry: e, round, kind: 'call', tile: null, loss: 5, text: `${e.text}（推奨は${adviceName(e.call.advice)}：${e.call.advice.text}）`, rec: null })
        }
        if (e.type === 'callcheck') {
            issues.push({ entry: e, round, kind: 'call', tile: null, loss: 5, text: e.text, rec: null })
        }
    }
    issues.sort((a, b) => b.loss - a.loss)
    return { rounds, discards, issues, dealIns, calls: [...callDecisions] }
})

// The hand shown in the review (null = the whole game so far).
const reviewRound = ref(null)

function summarize(d, round) {
    const pick = list => round ? list.filter(x => x.round === round) : list
    const discards = pick(d.discards)
    const calls = pick(d.calls)
    return {
        discards: discards.length,
        agreed: discards.filter(x => x.same).length,
        riichiTotal: discards.filter(x => x.riichi).length,
        riichiAgreed: discards.filter(x => x.riichiAgreed).length,
        calls: calls.length,
        callsAgreed: calls.filter(x => x.agreed).length,
        issues: pick(d.issues),
        dealIns: pick(d.dealIns),
    }
}

const review = computed(() => {
    const d = reviewData.value
    if (!d) return null
    const round = d.rounds.includes(reviewRound.value) ? reviewRound.value : null
    return {
        ...summarize(d, round),
        round,
        // Every hand with its agreement, for the hand buttons.
        rounds: d.rounds.map(name => {
            const r = summarize(d, name)
            return { name, discards: r.discards, agreed: r.agreed, dealIn: r.dealIns.length > 0 }
        }),
    }
})

function openReview(round = null) {
    stop()
    reviewRound.value = round
    reviewAll.value = false
    reviewDialog.value.showModal()
}

function pickReviewRound(round) {
    reviewRound.value = round
    reviewAll.value = false
}

function reviewGo(e) {
    reviewDialog.value.close()
    openEntry(e)
}

// Waits of everyone in tenpai (not the player to move), with the tiles still unseen by anyone.
const waitsBySeat = computed(() => {
    const g = game.value
    if (!g?.players.length || g.phase !== 'play') return {}
    // Playing, the human's own count uses only what the human can see (as on a real table).
    const viewer = hidden.value ? humanSeat.value : null
    const out = {}
    g.players.forEach((pl, p) => {
        if (hidden.value && p !== humanSeat.value) return
        const info = tenpaiInfo(g, p, viewer)
        if (info) out[p] = info
    })
    return out
})

const currentEntryId = computed(() => {
    let id = null
    for (const e of log.value) if (e.pos <= cursor.value) id = e.id
    return id
})

const kifuList = ref(null)
watch(currentEntryId, async () => {
    await nextTick()
    const box = kifuList.value
    const el = box?.querySelector('.current')
    if (!el) return
    if (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTop = el.offsetTop - box.clientHeight / 2
    }
})

const detailOwner = computed(() => {
    if (!detail.value) return null
    const p = detail.value.player
    return { ...PERSONALITIES[game.value.seats[p]], name: playerName(p) }
})

/* =====================
   成績（性格ごとの通算）
===================== */
// Keyed by personality and level, e.g. 'kei:beginner'. Kept in this browser only.
// { hanchan: { 'kei:advanced': {...} }, tonpu: {...} }
const STATS_KEY = 'mahjong-stats'
const allTotals = reactive(loadTotals())
// The length shown in the stats dialog.
const statsLength = ref('hanchan')
const totals = computed(() => allTotals[statsLength.value])
const statKey = (id, level) => `${id}:${level}`

function loadTotals() {
    const empty = { hanchan: {}, tonpu: {} }
    try {
        let saved = JSON.parse(localStorage.getItem(STATS_KEY) ?? '{}')
        // Records kept before 東風戦 existed are 半荘戦 ones.
        if (!saved.hanchan && !saved.tonpu) saved = { hanchan: saved }
        // Drop players who are no longer in the roster.
        const keep = rows => Object.fromEntries(Object.entries(rows ?? {}).filter(([, t]) => PERSONALITIES[t?.id]))
        return { hanchan: keep(saved.hanchan), tonpu: keep(saved.tonpu) }
    } catch {
        return empty
    }
}
watch(allTotals, () => {
    try {
        localStorage.setItem(STATS_KEY, JSON.stringify(allTotals))
    } catch {
        // Private windows may refuse storage; the record then lasts for this visit only.
    }
}, { deep: true })

function resetTotals() {
    if (!confirm(`${LENGTHS[statsLength.value]}の戦績をすべて消します。よろしいですか？`)) return
    allTotals[statsLength.value] = {}
}

function openStats() {
    statsLength.value = game.value?.length ?? gameLength.value
    statsDialog.value.showModal()
}
// CPU-only batches are a development tool, not shown on the public site.
const devTools = ['localhost', '127.0.0.1'].includes(location.hostname)

function addTotals(g) {
    const totals = allTotals[g.length ?? 'hanchan']
    g.seats.forEach((id, p) => {
        const key = statKey(id, g.levels[p])
        totals[key] ??= {
            id, level: g.levels[p], games: 0, rankSum: 0, top: 0, last: 0, scoreSum: 0,
            hands: 0, wins: 0, winPoints: 0, dealIns: 0, riichi: 0, calledHands: 0, discards: 0, agreed: 0,
        }
        const t = totals[key]
        const s = g.stats[p]
        const rank = g.finalRanking.indexOf(p) + 1
        t.games++
        t.rankSum += rank
        if (rank === 1) t.top++
        if (rank === 4) t.last++
        t.scoreSum += g.scores[p]
        for (const k of ['hands', 'wins', 'winPoints', 'dealIns', 'riichi', 'calledHands', 'discards', 'agreed']) t[k] += s[k]
    })
}

const ORDER = [...CPU_IDS, HUMAN]
const ratio = (a, b) => b ? a / b : null
// Columns that can be sorted. low: smaller is better, so the first press puts the smallest on top.
const STAT_COLUMNS = [
    { key: 'games', label: '対局数', value: t => t.games },
    { key: 'rank', label: '平均順位', low: true, value: t => ratio(t.rankSum, t.games) },
    { key: 'top', label: 'トップ率', value: t => ratio(t.top, t.games) },
    { key: 'last', label: 'ラス率', low: true, value: t => ratio(t.last, t.games) },
    { key: 'win', label: '和了率', value: t => ratio(t.wins, t.hands) },
    { key: 'dealIn', label: '放銃率', low: true, value: t => ratio(t.dealIns, t.hands) },
    { key: 'riichi', label: 'リーチ率', value: t => ratio(t.riichi, t.hands) },
    { key: 'call', label: '副露率', value: t => ratio(t.calledHands, t.hands) },
    { key: 'points', label: '平均打点', value: t => ratio(t.winPoints, t.wins) },
    { key: 'agree', label: '推奨一致率', value: t => ratio(t.agreed, t.discards) },
]
// null = the roster order; desc: largest first.
const statSort = ref({ key: null, desc: true })

function sortBy(key) {
    if (key === null) {
        statSort.value = { key: null, desc: true }
        return
    }
    const col = STAT_COLUMNS.find(c => c.key === key)
    statSort.value = statSort.value.key === key
        ? { key, desc: !statSort.value.desc }
        : { key, desc: !col.low }
}

function sortMark(key) {
    if (statSort.value.key !== key) return ''
    return statSort.value.desc ? '▼' : '▲'
}

const rosterOrder = (a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id) || LEVEL_IDS.indexOf(a.level) - LEVEL_IDS.indexOf(b.level)
const statRows = computed(() => {
    const rows = Object.values(totals.value).sort(rosterOrder)
    const { key, desc } = statSort.value
    if (!key) return rows
    const value = STAT_COLUMNS.find(c => c.key === key).value
    // Rows without a value (—) stay at the bottom either way.
    return rows.sort((a, b) => {
        const va = value(a)
        const vb = value(b)
        if (va === null || vb === null) return (va === null) - (vb === null)
        return (desc ? vb - va : va - vb) || rosterOrder(a, b)
    })
})
const totalGames = computed(() => Object.values(totals.value).reduce((n, t) => n + t.games, 0) / 4)
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—'

const batchLeft = ref(0)
const batchDone = ref(0)
// Batch games use the current members; open places (none chosen yet, or the human's seat) are drawn anew each game.
function runBatch(n) {
    stop()
    batchLeft.value = n
    batchDone.value = 0
    const chunk = () => {
        if (!batchLeft.value) return
        const seed = Math.floor(Math.random() * 2 ** 31)
        const g = new MahjongGame({ seed, length: statsLength.value, ...seatsFor(seed, members.value, 4, false) })
        while (!g.over) g.step()
        addTotals(g)
        batchLeft.value--
        batchDone.value++
        setTimeout(chunk, 0)
    }
    chunk()
}

</script>

<template>
    <div class="mahjong-app">
        <header class="hero">
            <p class="eyebrow">MAHJONG WATCH TABLE</p>
            <div class="title-row">
                <h1>麻雀観戦卓<span class="beta" title="開発中">β</span></h1>
                <button type="button" class="manual-button" @click="manualDialog.showModal()">説明書</button>
                <button type="button" class="manual-button" @click="openStats">戦績</button>
                <button v-if="review?.discards" type="button" class="manual-button" @click="openReview()">振り返り</button>
                <button type="button" class="manual-button sound-button" :class="{ off: !soundOn }" :aria-pressed="soundOn"
                    :title="soundOn ? '効果音を消す' : '効果音を出す'" @click="toggleSound">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                        <template v-if="soundOn">
                            <path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                            <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                        </template>
                        <path v-else d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                    {{ soundOn ? '音あり' : '音なし' }}
                </button>
            </div>
        </header>

        <dialog ref="reviewDialog" class="stats-dialog review-dialog" aria-labelledby="review-title">
            <template v-if="review">
                <h2 id="review-title">振り返り <span class="muted">（{{ review.round ?? (game?.over ? 'この対局' : 'ここまで') }}）</span></h2>
                <div class="review-rounds" role="radiogroup" aria-label="振り返る局">
                    <button type="button" role="radio" :aria-checked="review.round === null" :class="{ active: review.round === null }" @click="pickReviewRound(null)">
                        全体 <strong>{{ reviewData.discards.filter(x => x.same).length }}/{{ reviewData.discards.length }}</strong>
                    </button>
                    <button v-for="r in review.rounds" :key="r.name" type="button" role="radio" :aria-checked="review.round === r.name"
                        :class="{ active: review.round === r.name, 'deal-in': r.dealIn }" @click="pickReviewRound(r.name)">
                        {{ r.name }} <strong>{{ r.agreed }}/{{ r.discards }}</strong>
                    </button>
                </div>
                <div class="review-summary">
                    <div><span class="muted">打牌の推奨一致</span><strong>{{ pct(review.agreed, review.discards) }}</strong><small>{{ review.agreed }} / {{ review.discards }}打</small></div>
                    <div><span class="muted">鳴きの判断</span><strong>{{ review.calls ? `${review.callsAgreed} / ${review.calls}` : '—' }}</strong><small>推奨と一致 / 判断した数</small></div>
                    <div><span class="muted">リーチの判断</span><strong>{{ review.riichiTotal ? `${review.riichiAgreed} / ${review.riichiTotal}` : '—' }}</strong><small>推奨と一致 / テンパイ</small></div>
                    <div><span class="muted">放銃</span><strong>{{ review.dealIns.length }}回</strong>
                        <small>{{ ['避けられた', '押し判断どおり', '事故'].map(v => `${v}${review.dealIns.filter(d => d.verdict === v).length}`).join('・') }}</small></div>
                </div>

                <h3>放銃</h3>
                <p v-if="!review.dealIns.length" class="muted">放銃はありません。</p>
                <ul class="review-list">
                    <li v-for="(d, i) in review.dealIns" :key="'d' + i">
                        <button type="button" @click="reviewGo(d.entry)">
                            <span class="verdict" :class="d.verdict">{{ d.verdict }}</span>
                            <span class="muted">{{ d.round }}</span>
                            <MahjongTile v-if="d.tile !== null" :id="d.tile" size="xs" />
                            <span>{{ d.winner }}に{{ d.points.toLocaleString() }}点</span>
                            <small>{{ d.note }}</small>
                        </button>
                    </li>
                </ul>

                <h3>推奨と違った判断 <span class="muted">（ずれの大きい順）</span></h3>
                <p v-if="!review.issues.length" class="muted">すべて推奨どおりです。</p>
                <ul class="review-list">
                    <li v-for="(it, i) in (reviewAll ? review.issues : review.issues.slice(0, REVIEW_ROWS))" :key="'i' + i">
                        <button type="button" @click="reviewGo(it.entry)">
                            <span class="size" :class="lossSize(it.loss)">{{ it.kind === 'discard' ? `ずれ${lossSize(it.loss)}` : it.kind === 'call' ? '鳴き' : 'リーチ' }}</span>
                            <span class="muted">{{ it.round }}</span>
                            <template v-if="it.tile !== null"><MahjongTile :id="it.tile" size="xs" />切り</template>
                            <template v-if="it.rec !== null"><span class="muted">推奨</span><MahjongTile :kind="it.rec" size="xs" /></template>
                            <small>{{ it.text }}</small>
                        </button>
                    </li>
                </ul>
                <button v-if="review.issues.length > REVIEW_ROWS" type="button" class="review-more" @click="reviewAll = !reviewAll">
                    {{ reviewAll ? '上位だけ表示' : `残り${review.issues.length - REVIEW_ROWS}件も表示` }}
                </button>
                <p class="muted review-note">行を押すとその局面に移り、右側に解説が出ます。</p>
            </template>
            <div class="dialog-actions">
                <button type="button" @click="reviewDialog.close()">閉じる</button>
            </div>
        </dialog>

        <dialog ref="statsDialog" class="stats-dialog" aria-labelledby="stats-title">
          <section class="stats">
            <div class="stats-head">
                <h2 id="stats-title">戦績 <span class="muted">（{{ totalGames }}戦）</span></h2>
                <div class="mode stats-length" role="radiogroup" aria-label="対局の長さ">
                    <button v-for="(label, key) in LENGTHS" :key="key" type="button" role="radio" :aria-checked="statsLength === key"
                        :class="{ active: statsLength === key }" :disabled="batchLeft > 0" @click="statsLength = key">{{ label }}</button>
                </div>
                <div v-if="devTools" class="batch">
                    <button type="button" :disabled="batchLeft > 0" @click="runBatch(10)">CPUだけで10戦</button>
                    <button type="button" :disabled="batchLeft > 0" @click="runBatch(50)">50戦</button>
                    <span v-if="batchLeft > 0" class="muted">対局中… {{ batchDone }} / {{ batchDone + batchLeft }}</span>
                </div>
            </div>
            <p v-if="!statRows.length" class="muted">まだ記録がありません。</p>
            <div class="table-scroll">
                <table>
                    <thead>
                        <tr>
                            <th :aria-sort="statSort.key === null ? 'other' : 'none'">
                                <button type="button" class="sort" @click="sortBy(null)">打ち手</button>
                            </th>
                            <th v-for="col in STAT_COLUMNS" :key="col.key"
                                :aria-sort="statSort.key === col.key ? (statSort.desc ? 'descending' : 'ascending') : 'none'">
                                <button type="button" class="sort" :class="{ active: statSort.key === col.key }" @click="sortBy(col.key)">
                                    {{ col.label }}<span class="sort-mark">{{ sortMark(col.key) }}</span>
                                </button>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="t in statRows" :key="statKey(t.id, t.level)">
                            <th>
                                <span class="dot" :style="{ background: PERSONALITIES[t.id].color }" />
                                {{ displayName(t.id, t.level) }}<small v-if="t.id !== HUMAN">{{ starText(t.id) }}</small>
                            </th>
                            <td>{{ t.games }}</td>
                            <td>{{ t.games ? (t.rankSum / t.games).toFixed(2) : '—' }}</td>
                            <td>{{ pct(t.top, t.games) }}</td>
                            <td>{{ pct(t.last, t.games) }}</td>
                            <td>{{ pct(t.wins, t.hands) }}</td>
                            <td>{{ pct(t.dealIns, t.hands) }}</td>
                            <td>{{ pct(t.riichi, t.hands) }}</td>
                            <td>{{ pct(t.calledHands, t.hands) }}</td>
                            <td>{{ t.wins ? Math.round(t.winPoints / t.wins).toLocaleString() : '—' }}</td>
                            <td>{{ pct(t.agreed, t.discards) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="dialog-actions">
                <button type="button" class="reset" :disabled="!statRows.length || batchLeft > 0" @click="resetTotals">リセット</button>
                <button type="button" @click="statsDialog.close()">閉じる</button>
            </div>
          </section>
        </dialog>

        <dialog ref="manualDialog" class="manual-dialog" aria-labelledby="manual-title">
            <div class="manual-head">
                <h2 id="manual-title">説明書</h2>
                <button type="button" class="close" aria-label="閉じる" @click="manualDialog.close()">×</button>
            </div>
            <section>
                <h3>このアプリについて</h3>
                <p>打ち筋の違うCPUが打つ対局を眺めたり、自分も卓に入って打ったりできます。打つ前の推奨と実際の打牌を並べて、判断が分かれた理由を見られます。</p>
                <p>開発中のβ版です。CPUの打ち方や画面は予告なく変わることがあります。</p>
            </section>
            <section>
                <h3>始め方</h3>
                <ul>
                    <li>「新しい対局」を押して面子を選びます。「自分も打つ」なら3人、観戦なら4人です。選んだ人の打ち筋が下に出ます。半荘戦（東南の8局）か東風戦（東の4局）も選べます。</li>
                    <li>2回目からは、前回の面子が選ばれた状態で開きます。</li>
                    <li>席順はランダムです。「自分も打つ」ではあなたが一番下の席になり、他の人の手牌・待ち・推奨は局が終わるまで見えません。</li>
                </ul>
            </section>
            <section>
                <h3>操作</h3>
                <ul>
                    <li>「1手進む」で、打牌と次の人のツモまで進みます。←→キーでも1手ずつ動けます。</li>
                    <li>「局の最初へ」は局の途中なら局の頭へ、局の頭なら前の局へ戻ります。戻ってから進めても同じ展開になります。</li>
                    <li>牌譜の行を押すと、その局面に移ってその打牌の解説が開きます。</li>
                    <li>自分が打つときは、マウスなら牌をクリックして切ります。指で操作するときは、1回タップすると牌が浮き、同じ牌をもう一度タップすると切ります。ツモ・リーチ・カン・ロン・ポン・チーはボタンで選びます。</li>
                    <li>効果音はタイトル横のスピーカーのボタン（音あり／音なし）で切り替えられます。設定はこのブラウザに保存されます。</li>
                </ul>
            </section>
            <section>
                <h3>画面の見方</h3>
                <ul>
                    <li>右上は今の手番の人への推奨です。手牌の緑の枠が推奨の牌、オレンジの枠がツモった牌です。</li>
                    <li>河の暗い牌はツモ切り、薄い牌は鳴かれた牌です。</li>
                    <li>テンパイしている人の欄には待ちと残り枚数が出ます。黄色の印はフリテンと、鳴いて役がない状態です。</li>
                </ul>
            </section>
            <section>
                <h3>推奨について</h3>
                <ul>
                    <li>推奨は、役の方針・牌効率・テンパイ時の打点・リーチや鳴いた相手への安全度から判断した一つの意見です。正解ではなく、比べるための物差しです。</li>
                    <li>自分も打つときは右の「狙い役」で役を選ぶと、打牌・リーチ・鳴きの推奨がその役に向けたものに変わります。局が変わるとおまかせに戻ります。</li>
                    <li>テンパイ時の打点は、ロン（フリテンのときはツモ）・裏ドラなしで計算し、面前の手はリーチをかけたものとしています。</li>
                    <li>危険度の数字は、よく言われる目安の放銃率です。</li>
                </ul>
            </section>
            <section>
                <h3>強さ（★）の違い</h3>
                <ul>
                    <li>どの強さでも、評価がまったく同じ候補はランダムに選びます。強いほど癖は控えめに、弱いほど強く出ます。鳴きは得になるときにします（リン・ハジメは鳴きません）。</li>
                    <li><strong>★4</strong>：迷わない。見えている牌まで数えた牌効率、スジ・壁（ノーチャンス）・字牌の危険度、鳴きやツモ切りの読み、三色・一通・チャンタ・三元まで考えた役の方針、フリテンの回避。</li>
                    <li><strong>★3</strong>：受け入れが7枚差くらいまでの候補でときどき迷う。残り枚数は自分の手牌からしか数えない。スジと字牌の見え枚数で危険度を考えるが、壁は使わない。鳴きは3副露など危ないときだけ警戒する。</li>
                    <li><strong>★2</strong>：受け入れが20枚差くらいまでの候補でよく迷う。有効牌の種類だけ数える。現物以外はどれも同じくらい危ないと思っている。降りが甘く、鳴きを警戒しない。三色・一通・チャンタに気づかず、待ちの広さだけでテンパイを選ぶ。フリテンは自分の捨て牌のものだけ避ける。ダマで満貫あるとき以外はリーチ。好きな役は遠くても狙いがち。</li>
                    <li><strong>★1</strong>：覚えたての打ち方。降りない。手牌を見た目で分けるので複合形を見誤ることがある。受け入れが40枚差くらいでも迷う。役があれば早くから鳴き、面前でテンパイしたらすぐリーチ。好きな役は遠くてもまっしぐら。</li>
                </ul>
            </section>
            <section>
                <h3>戦績</h3>
                <ul>
                    <li>タイトル横の「戦績」で開きます。最後まで打った対局を打ち手ごとに合計し、このブラウザに保存します。半荘戦と東風戦は別々に記録し、上のボタンで切り替えます。「リセット」で表示中の方をすべて消せます。見出しを押すと並べ替わります（もう一度押すと逆順、「打ち手」で元の並び）。</li>
                    <li>自分も打つときは「振り返り」で、その対局の推奨との一致率、放銃の判定（避けられた・押し判断どおり・事故）、推奨と違った判断の一覧を見られます。行を押すとその局面に移ります。</li>
                    <li>CPUだけの対局は今の面子で打ちます。面子を選ぶ前なら、毎回ランダムな4人で打ちます。</li>
                </ul>
            </section>
            <section>
                <h3>ルール</h3>
                <p>四麻の半荘戦または東風戦・25000点持ち・喰いタンあり・赤ドラ3枚・後付けあり・頭ハネ・トビあり・オーラス親のアガリやめあり・カンドラ即乗り・四槓散了あり。九種九牌などそれ以外の途中流局はありません。点数計算に <a href="https://github.com/takayama-lily/riichi" target="_blank" rel="noopener">riichi</a>（MIT）を使っています。</p>
            </section>
        </dialog>

        <section class="card setup">
            <div class="setup-row">
                <template v-if="members.length">
                    <span class="setup-mode">{{ mode === 'play' ? '自分も打つ' : 'CPU4人を観戦' }}・{{ LENGTHS[gameLength] }}</span>
                    <span class="member-list">
                        <span v-for="id in members" :key="id" class="member-chip" :style="{ '--person': PERSONALITIES[id].color }">
                            {{ PERSONALITIES[id].name }}<small>{{ starText(id) }}</small>
                        </span>
                    </span>
                </template>

                <button class="primary" type="button" @click="openMembers">新しい対局</button>
            </div>
        </section>

        <dialog ref="memberDialog" class="member-dialog" aria-labelledby="member-dialog-title">
            <h2 id="member-dialog-title">面子を選ぶ</h2>
            <div class="mode" role="radiogroup" aria-label="遊び方">
                <button type="button" role="radio" :aria-checked="draftMode === 'play'" :class="{ active: draftMode === 'play' }" @click="draftMode = 'play'">自分も打つ</button>
                <button type="button" role="radio" :aria-checked="draftMode === 'watch'" :class="{ active: draftMode === 'watch' }" @click="draftMode = 'watch'">CPU4人を観戦</button>
            </div>
            <div class="mode" role="radiogroup" aria-label="対局の長さ">
                <button v-for="(label, key) in LENGTHS" :key="key" type="button" role="radio" :aria-checked="draftLength === key"
                    :class="{ active: draftLength === key }" @click="draftLength = key">{{ label }}</button>
            </div>
            <div class="presets">
                <span class="muted">おすすめ</span>
                <button v-for="pr in PRESETS" :key="pr.label" type="button" :title="pr.title" @click="draft = pr.pick(draftCount)">{{ pr.label }}</button>
            </div>
            <p class="muted">{{ draft.length }} / {{ draftCount }}人</p>
            <div class="char-grid">
                <button v-for="id in CPU_IDS" :key="id" type="button" class="char-card"
                    :class="{ selected: draft.includes(id), full: !draft.includes(id) && draft.length >= draftCount }"
                    :style="{ '--person': PERSONALITIES[id].color }" :aria-pressed="draft.includes(id)"
                    aria-describedby="char-detail" @click="toggleDraft(id)">
                    <span class="char-name">{{ PERSONALITIES[id].name }}</span>
                    <span class="char-stars">{{ starText(id) }}</span>
                </button>
            </div>
            <!-- The chosen opponents, one line each; the box keeps the height of four so nothing jumps. -->
            <ul id="char-detail" class="char-detail" aria-live="polite">
                <li v-if="draftMode === 'play'"><strong>あなた</strong>あなたです</li>
                <li v-for="id in draft" :key="id">
                    <strong>{{ PERSONALITIES[id].name }}</strong><span class="char-stars">{{ starText(id) }}</span>
                    {{ PERSONALITIES[id].intro }}
                </li>
            </ul>
            <div class="dialog-actions">
                <button type="button" @click="memberDialog.close()">キャンセル</button>
                <button class="primary" type="button" :disabled="draft.length !== draftCount" @click="startWithDraft">この面子で始める</button>
            </div>
        </dialog>

        <div v-if="game" class="controls">
            <button v-if="!playing" class="primary" type="button" @click="play">▶ 自動再生</button>
            <button v-else class="primary" type="button" @click="stop">⏸ 一時停止</button>
            <div class="nav" role="group" aria-label="手の移動">
                <button type="button" :disabled="playing || cursor === 0" title="局の最初にいるときは前の局へ" @click="prevRound">« 局の最初へ</button>
                <button type="button" :disabled="playing || cursor === 0" title="1手戻る（←キー）" @click="back">◀ 1手戻る</button>
                <button type="button" :disabled="playing || !canForward" title="1手進む（→キー）" @click="forward">1手進む ▶</button>
                <button type="button" :disabled="playing || !canForward" @click="stepToRoundEnd">局の最後まで »</button>
            </div>
            <div class="speed" role="radiogroup" aria-label="再生速度">
                <button v-for="s in SPEEDS" :key="s.id" type="button" role="radio" :aria-checked="speed === s.id"
                    :class="{ active: speed === s.id }" @click="speed = s.id">{{ s.label }}</button>
            </div>
            <label v-if="humanSeat !== null" class="hint-toggle">
                <input v-model="showHint" type="checkbox" /> 推奨のヒントを出す
            </label>
        </div>

        <div v-if="game && game.players.length" class="layout">
            <section class="table" :class="{ flash }" aria-label="卓">
                <div v-if="centerText" :key="centerText.id" class="center-announce">{{ centerText.text }}</div>
                <section v-if="game.phase === 'roundEnd' && game.result && resultOpen" class="result-overlay" aria-live="polite">
                  <div class="result card">
                    <h2>{{ game.result.roundName }} {{ game.result.honba }}本場 結果</h2>
                    <template v-if="game.result.kind === 'win'">
                        <p class="result-title">
                            {{ playerName(game.result.winner) }}
                            {{ game.result.loser === null ? 'ツモ' : `ロン ← ${playerName(game.result.loser)}` }}
                        </p>
                        <div class="win-hand">
                            <MahjongTile v-for="id in game.result.hand.filter(x => x !== game.result.tile)" :key="id" :id="id" size="sm" />
                            <span class="draw-gap"><MahjongTile :id="game.result.tile" size="sm" mark /></span>
                            <span v-for="(meld, i) in game.result.melds" :key="i" class="meld">
                                <span v-for="t in meldTiles(meld, game.result.winner)" :key="t.id" class="meld-slot">
                                    <MahjongTile v-if="t.added != null" :id="t.added" size="xs" sideways />
                                    <MahjongTile :id="t.id" size="xs" :sideways="t.sideways" :back="t.back" />
                                </span>
                            </span>
                        </div>
                        <ul class="yaku">
                            <li v-for="(y, i) in game.result.result.yaku" :key="y.name" class="yaku-row" :style="{ animationDelay: `${0.25 + i * 0.12}s` }"><span>{{ y.name }}</span><span>{{ y.value }}</span></li>
                        </ul>
                        <p v-if="game.result.ura.length" class="ura">裏ドラ表示牌
                            <MahjongTile v-for="id in game.result.ura" :key="id" :id="id" size="xs" />
                        </p>
                        <p class="points">
                            <template v-if="!game.result.result.yakuman">{{ game.result.result.fu }}符{{ game.result.result.han }}飜 </template>
                            {{ game.result.result.name }} {{ shownPoints.toLocaleString() }}点
                        </p>
                    </template>
                    <template v-else-if="game.result.kind === 'abort'">
                        <p class="result-title">途中流局（{{ game.result.reason }}）</p>
                    </template>
                    <template v-else>
                        <p class="result-title">流局</p>
                        <p>テンパイ：{{ game.result.tenpai.map((t, q) => t ? playerName(q) : null).filter(Boolean).join('・') || 'なし' }}</p>
                    </template>
                    <ul class="deltas">
                        <li v-for="(d, q) in game.result.deltas" :key="q" :class="{ plus: d > 0, minus: d < 0 }">
                            <span>{{ playerName(q) }}</span>
                            <span><strong>{{ scoreDelta(d) }}</strong><small>→ {{ game.scores[q].toLocaleString() }}点</small></span>
                        </li>
                    </ul>
                    <div class="result-actions">
                        <button type="button" @click="resultOpen = false">卓を見る</button>
                        <button v-if="reviewData?.rounds.includes(roundOf(game.result))" type="button" @click="openReview(roundOf(game.result))">この局の振り返り</button>
                        <button v-if="canForward" class="primary" type="button" @click="nextHand">次の局へ ▶</button>
                    </div>
                  </div>
                </section>
                <button v-if="game.phase === 'roundEnd' && game.result && !resultOpen" type="button" class="result-reopen" @click="resultOpen = true">結果を見る</button>



                <div v-if="!square" class="table-info">
                    <span class="round">{{ roundLabel }}</span>
                    <span>供託 {{ game.kyotaku }}本</span>
                    <span>残り {{ game.wall.length }}枚</span>
                    <span class="dora">ドラ表示牌
                        <MahjongTile v-for="id in game.doraIndicators" :key="id" :id="id" size="sm" />
                    </span>
                </div>

                <div v-if="square" class="square">
                    <div v-for="pos in OPPONENTS" :key="pos" class="opp" :class="[pos, { turn: game.turn === around[pos] && game.phase === 'play' }]"
                        :style="{ '--person': personOf(around[pos]).color }">
                        <div v-if="announcements[around[pos]]" :key="announcements[around[pos]].id" class="announce" :class="announcements[around[pos]].kind">
                            {{ announcements[around[pos]].text }}
                        </div>
                        <div class="opp-head">
                            <span class="wind" :class="{ dealer: game.seatWind(around[pos]) === 0 }">{{ WIND_NAME[game.seatWind(around[pos])] }}</span>
                            <span class="name">{{ playerName(around[pos]) }}</span>
                            <span v-if="game.players[around[pos]].riichi" class="riichi-stick" title="リーチ" aria-label="リーチ"><i /></span>
                            <span class="score">{{ game.scores[around[pos]].toLocaleString() }}</span>
                        </div>
                        <!-- Laid out as that player sees it: hand from their left to right, calls on their right,
                             every tile facing the centre of the table (face down until the hand is over). -->
                        <div class="opp-body">
                            <div class="opp-hand">
                                <MahjongTile v-for="id in game.players[around[pos]].hand" :key="id" :id="id" size="xs"
                                    :back="!showHand(game.players[around[pos]])" :sideways="pos !== 'top'" :flip="pos !== 'left'" />
                            </div>
                            <div v-if="game.players[around[pos]].melds.length" class="opp-melds">
                                <span v-for="(meld, i) in game.players[around[pos]].melds" :key="i" class="opp-meld" :title="meldLabel(meld)">
                                    <template v-for="t in meldTiles(meld, around[pos])" :key="t.id">
                                        <MahjongTile :id="t.id" size="xs" :back="t.back" v-bind="oppTileTurn(pos, t.sideways)" />
                                        <MahjongTile v-if="t.added != null" :id="t.added" size="xs" v-bind="oppTileTurn(pos, true)" />
                                    </template>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="center">
                        <div v-for="pos in RIVERS" :key="pos" class="river-slot" :class="pos">
                            <div class="river-box" :class="pos">
                                <MahjongTile v-for="r in game.players[around[pos]].river" :key="r.id" :id="r.id" size="xs" :sideways="r.riichi"
                                    :dim="r.called" :tsumogiri="r.tsumogiri" :mark="r.id === lastDiscardId" :class="{ fresh: r.id === lastDiscardId }" />
                            </div>
                        </div>
                        <div class="center-info">
                            <span class="round">{{ roundLabel }}</span>
                            <span>供託 {{ game.kyotaku }}本・残り {{ game.wall.length }}枚</span>
                            <span class="dora">ドラ表示牌 <MahjongTile v-for="id in game.doraIndicators" :key="id" :id="id" size="xs" /></span>
                        </div>
                    </div>
                </div>

                <article v-for="pl in panelPlayers" :key="pl.seat" class="player"
                    :class="{ turn: game.turn === pl.seat && game.phase === 'play', riichi: pl.riichi, me: pl.seat === humanSeat, compact: !showHand(pl) }"
                    :style="{ '--person': personOf(pl.seat).color }">
                    <div v-if="announcements[pl.seat]" :key="announcements[pl.seat].id" class="announce" :class="announcements[pl.seat].kind">
                        {{ announcements[pl.seat].text }}
                    </div>
                    <div class="player-head">
                        <span class="wind" :class="{ dealer: game.seatWind(pl.seat) === 0 }">{{ WIND_NAME[game.seatWind(pl.seat)] }}</span>
                        <span class="name">{{ playerName(pl.seat) }}</span>
                        <span v-if="pl.riichi" class="riichi-stick" title="リーチ" aria-label="リーチ"><i /></span>
                        <span v-if="pl.planName && !hidden" class="plan-label">方針：{{ pl.planName }}</span>
                        <span v-if="waitsBySeat[pl.seat]" class="wait-label">
                            待ち
                            <span v-for="w in waitsBySeat[pl.seat].waits" :key="w.kind" class="wait-tile">
                                <MahjongTile :kind="w.kind" size="xs" /><small>{{ w.left }}</small>
                            </span>
                            <span class="wait-total">{{ waitsBySeat[pl.seat].inWall ? '山に残り' : '残り' }}{{ waitsBySeat[pl.seat].total }}枚</span>
                            <span v-if="waitsBySeat[pl.seat].furiten" class="wait-flag">フリテン</span>
                            <span v-if="waitsBySeat[pl.seat].yakuless" class="wait-flag">役なし</span>
                        </span>
                        <span class="score">{{ game.scores[pl.seat].toLocaleString() }}</span>
                    </div>
                    <!-- A hidden CPU hand is left out (nothing to read in face-down tiles): its calls sit beside the river. -->
                    <div v-if="showHand(pl) || pl.melds.length" class="hand-row">
                        <div v-if="showHand(pl)" class="hand">
                            <MahjongTile v-for="id in handTiles(pl).rest" :key="id" :id="id"
                                :clickable="pl.seat === humanSeat && canDiscard(id)" :dim="pl.seat === humanSeat && !!turnOptions && !canDiscard(id)"
                                :rec="id === hintTile" :class="{ picked: id === picked }" @click="clickTile(pl, id)"
                                @pointerenter="hoverTile(pl, id, $event)" @pointerleave="hovered = null" />
                            <span v-if="handTiles(pl).draw !== null" class="draw-gap">
                                <MahjongTile :id="handTiles(pl).draw" :mark="handTiles(pl).draw !== hintTile" :rec="handTiles(pl).draw === hintTile"
                                    :clickable="pl.seat === humanSeat && canDiscard(handTiles(pl).draw)"
                                    :dim="pl.seat === humanSeat && !!turnOptions && !canDiscard(handTiles(pl).draw)"
                                    :class="{ picked: handTiles(pl).draw === picked }" @click="clickTile(pl, handTiles(pl).draw)"
                                    @pointerenter="hoverTile(pl, handTiles(pl).draw, $event)" @pointerleave="hovered = null" />
                            </span>
                        </div>
                        <div v-if="pl.melds.length" class="melds">
                            <span v-for="(meld, i) in pl.melds" :key="i" class="meld" :title="meldLabel(meld)">
                                <span v-for="t in meldTiles(meld, pl.seat)" :key="t.id" class="meld-slot">
                                    <MahjongTile v-if="t.added != null" :id="t.added" size="sm" sideways />
                                    <MahjongTile :id="t.id" size="sm" :sideways="t.sideways" :back="t.back" />
                                </span>
                                <small class="meld-label">{{ meldLabel(meld) }}</small>
                            </span>
                        </div>
                    </div>
                    <div v-if="!square" class="river">
                        <MahjongTile v-for="r in pl.river" :key="r.id" :id="r.id" size="sm" :sideways="r.riichi"
                            :dim="r.called" :tsumogiri="r.tsumogiri" :mark="r.id === lastDiscardId" :class="{ fresh: r.id === lastDiscardId }" />
                    </div>

                    <div v-if="pl.seat === humanSeat && turnOptions" class="actions">
                        <span class="prompt-text">
                            {{ turnOptions.riichiLocked ? 'リーチ中です' : picked !== null ? 'もう一度タップで切ります' : riichiMode ? 'リーチで切る牌を選んでください' : '切る牌を選んでください' }}
                        </span>
                        <button v-if="turnOptions.canTsumo" class="primary" type="button" @click="humanAct(g => g.humanTsumo())">ツモ</button>
                        <button v-for="k in turnOptions.kans" :key="k.type + k.kind" type="button" @click="humanAct(g => g.humanKan(k))">
                            {{ CALL_NAME[k.type] }} <MahjongTile :kind="k.kind" size="xs" />
                        </button>
                        <button v-if="canDeclareRiichi" type="button" :class="{ active: riichiMode }" @click="riichiMode = !riichiMode">
                            {{ riichiMode ? 'リーチをやめる' : 'リーチ' }}
                        </button>
                        <button v-if="turnOptions.riichiLocked" type="button" @click="discardTile(pl.lastDraw)">ツモ切り</button>
                    </div>
                    <div v-if="pl.seat === humanSeat && reactPrompt" class="actions">
                        <span class="prompt-text">
                            {{ playerName(reactPrompt.from) }}の <MahjongTile :id="reactPrompt.id" size="xs" /> を
                        </span>
                        <button v-if="reactPrompt.ron" class="primary" type="button" @click="humanAct(g => g.humanReact('ron'))">ロン</button>
                        <button v-for="(c, i) in reactPrompt.calls" :key="i" type="button" @click="humanAct(g => g.humanReact(i))">
                            {{ CALL_NAME[c.type] }}
                            <MahjongTile v-for="id in c.tiles" :key="id" :id="id" size="xs" />
                        </button>
                        <button type="button" @click="humanAct(g => g.humanReact('skip'))">{{ reactPrompt.ron ? '見逃す' : 'スルー' }}</button>
                    </div>
                </article>
                <p v-if="humanSeat !== null && game.prompt && !atLatest" class="review-note">
                    過去の局面を見ています。
                    <button type="button" @click="goTo(timeline.length - 1)">最新の局面に戻って打つ</button>
                </p>
            </section>

            <aside class="side">
                <section v-if="game.over" class="card final">
                    <h2>終局</h2>
                    <ol>
                        <li v-for="(p, i) in game.finalRanking" :key="p">
                            <span>{{ i + 1 }}位 {{ playerName(p) }}</span><span>{{ game.scores[p].toLocaleString() }}点</span>
                        </li>
                    </ol>
                    <div class="final-actions">
                        <button v-if="review?.discards" type="button" @click="openReview()">振り返り</button>
                        <button type="button" @click="openStats">戦績を見る</button>
                        <button v-if="atLatest" class="primary" type="button" @click="openMembers">次の対局へ</button>
                    </div>
                </section>

                <section v-if="aim" class="card aim">
                    <h2 class="live-head">狙い役
                        <span v-if="aim.riichi" class="muted">リーチ中</span>
                        <span v-else-if="lostAimName" class="muted">{{ lostAimName }}は狙えなくなりました</span>
                    </h2>
                    <div v-if="!aim.riichi" class="aim-list">
                        <button type="button" class="aim-chip" :class="{ on: !aim.aim }" :disabled="!atLatest" @click="setAim(null)">
                            <strong>おまかせ</strong><span class="muted">推奨の方針</span>
                        </button>
                        <button v-for="r in aim.rows" :key="r.id" type="button" class="aim-chip"
                            :class="{ on: aim.aim === r.id, active: aim.active === r.id }" :disabled="!atLatest" @click="setAim(r.id)">
                            <strong>{{ r.name }}<span v-if="r.id === aim.auto" class="tag">推奨</span></strong>
                            <span class="muted">{{ r.distance < 0 ? '完成' : r.distance === 0 ? 'テンパイ' : `${r.distance}シャンテン` }}・{{ r.points.toLocaleString() }}点</span>
                        </button>
                        <button v-if="aim.more" type="button" class="aim-more" @click="showAllAims = !showAllAims">{{ showAllAims ? '閉じる' : 'ほかの役' }}</button>
                    </div>
                </section>

                <section v-if="live && (live.calling || live.riichi || live.hint)" class="card analysis live" aria-live="polite">
                    <h2 class="live-head">
                        <span class="dot" :style="{ background: live.color }" />
                        {{ live.player === humanSeat ? 'あなた' : live.name }}の手番
                        <span v-if="live.drawn !== null && !live.secret" class="drawn-note">ツモ <MahjongTile :id="live.drawn" size="xs" /></span>
                        <span v-else-if="live.drawn === null && !live.calling" class="muted">（鳴いた直後）</span>
                    </h2>
                    <template v-if="live.calling">
                        <p class="muted">{{ live.calling }}。</p>
                        <div v-if="live.advice" class="call-advice" :class="{ differ: !live.agrees }">
                            <span class="badge" :class="live.agrees ? 'same' : 'diff'">{{ live.agrees ? '推奨どおり' : '推奨と違う' }}</span>
                            推奨：{{ live.advice.text }}
                        </div>
                    </template>
                    <p v-else-if="live.riichi" class="muted">リーチ中</p>
                    <MahjongAnalysis v-else :analysis="live.hint" :hide-plans="!!aim && live.player === humanSeat"
                        :focus-kind="live.player === humanSeat ? focusKind : null" />
                </section>

                <section v-if="reactPrompt && reactPrompt.advice && showHint" class="card analysis">
                    <h2 class="live-head">鳴きの判断</h2>
                    <p class="drawn-note">{{ playerName(reactPrompt.from) }}の <MahjongTile :id="reactPrompt.id" size="xs" /></p>
                    <div class="call-advice" :class="{ differ: false }">推奨：{{ reactPrompt.advice.text }}</div>
                </section>

                <section v-if="lastEntry" class="card last">
                    <button type="button" class="last-line" :class="{ differ: showsAnalysis(lastEntry) && !lastEntry.analysis.choice.same }"
                        :disabled="!showsAnalysis(lastEntry)" @click="openEntry(lastEntry)">
                        <span class="muted">直前</span>
                        <strong>{{ playerName(lastEntry.player) }}</strong>
                        <MahjongTile :id="lastEntry.tile" size="xs" />
                        <span>{{ lastSummary(lastEntry) }}</span>
                        <span v-if="showsAnalysis(lastEntry)" class="more">理由 ›</span>
                    </button>
                </section>

                <section v-if="detail" class="card analysis detail">
                    <h2 class="live-head">
                        <span class="dot" :style="{ background: detailOwner.color }" />
                        {{ detailOwner.name }}の打牌（{{ detail.roundName }}）
                        <button type="button" class="close" aria-label="閉じる" @click="detailEntry = null">×</button>
                    </h2>
                    <p v-if="detail.drawn != null" class="drawn-note">ツモ <MahjongTile :id="detail.drawn" size="xs" /></p>
                    <p v-if="detail.call" class="call-note">{{ CALL_NAME[detail.call.type] }}<template v-if="detail.call.reason">：{{ detail.call.reason }}</template><template v-if="detail.call.advice && detail.call.advice.action !== detail.call.type">（推奨は{{ adviceName(detail.call.advice) }}）</template></p>
                    <MahjongAnalysis :analysis="detail.analysis" :owner-name="detailOwner.name" />
                    <div v-if="visibleChances(detail).length" class="chances">
                        <h3>この牌への鳴き</h3>
                        <ul>
                            <li v-for="c in visibleChances(detail)" :key="c.player" :class="{ differ: (c.choice === 'skip') !== (c.advice.action === 'skip') || (c.choice !== 'skip' && c.choice !== c.advice.action) }">
                                <strong>{{ playerName(c.player) }}</strong>：{{ c.choice === 'skip' ? 'スルー' : CALL_NAME[c.choice] }}
                                <span class="muted">（推奨：{{ c.advice.text }}）</span>
                            </li>
                        </ul>
                    </div>
                </section>

                <section class="card log">
                    <h2>牌譜</h2>
                    <ol ref="kifuList">
                        <li v-for="e in kifuLines" :key="e.id"
                            :class="[e.type, { differ: (showsAnalysis(e) && (!e.analysis.choice.same || e.analysis.choice.riichiDiffers)) || e.type === 'callcheck' || callDiffers(e), current: e.id === currentEntryId, future: e.pos > cursor }]"
                            @click="openEntry(e)">
                            {{ kifuText(e) }}
                        </li>
                    </ol>
                </section>
            </aside>
        </div>



    </div>
</template>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(body) {
    margin: 0;
    min-width: 320px;
    background: #eef3ef;
    color: #1d2b25;
    font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
}
button { font: inherit; }

.mahjong-app {
    --felt: #1f6b4f;
    --felt-dark: #17533d;
    --accent: #1f8a5f;
    --line: #d3e0d8;
    --muted: #66786f;
    --warn: #d9480f;
    width: min(1280px, 100%);
    margin: 0 auto;
    padding: 12px clamp(16px, 3vw, 32px) 32px;
}

.hero { margin-bottom: 8px; }
.title-row { display: flex; align-items: center; gap: 12px; }
.manual-button { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 14px; }
.sound-button { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); border-color: var(--accent); background: #f0f8f3; }
.sound-button.off { color: var(--muted); border-color: var(--line); background: #fff; }
.manual-dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 32px); border: 0; border-radius: 14px; padding: 18px 22px; color: inherit; line-height: 1.7; }
.manual-dialog::backdrop { background: rgba(10, 30, 20, .55); }
.manual-head { display: flex; align-items: center; justify-content: space-between; }
.manual-head h2 { margin: 0; font-size: 18px; }
.manual-head .close { border: 0; background: none; font-size: 22px; cursor: pointer; color: var(--muted); }
.manual-dialog h3 { margin: 14px 0 4px; font-size: 15px; }
.manual-dialog p, .manual-dialog ul { margin: 0; font-size: 14px; }
.manual-dialog ul { padding-left: 20px; }
.manual-dialog a { color: var(--accent); }
.eyebrow { margin: 0 0 4px; color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .2em; }
h1 { margin: 0; font-size: clamp(22px, 3.4vw, 28px); }

.controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
.controls button, .batch button, .final button {
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 8px;
    padding: 8px 14px;
    cursor: pointer;
}
.controls button:disabled, .batch button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
.nav { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.speed { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.controls .speed button { border: 0; border-radius: 0; padding: 8px 12px; }
.speed button.active { background: #dff1e7; color: var(--felt-dark); font-weight: 700; }

.layout { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start; }
@media (max-width: 980px) { .layout { grid-template-columns: 1fr; } }

.table {
    position: relative;
    background: radial-gradient(circle at 50% 30%, #2a7d5d, var(--felt) 60%, var(--felt-dark));
    border-radius: 14px;
    padding: 8px;
    display: grid;
    gap: 6px;
    color: #f2f7f4;
}
/* 宣言の文字: pops up over the player's panel and fades. */
.announce {
    position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; pointer-events: none;
    font-size: clamp(28px, 6vw, 44px); font-weight: 900; letter-spacing: .1em; color: #fff;
    text-shadow: 0 2px 0 rgba(0, 0, 0, .35), 0 0 18px rgba(0, 0, 0, .35);
    background: linear-gradient(transparent 20%, rgba(0, 0, 0, .38) 40%, rgba(0, 0, 0, .38) 60%, transparent 80%);
    border-radius: 10px;
    animation: announce 1.1s ease-out forwards;
}
.announce.call { color: #ffe08a; }
.announce.riichi { color: #ffd43b; }
.announce.win { color: #ff8f8f; font-size: clamp(36px, 8vw, 60px); animation-duration: 1.6s; }
@keyframes announce {
    0% { opacity: 0; transform: scale(.6); }
    15% { opacity: 1; transform: scale(1.12); }
    30% { transform: scale(1); }
    80% { opacity: 1; }
    100% { opacity: 0; transform: scale(1.05); }
}
.center-announce {
    position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; pointer-events: none;
    font-size: clamp(32px, 7vw, 52px); font-weight: 900; letter-spacing: .2em; color: #e6f2ec;
    text-shadow: 0 2px 0 rgba(0, 0, 0, .4); animation: announce 1.5s ease-out forwards;
}
.table.flash::after {
    content: ''; position: absolute; inset: 0; border-radius: 14px; pointer-events: none;
    background: radial-gradient(circle, rgba(255, 240, 200, .55), rgba(255, 240, 200, 0) 70%);
    animation: flash .9s ease-out forwards;
}
@keyframes flash { from { opacity: 1; } to { opacity: 0; } }
.river .fresh, .river-box .fresh { animation: drop .25s ease-out; }
/* 4方向の卓 */
.square { display: grid; grid-template-columns: 104px 1fr 104px; grid-template-areas: "top top top" "left center right"; gap: 6px; }
.opp { position: relative; background: rgba(0, 0, 0, .16); border-radius: 10px; padding: 6px; min-width: 0; }
.opp.turn { background: rgba(255, 255, 255, .12); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .25); }
.opp.top { grid-area: top; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px 14px; border-top: 4px solid var(--person); }
.opp.left { grid-area: left; border-left: 4px solid var(--person); }
.opp.right { grid-area: right; border-right: 4px solid var(--person); }
.opp.left, .opp.right { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.opp-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 2px 8px; font-size: 13px; }
.opp.left .opp-head, .opp.right .opp-head { flex-direction: column; }
.opp-head .score { margin-left: 0; }
.opp-body { display: flex; align-items: center; gap: 8px; }
.opp-hand { display: flex; gap: 1px; }
.opp-melds { display: flex; gap: 4px; }
.opp-meld { display: inline-flex; align-items: center; gap: 1px; padding: 2px; background: rgba(255, 255, 255, .14); border-radius: 4px; }
/* 対面: their left-to-right runs right-to-left on screen, calls end up on our left. */
.opp.top .opp-body, .opp.top .opp-hand, .opp.top .opp-melds, .opp.top .opp-meld { flex-direction: row-reverse; }
/* 上家 (left) faces right: left-to-right runs top to bottom, calls below the hand. */
.opp.left .opp-body, .opp.left .opp-hand, .opp.left .opp-melds, .opp.left .opp-meld { flex-direction: column; }
/* 下家 (right) faces left: left-to-right runs bottom to top, calls above the hand. */
.opp.right .opp-body, .opp.right .opp-hand, .opp.right .opp-melds, .opp.right .opp-meld { flex-direction: column-reverse; }
.opp .announce { font-size: 26px; }
.center { grid-area: center; display: grid; grid-template-columns: 112px 126px 112px; grid-template-rows: 112px 126px 112px; justify-content: center; align-content: center; background: rgba(0, 0, 0, .12); border-radius: 12px; padding: 8px; }
.river-slot { position: relative; }
.river-slot.top { grid-area: 1 / 2; }
.river-slot.left { grid-area: 2 / 1; }
.river-slot.right { grid-area: 2 / 3; }
.river-slot.bottom { grid-area: 3 / 2; }
/* Each river faces its owner, filling away from the centre as in a real game. */
.river-box { position: absolute; left: 50%; top: 50%; width: 126px; height: 112px; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 2px; transform: translate(-50%, -50%); }
.river-box.top { transform: translate(-50%, -50%) rotate(180deg); }
.river-box.left { transform: translate(-50%, -50%) rotate(90deg); }
.river-box.right { transform: translate(-50%, -50%) rotate(-90deg); }
.center-info { grid-area: 2 / 2; display: grid; place-content: center; justify-items: center; gap: 4px; font-size: 12px; text-align: center; }
.center-info .round { font-size: 15px; }
@keyframes drop { from { transform: translateY(-8px) scale(1.15); } to { transform: none; } }
.riichi-stick { display: inline-flex; align-items: center; width: 46px; height: 8px; border-radius: 4px; background: #fbfaf5; box-shadow: 0 1px 0 rgba(0, 0, 0, .3); justify-content: center; }
.riichi-stick i { width: 6px; height: 6px; border-radius: 50%; background: #c8102e; }
.yaku-row { animation: rise .3s ease-out both; }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
    .announce, .center-announce { animation-duration: .01s; animation-delay: 1s; }
    .table.flash::after, .river .fresh, .yaku-row { animation: none; }
}
.table-info { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; font-size: 14px; padding: 0 4px; }
.round { font-weight: 800; font-size: 17px; }
.dora { display: inline-flex; align-items: center; gap: 6px; }

.player {
    position: relative;
    background: rgba(0, 0, 0, .16);
    border-radius: 10px;
    padding: 6px 8px;
    border-left: 4px solid var(--person);
}
.player.turn { background: rgba(255, 255, 255, .12); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .25); }
.player-head { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin-bottom: 4px; }
.wind { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; background: rgba(255, 255, 255, .18); font-weight: 700; }
.wind.dealer { background: #f5c542; color: #3b2b00; }
.name { font-weight: 800; }
.score { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 700; }
.badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 999px; }
.riichi-badge { background: #ffd43b; color: #5c3d00; }
.hand-row { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; min-height: 46px; }
.hand { display: flex; flex-wrap: wrap; gap: 2px; }
.draw-gap { margin-left: 8px; display: inline-flex; }
.melds { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
/* Each call in its own frame, so where one ends and the next begins is plain. */
.meld { position: relative; display: inline-flex; gap: 1px; align-items: flex-end; padding: 3px 4px 11px; background: rgba(255, 255, 255, .14); border: 1px solid rgba(255, 255, 255, .28); border-radius: 6px; }
.meld-slot { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; }
.meld-label { position: absolute; left: 0; right: 0; bottom: 1px; text-align: center; font-size: 9px; line-height: 1; opacity: .85; }
.win-hand .meld { background: #f3f8f5; border-color: var(--line); padding-bottom: 4px; }
.river { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 4px; min-height: 64px; max-width: 520px; align-content: flex-start; align-items: center; }
/* A CPU whose hand is hidden: name line, then the river with the calls on its right. */
.player.compact { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 10px; }
.player.compact .player-head { grid-column: 1 / -1; }
.player.compact .river { grid-row: 2; grid-column: 1; margin-top: 0; }
.player.compact .hand-row { grid-row: 2; grid-column: 2; min-height: 0; align-self: start; }

.side { display: grid; gap: 12px; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
.card h2 { margin: 0 0 10px; font-size: 16px; }
.muted { color: var(--muted); font-size: 13px; }

.result-title { font-weight: 800; font-size: 17px; margin: 0 0 8px; }
/* The result of a hand covers the table until 「次の局へ」 (or 「卓を見る」). */
.result-overlay { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; padding: 16px; background: rgba(8, 30, 20, .55); border-radius: 14px; }
.result-overlay .result { width: min(460px, 100%); max-height: 100%; overflow-y: auto; color: #1d2b25; animation: rise .3s ease-out both; }
.result-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.result-actions button, .result-reopen { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 8px 14px; cursor: pointer; font: inherit; }
.result-actions button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
.result-reopen { position: absolute; z-index: 4; right: 16px; top: 10px; font-size: 13px; padding: 4px 10px; }
.deltas small { margin-left: 8px; color: var(--muted); font-weight: 400; }
.win-hand { display: flex; flex-wrap: wrap; gap: 2px; align-items: flex-end; margin-bottom: 8px; }
.win-hand .meld { margin-left: 6px; }
.yaku { list-style: none; padding: 0; margin: 0 0 6px; }
.yaku li, .deltas li, .final li { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dashed var(--line); }
.ura { display: flex; align-items: center; gap: 6px; font-size: 13px; margin: 6px 0; }
.points { font-weight: 800; margin: 6px 0 10px; }
.deltas { list-style: none; padding: 0; margin: 0; font-variant-numeric: tabular-nums; }
.deltas .plus span:last-child { color: var(--accent); font-weight: 700; }
.deltas .minus span:last-child { color: var(--warn); font-weight: 700; }
.final ol { padding: 0; margin: 0 0 12px; list-style: none; }

.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; }
.drawn-note { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 13px; }
.call-note { margin: 0 0 8px; font-size: 13px; background: #f3f8f5; border-radius: 6px; padding: 6px 8px; }
.note { font-size: 12px; color: var(--muted); margin: 8px 0 0; line-height: 1.6; }

.log ol { position: relative; list-style: none; margin: 0; padding: 0; max-height: 320px; overflow-y: auto; font-size: 13px; }
.log li { padding: 4px 6px; border-bottom: 1px solid #eef3f0; cursor: pointer; }
.log li:hover { background: #f3f8f5; }
.log li.differ { border-left: 3px solid #f0a46b; }
.log li.current { background: #d9efe2; font-weight: 700; }
.log li.future { opacity: .45; }
.log li.start { text-align: center; padding-top: 8px; }
.log li.win, .log li.draw, .log li.start, .log li.end { font-weight: 700; color: var(--felt-dark); }

.stats-dialog { width: min(1180px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; border: 0; border-radius: 14px; padding: 18px; color: inherit; }
.review-dialog { width: min(820px, calc(100vw - 32px)); }
.review-dialog h2 { margin: 0 0 12px; }
.review-dialog h3 { margin: 16px 0 6px; font-size: 15px; }
.review-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.review-summary > div { display: flex; flex-direction: column; gap: 2px; background: #f3f8f5; border-radius: 8px; padding: 8px 10px; }
.review-summary strong { font-size: 20px; font-variant-numeric: tabular-nums; }
.review-summary small { font-size: 11px; color: var(--muted); }
.review-rounds { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 10px; }
.review-rounds button { font-size: 13px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; background: #fff; cursor: pointer; }
.review-rounds button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
/* A hand where the human dealt in. */
.review-rounds button.deal-in:not(.active) { border-color: #f0a46b; }
.review-list { list-style: none; margin: 0; padding: 0; }
.review-list button { width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 6px 8px; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; font: inherit; font-size: 14px; color: inherit; cursor: pointer; }
.review-list button:hover { background: #f3f8f5; }
.review-list small { flex-basis: 100%; color: var(--muted); font-size: 12px; }
.verdict, .size { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px; background: #e9ecef; }
.verdict.避けられた, .size.大 { background: #ffe1cc; color: #8a3200; }
.verdict.押し判断どおり, .size.中 { background: #fff3bf; color: #5c4400; }
.verdict.事故 { background: #dff1e7; color: #17533d; }
.review-note { margin: 10px 0 0; }
.review-more { margin-top: 6px; font-size: 13px; }
.stats-dialog::backdrop { background: rgba(10, 30, 20, .55); }
.final-actions { display: flex; justify-content: flex-end; gap: 8px; }
.stats-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
.stats-head h2 { margin: 0; }
.batch { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.table-scroll { overflow-x: auto; }
.stats table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
.stats th, .stats td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
.stats thead th { font-size: 12px; color: var(--muted); font-weight: 600; }
.stats thead th button.sort { border: 0; background: none; padding: 0; font: inherit; color: inherit; cursor: pointer; white-space: nowrap; }
.stats thead th button.sort:hover, .stats thead th button.sort.active { color: var(--accent); }
.sort-mark { display: inline-block; width: 1em; text-align: center; font-size: 10px; }
.stats tbody th { text-align: left; }
.stats small { display: block; color: var(--muted); font-weight: 400; font-size: 11px; margin-left: 16px; }

.setup { margin-bottom: 8px; padding: 8px 12px; }
.setup-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
.setup .muted { margin: 0; }
.mode { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.mode button { border: 0; background: #fff; padding: 8px 12px; cursor: pointer; }
.mode button.active { background: #dff1e7; color: var(--felt-dark); font-weight: 700; }
.mode + .mode { margin-left: 8px; }
.setup button.primary { border-radius: 8px; padding: 8px 14px; cursor: pointer; border: 1px solid var(--accent); }
.setup-mode { font-weight: 700; }
.aim-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(4, minmax(44px, auto)); gap: 4px; }
.aim-chip { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: #fff; text-align: left; font-size: 13px; line-height: 1.4; }
.aim-chip strong { font-weight: 600; display: flex; align-items: center; }
.aim-chip .muted { font-size: 11px; }
.aim-chip .tag { font-size: 10px; font-weight: 600; background: var(--accent); color: #fff; border-radius: 4px; padding: 0 4px; margin-left: 4px; }
.aim-chip.active { border-color: var(--accent); }
.aim-chip.on { background: #f0f8f3; border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.aim-more { grid-column: 1 / -1; font-size: 12px; padding: 2px; }
.beta { margin-left: 6px; font-size: 0.5em; font-weight: 700; vertical-align: super; color: var(--accent); }
.call-advice { font-size: 13px; line-height: 1.6; background: #f3f8f5; border-radius: 6px; padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.call-advice.differ { background: #fff7f0; }
.call-advice .badge.same { background: #dff1e7; color: #17533d; }
.call-advice .badge.diff { background: #ffe1cc; color: #8a3200; }
.chances { margin-top: 10px; }
.chances h3 { margin: 0 0 4px; font-size: 13px; }
.chances ul { list-style: none; margin: 0; padding: 0; }
.chances li { font-size: 13px; padding: 3px 0; border-bottom: 1px dashed var(--line); }
.chances li.differ { color: #8a3200; }
.member-list { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.member-chip { display: inline-flex; align-items: center; gap: 4px; border-left: 4px solid var(--person); background: #f3f8f5; border-radius: 6px; padding: 4px 8px; font-weight: 700; font-size: 14px; }
.member-chip small { color: #c28a00; font-weight: 400; }
.setup-row button { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
.setup-row button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
.member-dialog { width: min(980px, calc(100vw - 32px)); max-height: calc(100vh - 32px); border: 0; border-radius: 14px; padding: 18px; color: inherit; }
.member-dialog::backdrop { background: rgba(10, 30, 20, .55); }
.member-dialog h2 { margin: 0 0 10px; font-size: 18px; }
.member-dialog .mode { margin-bottom: 10px; }
.presets { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; overflow-x: auto; white-space: nowrap; }
.presets button { flex: none; }
.presets button, .dialog-actions button { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.char-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin: 10px 0 6px; }
@media (max-width: 640px) { .char-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.char-card { display: flex; align-items: center; justify-content: space-between; gap: 6px; text-align: left; border: 1px solid var(--line); border-left: 5px solid var(--person); border-radius: 8px; background: #fff; padding: 8px 10px; cursor: pointer; font: inherit; color: inherit; }
.char-card.selected { background: #e3f3ea; border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
/* Full: other cards can still be pressed to read how they play, but look unavailable. */
.char-card.full { opacity: .5; }
.char-name { font-weight: 800; display: flex; align-items: center; gap: 6px; }
.char-stars { color: #c28a00; font-size: 12px; letter-spacing: 1px; }
.char-detail { list-style: none; margin: 0; height: calc(4 * 1.7em + 12px); overflow-y: auto; font-size: 13px; line-height: 1.7; background: #f3f8f5; border-radius: 8px; padding: 6px 10px; }
.char-detail li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.char-detail strong { margin-right: 4px; }
.char-detail .char-stars { margin-right: 8px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.dialog-actions button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
.dialog-actions button:disabled { opacity: .45; cursor: default; }
.dialog-actions .reset { margin-right: auto; }
.live-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.live-head .drawn-note { margin: 0 0 0 auto; font-size: 13px; font-weight: 400; }
.live-head .close { margin-left: auto; border: 0; background: none; font-size: 18px; line-height: 1; cursor: pointer; color: var(--muted); }
.card.last { padding: 8px 10px; }
.last-line { width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; border: 0; background: none; padding: 0; text-align: left; cursor: pointer; font-size: 14px; color: inherit; }
.last-line:disabled { cursor: default; }
.last-line.differ { color: #8a3200; }
.last-line .more { margin-left: auto; color: var(--accent); font-size: 13px; }
.wait-label { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; color: #d8ffe8; }
.wait-tile { display: inline-flex; align-items: flex-end; gap: 1px; }
.wait-tile small { font-size: 10px; opacity: .85; }
.wait-total { opacity: .85; }
.wait-flag { font-size: 11px; font-weight: 700; color: #5c3d00; background: #ffd43b; border-radius: 4px; padding: 1px 5px; }
.hint-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }

.player.me { background: rgba(255, 255, 255, .1); }
/* A tile picked with a finger stands up until the second tap. */
.hand .picked, .hand .picked:hover { transform: translateY(-10px); box-shadow: 0 0 0 2px #ffd43b, 0 4px 8px rgba(0, 0, 0, .3); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(255, 255, 255, .3); }
.actions button { display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(255, 255, 255, .5); background: rgba(255, 255, 255, .92); color: #1d2b25; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-weight: 700; }
.actions button.primary { background: #ffd43b; border-color: #ffd43b; color: #5c3d00; }
.actions button.active { background: #ffd43b; }
.prompt-text { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 700; margin-right: 4px; }
.review-note { margin: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 14px; }
.review-note button { border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-weight: 700; }
.plan-label { font-size: 12px; background: rgba(255, 255, 255, .16); border-radius: 999px; padding: 2px 8px; }
</style>
