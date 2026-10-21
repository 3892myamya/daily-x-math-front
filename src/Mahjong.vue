<script setup>
import { ref, shallowRef, triggerRef, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import MahjongTile from './components/MahjongTile.vue'
import { toText, fromText, diffState, applyDiff } from './mahjongRecord.js'
import MahjongAnalysis from './components/MahjongAnalysis.vue'
import { MahjongGame, createRng, HUMAN, gameToText, gameFromText } from './mahjongGame.js'
import { PERSONALITIES, CPU_IDS, LEVELS, LEVEL_IDS, displayName, hintFor, levelOf, aimChoices, callAdvice, tenpaiInfo } from './mahjongAI.js'
import { WIND_NAME, kindOf, kindName, countKinds, KIND_COUNT, tileKey, tileName, doraOf, isRed } from './mahjongTiles.js'
import { waitingKinds } from './mahjongShanten.js'
import { playSound, soundEnabled, setSoundEnabled, wakeAudio } from './mahjongSound.js'

const SPEEDS = [
    { id: 'slow', label: 'ゆっくり', ms: 1000 },
    { id: 'normal', label: 'ふつう', ms: 650 },
    { id: 'brisk', label: '速い', ms: 300 },
    // The id stays 'fast' so a saved choice keeps meaning the quickest.
    { id: 'fast', label: '最速', ms: 150 },
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
// 解析モード (recommendations, candidates, 狙い役 for the human). On by default: it is what this app is
// for; someone who wants to play plain turns it off, as in other mahjong apps. Kept in this browser.
const showHint = ref(readSetting('mahjong-analysis', 'on') === 'on')
watch(showHint, on => saveSetting('mahjong-analysis', on ? 'on' : 'off'))

function readSetting(key, fallback) {
    try {
        return localStorage.getItem(key) ?? fallback
    } catch {
        return fallback
    }
}
function saveSetting(key, value) {
    try {
        localStorage.setItem(key, value)
    } catch {
        // Private windows may refuse storage; the setting then lasts for this visit only.
    }
}

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

// Every dialog closes with its × (top right), Esc, or a tap outside it. A dialog's own padding counts
// as inside: only a point outside its box closes it.
// A dialog closes on a tap outside it only when the press began there too. The decision is made at
// pointerdown, before anything inside reacts: by the click a button may already have changed the
// content and resized the dialog, and a press that starts inside and is released outside (a drag,
// a text selection) reaches the dialog as a click on itself.
let pressedBackdrop = null
function isOnBackdrop(e) {
    if (e.target !== e.currentTarget) return false
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
}
function notePress(e) {
    pressedBackdrop = isOnBackdrop(e) ? e.currentTarget : null
}
function closeOutside(e) {
    const dialog = pressedBackdrop
    pressedBackdrop = null
    if (dialog === e.currentTarget && e.target === e.currentTarget) dialog.close()
}

// The dialog opens on 'quick' (pick a strength and go); 'pick' is choosing the opponents one by one.
// Each strength is named by what the player wants from the game, which differs between playing and watching.
const dialogStep = ref('quick')
const STRENGTHS = [
    { id: 'easy', icon: { play: '🌱', watch: '🎉' }, label: { play: '麻雀に慣れたい', watch: 'にぎやかな卓を見たい' }, note: '★1〜★2の相手が選ばれます', stars: [1, 2] },
    { id: 'normal', icon: { play: '🀄', watch: '🍵' }, label: { play: 'ほどよく勝負したい', watch: '気軽に眺めたい' }, note: '★2〜★3の相手が選ばれます', stars: [2, 3] },
    { id: 'strong', icon: { play: '🔥', watch: '👀' }, label: { play: '本気で腕試し', watch: '上手な打ち方を見たい' }, note: '★3〜★4の相手が選ばれます', stars: [3, 4] },
    { id: 'any', icon: { play: '🎲', watch: '🎲' }, label: { play: 'だれとでも', watch: 'だれでも' }, note: '20人全員から選ばれます', stars: [1, 2, 3, 4] },
]

function quickStart(strength) {
    draft.value = pickRandom(CPU_IDS.filter(id => strength.stars.includes(stars(id))), draftCount.value)
    startWithDraft()
}

function sameMembers() {
    draft.value = [...members.value]
    startWithDraft()
}

function openMembers() {
    stop()
    dialogStep.value = 'quick'
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
// Every call chance the human decided ({ agreed }), including passes that leave no 牌譜 line, and every
// turn with a kan to declare or not (self: true).
let callDecisions = []
// A turn's kan choice, from the action until its event comes back (then it joins callDecisions).
let pendingKan = null
const playing = ref(false)
const speed = ref(SPEEDS.some(s => s.id === readSetting('mahjong-speed')) ? readSetting('mahjong-speed') : 'brisk')
watch(speed, v => saveSetting('mahjong-speed', v))
const settingsDialog = ref(null)
let timer = null
let logId = 0

function newGame() {
    stop()
    const seed = Math.floor(Math.random() * 2 ** 31)
    const playMode = mode.value === 'play'
    game.value = new MahjongGame({ seed, length: gameLength.value, ...seatsFor(seed, members.value, seatCount(mode.value), playMode) })
    log.value = []
    callDecisions = []
    clearRecord()
    lostRounds.value = { names: [], partial: null }
    reviewMode.value = false
    timeline.value = []
    riichiMode.value = false
    detailEntry.value = null
    advanceEngine()
    // The opponents are introduced first; playing starts when the card is closed.
    introOpen.value = true
}

/* =====================
   中断と再開
===================== */
// The latest position is saved after every step, so a reload (or closing the browser) can carry on from
// there. Starting a new game replaces the save (only when it really starts, not when the dialog is merely
// opened). Beside it, every position is recorded with the 牌譜 lines and decisions it added (see
// mahjongRecord.js), so the timeline and the review come back too; if that record cannot be written or
// read, the game still resumes and the hands before it are reviewed as lost.
const RESUME_KEY = 'mahjong-resume'
const RECORD_KEY = 'mahjong-record-'
// The plain states of the last two positions written (a rewrite of the last one diffs against the one before).
let record = { ok: true, pos: -1, prev: null, last: null, logs: '[]', calls: '[]' }

function clearRecord() {
    record = { ok: true, pos: -1, prev: null, last: null, logs: '[]', calls: '[]' }
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i)
            if (k?.startsWith(RECORD_KEY)) localStorage.removeItem(k)
        }
    } catch {
        // Nothing to do.
    }
}

// Writes position pos with the 牌譜 lines and call decisions it added; written again (same pos) when
// the position itself changes, as when the human picks a 狙い役.
function recordPosition(pos, logFrom = null, callsFrom = null) {
    if (!record.ok) return
    try {
        const entry = timeline.value[pos]
        const plain = JSON.parse(toText(entry.snap))
        if (pos !== record.pos) {
            record.prev = record.last
            record.logs = toText(log.value.slice(logFrom))
            record.calls = toText(callDecisions.slice(callsFrom))
        }
        const full = !record.prev || startsRound(entry)
        localStorage.setItem(RECORD_KEY + pos, JSON.stringify({
            t: entry.types, ...(full ? { s: plain } : { d: diffState(record.prev, plain) }), l: record.logs, c: record.calls,
        }))
        record.pos = pos
        record.last = plain
    } catch {
        // Storage full or blocked: stop recording, and free the room for the position itself.
        clearRecord()
        record.ok = false
    }
}

// The timeline, 牌譜 and call decisions of the first count positions, or null when any is missing.
function loadRecord(count) {
    try {
        const timelineBack = [], logs = [], calls = []
        let last = null, prev = null, lastItem = null
        for (let i = 0; i < count; i++) {
            const item = JSON.parse(localStorage.getItem(RECORD_KEY + i))
            prev = last
            last = item.s ?? applyDiff(last, item.d)
            timelineBack.push({ snap: fromText(JSON.stringify(last)), types: item.t })
            logs.push(...fromText(item.l))
            calls.push(...fromText(item.c))
            lastItem = item
        }
        return count > 0 ? { timeline: timelineBack, logs, calls, last, prev, lastItem } : null
    } catch {
        return null
    }
}

// The saved game, or null (none, unreadable, or saved by a version whose game state no longer fits).
function loadSaved() {
    try {
        const saved = JSON.parse(localStorage.getItem(RESUME_KEY) ?? 'null')
        const game = saved?.game ? gameFromText(saved.game) : null
        return game && !game.over ? { ...saved, game } : null
    } catch {
        return null
    }
}

// Only what the start screen shows; the game itself is read again when resuming.
const savedInfo = saved => saved && {
    round: saved.round, mode: saved.mode, length: LENGTHS[saved.game.length ?? 'hanchan'],
    // Who is at the table (the others when playing, all four when watching).
    names: saved.game.players.map((_, p) => p).filter(p => !saved.game.isHuman(p)).map(p => saved.game.nameOf(p)),
}
const savedGame = ref(savedInfo(loadSaved()))

function saveProgress(g) {
    try {
        if (g.over) {
            discardSaved()
            return
        }
        localStorage.setItem(RESUME_KEY, JSON.stringify({
            game: gameToText(g), members: members.value, mode: mode.value, at: Date.now(), round: `${g.roundName} ${g.honba}本場`,
            record: record.ok ? timeline.value.length : 0, lost: lostRounds.value,
        }))
    } catch {
        // Storage may be full or blocked; the game simply cannot be resumed then.
    }
}

function resumeSaved() {
    const saved = loadSaved()
    if (!saved) {
        discardSaved()
        return
    }
    stop()
    members.value = saved.members ?? members.value
    mode.value = saved.mode ?? mode.value
    game.value = saved.game
    gameLength.value = game.value.length
    reviewMode.value = false
    riichiMode.value = false
    detailEntry.value = null
    // The record is used only when it ends exactly at the saved position.
    const back = loadRecord(saved.record ?? 0)
    const savedPlain = JSON.parse(toText(structuredClone(saved.game)))
    if (back && diffState(back.last, savedPlain).length === 0) {
        timeline.value = back.timeline
        log.value = back.logs
        callDecisions = back.calls
        logId = Math.max(0, ...back.logs.map(e => e.id))
        lostRounds.value = saved.lost ?? { names: [], partial: null }
        record = { ok: true, pos: back.timeline.length - 1, prev: back.prev, last: back.last, logs: back.lastItem.l, calls: back.lastItem.c }
    } else {
        log.value = []
        callDecisions = []
        // Every hand finished so far (the game's own record of them) lost its decisions, and so did the
        // part of the one under way before the reload.
        lostRounds.value = {
            names: game.value.history.map(h => roundOf(h)),
            partial: game.value.phase === 'play' ? roundOf(game.value) : null,
        }
        timeline.value = [{ snap: structuredClone(game.value), types: [] }]
        // Recorded afresh from here, so another reload loses nothing more.
        clearRecord()
        recordPosition(0, 0, 0)
        saveProgress(game.value)
    }
    cursor.value = timeline.value.length - 1
    // Playing yourself, the game carries on (a finished hand still waits for 「次の局へ」); watching waits for 自動再生.
    if (humanSeat.value !== null) {
        if (game.value.phase === 'roundEnd') playing.value = true
        else play()
    }
}

function discardSaved() {
    clearRecord()
    try {
        localStorage.removeItem(RESUME_KEY)
    } catch {
        // Nothing to do.
    }
    savedGame.value = null
}

const introOpen = ref(false)
function closeIntro() {
    introOpen.value = false
    if (humanSeat.value !== null) play()
}
const introSeats = computed(() => seatOrder.value.filter(p => p !== humanSeat.value))

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

/* =====================
   役満（特別な演出と記録）
===================== */
const yakumanNames = result => result.yaku.filter(y => String(y.value).includes('役満')).map(y => y.name)

// The show over the table: who, which yakuman, gold light. Tap to close; it closes by itself too.
const yakumanShow = ref(null)
let yakumanTimer = null
function showYakuman(event) {
    const r = event.result
    yakumanShow.value = {
        id: ++announceId,
        name: playerName(r.winner),
        yaku: yakumanNames(r.result),
        points: r.result.points,
        how: r.loser === null ? 'ツモ' : 'ロン',
    }
    playSound('yakuman')
    clearTimeout(yakumanTimer)
    yakumanTimer = setTimeout(() => { yakumanShow.value = null }, 5200)
}
// Gold sparks: fixed positions (from the index) so they need no random state.
const SPARKS = Array.from({ length: 24 }, (_, i) => ({ left: (i * 37) % 100, delay: (i * 0.13) % 1.6, size: 4 + (i * 7) % 6 }))

// Every yakuman won in a real game (not the CPU-only batches), kept in this browser for the 戦績.
const YAKUMAN_KEY = 'mahjong-yakuman'
const yakumanRecords = ref(loadYakuman())
function loadYakuman() {
    try {
        return JSON.parse(localStorage.getItem(YAKUMAN_KEY) ?? '[]')
    } catch {
        return []
    }
}
// batch: won in the CPU-only games (a development tool); kept as well, to see how often each yakuman comes.
function recordYakuman(event, g, batch = false) {
    const r = event.result
    const name = p => displayName(g.seats[p], g.levels[p])
    yakumanRecords.value = [{
        at: Date.now(),
        name: name(r.winner),
        you: r.winner === g.humanSeat,
        batch,
        yaku: yakumanNames(r.result),
        points: r.result.points,
        how: r.loser === null ? 'ツモ' : `ロン（${name(r.loser)}から）`,
        round: `${LENGTHS[g.length ?? 'hanchan']} ${roundOf(r)}`,
        // The winning hand as it stood: the concealed tiles, the winning tile and the calls.
        seat: r.winner,
        hand: r.hand.filter(x => x !== r.tile).sort((a, b) => a - b),
        tile: r.tile,
        melds: r.melds.map(m => ({ type: m.type, tiles: [...m.tiles], calledTile: m.calledTile, addedTile: m.addedTile ?? null, from: m.from })),
    }, ...yakumanRecords.value]
    saveSetting(YAKUMAN_KEY, JSON.stringify(yakumanRecords.value))
}
const recordDate = at => new Date(at).toLocaleDateString('ja-JP')

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
            if (event.result.result.yakuman) showYakuman(event)
            else playSound('win')
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
        if (event.type === 'call' && event.player === h && event.call?.advice) {
            callDecisions.push({ round, pos, agreed: event.call.advice.action === event.call.type, choice: event.call.type, advice: event.call.advice, text: event.text })
        }
        for (const c of event.callChances ?? []) {
            if (c.player === h) callDecisions.push({ round, pos, agreed: c.advice.action === 'skip', choice: 'skip', advice: c.advice, tile: c.tile })
        }
        if (pendingKan && (event.type === 'win' || (event.player === h && ['kan', 'discard'].includes(event.type)))) {
            const { advice, chosen, first } = pendingKan
            pendingKan = null
            const rec = advice.option
            const agreed = rec ? !!chosen && chosen.kind === rec.kind && chosen.type === rec.type : !chosen
            callDecisions.push({
                round, pos, agreed, self: true, choice: chosen ? chosen.type : 'skip',
                advice: { action: rec ? rec.type : 'skip', text: advice.text }, tile: (chosen ?? rec ?? first)?.tiles[0] ?? null,
            })
        }
    }
    if (event.type === 'win' && event.result.result.yakuman) recordYakuman(event, g)
    if (event.type === 'end') addTotals(g)
}

