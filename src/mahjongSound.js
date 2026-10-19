// Sound effects made on the spot with the Web Audio API (no sound files, nothing to license).
// Browsers only allow sound after the user has interacted with the page; the first sound after a
// click starts the audio context.

const STORAGE_KEY = 'mahjong-sound'
let ctx = null
let enabled = readSetting()

function readSetting() {
    try {
        return localStorage.getItem(STORAGE_KEY) !== 'off'
    } catch {
        return true
    }
}

export function soundEnabled() {
    return enabled
}

export function setSoundEnabled(on) {
    enabled = on
    try {
        localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
    } catch {
        // Private windows may refuse storage; the setting then lasts for this visit only.
    }
}

function context() {
    if (!ctx) {
        const AudioContext = window.AudioContext ?? window.webkitAudioContext
        if (!AudioContext) return null
        ctx = new AudioContext()
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
}

// One note with a quick attack and a soft decay.
function tone(c, { freq, type = 'sine', start = 0, duration = 0.15, gain = 0.15, slide = null }) {
    const t = c.currentTime + start
    const osc = c.createOscillator()
    const amp = c.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + duration)
    amp.gain.setValueAtTime(0.0001, t)
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.01)
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(amp).connect(c.destination)
    osc.start(t)
    osc.stop(t + duration + 0.02)
}

// A short knock like a tile put down: filtered noise.
function knock(c) {
    const length = Math.floor(c.sampleRate * 0.05)
    const buffer = c.createBuffer(1, length, c.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 4)
    const src = c.createBufferSource()
    src.buffer = buffer
    const filter = c.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 1800
    filter.Q.value = 1.2
    const amp = c.createGain()
    amp.gain.value = 0.5
    src.connect(filter).connect(amp).connect(c.destination)
    src.start()
}

const SOUNDS = {
    discard: c => knock(c),
    call: c => {
        tone(c, { freq: 587, type: 'triangle', duration: 0.08, gain: 0.12 })
        tone(c, { freq: 784, type: 'triangle', start: 0.07, duration: 0.12, gain: 0.12 })
    },
    kan: c => {
        tone(c, { freq: 523, type: 'triangle', duration: 0.08, gain: 0.12 })
        tone(c, { freq: 659, type: 'triangle', start: 0.07, duration: 0.08, gain: 0.12 })
        tone(c, { freq: 784, type: 'triangle', start: 0.14, duration: 0.14, gain: 0.12 })
    },
    riichi: c => {
        tone(c, { freq: 1319, duration: 0.7, gain: 0.14 })
        tone(c, { freq: 1976, duration: 0.5, gain: 0.06 })
    },
    win: c => {
        ;[523, 659, 784].forEach((freq, i) => tone(c, { freq, type: 'triangle', start: i * 0.1, duration: 0.18, gain: 0.14 }))
        tone(c, { freq: 1047, type: 'triangle', start: 0.3, duration: 0.6, gain: 0.16 })
        tone(c, { freq: 1568, start: 0.3, duration: 0.5, gain: 0.05 })
    },
    draw: c => {
        tone(c, { freq: 440, type: 'sine', duration: 0.25, gain: 0.1 })
        tone(c, { freq: 330, type: 'sine', start: 0.2, duration: 0.4, gain: 0.1 })
    },
    turn: c => tone(c, { freq: 988, duration: 0.12, gain: 0.06 }),
    // 役満: a drum roll, a rising brass fanfare and a long bright chord with a shimmer on top.
    yakuman: c => {
        for (let i = 0; i < 10; i++) drum(c, i * 0.06, 0.15 + i * 0.02)
        const brass = (freq, start, duration, gain = 0.09) => {
            tone(c, { freq, type: 'sawtooth', start, duration, gain: gain * 0.5 })
            tone(c, { freq: freq * 2, type: 'triangle', start, duration, gain: gain * 0.4 })
        }
        ;[[392, 0.65], [523, 0.85], [659, 1.05]].forEach(([f, t]) => brass(f, t, 0.22))
        // The final chord: C major, held.
        ;[523, 659, 784, 1047].forEach(f => brass(f, 1.3, 1.6, 0.08))
        ;[2093, 2637, 3136, 2637, 3520].forEach((f, i) => tone(c, { freq: f, start: 1.4 + i * 0.12, duration: 0.5, gain: 0.03 }))
    },
}

// A soft drum hit for the roll.
function drum(c, start, gain) {
    tone(c, { freq: 110, type: 'triangle', start, duration: 0.12, gain, slide: 60 })
}

export function playSound(name) {
    if (!enabled) return
    try {
        const c = context()
        if (c) SOUNDS[name]?.(c)
    } catch {
        // Sound is a nicety; never let it break the game.
    }
}
