<script setup>
import { computed } from 'vue'
import { kindOf, isRed, tileFace, kindName, suitOf, numOf } from '../mahjongTiles.js'
import { tileArt } from '../mahjongTileArt.js'

// Pass either a physical tile id or a kind (for tiles that are only a kind, like waits).
const props = defineProps({
    id: { type: Number, default: null },
    kind: { type: Number, default: null },
    size: { type: String, default: 'md' },
    sideways: Boolean,
    dim: Boolean,
    mark: Boolean,
    // The standard AI's recommended discard in the hand of the player to move.
    rec: Boolean,
    // A river tile discarded straight after drawing it (ツモ切り), shown darker as in online mahjong.
    tsumogiri: Boolean,
    // Face down (other players' hands while the human plays, the ends of a concealed kan).
    back: Boolean,
    // Turned to face the other way (the player across the table); with sideways, the player on the right.
    flip: Boolean,
    clickable: Boolean,
})

const k = computed(() => props.id !== null ? kindOf(props.id) : (props.kind ?? 0))
const face = computed(() => tileFace(k.value))
const red = computed(() => props.id !== null && isRed(props.id))
// 筒子・索子 are drawn; 萬子 and honors are characters, as on real tiles.
const art = computed(() => k.value < 27 && suitOf(k.value) !== 0 ? tileArt(face.value.suit, numOf(k.value), red.value) : null)
const honorClass = computed(() => {
    if (k.value === 32) return 'hatsu'
    if (k.value === 33) return 'chun'
    return ''
})
</script>

<template>
    <span v-if="back" class="tile back" :class="[size, { sideways }]" />
    <span v-else class="tile" :class="[size, face.suit, honorClass, { red, sideways, flip, dim, mark, rec, tsumogiri, clickable }]" :title="kindName(k) + (red ? '（赤）' : '')">
        <!-- 白 is a blank tile; a thin inner frame keeps it recognisable. -->
        <span v-if="k === 31" class="face haku-face" />
        <span v-else-if="art" class="face art-face">
            <svg viewBox="0 0 60 84" aria-hidden="true">
                <template v-for="(a, i) in art" :key="i">
                    <g v-if="a.shape === 'circle'">
                        <circle :cx="a.x" :cy="a.y" :r="a.r" fill="#fffdf6" :stroke="a.color" stroke-width="2.4" />
                        <circle :cx="a.x" :cy="a.y" :r="a.r * 0.42" :fill="a.color" />
                    </g>
                    <g v-else-if="a.shape === 'big'">
                        <circle :cx="a.x" :cy="a.y" r="24" fill="#fffdf6" stroke="#1e7a45" stroke-width="3" />
                        <circle :cx="a.x" :cy="a.y" r="17" fill="none" stroke="#1f5fa8" stroke-width="2.5" stroke-dasharray="4 2.5" />
                        <circle :cx="a.x" :cy="a.y" r="9.5" fill="#c8102e" />
                        <circle :cx="a.x" :cy="a.y" r="3" fill="#fffdf6" />
                    </g>
                    <g v-else-if="a.shape === 'stick'" :transform="`rotate(${a.rotate} ${a.x} ${a.y})`">
                        <rect :x="a.x - a.w / 2" :y="a.y - a.h / 2" :width="a.w" :height="a.h" rx="3.5" :fill="a.color" />
                        <line :x1="a.x - a.w / 2" :x2="a.x + a.w / 2" :y1="a.y - a.h / 6" :y2="a.y - a.h / 6" stroke="#fffdf6" stroke-width="1.4" />
                        <line :x1="a.x - a.w / 2" :x2="a.x + a.w / 2" :y1="a.y + a.h / 6" :y2="a.y + a.h / 6" stroke="#fffdf6" stroke-width="1.4" />
                        <line :x1="a.x" :x2="a.x" :y1="a.y - a.h / 2 + 3" :y2="a.y + a.h / 2 - 3" stroke="#fffdf6" stroke-width=".8" opacity=".6" />
                    </g>
                    <g v-else-if="a.shape === 'bird'">
                        <path d="M30 60 L18 79 M30 60 L30 81 M30 60 L42 79" :stroke="a.red ? '#c8102e' : '#c8102e'" stroke-width="3" stroke-linecap="round" fill="none" />
                        <ellipse :cx="a.x" :cy="a.y" rx="12" ry="16" fill="#1e7a45" />
                        <ellipse :cx="a.x + 3" :cy="a.y + 2" rx="6" ry="10" fill="#3aa96b" />
                        <circle :cx="a.x" cy="22" r="7.5" fill="#1e7a45" />
                        <circle :cx="a.x + 2.5" cy="21" r="1.7" fill="#fffdf6" />
                        <path :d="`M${a.x + 6.5} 21 L${a.x + 13} 23.5 L${a.x + 6.5} 26 Z`" fill="#e0a020" />
                        <path :d="`M${a.x - 2} 15 L${a.x - 5} 8 M${a.x + 1} 15 L${a.x + 1} 7`" stroke="#c8102e" stroke-width="2" stroke-linecap="round" />
                    </g>
                </template>
            </svg>
        </span>
        <span v-else class="face">
            <span class="top">{{ face.top }}</span>
            <span v-if="face.bottom" class="bottom">{{ face.bottom }}</span>
        </span>
    </span>