// Runs the engine (after an optional human action) to the next stopping point and records it as a new position.
function advanceEngine(action = null) {
    const g = game.value
    const pos = timeline.value.length
    const logFrom = log.value.length
    const callsFrom = callDecisions.length
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
        recordPosition(pos, logFrom, callsFrom)
        saveProgress(g)
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
    // Back at the live position of the human's game: it carries on by itself.
    if (game.value.humanSeat !== null && atLatest.value && !game.value.over && !introOpen.value && !playing.value && !reviewMode.value) {
        // At a hand's result the game waits for 「次の局へ」 as usual.
        if (game.value.phase === 'roundEnd') playing.value = true
        else play()
    }
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
    if (!game.value || e.target.closest?.('input, textarea, select, dialog')) return
    if (reviewMode.value) {
        if (e.key === 'ArrowLeft') { showReviewItem(reviewIndex.value - 1); e.preventDefault() }
        if (e.key === 'ArrowRight') { showReviewItem(reviewIndex.value + 1); e.preventDefault() }
        if (e.key === 'Escape') closeReview()
        return
    }
    // Playing yourself: the keys play the turn; earlier positions are seen in the review only.
    if (humanSeat.value !== null) {
        if (humanKey(e)) {
            kbUsed.value = true
            e.preventDefault()
        }
        return
    }
    if (playing.value) return
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

// The human's actions as plain data.
function applyAction(g, a) {
    if (a.t === 'discard') return g.humanDiscard(a.id, a.riichi)
    if (a.t === 'tsumo') return g.humanTsumo()
    if (a.t === 'kan') return g.humanKan(a.option)
    if (a.t === 'react') return g.humanReact(a.choice)
    if (a.t === 'kyuushu') return g.humanKyuushu()
    throw new Error(`unknown action ${a.t}`)
}

function humanAct(a) {
    if (!waitingHuman.value) return
    riichiMode.value = false
    const kanAdvice = turnOptions.value?.kanAdvice
    pendingKan = kanAdvice && ['kan', 'discard', 'tsumo'].includes(a.t) ? { advice: kanAdvice, chosen: a.t === 'kan' ? a.option : null, first: turnOptions.value.kans[0] } : null
    schedule(advanceEngine(g => applyAction(g, a)))
}

const humanSeat = computed(() => game.value?.humanSeat ?? null)
const turnOptions = computed(() => waitingHuman.value && game.value.prompt.kind === 'turn' ? game.value.humanTurnOptions() : null)
// The call the recommendation would make, matched on its tiles (several chi may be possible).
function isRecCall(c) {
    const a = reactPrompt.value?.advice
    if (!showHint.value || !a || a.action !== c.type) return false
    return !a.tiles || (a.tiles.length === c.tiles.length && a.tiles.every(id => c.tiles.includes(id)))
}
const reactPrompt = computed(() => waitingHuman.value && game.value.prompt.kind === 'react' ? game.value.prompt : null)
// The tile the human may call or win on: shown plainly (not greyed as ツモ切り) and lifted out in the river.
const callTargetId = computed(() => reactPrompt.value?.id ?? null)

// 鳴きなし: while on, chances to チー・ポン・カン are let go at once (ロン is still asked). Kept in this browser.
const noCalls = ref(readSetting('mahjong-nocall', 'off') === 'on')
watch(noCalls, on => saveSetting('mahjong-nocall', on ? 'on' : 'off'))
watch(reactPrompt, pr => {
    if (pr && noCalls.value && !pr.ron) nextTick(() => { if (reactPrompt.value === pr) humanAct({ t: 'react', choice: 'skip' }) })
})

/* キーボード: ←→ choose a tile (it rises) and Enter or Space discards it; ↑ goes to the buttons (ツモ・リーチ・
   カン…, or the calls when a tile can be called), ←→ move among them, Enter presses, ↓ back to the hand.
   Esc leaves the second step of a call. */
const kbArea = ref('hand') // 'hand' | 'actions'
const kbAction = ref(0)
const visibleSlots = computed(() => pickSlot.value ? [...pickSlot.value.options.map(o => ({ id: 'opt-' + o.key, press: o.act })), { id: 'back', press: () => { pickType.value = null } }]
    : actionSlots.value.filter(sl => sl.show).map(sl => ({ id: sl.id, press: () => pressSlot(sl) })))
// The keyboard's place is shown only once keys are in use (a mouse or a touch hides it again), so it is not
// mistaken for the recommendation's mark.
const kbUsed = ref(false)
const kbFocusId = computed(() => kbUsed.value && kbArea.value === 'actions' ? visibleSlots.value[kbAction.value]?.id ?? null : null)
watch(() => game.value?.prompt, pr => {
    // A call chance has nothing to discard: the keyboard starts on the buttons.
    kbArea.value = pr?.kind === 'react' ? 'actions' : 'hand'
    kbAction.value = 0
})

function humanKey(e) {
    if (!waitingHuman.value) return false
    const turn = turnOptions.value
    const slots = visibleSlots.value
    const move = (list, i, d) => list.length ? (i + d + list.length) % list.length : 0
    if (e.key === 'Escape' && pickType.value) { pickType.value = null; return true }
    if (kbArea.value === 'actions' || !turn) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { kbAction.value = move(slots, kbAction.value, e.key === 'ArrowLeft' ? -1 : 1); kbArea.value = 'actions'; return true }
        if (e.key === 'ArrowDown' && turn && !pickType.value) { kbArea.value = 'hand'; return true }
        if ((e.key === 'Enter' || e.key === ' ') && slots[kbAction.value]) {
            const press = slots[kbAction.value].press
            // After choosing riichi, the tile to cut is chosen in the hand.
            if (slots[kbAction.value].id === 'riichi') kbArea.value = 'hand'
            press()
            return true
        }
        return e.key === 'ArrowUp' || e.key === 'ArrowDown'
    }
    const pl = game.value.players[humanSeat.value]
    const { rest, draw } = handTiles(pl)
    const order = [...rest, ...(draw !== null ? [draw] : [])].filter(canDiscard)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = order.indexOf(picked.value)
        picked.value = order[i < 0 ? (e.key === 'ArrowLeft' ? order.length - 1 : 0) : move(order, i, e.key === 'ArrowLeft' ? -1 : 1)] ?? null
        return true
    }
    if (e.key === 'ArrowUp') {
        if (slots.length) { kbArea.value = 'actions'; kbAction.value = 0 }
        return true
    }
    if ((e.key === 'Enter' || e.key === ' ') && picked.value !== null && canDiscard(picked.value)) { discardTile(picked.value); return true }
    return e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' '
}
// The human's buttons in fixed places: チー・ポン・カン・リーチ・ツモ/ロン・スルー (ツモ切り in riichi, 九種九牌).
// A call with several ways (which tiles to chi with, a red five or not, which kan) asks which as a second step.
const pickType = ref(null)
const actionSlots = computed(() => {
    const t = turnOptions.value
    const r = reactPrompt.value
    const hint = showHint.value
    const callsOf = types => (r?.calls ?? []).map((c, i) => ({ c, i })).filter(({ c }) => types.includes(c.type))
        .map(({ c, i }) => ({ key: i, tiles: c.tiles, rec: isRecCall(c), act: () => humanAct({ t: 'react', choice: i }) }))
    const kans = [
        ...callsOf(['minkan']),
        ...(t?.kans ?? []).map(k => ({
            key: k.type + k.kind, kind: k.kind,
            rec: hint && t.recKan?.type === k.type && t.recKan?.kind === k.kind,
            act: () => humanAct({ t: 'kan', option: { type: k.type, kind: k.kind, tiles: [...k.tiles] } }),
        })),
    ]
    const slot = (id, label, options, extra = {}) => ({ id, label, options, show: options.length > 0, rec: options.some(o => o.rec), ...extra })
    const once = (rec, act) => [{ key: 0, rec, act }]
    const advice = r?.advice?.action
    return [
        slot('chi', 'チー', callsOf(['chi']), { rec: hint && advice === 'chi' }),
        slot('pon', 'ポン', callsOf(['pon']), { rec: hint && advice === 'pon' }),
        slot('kan', 'カン', kans),
        slot('riichi', 'リーチ', canDeclareRiichi.value ? once(hint && !riichiMode.value && t.hint.recommendation.riichi, () => { riichiMode.value = !riichiMode.value }) : [],
            { active: riichiMode.value }),
        slot('win', r?.ron ? 'ロン' : 'ツモ', t?.canTsumo ? once(hint, () => humanAct({ t: 'tsumo' })) : r?.ron ? once(hint, () => humanAct({ t: 'react', choice: 'ron' })) : []),
        r
            ? slot('pass', r.ron ? '見逃す' : 'スルー', once(hint && !r.ron && advice === 'skip', () => humanAct({ t: 'react', choice: 'skip' })))
            // 九種九牌 is so rare it has no place of its own: it comes only at the first draw, where this
            // last place (ツモ切り in riichi) is never used.
            : t?.kyuushu
                ? slot('pass', '九種九牌', once(hint && t.kyuushu.abort, () => humanAct({ t: 'kyuushu' })))
                : slot('pass', 'ツモ切り', t?.riichiLocked ? once(false, () => discardTile(game.value.players[humanSeat.value].lastDraw)) : []),
    ]
})
const pickSlot = computed(() => actionSlots.value.find(s => s.id === pickType.value && s.options.length > 1) ?? null)
watch(pickType, () => { kbAction.value = 0 })
// Letting a win go (見逃す, or ツモ切り of a winning tile) is rarely meant and its button sits next to the
// win's: the first press only asks again (「本当？」), the second does it; it goes back after 3 seconds.
const passArmed = ref(false)
let passTimer = null
const winLetGo = slot => slot.id === 'pass' && (!!reactPrompt.value?.ron || !!turnOptions.value?.canTsumo)
function pressSlot(slot) {
    if (!slot.show) return
    if (winLetGo(slot) && !passArmed.value) {
        passArmed.value = true
        clearTimeout(passTimer)
        passTimer = setTimeout(() => { passArmed.value = false }, 3000)
        return
    }
    passArmed.value = false
    if (slot.options.length > 1) pickType.value = slot.id
    else slot.options[0].act()
}
watch(() => game.value?.prompt, () => { passArmed.value = false })

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
const notePointer = e => {
    lastPointer = e.pointerType || 'mouse'
    kbUsed.value = false
    wakeAudio()
}
// Safari still zooms on a double tap on plain text (a result card, a dialog) despite touch-action. A second
// tap soon after the first, at the same spot, on anything that is not a control is kept from zooming; taps on buttons, tiles
// and links pass untouched (a tile is tapped twice to discard it), and pinch zoom is not affected.
// Only a second tap close to the first counts (that is what zooms); a quick tap elsewhere is a tap.
let lastTouch = { t: -1e9, x: 0, y: 0 }
const noDoubleTapZoom = e => {
    if (e.touches.length || e.changedTouches.length !== 1) return
    const { clientX: x, clientY: y } = e.changedTouches[0]
    const double = e.timeStamp - lastTouch.t < 350 && Math.hypot(x - lastTouch.x, y - lastTouch.y) < 40
    lastTouch = { t: e.timeStamp, x, y }
    if (!double) return
    if (e.target.closest?.('button, a, input, select, textarea, label, summary, [role="button"], [role="switch"], .tile')) return
    e.preventDefault()
}
onMounted(() => {
    window.addEventListener('pointerdown', notePointer, true)
    document.addEventListener('touchend', noDoubleTapZoom, { passive: false })
    // iPhone lets sound start again only from some kinds of taps (the end of a touch, a click).
    window.addEventListener('touchend', wakeAudio, true)
    window.addEventListener('click', wakeAudio, true)
})
onBeforeUnmount(() => {
    window.removeEventListener('pointerdown', notePointer, true)
    document.removeEventListener('touchend', noDoubleTapZoom)
    window.removeEventListener('touchend', wakeAudio, true)
    window.removeEventListener('click', wakeAudio, true)
})

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
    humanAct({ t: 'discard', id, riichi })
}

function hoverTile(pl, id, e) {
    if (e.pointerType === 'mouse' && pl.seat === humanSeat.value) hovered.value = id
}
// A new decision (or going back in the record) starts without a picked tile.
watch(() => game.value?.prompt, () => { picked.value = null; hovered.value = null; pickType.value = null })
watch(riichiMode, () => { if (picked.value !== null && !canDiscard(picked.value)) picked.value = null })
// The tile shown in the candidates: the picked one, else the one under the mouse.
const focusKey = computed(() => {
    const id = picked.value ?? hovered.value
    return id !== null && turnOptions.value && canDiscard(id) ? tileKey(id) : null
})

const canDeclareRiichi = computed(() => {
    const o = turnOptions.value
    return !!o && !o.riichiLocked && o.hint?.canRiichi && o.hint.tenpaiKinds.length > 0
})