</template>

<style scoped>
.tile {
    --w: 30px;
    --h: 40px;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: var(--w);
    height: var(--h);
    flex: none;
    border-radius: 5px;
    background: linear-gradient(#fffdf6, #f1ead9);
    border: 1px solid #cbbf9f;
    box-shadow: 0 2px 0 #b9ab86;
    line-height: 1;
    font-weight: 700;
    user-select: none;
}
.tile.sm { --w: 23px; --h: 31px; border-radius: 4px; }
.tile.xs { --w: 19px; --h: 26px; border-radius: 3px; }
/* 14 tiles have to fit one row on a phone. */
@media (max-width: 520px) {
    .tile.md { --w: 20px; --h: 28px; border-radius: 3px; }
    .tile.sm { --w: 18px; --h: 25px; border-radius: 3px; }
}
.face { display: inline-flex; flex-direction: column; align-items: center; }
/* A sideways tile swaps its box and turns only the face, so neighbours keep their spacing. */
.tile.sideways { width: var(--h); height: var(--w); }
.tile.sideways .face { transform: rotate(90deg); }
.tile.flip .face { transform: rotate(180deg); }
.tile.sideways.flip .face { transform: rotate(-90deg); }
.art-face { width: 84%; height: 86%; }
.art-face svg { width: 100%; height: 100%; display: block; }
.top { font-size: calc(var(--w) * .55); }
.bottom { font-size: calc(var(--w) * .36); margin-top: 2px; }
.m .top { color: #1f2a37; }
.m .bottom { color: #b4232f; }
.p { color: #1f5fa8; }
.s { color: #1e7a45; }
.z .top { font-size: calc(var(--w) * .62); color: #1f2a37; }
.hatsu .top { color: #1e7a45; }
.chun .top { color: #b4232f; }
.red { background: linear-gradient(#ffeef0, #f6d7da); border-color: #d77b85; }
.red .top, .red .bottom { color: #c8102e; }
.dim { opacity: .38; }
.haku-face { width: 62%; height: 64%; border: 2px solid #9fb4d6; border-radius: 3px; }
.tsumogiri { filter: brightness(.72) saturate(.8); }
.back { background: linear-gradient(#e9a23b, #c97d1c); border-color: #a8661a; box-shadow: 0 2px 0 #8a5212; }
.clickable { cursor: pointer; transition: transform .08s; }
.clickable:hover { transform: translateY(-4px); }
.mark { outline: 2px solid #ffb020; outline-offset: 1px; }
.rec { outline: 3px solid #37d67a; outline-offset: 1px; }
</style>