// The recommended tile in the hand of the player to move.
const hintTile = computed(() => {
    if (reviewMode.value) return reviewRecTile.value
    const hint = live.value?.hint
    if (!hint) return null
    // When the recommendation throws the hand in (九種九牌), only that button is marked.
    if (turnOptions.value?.kyuushu?.abort) return null
    const pl = game.value.players[live.value.player]
    // The recommendation names the very tile (a red five and a normal five are different choices).
    return pl.hand.includes(hint.recommendation.id) ? hint.recommendation.id : null
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

// Playing yourself, other hands and CPU analyses are seen only in the review (the hand reviewed is
// over), or at a hand's end. On the square table they open with the result: the face-down tiles are
// already in place, so nothing moves. In the list of panels a hand only opens after 「卓を見る」, as
// opening it there pushes the panels around without the player asking.
const hidden = computed(() => humanSeat.value !== null && !reviewMode.value
    && !(game.value?.phase !== 'play' && (square.value || !resultOpen.value)))
// Dora in a hand or a call get the same mark, a red five or not.
const doraKinds = computed(() => new Set((game.value?.doraIndicators ?? []).map(id => doraOf(kindOf(id)))))
const isDora = id => id != null && (isRed(id) || doraKinds.value.has(kindOf(id)))

// In the review the other hands are closed unless the player opens them (kept in this browser): the
// review is first about one's own choices, and the hands are there to check when wanted.
const reviewHands = ref(readSetting('mahjong-review-hands', 'off') === 'on')
watch(reviewHands, on => saveSetting('mahjong-review-hands', on ? 'on' : 'off'))
// Whether other players' hands (and what they read: waits, plans) are open now.
const othersOpen = computed(() => !hidden.value && !(reviewMode.value && humanSeat.value !== null && !reviewHands.value))
function showHand(pl) {
    return othersOpen.value || pl.seat === humanSeat.value
}
// Analyses show only in 解析モード (the review shows the human's anyway); while playing, only the human's.
const showsAnalysis = e => !!e.analysis && showHint.value && (!hidden.value || e.player === humanSeat.value)

// While the human plays, the other players' draws stay secret in the 牌譜 too.
function kifuText(e) {
    if (e.type === 'start') return `― ${e.text} ―`
    if (hidden.value && e.player !== humanSeat.value) return e.text.replace(/ツモ[^ ]+ → /, '')
    if (callDiffers(e)) return `${e.text}（推奨は${adviceName(e.call.advice)}）`
    return e.text
}

const adviceName = advice => advice.action === 'skip' ? 'スルー' : CALL_NAME[advice.action]
// The call advice of an entry may be shown (CPU calls stay private while the human plays).
const showsCall = e => !!e.call?.advice && showHint.value && (!hidden.value || e.player === humanSeat.value)
const callDiffers = e => e.type === 'call' && showsCall(e) && e.call.advice.action !== e.call.type
// Call chances around a discard that may be shown.
const visibleChances = e => (e.callChances ?? []).filter(c => showHint.value && (!hidden.value || c.player === humanSeat.value))
// 牌譜 lines: a let-go call of a CPU stays private while the human plays.
const kifuLines = computed(() => {
    void log.value.length
    return log.value.filter(e => e.type !== 'callcheck' || (showHint.value && (!hidden.value || e.player === humanSeat.value)))
})

function playerName(p) {
    return displayName(game.value.seats[p], game.value.levels[p])
}
const seatStars = p => game.value.seats[p] === HUMAN ? '' : '★'.repeat(LEVELS[game.value.levels[p]].stars)

// 名前を押すと出る紹介: strength, style and this game's record against the human.
const profileDialog = ref(null)
const profileSeat = ref(null)
function openProfile(p) {
    if (game.value.seats[p] === HUMAN) return
    profileSeat.value = p
    profileDialog.value.showModal()
}
const profile = computed(() => {
    const p = profileSeat.value
    const g = game.value
    if (p === null || !g) return null
    const h = humanSeat.value
    const hist = g.history ?? []
    const wins = hist.filter(x => x.kind === 'win' && x.winner === p)
    return {
        name: playerName(p), stars: seatStars(p), level: LEVELS[g.levels[p]].label, color: personOf(p).color,
        intro: PERSONALITIES[g.seats[p]].intro,
        wins: wins.length,
        fromYou: h === null ? null : wins.filter(x => x.loser === h).length,
        toYou: h === null ? null : hist.filter(x => x.kind === 'win' && x.winner === h && x.loser === p).length,
        dealIns: hist.filter(x => x.kind === 'win' && x.loser === p).length,
    }
})

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
const AIM_ROWS = 7
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
    if (entry) {
        entry.snap = structuredClone(g)
        recordPosition(cursor.value)
    }
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
    // Paused on a discard someone is about to call: its recommendation, if shown; the call is on the next step.
    if (g.pendingCall) {
        const c = g.pendingCall
        const advice = !showHint.value || (hidden.value && c.player !== humanSeat.value) ? null : c.advice
        return { player: c.player, name: playerName(c.player), color: personOf(c.player).color, drawn: null, hint: null,
            calling: `${playerName(c.from)}の${kindName(kindOf(c.id))}を${CALL_NAME[c.type]}します`,
            advice, agrees: advice?.action === c.type }
    }
    if (!g.awaitingDiscard) return null
    const p = g.turn
    const pl = g.players[p]
    const base = { player: p, name: playerName(p), color: personOf(p).color, drawn: pl.lastDraw, riichi: pl.riichi }
    if (hidden.value && p !== humanSeat.value) return { ...base, hint: null, secret: true }
    if (pl.riichi || !showHint.value) return { ...base, hint: null }
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
    return `${tile}：推奨は${tileName(e.analysis.recommendation.id)}`
}

// The 直前 line folds open like the 牌譜 and stays open from move to move.
const lastOpen = ref(false)

// A discard opened from the 牌譜; shown while its position is on screen.
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
const roundOf = e => `${e.roundName}${e.honba ? ` ${e.honba}本場` : ''}`
// loss: tiles of acceptance given up (a step back in shanten is about 80).
const lossSize = loss => loss >= 20 ? '大' : loss >= 5 ? '中' : '小'

// 放銃 judged from what could be seen at the time and, afterwards, the winner's waits:
// 事故 (no one to be wary of), 押しの範囲 (the recommendation would have pushed as well, or its tile
// dealt in too), 避けられた (the recommendation was a safer tile that was not a winning tile).
function judgeDealIn(discard, win) {
    const r = win.result
    const waits = waitingKinds(countKinds(r.hand), r.melds.length)
    const a = discard?.analysis
    if (!discard || discard.type !== 'discard') return { verdict: '事故', note: '槍槓（加槓した牌でのロン）' }
    if (!a) return { verdict: '押しの範囲', note: 'リーチ後の放銃（リーチした時点で押すと決めている）' }
    const rec = a.recommendation.kind
    if (!a.threats.length) return { verdict: '事故', note: '警戒すべき相手がいなかった（ダマや気配のない手）' }
    if (a.choice.same) return { verdict: '押しの範囲', note: `推奨も同じ牌で押していた（警戒：${a.threats.map(t => t.text).join('、')}）` }
    if (waits.includes(rec)) return { verdict: '押しの範囲', note: `推奨の${kindName(rec)}でも当たっていた` }
    return { verdict: '避けられた', note: `推奨は${kindName(rec)}（${a.recommendation.text}）` }
}

// Every decision the human made, in order: discards (with the riichi choice) and call chances.
// Each is shown at the position just before it (timeline pos − 1), with a mark: 一致, ずれ小・中・大
// (how far below the recommendation), リーチ (only the riichi choice differed) or 鳴き (a call or pass
// against the advice). A deal-in is attached to the discard that caused it.
const allReviewItems = computed(() => {
    void log.value.length
    const h = humanSeat.value
    if (h === null) return []
    const items = []
    const byEntry = new Map()
    let lastDiscard = null
    for (const e of log.value) {
        const round = roundOf(e)
        if (e.player === h && e.type === 'discard') {
            lastDiscard = e
            if (e.analysis) {
                const c = e.analysis.choice
                const mark = c.same ? (c.riichiDiffers ? 'リーチ' : '一致') : `ずれ${lossSize(c.loss)}`
                const item = { kind: 'discard', pos: e.pos, round, entry: e, mark, agreed: c.same && !c.riichiDiffers, dealIn: null }
                items.push(item)
                byEntry.set(e, item)
            }
        }
        if (e.type === 'win' && e.result?.loser === h) {
            const dealIn = { ...judgeDealIn(lastDiscard, e), points: e.result.result.points, winner: playerName(e.player) }
            const item = byEntry.get(lastDiscard)
            // A deal-in after riichi (no choice left) or on a robbed kan still gets its own line.
            if (item) item.dealIn = dealIn
            else items.push({ kind: 'dealIn', pos: (lastDiscard ?? e).pos, round, entry: lastDiscard ?? e, mark: '放銃', agreed: null, dealIn })
        }
    }
    for (const c of callDecisions) {
        items.push({ kind: 'call', pos: c.pos, round: c.round, mark: c.agreed ? '一致' : c.self ? 'カン' : '鳴き', agreed: c.agreed, call: c, dealIn: null })
    }
    return items.sort((a, b) => a.pos - b.pos)
})

// While the game goes on, a review covers only the hand just finished; once it is over, the whole game.
const reviewScope = ref(null)
const reviewItems = computed(() => reviewScope.value
    ? allReviewItems.value.filter(it => it.round === reviewScope.value)
    : allReviewItems.value)

// Hands whose decisions were lost when the game was resumed after a reload (only the position is saved):
// those finished before it, and the one under way (partly lost).
const lostRounds = ref({ names: [], partial: null })

const reviewSummary = computed(() => {
    const items = reviewItems.value
    const decisions = items.filter(it => it.agreed !== null)
    const dealIns = items.filter(it => it.dealIn).map(it => it.dealIn)
    const rounds = []
    // In the review of the whole game, the hands lost to a resume are listed too, saying so.
    if (!reviewScope.value) {
        for (const name of lostRounds.value.names) rounds.push({ name, decisions: 0, agreed: 0, dealIn: false, lost: true })
        const partial = lostRounds.value.partial
        if (partial && !lostRounds.value.names.includes(partial) && !items.some(it => it.round === partial)) {
            rounds.push({ name: partial, decisions: 0, agreed: 0, dealIn: false, lost: true })
        }
    }
    for (const it of items) {
        let r = rounds.at(-1)
        if (r?.name !== it.round) rounds.push(r = { name: it.round, decisions: 0, agreed: 0, dealIn: false, partial: it.round === lostRounds.value.partial })
        if (it.agreed !== null) r.decisions++
        if (it.agreed) r.agreed++
        if (it.dealIn) r.dealIn = true
    }
    return {
        decisions: decisions.length,
        agreed: decisions.filter(it => it.agreed).length,
        dealIns: dealIns.length,
        verdicts: ['避けられた', '押しの範囲', '事故'].map(v => `${v}${dealIns.filter(d => d.verdict === v).length}`).join('・'),
        rounds,
    }
})

// The review takes over the table: one decision at a time, the rest of the game paused.
const reviewMode = ref(false)
const reviewIndex = ref(0)
const reviewItem = computed(() => reviewMode.value ? reviewItems.value[reviewIndex.value] ?? null : null)

// The positions the review may move through: the hand reviewed (or the whole game once it is over).
const snapRound = snap => roundOf({ roundName: `${WIND_NAME[Math.floor(snap.roundIndex / 4)]}${snap.roundIndex % 4 + 1}局`, honba: snap.honba })
const reviewRange = computed(() => {
    const all = timeline.value
    if (!reviewScope.value) return [0, all.length - 1]
    const inside = all.map((e, i) => snapRound(e.snap) === reviewScope.value ? i : -1).filter(i => i >= 0)
    return inside.length ? [inside[0], inside.at(-1)] : [0, all.length - 1]
})
// The board shows the position just before the current decision; 一手前・一手先 move from there through
// everyone's moves, and the decision shown follows (the last one at or before the board).
const reviewOnDecision = computed(() => !!reviewItem.value && cursor.value === Math.max(0, reviewItem.value.pos - 1))
function stepReview(d) {
    const [lo, hi] = reviewRange.value
    const i = cursor.value + d
    if (i < lo || i > hi) return
    goTo(i)
    let k = 0
    reviewItems.value.forEach((it, j) => { if (Math.max(0, it.pos - 1) <= i) k = j })
    reviewIndex.value = k
}

function showReviewItem(i) {
    const item = reviewItems.value[i]
    if (!item) return
    reviewIndex.value = i
    goTo(Math.max(0, item.pos - 1))
    // Keep the current decision in view in the (scrolling) list, without moving the page.
    nextTick(() => {
        const list = document.querySelector('.review-timeline')
        const cur = list?.querySelector('.current')
        if (list && cur) list.scrollTop = cur.offsetTop - list.clientHeight / 2
    })
}

// round: the hand to review (required while the game goes on); once it is over, where to start.
function openReview(round = null) {
    reviewScope.value = game.value?.over ? null : round
    // After a resume a whole-game review opens even with nothing left to show, to say why.
    if (!reviewItems.value.length && !(game.value?.over && lostRounds.value.names.length)) return
    stop()
    reviewMode.value = true
    detailEntry.value = null
    const i = round ? reviewItems.value.findIndex(it => it.round === round) : 0
    showReviewItem(Math.max(0, i))
}
// Whether there is a review of the whole game to offer (decisions, or hands lost to a resume).
const canReviewGame = computed(() => allReviewItems.value.length > 0 || lostRounds.value.names.length > 0)

function closeReview() {
    reviewMode.value = false
    // Back to the live position (the game carries on by itself if it is not over).
    goTo(timeline.value.length - 1)
    // On a narrow screen the review sat below the table: come back up to the table, not to an emptied page.
    if (!window.matchMedia?.('(max-width: 980px)').matches) return
    nextTick(() => document.querySelector('.table')?.scrollIntoView({ block: 'start' }))
}

// What the human did and what was recommended, for the current item.
const reviewNow = computed(() => {
    const it = reviewItem.value
    const g = game.value
    if (!it || !g) return null
    const h = humanSeat.value
    const turn = `${g.players[h].river.length + 1}巡目`
    if (it.kind === 'call' && it.call.self) {
        const c = it.call
        const say = action => action === 'skip' ? 'カンしない' : CALL_NAME[action]
        return { turn, self: true, tile: c.tile, chose: say(c.choice), advised: say(c.advice.action), reason: c.advice.text }
    }
    if (it.kind === 'call') {
        const c = it.call
        const from = g.lastDiscard ? playerName(g.lastDiscard.player) : ''
        const tile = c.tile ?? g.lastDiscard?.id ?? null
        return { turn, from, tile, chose: c.choice === 'skip' ? 'スルー' : CALL_NAME[c.choice], advised: adviceName(c.advice), reason: c.advice.text }
    }
    return { turn }
})

// In the review the hand shows the recommended tile (green) and the one played (orange).
const reviewRecTile = computed(() => {
    const it = reviewItem.value
    if (it?.kind !== 'discard' || !reviewOnDecision.value) return null
    const hand = game.value.players[humanSeat.value].hand
    const id = it.entry.analysis.recommendation.id
    return hand.includes(id) ? id : null
})
const reviewChosenTile = computed(() => reviewOnDecision.value && (reviewItem.value?.kind === 'discard' || reviewItem.value?.kind === 'dealIn') ? reviewItem.value.entry.tile : null)

const markClass = mark => mark === '一致' ? 'ok' : mark === 'ずれ大' || mark === '放銃' ? 'big' : mark === 'ずれ中' ? 'mid' : 'small'

// Waits of everyone in tenpai (not the player to move), with the tiles still unseen by anyone.
const waitsBySeat = computed(() => {
    const g = game.value
    if (!g?.players.length || g.phase !== 'play') return {}
    // Playing, the human's own count uses only what the human can see (as on a real table).
    const viewer = hidden.value ? humanSeat.value : null
    const out = {}
    g.players.forEach((pl, p) => {
        if (!othersOpen.value && p !== humanSeat.value) return
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
// The 牌譜 folds away like the 直前 line; it is open only when wanted.
const logOpen = ref(false)
watch([currentEntryId, logOpen], async () => {
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
// The 役満 tab shows the records instead of a table; the table stays on the last length.
const totals = computed(() => allTotals[statsLength.value] ?? {})
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

// Everything at once: both lengths and the yakuman record.
function resetTotals() {
    if (!confirm('半荘戦・東風戦の戦績と役満の記録をすべて消します。よろしいですか？')) return
    allTotals.hanchan = {}
    allTotals.tonpu = {}
    yakumanRecords.value = []
    saveSetting(YAKUMAN_KEY, '[]')
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
            hands: 0, wins: 0, winPoints: 0, dealIns: 0, riichi: 0, calledHands: 0, discards: 0, agreed: 0, decisions: 0, decisionsAgreed: 0,
        }
        const t = totals[key]
        const s = g.stats[p]
        const rank = g.finalRanking.indexOf(p) + 1
        t.games++
        t.rankSum += rank
        if (rank === 1) t.top++
        if (rank === 4) t.last++
        t.scoreSum += g.scores[p]
        for (const k of ['hands', 'wins', 'winPoints', 'dealIns', 'riichi', 'calledHands', 'discards', 'agreed', 'decisions', 'decisionsAgreed']) t[k] = (t[k] ?? 0) + (s[k] ?? 0)
    })
}

const ORDER = [...CPU_IDS, HUMAN]
const ratio = (a, b) => b ? a / b : null
// Discards and call chances that followed the recommendation; records kept before calls were
// counted fall back to discards only.
const decisionRate = t => t.decisions ? t.decisionsAgreed / t.decisions : ratio(t.agreed, t.discards)
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
    { key: 'agree', label: '一致率', value: t => decisionRate(t) },
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
// Every player always has a row (you and the 20 CPUs at their own level), all zeros until played,
// so the table keeps its size; rows for other levels (older records) are added below them.
const emptyTotals = (id, level) => ({
    id, level, games: 0, rankSum: 0, top: 0, last: 0, scoreSum: 0,
    hands: 0, wins: 0, winPoints: 0, dealIns: 0, riichi: 0, calledHands: 0, discards: 0, agreed: 0, decisions: 0, decisionsAgreed: 0,
})
const statRows = computed(() => {
    const all = { ...totals.value }
    for (const [id, level] of [[HUMAN, 'advanced'], ...CPU_IDS.map(id => [id, levelOf(id)])]) {
        all[statKey(id, level)] ??= emptyTotals(id, level)
    }
    const rows = Object.values(all).sort(rosterOrder)
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
        while (!g.over) {
            const e = g.step()
            if (e?.type === 'win' && e.result.result.yakuman) recordYakuman(e, g, true)
        }
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
        <header class="appbar">
            <h1>雀風帖</h1>
            <nav class="appbar-tools" aria-label="メニュー">
                <button type="button" class="manual-button" @click="manualDialog.showModal()">説明書</button>
                <button type="button" class="manual-button" @click="openStats">戦績</button>
                <button type="button" class="manual-button analysis-switch" :class="{ on: showHint }" role="switch"
                    :aria-checked="showHint" @click="showHint = !showHint">
                    解析<span class="knob" aria-hidden="true" /><small>{{ showHint ? 'ON' : 'OFF' }}</small>
                </button>
                <button type="button" class="manual-button" aria-label="設定" @click="settingsDialog.showModal()">設定</button>
            </nav>
            <!-- Before the first game the big button on the table is the only one. -->
            <button v-if="game && game.players.length" class="new-game" type="button" @click="openMembers">新しい対局</button>
        </header>

        <dialog ref="settingsDialog" class="profile-dialog settings-dialog" aria-labelledby="settings-title" @pointerdown="notePress" @click="closeOutside">
            <div class="dialog-head">
                <h2 id="settings-title">設定</h2>
                <button type="button" class="close" aria-label="閉じる" @click="settingsDialog.close()">×</button>
            </div>
            <div class="setting-row">
                <span>CPUの打つ速さ</span>
                <div class="speed" role="radiogroup" aria-label="CPUの打つ速さ">
                    <button v-for="sp in SPEEDS" :key="sp.id" type="button" role="radio" :aria-checked="speed === sp.id"
                        :class="{ active: speed === sp.id }" @click="speed = sp.id">{{ sp.label }}</button>
                </div>
            </div>
            <div class="setting-row">
                <span>効果音</span>
                <button type="button" class="manual-button sound-button" :class="{ off: !soundOn }" :aria-pressed="soundOn" @click="toggleSound">
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
            <p class="muted">設定はこのブラウザに保存されます。</p>
        </dialog>

        <dialog ref="profileDialog" class="profile-dialog" aria-labelledby="profile-title" @pointerdown="notePress" @click="closeOutside">
            <template v-if="profile">
                <div class="dialog-head">
                    <h2 id="profile-title" :style="{ '--person': profile.color }"><span class="dot" :style="{ background: profile.color }" />{{ profile.name }}<span class="char-stars">{{ profile.stars }}</span><small class="muted">{{ profile.level }}</small></h2>
                    <button type="button" class="close" aria-label="閉じる" @click="profileDialog.close()">×</button>
                </div>
                <p>{{ profile.intro }}</p>
                <p class="muted profile-record">
                    この対局：アガリ{{ profile.wins }}回<template v-if="profile.fromYou !== null">（うちあなたから{{ profile.fromYou }}回）・あなたへの放銃{{ profile.toYou }}回</template><template v-else>・放銃{{ profile.dealIns }}回</template>
                </p>
            </template>
        </dialog>

        <dialog ref="statsDialog" class="stats-dialog" aria-labelledby="stats-title" @pointerdown="notePress" @click="closeOutside">
          <section class="stats">
            <div class="stats-head">
                <div class="dialog-head">
                    <h2 id="stats-title">戦績 <span class="muted">（{{ statsLength === 'yakuman' ? `役満${yakumanRecords.length}回` : `${totalGames}戦` }}）</span></h2>
                    <button type="button" class="close" aria-label="閉じる" @click="statsDialog.close()">×</button>
                </div>
                <!-- Results by length, and apart from them the record of yakuman (a different kind of list). -->
                <div class="stats-tabs" role="radiogroup" aria-label="表示する記録">
                    <div class="mode">
                        <button v-for="(label, key) in LENGTHS" :key="key" type="button" role="radio" :aria-checked="statsLength === key"
                            :class="{ active: statsLength === key }" :disabled="batchLeft > 0" @click="statsLength = key">{{ label }}</button>
                    </div>
                    <div class="mode">
                        <button type="button" role="radio" :aria-checked="statsLength === 'yakuman'" :class="{ active: statsLength === 'yakuman' }"
                            :disabled="batchLeft > 0" @click="statsLength = 'yakuman'">役満の記録</button>
                    </div>
                </div>
                <div v-if="devTools && statsLength !== 'yakuman'" class="batch">
                    <button type="button" :disabled="batchLeft > 0" @click="runBatch(100)">CPUだけで100戦</button>
                    <button type="button" :disabled="batchLeft > 0" @click="runBatch(500)">500戦</button>
                    <span v-if="batchLeft > 0" class="muted">対局中… {{ batchDone }} / {{ batchDone + batchLeft }}</span>
                </div>
            </div>
            <!-- A fixed size: the table or the list scrolls inside, so nothing jumps between tabs. -->
            <div class="stats-body">
            <div v-if="statsLength !== 'yakuman'" class="table-scroll">
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
                            <td>{{ decisionRate(t) === null ? '—' : (100 * decisionRate(t)).toFixed(1) + '%' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <section v-else class="yakuman-records">
                <p v-if="!yakumanRecords.length" class="muted">まだありません。誰かが役満をアガるとここに残ります。</p>
                <ol v-if="yakumanRecords.length">
                    <li v-for="r in yakumanRecords" :key="r.at" :class="{ you: r.you }">
                        <span class="muted">{{ recordDate(r.at) }}</span>
                        <strong>{{ r.name }}</strong>
                        <span class="yakuman-names">{{ r.yaku.join('・') }}</span>
                        <span>{{ r.points.toLocaleString() }}点 {{ r.how }}</span>
                        <span class="muted">{{ r.round }}</span>
                        <span v-if="r.batch" class="batch-tag">CPU一括</span>
                        <div v-if="r.hand" class="win-hand record-hand">
                            <MahjongTile v-for="id in r.hand" :key="id" :id="id" size="xs" />
                            <span class="draw-gap"><MahjongTile :id="r.tile" size="xs" mark /></span>
                            <span v-for="(meld, i) in r.melds" :key="i" class="meld">
                                <span v-for="t in meldTiles(meld, r.seat)" :key="t.id" class="meld-slot">
                                    <MahjongTile v-if="t.added != null" :id="t.added" size="xs" sideways />
                                    <MahjongTile :id="t.id" size="xs" :sideways="t.sideways" :back="t.back" />
                                </span>
                            </span>
                        </div>
                    </li>
                </ol>
            </section>
            </div>
            <div class="dialog-actions">
                <button type="button" class="reset" :disabled="batchLeft > 0" @click="resetTotals">リセット</button>
            </div>
          </section>
        </dialog>

        <dialog ref="manualDialog" class="manual-dialog" aria-labelledby="manual-title" @pointerdown="notePress" @click="closeOutside">
            <div class="dialog-head">
                <h2 id="manual-title">説明書</h2>
                <button type="button" class="close" aria-label="閉じる" @click="manualDialog.close()">×</button>
            </div>
            <section>
                <h3>このアプリについて</h3>
                <p>雀風帖（じゃんぷうちょう）はブラウザで遊べる麻雀アプリです。主な特徴は以下の通りです。</p>
                <ul>
                    <li><strong>打ち筋の違う20人</strong>：速攻派、染め手好き、面前を貫く人、守りの堅い人。強さだけでなく打ち方そのものが違う相手と打てます。</li>
                    <li><strong>一打ごとに理由が見える</strong>：解析をONにすると、おすすめの打牌とその理由（受け入れ枚数・危険度・狙える役と見込み打点）が手番ごとに出ます。自分の一打とおすすめの差もその場で分かります。</li>
                    <li><strong>打ち終わったら振り返り</strong>：自分の判断を一手ずつ見返せます。放銃した一打は、避けられたのか押してよかったのかまで判定します。</li>
                    <li><strong>観戦も楽しい</strong>：CPU4人の対局を眺めながら、それぞれがなぜその牌を切ったのかを読めます。</li>
                </ul>
            </section>
            <section>
                <h3>始め方</h3>
                <ul>
                    <li>「新しい対局」を押し、「麻雀に慣れたい」「本気で腕試し」などやりたいことを選ぶと、それに合った強さ（★）の相手とすぐ始まります。「自分も打つ」か観戦か、半荘戦（東南の8局）か東風戦（東の4局）もここで選びます。</li>
                    <li>「相手を自分で選ぶ」のタブでは20人から選べます（自分も打つなら3人、観戦なら4人）。2回目からは「前回と同じ面子で始める」も使えます。</li>
                    <li>始める前に対局者の紹介が出ます。対局中も名前を押すと、強さ・打ち筋・この対局での成績を見られます。</li>
                    <li>席順はランダムです。「自分も打つ」ではあなたが一番下の席になり、他の人の手牌・待ち・推奨は局が終わるまで見えません。局が終わると、広い画面の卓では全員の手牌が開きます（縦に並ぶ画面では結果の「卓を見る」で開きます）。</li>
                </ul>
            </section>
            <section>
                <h3>操作</h3>
                <ul>
                    <li>自分も打つときは対局が自動で進み、自分の番で止まります。CPUの打つ速さはタイトル横の「設定」で変えられます。</li>
                    <li>観戦では牌譜の行を押す（または←キー）と過去の局面を見返せます。自分も打つときに過去の局面を見るのは、振り返りの中で行います。</li>
                    <li>観戦では「自動再生」で進み、「1手進む」で打牌と次の人のツモまで進みます。←→キーでも1手ずつ動けます。</li>
                    <li>「局の最初へ」は局の途中なら局の頭へ、局の頭なら前の局へ戻ります。戻ってから進めても同じ展開になります。</li>
                    <li>牌譜の行を押すと、その局面に移ってその打牌の解説が開きます。</li>
                    <li>自分が打つときは、マウスなら牌をクリックして切ります。指で操作するときは、1回タップすると牌が浮き、同じ牌をもう一度タップすると切ります。ツモ・リーチ・カン・ロン・ポン・チーと九種九牌で流すのはボタンで選びます。</li>
                    <li>パソコンではキーボードでも打てます。←→で牌を選び、EnterかSpaceで切ります。↑でツモ・リーチ・カンなどのボタンに移り、←→で選んでEnter、↓で手牌に戻ります。鳴ける場面ではボタンから始まります。</li>
                    <li>手牌の上の「鳴きなし」をONにすると、チー・ポン・カンを聞かずに自動でスルーします（ロンは聞きます）。</li>
                    <li>効果音（はじめは音なし）とCPUの打つ速さ（はじめは「速い」）は「設定」で切り替えられます。設定はこのブラウザに保存されます。</li>
                    <li>対局の途中でページを閉じても、次に開いたときに「前回の対局の続きから」で再開できます。それまでの牌譜と振り返りもそのまま続きます。新しい対局を始めると、前の対局の記録は消えます。</li>
                    <li>はじめは解析モードがONで、手番ごとの推奨（打牌・受け入れ・危険度）、狙い役、鳴き・リーチ・カンの推奨、観戦ではCPUの選択との比較が出ます。推奨なしで打ちたいときは、タイトル横の「解析」をOFFにしてください。OFFでも、自分が打った対局の「振り返り」は見られます。</li>
                </ul>
            </section>
            <section>
                <h3>画面の見方</h3>
                <ul>
                    <li>右上は今の手番の人への推奨です。手牌の緑の枠が推奨の牌、オレンジの枠がツモった牌です。手牌や鳴いた牌のドラ（赤ドラを含む）は、ときどき光が走ります。</li>
                    <li>河の暗い牌はツモ切り、薄い牌は鳴かれた牌です。</li>
                    <li>テンパイしている人の欄には待ちと残り枚数が出ます。黄色の印はフリテンと、鳴いて役がない状態です。</li>
                </ul>
            </section>
            <section>
                <h3>推奨について</h3>
                <ul>
                    <li>推奨は、役の方針・牌効率・テンパイ時の打点・リーチや鳴いた相手への安全度から判断した一つの意見です。正解ではなく、比べるための物差しです。</li>
                    <li>解析モードでは右の「狙い役」で役を選ぶと、打牌・リーチ・鳴きの推奨がその役に向けたものに変わります。局が変わるとおまかせに戻ります。</li>
                    <li>テンパイ時の打点は、ロン（フリテンのときはツモ）・裏ドラなしで計算し、面前の手はリーチをかけたものとしています。</li>
                    <li>危険度は「現物」「スジ」「無スジの中張牌」のように、その牌の安全さの目安を言葉で示します。鳴いた人やリーチの人のテンパイの気配も「テンパイは五分」「テンパイが濃い」のように言葉で示します。</li>
                </ul>
            </section>
            <section>
                <h3>強さ（★）の違い</h3>
                <ul>
                    <li>同じくらい良い牌がいくつかあるときは、その時々でどれかを選びます。強い人ほど個性は控えめで、弱い人ほど強く出ます。鳴くのは得になるときだけです（リン・ハジメは鳴きません）。</li>
                    <li><strong>★4</strong>：上級者。迷わずいちばん効率のいい牌を選びます。壁やノーチャンスまで使って危ない牌を見分け、鳴いた人の手やツモ切りも読みます。三色・一通・チャンタなどの手役も見て方針を立て、フリテンも避けます。</li>
                    <li><strong>★3</strong>：中級者。ときどき少しだけ損な牌を選びます。スジや字牌は気にしますが壁までは見ません。鳴いた人は3副露のように見るからに危ないときだけ警戒します。</li>
                    <li><strong>★2</strong>：ひととおり打てるようになった人。浮いた牌のどれから切るか、どの塔子を外すかでよく迷い、少し損な方を選びがちです。安全なのは現物だけと考え、降りは中途半端です。三色・一通・チャンタには気づかず、テンパイは待ちの広さだけで取ります。リーチは基本かけます（ダマで満貫あるときだけ黙ります）。好きな役に寄りがちです。</li>
                    <li><strong>★1</strong>：覚えたての人。降りません。くっついた複雑な形を読み違え、浮いた牌があるのに形のできている牌を切ることもあります。役があればすぐ鳴き、テンパイしたらすぐリーチします。フリテンにも気づきません。好きな役はどんなに遠くても狙います。</li>
                </ul>
            </section>
            <section>
                <h3>戦績</h3>
                <ul>
                    <li>タイトル横の「戦績」で開きます。最後まで打った対局を打ち手ごとに合計し、このブラウザに保存します。半荘戦と東風戦は別々に記録し、上のボタンで切り替えます。「リセット」で半荘戦・東風戦の戦績と役満の記録をまとめて消せます。誰か（自分を含む）が役満をアガると、戦績の「役満の記録」のタブに日付・名前・役とともに残ります。見出しを押すと並べ替わります（もう一度押すと逆順、「打ち手」で元の並び）。</li>
                    <li>一致率は、打牌（リーチできるときはリーチするかも含めて）と鳴ける場面の判断が、推奨と同じだった割合です（振り返りの一致率にはカンできる場面も入ります）。</li>
                    <li>自分も打つときは「振り返り」で、自分の判断（打牌、鳴ける場面、カンできる場面）を順に見返せます。局が終わったときは結果の「この局の振り返り」でその局を、対局が終わったら全部の局を見返せます。卓が判断の直前の局面になり（振り返り中は卓が青みがかった色になり「振り返り中」と出ます）、推奨の牌を緑、自分が切った牌をオレンジで示します。どの判断にも一致・ずれ小・ずれ中・ずれ大などの印が付き、放銃した打牌には避けられた・押しの範囲・事故の判定が付きます。「前の判断」「次の判断」（←→キー）で判断に移ります。対局が終わった後の振り返りでは、「一手前」「一手先」で他家の打牌も含めて1手ずつ動かせます。振り返りの「他家の手牌を見る」で他家の手牌を開けます（閉じるときは「他家の手牌を隠す」）。</li>
                    <li>CPUだけの対局は今の面子で打ちます。面子を選ぶ前なら、毎回ランダムな4人で打ちます。</li>
                </ul>
            </section>
            <section>
                <h3>ルール</h3>
                <p>四麻の半荘戦または東風戦・25000点持ち・喰いタンあり・赤ドラ3枚・後付けあり・頭ハネ・トビあり・オーラス親のアガリやめあり・カンドラ即乗り・流し満貫あり・大三元と大四喜の責任払いあり・ダブル役満（四暗刻単騎・国士十三面・純正九蓮宝燈・大四喜）と役満の複合あり。途中流局は九種九牌（任意）・四風連打・四家立直・四槓散了です（頭ハネなので三家和了はありません）。点数計算に <a href="https://github.com/takayama-lily/riichi" target="_blank" rel="noopener">riichi</a>（MIT）を使っています。</p>
            </section>
            <section>
                <h3>免責事項</h3>
                <ul>
                    <li>推奨・振り返りの判定・危険度などは、このアプリが独自の考え方で出したものです。最善の打牌や正しい判断であることは保証しません。</li>
                    <li>このアプリを使ったことで生じたいかなる損害についても、作者は責任を負いません。</li>
                    <li>戦績や途中の対局はこのブラウザにだけ保存されます。ブラウザのデータの削除などで消えることがあります。</li>
                </ul>
            </section>
            <section>
                <h3>お問い合わせ・ご意見</h3>
                <p>不具合の報告・ご意見・ご感想は、X（旧Twitter）の <a href="https://x.com/3892myamya" target="_blank" rel="noopener">@3892myamya</a> までご連絡ください。</p>
            </section>
        </dialog>


        <dialog ref="memberDialog" class="member-dialog" aria-labelledby="member-dialog-title" @pointerdown="notePress" @click="closeOutside">
            <div class="dialog-head">
                <h2 id="member-dialog-title">対局を始める</h2>
                <button type="button" class="close" aria-label="閉じる" @click="memberDialog.close()">×</button>
            </div>
            <div class="mode" role="radiogroup" aria-label="遊び方">
                <button type="button" role="radio" :aria-checked="draftMode === 'play'" :class="{ active: draftMode === 'play' }" @click="draftMode = 'play'">自分も打つ</button>
                <button type="button" role="radio" :aria-checked="draftMode === 'watch'" :class="{ active: draftMode === 'watch' }" @click="draftMode = 'watch'">CPU4人を観戦</button>
            </div>
            <div class="mode" role="radiogroup" aria-label="対局の長さ">
                <button v-for="(label, key) in LENGTHS" :key="key" type="button" role="radio" :aria-checked="draftLength === key"
                    :class="{ active: draftLength === key }" @click="draftLength = key">{{ label }}</button>
            </div>
            <!-- Two ways to choose the opponents, side by side: by strength (quick) or one by one. -->
            <div class="choose-tabs" role="tablist" aria-label="相手の決め方">
                <button type="button" role="tab" :aria-selected="dialogStep === 'quick'" :class="{ active: dialogStep === 'quick' }" @click="dialogStep = 'quick'">おまかせで選ぶ</button>
                <button type="button" role="tab" :aria-selected="dialogStep === 'pick'" :class="{ active: dialogStep === 'pick' }" @click="dialogStep = 'pick'">相手を自分で選ぶ</button>
            </div>
            <div v-if="dialogStep === 'quick'" class="quick">
                <div class="quick-grid">
                    <button v-for="st in STRENGTHS" :key="st.id" type="button" class="quick-button" @click="quickStart(st)">
                        <span class="quick-icon" aria-hidden="true">{{ st.icon[draftMode] }}</span>
                        <span class="quick-text"><strong>{{ st.label[draftMode] }}</strong><small>{{ st.note }}</small></span>
                    </button>
                </div>
                <button v-if="members.length === draftCount" type="button" class="quick-same" @click="sameMembers">
                    前回と同じ面子で始める（{{ members.map(id => PERSONALITIES[id].name).join('・') }}）
                </button>
            </div>
            <template v-else>
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
            </template>
            <div v-if="dialogStep === 'pick'" class="dialog-actions">
                <button class="primary" type="button" :disabled="draft.length !== draftCount" @click="startWithDraft">この面子で始める</button>
            </div>
        </dialog>

        <!-- Watching only: playing yourself, the game simply runs (as in other mahjong apps) and earlier
             positions are seen in the review. -->
        <div v-if="game && !reviewMode && humanSeat === null" class="controls">
            <button v-if="!playing" class="primary" type="button" @click="play">▶ 自動再生</button>
            <button v-else class="primary" type="button" @click="stop">⏸ 一時停止</button>
            <div class="nav" role="group" aria-label="手の移動">
                <button type="button" :disabled="playing || cursor === 0" title="局の最初にいるときは前の局へ" @click="prevRound">« 局の最初</button>
                <button type="button" :disabled="playing || cursor === 0" title="←キー" @click="back">◀ 一手前</button>
                <button type="button" :disabled="playing || !canForward" title="→キー" @click="forward">一手先 ▶</button>
                <button type="button" :disabled="playing || !canForward" @click="stepToRoundEnd">局の最後 »</button>
            </div>
            <div class="speed" role="radiogroup" aria-label="再生速度">
                <button v-for="s in SPEEDS" :key="s.id" type="button" role="radio" :aria-checked="speed === s.id"
                    :class="{ active: speed === s.id }" @click="speed = s.id">{{ s.label }}</button>
            </div>
        </div>

        <!-- Before the first game: the table's place holds the one thing to do. -->
        <section v-if="!game || !game.players.length" class="start-empty">
            <div class="start-choices">
                <button v-if="savedGame" type="button" class="start-big" @click="resumeSaved">前回の対局の続きから</button>
                <p v-if="savedGame" class="resume-note">
                    {{ savedGame.length }} {{ savedGame.round }}・{{ savedGame.mode === 'watch' ? '観戦' : '自分も打つ' }}<br>
                    {{ savedGame.mode === 'watch' ? '' : '相手：' }}{{ savedGame.names.join('・') }}
                </p>
                <button type="button" :class="savedGame ? 'start-sub' : 'start-big'" @click="openMembers">{{ savedGame ? '新しい対局を始める' : '対局を始める' }}</button>
            </div>
        </section>
        <div v-if="game && game.players.length" class="layout" :class="{ reviewing: reviewMode, squared: square }">
            <section class="table" :class="{ flash }" aria-label="卓">
                <div v-if="centerText" :key="centerText.id" class="center-announce">{{ centerText.text }}</div>
                <div v-if="yakumanShow" :key="yakumanShow.id" class="yakuman-show" role="status" @click="yakumanShow = null">
                    <div class="yakuman-rays" aria-hidden="true" />
                    <span v-for="(sp, i) in SPARKS" :key="i" class="yakuman-spark" aria-hidden="true"
                        :style="{ left: sp.left + '%', animationDelay: sp.delay + 's', width: sp.size + 'px', height: sp.size + 'px' }" />
                    <div class="yakuman-text">
                        <p class="yakuman-who">{{ yakumanShow.name }}　{{ yakumanShow.how }}</p>
                        <p class="yakuman-title">役満</p>
                        <p class="yakuman-yaku">{{ yakumanShow.yaku.join('・') }}</p>
                        <p class="yakuman-points">{{ yakumanShow.points.toLocaleString() }}点</p>
                    </div>
                </div>
                <section v-if="introOpen" class="result-overlay intro-overlay" aria-labelledby="intro-title">
                  <div class="result card">
                    <h2 id="intro-title">対局者</h2>
                    <ul class="intro-list">
                        <li v-for="p in introSeats" :key="p" :style="{ '--person': personOf(p).color }">
                            <span class="wind">{{ WIND_NAME[game.seatWind(p)] }}</span>
                            <div>
                                <strong>{{ playerName(p) }}</strong><span class="char-stars">{{ seatStars(p) }}</span>
                                <p>{{ PERSONALITIES[game.seats[p]].intro }}</p>
                            </div>
                        </li>
                    </ul>
                    <p v-if="humanSeat !== null" class="muted intro-you">あなたは{{ WIND_NAME[game.seatWind(humanSeat)] }}家です。対局中も名前を押すと紹介を見られます。</p>
                    <div class="result-actions">
                        <button class="primary" type="button" @click="closeIntro">{{ humanSeat !== null ? '対局開始' : '観戦を始める' }}</button>
                    </div>
                  </div>
                </section>

                <section v-if="game.phase === 'roundEnd' && game.result && resultOpen" class="result-overlay" aria-live="polite">
                  <div class="result card">
                    <h2>{{ game.result.roundName }} {{ game.result.honba }}本場 結果</h2>
                    <template v-if="game.result.kind === 'win'">
                        <p class="result-title">
                            {{ playerName(game.result.winner) }}
                            {{ game.result.loser === null ? 'ツモ' : `ロン ← ${playerName(game.result.loser)}` }}
                        </p>
                        <div class="win-hand">
                            <MahjongTile v-for="id in game.result.hand.filter(x => x !== game.result.tile)" :key="id" :id="id" size="sm" :dora="isDora(id)" />
                            <span class="draw-gap"><MahjongTile :id="game.result.tile" size="sm" mark :dora="isDora(game.result.tile)" /></span>
                            <span v-for="(meld, i) in game.result.melds" :key="i" class="meld">
                                <span v-for="t in meldTiles(meld, game.result.winner)" :key="t.id" class="meld-slot">
                                    <MahjongTile v-if="t.added != null" :id="t.added" size="xs" sideways :dora="isDora(t.added)" />
                                    <MahjongTile :id="t.id" size="xs" :sideways="t.sideways" :back="t.back" :dora="isDora(t.id)" />
                                </span>
                            </span>
                        </div>
                        <ul class="yaku">
                            <li v-for="(y, i) in game.result.result.yaku" :key="y.name" class="yaku-row" :style="{ animationDelay: `${0.25 + i * 0.12}s` }"><span>{{ y.name }}</span><span>{{ y.value }}</span></li>
                        </ul>
                        <p v-if="game.result.ura.length" class="ura">裏ドラ表示牌
                            <MahjongTile v-for="id in game.result.ura" :key="id" :id="id" size="xs" />
                        </p>
                        <p v-if="game.result.pao" class="pao-note">責任払い：{{ playerName(game.result.pao.player) }}（{{ game.result.pao.yaku }}を鳴かせた）</p>
                        <p class="points">
                            <template v-if="!game.result.result.yakuman">{{ game.result.result.fu }}符{{ game.result.result.han }}飜 </template>
                            {{ game.result.result.name }} {{ shownPoints.toLocaleString() }}点
                        </p>
                    </template>
                    <template v-else-if="game.result.kind === 'abort'">
                        <p class="result-title">途中流局（{{ game.result.reason }}）</p>
                        <template v-if="game.result.abortBy">
                            <p>{{ playerName(game.result.abortBy.player) }}：么九牌{{ game.result.abortBy.kinds }}種</p>
                            <div class="win-hand">
                                <MahjongTile v-for="id in game.result.abortBy.hand" :key="id" :id="id" size="sm" />
                            </div>
                        </template>
                    </template>
                    <template v-else>
                        <p class="result-title">{{ game.result.nagashi?.length ? '流し満貫' : '流局' }}</p>
                        <p v-if="game.result.nagashi?.length">{{ game.result.nagashi.map(q => playerName(q)).join('・') }}</p>
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
                        <button v-if="allReviewItems.some(it => it.round === roundOf(game.result))" type="button" class="review-cta" @click="openReview(roundOf(game.result))">この局の振り返り</button>
                        <button v-if="canForward" class="primary" type="button" @click="nextHand">次の局へ ▶</button>
                    </div>
                  </div>
                </section>
                <!-- Over the corner of the square table; in the list of panels it joins the info line instead, so it covers nothing. -->
                <button v-if="square && game.phase === 'roundEnd' && game.result && !resultOpen" type="button" class="result-reopen" @click="resultOpen = true">結果を見る</button>



                <div v-if="!square" class="table-info">
                    <span class="game-kind" :class="{ reviewing: reviewMode }">{{ reviewMode ? '振り返り中' : LENGTHS[game.length ?? 'hanchan'] }}</span>
                    <span class="round">{{ roundLabel }}</span>
                    <span>供託 {{ game.kyotaku }}本</span>
                    <span>残り {{ game.wall.length }}枚</span>
                    <span class="dora">ドラ表示牌
                        <MahjongTile v-for="id in game.doraIndicators" :key="id" :id="id" size="sm" />
                    </span>
                    <button v-if="game.phase === 'roundEnd' && game.result && !resultOpen" type="button" class="result-reopen in-line" @click="resultOpen = true">結果を見る</button>
                </div>

                <div v-if="square" class="square">
                    <div v-for="pos in OPPONENTS" :key="pos" class="opp" :class="[pos, { turn: game.turn === around[pos] && game.phase === 'play' }]"
                        :style="{ '--person': personOf(around[pos]).color }">
                        <div v-if="announcements[around[pos]]" :key="announcements[around[pos]].id" class="announce" :class="announcements[around[pos]].kind">
                            {{ announcements[around[pos]].text }}
                        </div>
                        <div class="opp-head">
                            <span class="wind" :class="{ dealer: game.seatWind(around[pos]) === 0 }">{{ WIND_NAME[game.seatWind(around[pos])] }}</span>
                            <button type="button" class="name name-button" @click="openProfile(around[pos])">{{ playerName(around[pos]) }}<small class="seat-stars">{{ seatStars(around[pos]) }}</small></button>
                            <span v-if="game.players[around[pos]].riichi" class="riichi-stick" title="リーチ" aria-label="リーチ"><i /></span>
                            <span class="score">{{ game.scores[around[pos]].toLocaleString() }}</span>
                        </div>
                        <!-- Laid out as that player sees it: hand from their left to right, calls on their right,
                             every tile facing the centre of the table (face down until the hand is over). -->
                        <div class="opp-body">
                            <div class="opp-hand">
                                <MahjongTile v-for="id in game.players[around[pos]].hand" :key="id" :id="id" size="xs" :dora="isDora(id)"
                                    :back="!showHand(game.players[around[pos]])" :sideways="pos !== 'top'" :flip="pos !== 'left'" />
                            </div>
                            <div v-if="game.players[around[pos]].melds.length" class="opp-melds">
                                <span v-for="(meld, i) in game.players[around[pos]].melds" :key="i" class="opp-meld" :title="meldLabel(meld)">
                                    <template v-for="t in meldTiles(meld, around[pos])" :key="t.id">
                                        <MahjongTile :id="t.id" size="xs" :back="t.back" :dora="isDora(t.id)" v-bind="oppTileTurn(pos, t.sideways)" />
                                        <MahjongTile v-if="t.added != null" :id="t.added" size="xs" :dora="isDora(t.added)" v-bind="oppTileTurn(pos, true)" />
                                    </template>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="center">
                        <div v-for="pos in RIVERS" :key="pos" class="river-slot" :class="pos">
                            <div class="river-box" :class="pos">
                                <MahjongTile v-for="r in game.players[around[pos]].river" :key="r.id" :id="r.id" size="xs" :sideways="r.riichi"
                                    :dim="r.called" :tsumogiri="r.tsumogiri && r.id !== callTargetId" :mark="r.id === lastDiscardId" :class="{ fresh: r.id === lastDiscardId, 'call-target': r.id === callTargetId }" />
                            </div>
                        </div>
                        <div class="center-info">
                            <span class="game-kind" :class="{ reviewing: reviewMode }">{{ reviewMode ? '振り返り中' : LENGTHS[game.length ?? 'hanchan'] }}</span>
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
                        <button v-if="pl.seat !== humanSeat" type="button" class="name name-button" @click="openProfile(pl.seat)">{{ playerName(pl.seat) }}<small class="seat-stars">{{ seatStars(pl.seat) }}</small></button>
                        <span v-else class="name">{{ playerName(pl.seat) }}</span>
                        <span v-if="pl.riichi" class="riichi-stick" title="リーチ" aria-label="リーチ"><i /></span>
                        <span v-if="pl.planName && (pl.seat === humanSeat ? !hidden : othersOpen)" class="plan-label">方針：{{ pl.planName }}</span>
                        <span v-if="waitsBySeat[pl.seat]" class="wait-label">
                            待ち
                            <span v-for="w in waitsBySeat[pl.seat].waits" :key="w.kind" class="wait-tile">
                                <MahjongTile :kind="w.kind" size="xs" /><small>{{ w.left }}</small>
                            </span>
                            <span class="wait-total">{{ waitsBySeat[pl.seat].inWall ? '山に残り' : '残り' }}{{ waitsBySeat[pl.seat].total }}枚</span>
                            <span v-if="waitsBySeat[pl.seat].furiten" class="wait-flag">フリテン</span>
                            <span v-if="waitsBySeat[pl.seat].yakuless" class="wait-flag">役なし</span>
                        </span>
                        <button v-if="pl.seat === humanSeat && !game.over" type="button" class="nocall-toggle" :class="{ on: noCalls }"
                            role="switch" :aria-checked="noCalls" title="ONの間はチー・ポン・カンを聞かずにスルーします（ロンは聞きます）" @click="noCalls = !noCalls">鳴きなし</button>
                        <span class="score">{{ game.scores[pl.seat].toLocaleString() }}</span>
                    </div>
                    <!-- A hidden CPU hand is left out (nothing to read in face-down tiles): its calls sit beside the river. -->
                    <div v-if="showHand(pl) || pl.melds.length" class="hand-row">
                        <div v-if="showHand(pl)" class="hand">
                            <MahjongTile v-for="id in handTiles(pl).rest" :key="id" :id="id" :dora="isDora(id)"
                                :clickable="pl.seat === humanSeat && canDiscard(id)" :dim="pl.seat === humanSeat && !!turnOptions && !canDiscard(id)"
                                :rec="id === hintTile" :class="{ picked: id === picked, played: pl.seat === humanSeat && id === reviewChosenTile && id !== hintTile }" @click="clickTile(pl, id)"
                                @pointerenter="hoverTile(pl, id, $event)" @pointerleave="hovered = null" />
                            <span v-if="handTiles(pl).draw !== null" class="draw-gap">
                                <MahjongTile :id="handTiles(pl).draw" :dora="isDora(handTiles(pl).draw)" :mark="handTiles(pl).draw !== hintTile" :rec="handTiles(pl).draw === hintTile"
                                    :clickable="pl.seat === humanSeat && canDiscard(handTiles(pl).draw)"
                                    :dim="pl.seat === humanSeat && !!turnOptions && !canDiscard(handTiles(pl).draw)"
                                    :class="{ picked: handTiles(pl).draw === picked, played: pl.seat === humanSeat && handTiles(pl).draw === reviewChosenTile && handTiles(pl).draw !== hintTile }" @click="clickTile(pl, handTiles(pl).draw)"
                                    @pointerenter="hoverTile(pl, handTiles(pl).draw, $event)" @pointerleave="hovered = null" />
                            </span>
                        </div>
                        <div v-if="pl.melds.length" class="melds">
                            <span v-for="(meld, i) in pl.melds" :key="i" class="meld" :title="meldLabel(meld)">
                                <span v-for="t in meldTiles(meld, pl.seat)" :key="t.id" class="meld-slot">
                                    <MahjongTile v-if="t.added != null" :id="t.added" size="sm" sideways :dora="isDora(t.added)" />
                                    <MahjongTile :id="t.id" size="sm" :sideways="t.sideways" :back="t.back" :dora="isDora(t.id)" />
                                </span>
                                <small class="meld-label">{{ meldLabel(meld) }}</small>
                            </span>
                        </div>
                    </div>
                    <div v-if="!square" class="river">
                        <MahjongTile v-for="r in pl.river" :key="r.id" :id="r.id" size="sm" :sideways="r.riichi"
                            :dim="r.called" :tsumogiri="r.tsumogiri && r.id !== callTargetId" :mark="r.id === lastDiscardId" :class="{ fresh: r.id === lastDiscardId, 'call-target': r.id === callTargetId }" />
                    </div>

                    <!-- The human's buttons, each always in its own place (shown only when it can be used); the row
                         keeps its height so nothing moves when buttons come and go. -->
                    <div v-if="pl.seat === humanSeat && !game.over" class="actions" :class="{ picking: !!pickSlot }">
                        <template v-if="pickSlot">
                            <span class="prompt-text">{{ pickSlot.label }}：</span>
                            <button v-for="o in pickSlot.options" :key="o.key" type="button" :class="{ rec: o.rec, 'kb-focus': kbFocusId === 'opt-' + o.key }" @click="o.act()">
                                <MahjongTile v-for="id in o.tiles ?? []" :key="id" :id="id" size="xs" />
                                <MahjongTile v-if="o.kind != null" :kind="o.kind" size="xs" />
                            </button>
                            <button type="button" :class="{ 'kb-focus': kbFocusId === 'back' }" @click="pickType = null">戻る</button>
                        </template>
                        <template v-else>
                            <button v-for="slot in actionSlots" :key="slot.id" type="button" class="slot" :class="[slot.id, { hidden: !slot.show, rec: slot.show && slot.rec, active: slot.active, primary: slot.id === 'win', 'kb-focus': kbFocusId === slot.id, armed: passArmed && winLetGo(slot) }]"
                                :disabled="!slot.show" :tabindex="slot.show ? 0 : -1" :aria-hidden="!slot.show" @click="pressSlot(slot)">{{ passArmed && winLetGo(slot) ? '本当？' : slot.label }}</button>
                        </template>
                    </div>
                </article>
            </section>

            <aside class="side">
                <section v-if="reviewMode" class="card review-panel" aria-labelledby="review-title">
                    <div class="dialog-head">
                        <h2 id="review-title">振り返り</h2>
                        <button v-if="humanSeat !== null" type="button" class="hands-toggle" :class="{ on: reviewHands }" role="switch" :aria-checked="reviewHands"
                            @click="reviewHands = !reviewHands">他家の手牌{{ reviewHands ? 'を隠す' : 'を見る' }}</button>
                        <button type="button" class="close" aria-label="振り返りを終える" @click="closeReview">×</button>
                    </div>
                    <p class="review-sum">
                        一致率 <strong>{{ pct(reviewSummary.agreed, reviewSummary.decisions) }}</strong><span class="muted">（{{ reviewSummary.agreed }}/{{ reviewSummary.decisions }}判断）</span>
                        ・放銃 <strong>{{ reviewSummary.dealIns }}回</strong><span v-if="reviewSummary.dealIns" class="muted">（{{ reviewSummary.verdicts }}）</span>
                    </p>
                    <!-- At the top, so they stay in place however long the explanation below is. -->
                    <div v-if="reviewItem" class="review-nav">
                        <button type="button" class="judge-step" :disabled="reviewIndex === 0 && reviewOnDecision" @click="showReviewItem(reviewOnDecision ? reviewIndex - 1 : reviewIndex)">◀ 前の判断</button>
                        <button v-if="!reviewScope" type="button" :disabled="cursor <= reviewRange[0]" @click="stepReview(-1)">一手前</button>
                        <span class="muted">{{ reviewIndex + 1 }} / {{ reviewItems.length }}</span>
                        <button v-if="!reviewScope" type="button" :disabled="cursor >= reviewRange[1]" @click="stepReview(1)">一手先</button>
                        <button type="button" class="judge-step" :disabled="reviewIndex >= reviewItems.length - 1" @click="showReviewItem(reviewIndex + 1)">次の判断 ▶</button>
                    </div>
                    <p v-if="reviewItem && !reviewOnDecision" class="muted review-between">あなたの判断の間の局面です（「前の判断」「次の判断」で判断に移ります）。</p>
                    <div v-if="reviewItem && reviewNow && reviewOnDecision" class="review-now">
                        <p class="review-where">
                            <span class="judge" :class="markClass(reviewItem.mark)">{{ reviewItem.mark }}</span>
                            {{ reviewItem.round }}・{{ reviewNow.turn }}
                        </p>
                        <template v-if="reviewItem.kind === 'call'">
                            <p v-if="reviewNow.self" class="review-call">カンの判断<MahjongTile v-if="reviewNow.tile !== null" :id="reviewNow.tile" size="xs" />：あなたは<strong>{{ reviewNow.chose }}</strong>／推奨は<strong>{{ reviewNow.advised }}</strong></p>
                            <p v-else class="review-call">{{ reviewNow.from }}の<MahjongTile v-if="reviewNow.tile !== null" :id="reviewNow.tile" size="xs" />：あなたは<strong>{{ reviewNow.chose }}</strong>／推奨は<strong>{{ reviewNow.advised }}</strong></p>
                            <p class="muted">{{ reviewNow.reason }}</p>
                        </template>
                        <p v-if="reviewItem.dealIn" class="review-dealin">
                            <span class="verdict" :class="reviewItem.dealIn.verdict">{{ reviewItem.dealIn.verdict }}</span>
                            この牌で{{ reviewItem.dealIn.winner }}に{{ reviewItem.dealIn.points.toLocaleString() }}点の放銃。{{ reviewItem.dealIn.note }}
                        </p>
                        <MahjongAnalysis v-if="reviewItem.kind === 'discard'" :analysis="reviewItem.entry.analysis" owner-name="あなた" folded />
                    </div>
                    <ol class="review-timeline">
                        <template v-for="r in reviewSummary.rounds" :key="r.name">
                            <li class="round-head" :class="{ 'deal-in': r.dealIn }">{{ r.name }} <span v-if="!r.lost" class="muted">{{ r.agreed }}/{{ r.decisions }}</span></li>
                            <li v-if="r.lost" class="lost-note muted">中断して再開したため、この局の記録はありません</li>
                            <li v-else-if="r.partial" class="lost-note muted">中断より前の判断は記録がありません</li>
                            <template v-for="(it, i) in reviewItems" :key="i">
                                <li v-if="it.round === r.name">
                                    <button type="button" :class="{ current: i === reviewIndex }" @click="showReviewItem(i)">
                                        <span class="judge" :class="markClass(it.mark)">{{ it.mark }}</span>
                                        <template v-if="it.kind === 'call'">{{ it.call.choice === 'skip' ? (it.call.self ? 'カンせず' : 'スルー') : CALL_NAME[it.call.choice] }}</template>
                                        <template v-else><MahjongTile :id="it.entry.tile" size="xs" />切り</template>
                                        <span v-if="it.dealIn" class="judge big">放銃</span>
                                    </button>
                                </li>
                            </template>
                        </template>
                    </ol>
                    <button type="button" class="review-end primary" @click="closeReview">振り返りを終える</button>
                </section>

                <template v-if="!reviewMode">
                <!-- Watching: the last move first, its reasons right below it. Playing yourself, the table shows
                     what happened; the record lives in the review. -->
                <!-- Shown from the start of the hand (empty) so the cards below never jump. Opens like the 牌譜. -->
                <section v-if="humanSeat === null" class="card last" :class="{ open: lastOpen && lastEntry && showsAnalysis(lastEntry) }">
                    <button type="button" class="last-line" :class="{ differ: lastEntry && showsAnalysis(lastEntry) && !lastEntry.analysis.choice.same }"
                        :disabled="!lastEntry || !showsAnalysis(lastEntry)" :aria-expanded="lastOpen" @click="lastOpen = !lastOpen">
                        <span class="muted">直前</span>
                        <template v-if="lastEntry">
                            <strong>{{ playerName(lastEntry.player) }}</strong>
                            <MahjongTile :id="lastEntry.tile" size="xs" />
                            <span>{{ lastSummary(lastEntry) }}</span>
                            <span v-if="showsAnalysis(lastEntry)" class="more">{{ lastOpen ? '閉じる ▴' : '開く ▾' }}</span>
                        </template>
                        <span v-else class="muted">まだ打牌はありません</span>
                    </button>
                    <div v-if="lastOpen && lastEntry && showsAnalysis(lastEntry)" class="last-detail analysis">
                        <p v-if="lastEntry.drawn != null" class="drawn-note">ツモ <MahjongTile :id="lastEntry.drawn" size="xs" /></p>
                        <p v-if="lastEntry.call" class="call-note">{{ CALL_NAME[lastEntry.call.type] }}<template v-if="lastEntry.call.reason">：{{ lastEntry.call.reason }}</template><template v-if="lastEntry.call.advice && lastEntry.call.advice.action !== lastEntry.call.type">（推奨は{{ adviceName(lastEntry.call.advice) }}）</template></p>
                        <MahjongAnalysis :analysis="lastEntry.analysis" :owner-name="playerName(lastEntry.player)" />
                        <div v-if="visibleChances(lastEntry).length" class="chances">
                            <h3>この牌への鳴き</h3>
                            <ul>
                                <li v-for="c in visibleChances(lastEntry)" :key="c.player" :class="{ differ: (c.choice === 'skip') !== (c.advice.action === 'skip') || (c.choice !== 'skip' && c.choice !== c.advice.action) }">
                                    <strong>{{ playerName(c.player) }}</strong>：{{ c.choice === 'skip' ? 'スルー' : CALL_NAME[c.choice] }}
                                    <span class="muted">（推奨：{{ c.advice.text }}）</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </section>

                <!-- A discard opened from the 牌譜 (the 直前 one is already shown above when that is open). -->
                <section v-if="detail && !(lastOpen && detail === lastEntry)" class="card analysis detail">
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

                <section v-if="game.over" class="card final">
                    <h2>終局</h2>
                    <ol>
                        <li v-for="(p, i) in game.finalRanking" :key="p">
                            <span>{{ i + 1 }}位 {{ playerName(p) }}</span><span>{{ game.scores[p].toLocaleString() }}点</span>
                        </li>
                    </ol>
                    <div class="final-actions">
                        <button v-if="canReviewGame" type="button" class="review-cta" @click="openReview()">振り返り</button>
                        <button type="button" @click="openStats">戦績を見る</button>
                        <button v-if="atLatest" class="primary" type="button" @click="openMembers">次の対局へ</button>
                    </div>
                </section>

                <!-- Nothing that would only flash by: a call about to be made shows only its recommendation (the call
                     itself appears on the table), a player in riichi nothing. -->
                <section v-if="live && ((live.calling && live.advice) || live.hint)" class="card analysis live" aria-live="polite">
                    <h2 class="live-head">
                        <span class="dot" :style="{ background: live.color }" />
                        {{ live.player === humanSeat ? 'あなた' : live.name }}の手番
                        <span v-if="live.drawn !== null && !live.secret" class="drawn-note">ツモ <MahjongTile :id="live.drawn" size="xs" /></span>
                        <span v-else-if="live.drawn === null && !live.calling" class="muted">（鳴いた直後）</span>
                    </h2>
                    <template v-if="live.calling">
                        <div v-if="live.advice" class="call-advice" :class="{ differ: !live.agrees }">
                            <span class="badge" :class="live.agrees ? 'same' : 'diff'">{{ live.agrees ? '推奨どおり' : '推奨と違う' }}</span>
                            推奨：{{ live.advice.text }}
                        </div>
                    </template>
                    <div v-if="!live.calling && !live.riichi && live.player === humanSeat && turnOptions?.kyuushu" class="call-advice">
                        九種九牌：{{ turnOptions.kyuushu.abort ? '流すのがおすすめ' : `続けるのがおすすめ（${turnOptions.kyuushu.plan}）` }}
                        <span class="muted">今の手の見込みは配り直しの{{ turnOptions.kyuushu.ratio.toFixed(1) }}倍</span>
                    </div>
                    <div v-if="!live.calling && live.player === humanSeat && turnOptions?.kanAdvice && showHint" class="call-advice">
                        カンの判断：{{ turnOptions.kanAdvice.text }}
                    </div>
                    <MahjongAnalysis v-if="!live.calling && !live.riichi" :analysis="live.hint" :hide-plans="!!aim && live.player === humanSeat"
                        :focus-key="live.player === humanSeat ? focusKey : null" />
                </section>

                <section v-if="reactPrompt && reactPrompt.advice && showHint" class="card analysis">
                    <h2 class="live-head">鳴きの判断</h2>
                    <p class="drawn-note">{{ playerName(reactPrompt.from) }}の <MahjongTile :id="reactPrompt.id" size="xs" /></p>
                    <div class="call-advice" :class="{ differ: false }">推奨：{{ reactPrompt.advice.text }}</div>
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
                            <span class="muted">{{ r.distance < 0 ? '完成' : r.distance === 0 ? 'テンパイ' : `${r.distance}シャンテン` }}・{{ r.ukeire }}枚・{{ r.points.toLocaleString() }}点</span>
                        </button>
                        <button v-if="aim.more" type="button" class="aim-more" @click="showAllAims = !showAllAims">{{ showAllAims ? '閉じる' : 'ほかの役' }}</button>
                    </div>
                </section>



                <section v-if="humanSeat === null" class="card log">
                    <button type="button" class="log-toggle" :aria-expanded="logOpen" @click="logOpen = !logOpen">
                        <h2>牌譜</h2>
                        <span class="more">{{ logOpen ? '閉じる ▴' : '開く ▾' }}</span>
                    </button>
                    <ol v-if="logOpen" ref="kifuList">
                        <li v-for="e in kifuLines" :key="e.id"
                            :class="[e.type, { differ: (showsAnalysis(e) && (!e.analysis.choice.same || e.analysis.choice.riichiDiffers)) || e.type === 'callcheck' || callDiffers(e), current: e.id === currentEntryId, future: e.pos > cursor }]"
                            @click="openEntry(e)">
                            {{ kifuText(e) }}
                        </li>
                    </ol>
                </section>
                </template>
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
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif;
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
    width: min(1480px, 100%);
    margin: 0 auto;
    padding: 12px clamp(16px, 3vw, 32px) 32px;
}

.appbar { display: grid; grid-template-columns: auto 1fr auto; grid-template-areas: "title tools new"; align-items: center; gap: 8px 14px; margin-bottom: 10px; padding: 8px 12px; background: var(--felt-dark); color: #f4efe2; border-radius: 10px; }
.appbar, .appbar button { font-family: "Zen Old Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif; }
.appbar h1 { grid-area: title; margin: 0; font-weight: 700; font-size: 24px; letter-spacing: .06em; }
.appbar-tools { grid-area: tools; display: flex; flex-wrap: wrap; gap: 6px; }
.appbar .manual-button { background: rgba(255, 255, 255, .08); border-color: rgba(255, 255, 255, .22); color: #f4efe2; }
.appbar .manual-button:hover { background: rgba(255, 255, 255, .16); }
.appbar .analysis-switch.on { background: rgba(255, 212, 59, .16); border-color: #e9c46a; color: #ffe08a; }
.appbar .analysis-switch.on .knob { background: #e9c46a; }
.appbar .analysis-switch .knob { background: rgba(255, 255, 255, .3); }
.start-empty {
    display: grid; place-items: center; min-height: min(560px, calc(100vh - 140px)); border-radius: 14px;
    background: radial-gradient(circle at 50% 40%, #2a7d5d, var(--felt) 60%, var(--felt-dark));
}
.start-big {
    border: 0; border-radius: 14px; padding: 22px 48px; cursor: pointer;
    background: #e9c46a; color: #3b2b00; font-size: clamp(20px, 3vw, 26px); font-weight: 700; letter-spacing: .08em;
    font-family: "Zen Old Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif;
    box-shadow: 0 6px 0 #b8902f, 0 10px 24px rgba(0, 0, 0, .25);
}
.start-big:hover { background: #f0d27f; }
/* On a phone the longest label (前回の対局の続きから) stays on one line. */
@media (max-width: 520px) { .start-big { padding: 20px 22px; letter-spacing: .04em; white-space: nowrap; } }
.start-choices { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 16px; text-align: center; }
.pao-note { margin: 4px 0 0; font-size: 13px; color: #8a3200; font-weight: 700; }
.resume-note { margin: 0; color: #e8f3ec; font-size: 14px; line-height: 1.6; }
.start-sub { border: 1px solid rgba(255, 255, 255, .6); border-radius: 10px; padding: 10px 22px; background: rgba(255, 255, 255, .12); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.start-sub:hover { background: rgba(255, 255, 255, .2); }
.start-big:active { transform: translateY(3px); box-shadow: 0 3px 0 #b8902f, 0 6px 14px rgba(0, 0, 0, .25); }
.new-game { grid-area: new; border: 0; border-radius: 8px; padding: 8px 16px; background: #e9c46a; color: #3b2b00; font-weight: 700; cursor: pointer; white-space: nowrap; }
.new-game:hover { background: #f0d27f; }
.game-kind { font-size: 12px; font-weight: 700; padding: 1px 6px; border: 1px solid rgba(255, 255, 255, .4); border-radius: 4px; }
.game-kind.reviewing { background: #e3f8ec; border-color: #e3f8ec; color: #173f4c; }
.manual-button { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 14px; white-space: nowrap; }
.sound-button { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); border-color: var(--accent); background: #f0f8f3; }
.sound-button.off { color: var(--muted); border-color: var(--line); background: #fff; }
.manual-dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 32px); border: 0; border-radius: 14px; padding: 18px 22px; color: inherit; line-height: 1.7; }
.manual-dialog::backdrop { background: rgba(10, 30, 20, .55); }
/* The same head on every dialog: title on the left, × on the right. */
.dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.dialog-head h2 { margin: 0; font-size: 18px; }
.dialog-head .close { flex: none; width: 32px; height: 32px; margin: -4px -6px 0 0; border: 0; border-radius: 50%; background: none; font-size: 22px; line-height: 1; cursor: pointer; color: var(--muted); }
.dialog-head .close:hover { background: #eef3ef; color: inherit; }
.manual-dialog h3 { margin: 14px 0 4px; font-size: 15px; }
.manual-dialog p, .manual-dialog ul { margin: 0; font-size: 14px; }
.manual-dialog ul { padding-left: 20px; }
.manual-dialog section > * + * { margin-top: 6px; }
.manual-dialog a { color: var(--accent); }
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

.layout { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 16px; align-items: start; }
/* The review needs a wider column: its comparison sits side by side. */
.layout.reviewing { grid-template-columns: minmax(0, 1fr) minmax(400px, 520px); }
/* Below the square table's width (an iPad on its side) the table needs the room more: the review stays at 400px. */
@media (max-width: 1099px) { .layout.reviewing { grid-template-columns: minmax(0, 1fr) 400px; } }
/* The 4-direction table takes only the width it needs; the analysis column gets the rest. */
.layout.squared, .layout.squared.reviewing { grid-template-columns: max-content minmax(400px, 1fr); }
@media (max-width: 980px) {
    .layout, .layout.reviewing { grid-template-columns: 1fr; }
}
/* Beside the square table the review is as tall as the table (never taller: the height of 0 keeps it from
   stretching the row), and the list of decisions takes what is left. */
.layout.squared.reviewing .side { align-self: stretch; height: 0; min-height: 100%; display: flex; flex-direction: column; }
.layout.squared.reviewing .review-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.layout.squared.reviewing .review-timeline { flex: 1 1 0; min-height: 120px; max-height: none; }

/* In the review the table turns a bluer green: the same table, plainly not the game going on. */
.layout.reviewing .table { --felt-light: #2b6f80; --felt: #1f5868; --felt-dark: #173f4c; }
.table {
    position: relative;
    background: radial-gradient(circle at 50% 30%, var(--felt-light, #2a7d5d), var(--felt) 60%, var(--felt-dark));
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
/* 役満: gold light turning behind big letters, sparks falling, the table dimmed. */
.yakuman-show {
    position: absolute; inset: 0; z-index: 6; overflow: hidden; display: grid; place-items: center; cursor: pointer;
    background: radial-gradient(circle at 50% 45%, rgba(60, 40, 0, .55), rgba(5, 10, 8, .88) 70%); border-radius: 14px;
    animation: yakuman-in .5s ease-out both, yakuman-out .6s ease-in 4.6s forwards;
}
.yakuman-rays {
    position: absolute; left: 50%; top: 45%; width: 160vmax; height: 160vmax; transform: translate(-50%, -50%);
    background: repeating-conic-gradient(from 0deg, rgba(255, 214, 102, .22) 0deg 8deg, rgba(255, 214, 102, 0) 8deg 20deg);
    animation: yakuman-spin 9s linear infinite;
    mask-image: radial-gradient(circle, #000 0, #000 18%, transparent 55%);
}
.yakuman-spark { position: absolute; top: -10px; border-radius: 50%; background: radial-gradient(circle, #fff6d0, #f2c14e 60%, rgba(242, 193, 78, 0)); animation: yakuman-fall 2.6s ease-in infinite; }
.yakuman-text { position: relative; text-align: center; color: #fff3cf; }
.yakuman-text p { margin: 0; }
.yakuman-who { font-size: clamp(14px, 2.4vw, 18px); letter-spacing: .1em; opacity: .9; animation: yakuman-rise .6s ease-out .3s both; }
.yakuman-title {
    font-family: "Zen Old Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif; font-weight: 700;
    font-size: clamp(64px, 14vw, 128px); line-height: 1.1; letter-spacing: .15em;
    background: linear-gradient(180deg, #fff8dc 0%, #ffd56a 40%, #c8901c 60%, #ffe9a8 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 0 18px rgba(255, 200, 80, .7)) drop-shadow(0 4px 0 rgba(80, 50, 0, .6));
    animation: yakuman-stamp .7s cubic-bezier(.2, 1.6, .4, 1) .5s both;
}
.yakuman-yaku { font-family: "Zen Old Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif; font-size: clamp(22px, 4vw, 34px); font-weight: 700; letter-spacing: .12em; color: #ffe08a; animation: yakuman-rise .6s ease-out 1.1s both; }
.yakuman-points { font-size: clamp(16px, 2.6vw, 22px); font-weight: 700; margin-top: 4px !important; animation: yakuman-rise .6s ease-out 1.4s both; }
@keyframes yakuman-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes yakuman-out { to { opacity: 0; visibility: hidden; } }
@keyframes yakuman-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
@keyframes yakuman-stamp { from { opacity: 0; transform: scale(2.4); } to { opacity: 1; transform: scale(1); } }
@keyframes yakuman-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes yakuman-fall { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 1; } 100% { transform: translateY(110vh); opacity: 0; } }
.yakuman-records { margin-top: 8px; }
.stats-head .dialog-head { flex-basis: 100%; }
.stats-tabs { display: flex; flex-wrap: wrap; gap: 8px 24px; }
.stats-tabs .mode + .mode { margin-left: 0; }
.record-hand { flex-basis: 100%; margin: 4px 0 2px; }
.batch-tag { font-size: 11px; border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; color: var(--muted); }
.yakuman-records ol { list-style: none; margin: 0; padding: 0; }
.yakuman-records li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 6px 8px; border-bottom: 1px solid var(--line); font-size: 14px; }
.yakuman-records li.you { background: #fff8e1; }
.yakuman-names { font-family: "Zen Old Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif; font-weight: 700; color: #a5740b; }
.river .fresh, .river-box .fresh { animation: drop .25s ease-out; }
.call-target { outline: 3px solid #ffd43b; outline-offset: 1px; border-radius: 4px; position: relative; z-index: 1; animation: call-pulse 1.1s ease-in-out infinite; }
@keyframes call-pulse { 50% { outline-color: #fff3b0; } }
/* 4方向の卓 */
.square {
    /* River tiles grow with the window (up to 31px), limited by its height and by the width left
       after a 400px analysis column; opponents' hands follow at 85%. */
    --rt: clamp(17px, min(calc((100vh - 380px) / 17), calc((100vw - 790px) / 17)), 31px);
    --ot: calc(var(--rt) * .85);
    --bw: calc(6 * (var(--rt) + 2px));
    --bh: calc(4 * (var(--rt) * 1.37 + 2px));
    display: grid; grid-template-columns: minmax(104px, auto) auto minmax(104px, auto); grid-template-areas: "top top top" "left center right"; gap: 6px;
}
.square .opp-hand .tile, .square .opp-meld .tile { --w: var(--ot); --h: calc(var(--ot) * 1.37); }
.square .center .river-box .tile { --w: var(--rt); --h: calc(var(--rt) * 1.37); }
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
.center { grid-area: center; display: grid; grid-template-columns: var(--bh) var(--bw) var(--bh); grid-template-rows: var(--bh) var(--bw) var(--bh); justify-content: center; align-content: center; background: rgba(0, 0, 0, .12); border-radius: 12px; padding: 8px; }
.river-slot { position: relative; }
.river-slot.top { grid-area: 1 / 2; }
.river-slot.left { grid-area: 2 / 1; }
.river-slot.right { grid-area: 2 / 3; }
.river-slot.bottom { grid-area: 3 / 2; }
/* Each river faces its owner, filling away from the centre as in a real game. */
.river-box { position: absolute; left: 50%; top: 50%; width: var(--bw); height: var(--bh); display: flex; flex-wrap: wrap; align-content: flex-start; gap: 2px; transform: translate(-50%, -50%); }
.river-box.top { transform: translate(-50%, -50%) rotate(180deg); }
.river-box.left { transform: translate(-50%, -50%) rotate(90deg); }
.river-box.right { transform: translate(-50%, -50%) rotate(-90deg); }
.center-info { grid-area: 2 / 2; display: grid; place-content: center; justify-items: center; gap: 4px; font-size: 12px; text-align: center; }
.center-info .round { font-size: calc(var(--rt) * .7); }
@keyframes drop { from { transform: translateY(-8px) scale(1.15); } to { transform: none; } }
.riichi-stick { display: inline-flex; align-items: center; width: 46px; height: 8px; border-radius: 4px; background: #fbfaf5; box-shadow: 0 1px 0 rgba(0, 0, 0, .3); justify-content: center; }
.riichi-stick i { width: 6px; height: 6px; border-radius: 50%; background: #c8102e; }
.yaku-row { animation: rise .3s ease-out both; }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
    .announce, .center-announce { animation-duration: .01s; animation-delay: 1s; }
    .table.flash::after, .river .fresh, .yaku-row, .call-target { animation: none; }
    /* 役満: the letters only, no turning light or sparks; it still fades out. */
    .yakuman-rays, .yakuman-spark { display: none; }
    .yakuman-title, .yakuman-who, .yakuman-yaku, .yakuman-points { animation: none; }
}
.table-info { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 14px; padding: 0 4px; }
/* The dora indicators (more after a kan) stay together on one line. */
.table-info .dora { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
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
.nocall-toggle { margin-left: auto; border: 1px solid rgba(255, 255, 255, .45); border-radius: 999px; padding: 1px 10px; background: transparent; color: rgba(255, 255, 255, .8); font: inherit; font-size: 12px; cursor: pointer; }
.nocall-toggle.on { background: #ffd43b; border-color: #ffd43b; color: #5c3d00; font-weight: 700; }
.nocall-toggle + .score { margin-left: 0; }
.hands-toggle { margin-left: auto; margin-right: 8px; border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; background: #fff; color: var(--felt-dark); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.hands-toggle.on { border-color: var(--accent); color: var(--accent); background: #f0f8f3; }
/* The place the keyboard is on (actions), as the lifted tile is in the hand. */
.actions button.kb-focus { box-shadow: 0 0 0 3px #7cc4ff; }
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
/* A CPU whose hand is hidden: the calls sit on the name line (small, without labels) so the river keeps
   the full width and its height; nothing below moves when someone calls. */
.player.compact { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: minmax(30px, auto) auto; column-gap: 8px; }
.player.compact .player-head { grid-row: 1; grid-column: 1; flex-wrap: nowrap; overflow: hidden; margin-bottom: 0; }
.player.compact .hand-row { grid-row: 1; grid-column: 2; min-height: 0; align-self: center; }
.player.compact .river { grid-row: 2; grid-column: 1 / -1; margin-top: 2px; }
.player.compact .melds { gap: 3px; }
.player.compact .meld { padding: 2px; }
.player.compact .meld-label { display: none; }
.player.compact .meld .tile { --w: 15px; --h: 20px; }

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
/* The review is one of the main ways on: a green outline (like the quick-start choices), next to the green fill of going on. */
.result-actions button.review-cta, .final-actions button.review-cta { border: 2px solid var(--accent); color: var(--accent); background: #f0f8f3; font-weight: 700; }
.result-reopen { position: absolute; z-index: 4; right: 16px; top: 10px; font-size: 13px; padding: 4px 10px; }
.result-reopen.in-line { position: static; margin-left: auto; }
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

.log-toggle { width: 100%; display: flex; align-items: center; border: 0; background: none; padding: 0; cursor: pointer; font: inherit; color: inherit; }
.log-toggle h2 { margin: 0; }
.log-toggle .more { margin-left: auto; color: var(--accent); font-size: 13px; }
.log ol { position: relative; list-style: none; margin: 8px 0 0; padding: 0; max-height: 320px; overflow-y: auto; font-size: 13px; }
.log li { padding: 4px 6px; border-bottom: 1px solid #eef3f0; cursor: pointer; }
.log li:hover { background: #f3f8f5; }
.log li.differ { border-left: 3px solid #f0a46b; }
.log li.current { background: #d9efe2; font-weight: 700; }
.log li.future { opacity: .45; }
.log li.start { text-align: center; padding-top: 8px; }
.log li.win, .log li.draw, .log li.start, .log li.end { font-weight: 700; color: var(--felt-dark); }

.stats-dialog { width: min(1180px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); overflow: hidden; border: 0; border-radius: 14px; padding: 18px; color: inherit; }
.stats-dialog .stats { display: flex; flex-direction: column; height: 100%; }
.stats-body { flex: 1; min-height: 0; overflow: auto; margin-top: 8px; }
/* A hand where the human dealt in. */
.verdict { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px; background: #e9ecef; }
.verdict.避けられた { background: #ffe1cc; color: #8a3200; }
.verdict.押しの範囲 { background: #fff3bf; color: #5c4400; }
.verdict.事故 { background: #dff1e7; color: #17533d; }
@media (max-width: 520px) {
    .appbar { grid-template-columns: 1fr auto; grid-template-areas: "title new" "tools tools"; }
    .appbar h1 { font-size: 21px; }
    .manual-button { padding: 5px 9px; font-size: 13px; }
    .controls .nav button { padding: 8px 8px; font-size: 13px; }
    /* The table runs to the screen edges and the human's 14 tiles fill its width. */
    .table { margin-inline: -12px; padding: 4px; border-radius: 10px; }
    .player { padding: 4px 6px; border-left-width: 3px; }
    /* The hand's box is the screen less about 46px; 13 gaps of 2px and the 8px before the drawn tile come out of it too, with a little room to spare. */
    .player.me .hand .tile.md { --w: min(30px, calc((100vw - 92px) / 14)); --h: calc(var(--w) * 1.38); }
}
.review-note { margin: 10px 0 0; }
.review-panel { display: grid; gap: 8px; padding: 10px 12px; font-size: 13px; }
.review-panel .dialog-head { margin-bottom: 0; }
.review-sum { margin: 0; font-size: 13px; }
.review-now { border: 1px solid var(--line); border-radius: 10px; padding: 8px; display: grid; gap: 4px; }
.review-where { margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 700; }
.review-call { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.review-now > p.muted { margin: 0; font-size: 13px; }
.review-dealin { margin: 0; font-size: 13px; background: #fff4e5; border-left: 3px solid #c92a2a; border-radius: 4px; padding: 6px 8px; }
.review-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
.review-between { margin: 6px 0 0; font-size: 13px; }
.review-nav button, .review-end { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; font-size: 14px; }
.review-nav button:disabled { opacity: .4; cursor: default; }
/* Going from decision to decision is the main way through a review: green outline, as the review button. */
.review-nav button.judge-step { border: 2px solid var(--accent); color: var(--accent); background: #f0f8f3; font-weight: 700; }
.review-timeline { position: relative; list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 4px; align-content: flex-start; }
.review-timeline .round-head { flex-basis: 100%; font-size: 13px; font-weight: 700; padding: 6px 2px 2px; border-bottom: 1px solid var(--line); }
.review-timeline .round-head.deal-in { color: #c92a2a; }
.review-timeline .lost-note { flex-basis: 100%; font-size: 12px; padding: 2px; }
.review-timeline button { display: inline-flex; align-items: center; gap: 3px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 6px; background: #fff; font: inherit; font-size: 12px; cursor: pointer; }
.review-timeline button.current { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: #f0f8f3; }
/* Not ".mark": that is the drawn tile's class in MahjongTile. */
.judge { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 6px; white-space: nowrap; }
.judge.ok { background: #dff1e7; color: #17533d; }
.judge.small { background: #eef1f4; color: #4a5560; }
.judge.mid { background: #fff3bf; color: #5c4400; }
.judge.big { background: #ffe1cc; color: #8a3200; }
.hand .played { outline: 3px solid #f08c00; outline-offset: 1px; }
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

.mode { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.mode button { border: 0; background: #fff; padding: 8px 12px; cursor: pointer; }
.mode button.active { background: #dff1e7; color: var(--felt-dark); font-weight: 700; }
.mode + .mode { margin-left: 8px; }
.aim-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(4, minmax(44px, auto)); gap: 4px; }
.aim-chip { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: #fff; text-align: left; font-size: 13px; line-height: 1.4; }
.aim-chip strong { font-weight: 600; display: flex; align-items: center; }
.aim-chip .muted { font-size: 11px; }
.aim-chip .tag { font-size: 10px; font-weight: 600; background: var(--accent); color: #fff; border-radius: 4px; padding: 0 4px; margin-left: 4px; }
.aim-chip.active { border-color: var(--accent); }
.aim-chip.on { background: #f0f8f3; border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.aim-more { grid-column: 1 / -1; font-size: 12px; padding: 2px; }
.call-advice { font-size: 13px; line-height: 1.6; background: #f3f8f5; border-radius: 6px; padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.call-advice.differ { background: #fff7f0; }
.call-advice .badge.same { background: #dff1e7; color: #17533d; }
.call-advice .badge.diff { background: #ffe1cc; color: #8a3200; }
.chances { margin-top: 10px; }
.chances h3 { margin: 0 0 4px; font-size: 13px; }
.chances ul { list-style: none; margin: 0; padding: 0; }
.chances li { font-size: 13px; padding: 3px 0; border-bottom: 1px dashed var(--line); }
.chances li.differ { color: #8a3200; }
.member-dialog { margin: 6vh auto auto; width: min(980px, calc(100vw - 32px)); max-height: calc(94vh - 16px); border: 0; border-radius: 14px; padding: 18px; color: inherit; }
.member-dialog::backdrop { background: rgba(10, 30, 20, .55); }
.member-dialog h2 { margin: 0 0 10px; font-size: 18px; }
.member-dialog .mode { margin-bottom: 10px; }
.dialog-actions button { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
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
.quick { display: grid; gap: 10px; }
.choose-tabs { display: flex; gap: 4px; margin: 14px 0 10px; border-bottom: 2px solid var(--line); }
.choose-tabs button { border: 0; background: none; padding: 8px 14px; margin-bottom: -2px; border-bottom: 3px solid transparent; font: inherit; font-weight: 700; color: var(--muted); cursor: pointer; }
.choose-tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
.quick p { margin: 0; }
.quick-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.quick-icon { font-size: 30px; line-height: 1; font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }
.quick-text { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.quick-button { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px 8px; border: 2px solid var(--accent); border-radius: 12px; background: #f0f8f3; cursor: pointer; font: inherit; color: var(--felt-dark); }
.quick-button strong { font-size: 16px; line-height: 1.35; text-align: center; }
.quick-button small { font-size: 12px; color: var(--muted); text-align: center; line-height: 1.4; }
.quick-button:hover { background: #dff1e7; }
.quick-same { border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 10px 12px; cursor: pointer; font: inherit; text-align: left; }
.intro-list { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 8px; }
.intro-list li { display: flex; gap: 10px; align-items: flex-start; border-left: 4px solid var(--person); padding: 4px 8px; background: #f7faf8; border-radius: 6px; }
.intro-list .wind { flex: none; background: #e3ece7; }
.intro-list p { margin: 2px 0 0; font-size: 13px; line-height: 1.6; }
.intro-list .char-stars { margin-left: 6px; }
.intro-you { margin: 0; font-size: 13px; }
.name-button { border: 0; background: none; padding: 0; font: inherit; font-weight: 800; color: inherit; cursor: pointer; text-decoration: underline dotted rgba(255, 255, 255, .5); text-underline-offset: 3px; }
.seat-stars { margin-left: 3px; font-size: 10px; color: #ffd43b; font-weight: 400; letter-spacing: -1px; }
.profile-dialog { width: min(440px, calc(100vw - 32px)); border: 0; border-radius: 14px; padding: 18px; color: inherit; }
.profile-dialog::backdrop { background: rgba(10, 30, 20, .45); }
.profile-dialog h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 18px; }
.profile-dialog h2 small { font-size: 12px; font-weight: 400; }
.profile-dialog p { margin: 0 0 6px; line-height: 1.7; }
.profile-record { font-size: 13px; }
.review-label, .speed-label { font-size: 13px; font-weight: 700; }
@media (max-width: 640px) {
    .char-detail { height: auto; min-height: calc(4 * 1.7em + 12px); }
    .char-detail li { white-space: normal; }
    /* One per row so each wish reads on one line, the stars at the right. */
    .quick-grid { grid-template-columns: 1fr; }
    .quick-button { flex-direction: row; justify-content: flex-start; gap: 12px; padding: 10px 14px; }
    .quick-icon { font-size: 26px; }
    .quick-text { align-items: flex-start; gap: 2px; }
    .quick-button small { text-align: left; }
}
.live-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.live-head .drawn-note { margin: 0 0 0 auto; font-size: 13px; font-weight: 400; }
.live-head .close { margin-left: auto; border: 0; background: none; font-size: 18px; line-height: 1; cursor: pointer; color: var(--muted); }
.card.last { padding: 8px 10px; }
.last-detail { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
.last-line { width: 100%; min-height: 28px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; border: 0; background: none; padding: 0; text-align: left; cursor: pointer; font-size: 14px; color: inherit; }
.last-line:disabled { cursor: default; }
.last-line.differ { color: #8a3200; }
.last-line .more { margin-left: auto; color: var(--accent); font-size: 13px; }
.wait-label { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; color: #d8ffe8; }
.wait-tile { display: inline-flex; align-items: flex-end; gap: 1px; }
.wait-tile small { font-size: 10px; opacity: .85; }
.wait-total { opacity: .85; }
.wait-flag { font-size: 11px; font-weight: 700; color: #5c3d00; background: #ffd43b; border-radius: 4px; padding: 1px 5px; }
.analysis-switch { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
.analysis-switch .knob { position: relative; width: 30px; height: 16px; border-radius: 999px; background: #c9d4ce; transition: background .15s; }
.analysis-switch .knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .15s; }
.analysis-switch.on { border-color: var(--accent); color: var(--accent); background: #f0f8f3; }
.analysis-switch.on .knob { background: var(--accent); }
.analysis-switch.on .knob::after { transform: translateX(14px); }
.analysis-switch small { font-size: 11px; min-width: 2.2em; }
.setting-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.settings-dialog .speed button { border: 0; background: #fff; padding: 8px 12px; cursor: pointer; font: inherit; }
.settings-dialog .speed button.active { background: #dff1e7; color: var(--felt-dark); font-weight: 700; }

.player.me { background: rgba(255, 255, 255, .1); }
/* The recommended choice among the buttons, marked like the recommended tile. */
.actions button.rec { outline: 3px solid #37d67a; outline-offset: 1px; }
/* A tile picked with a finger stands up until the second tap. */
.hand .picked, .hand .picked:hover { transform: translateY(-10px); box-shadow: 0 0 0 2px #ffd43b, 0 4px 8px rgba(0, 0, 0, .3); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 46px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(255, 255, 255, .3); }
/* Fixed places: a button that cannot be used keeps its room but is not shown. */
.actions .slot { flex: 0 0 auto; min-width: 64px; justify-content: center; }
.actions .slot.hidden { visibility: hidden; }
.actions .slot.riichi:not(.hidden) { background: #ff8a5c; border-color: #ff8a5c; color: #fff; }
.actions .slot.riichi.active { background: #c94a1c; border-color: #c94a1c; }
.actions .slot.armed { background: #ffe3e3; border-color: #ffa8a8; color: #a61e1e; }
@media (max-width: 640px) {
    /* Six equal places in one row. */
    .actions:not(.picking) { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; }
    .actions .slot { min-width: 0; padding: 6px 2px; font-size: 13px; }
}
.actions button { display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(255, 255, 255, .5); background: rgba(255, 255, 255, .92); color: #1d2b25; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-weight: 700; }
.actions button.primary { background: #ffd43b; border-color: #ffd43b; color: #5c3d00; }
.actions button.active { background: #ffd43b; }
.prompt-text { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 700; margin-right: 4px; }
.review-note { margin: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 14px; }
.review-note button { border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-weight: 700; }
.plan-label { font-size: 12px; background: rgba(255, 255, 255, .16); border-radius: 999px; padding: 2px 8px; }
</style>
