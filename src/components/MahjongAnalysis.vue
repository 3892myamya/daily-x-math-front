<script setup>
import MahjongTile from './MahjongTile.vue'

// analysis: { recommendation, candidates, threats, plans, choice? } from mahjongAI.js.
// With a choice it compares the recommendation with what was played; without one it is a hint.
defineProps({
    analysis: { type: Object, required: true },
    ownerName: { type: String, default: '' },
    // The 狙い役 card already lists the plans.
    hidePlans: { type: Boolean, default: false },
    // The tile the human has picked (or points at), highlighted in the candidates.
    focusKind: { type: Number, default: null },
})

// The best six, and the focused tile below them when it is not among them.
function candidateList(analysis, focusKind) {
    const top = analysis.candidates.slice(0, 6)
    const focused = analysis.candidates.find(c => c.kind === focusKind)
    return focused && !top.includes(focused) ? [...top, focused] : top
}

// Best points among a tenpai candidate's waits, for the table.
function waitSummary(c) {
    if (!c.waits) return '—'
    const best = Math.max(0, ...c.waits.map(w => w.points))
    // A closed hand not yet in riichi is valued with riichi; say so when dama would differ.
    const withRiichi = c.waits.some(w => w.damaPoints !== w.points)
    const text = best ? `最高${best.toLocaleString()}点${withRiichi ? '（リーチ時）' : ''}` : '役なし'
    return c.waits[0]?.furiten ? `${text}（フリテン）` : text
}

function planDistance(d) {
    if (d < 0) return '完成'
    return d === 0 ? 'テンパイ' : `${d}シャンテン`
}

// Wait details for the recommended and the chosen discard, when they reach tenpai.
const tenpaiRows = analysis => analysis.candidates.filter(c => c.waits && (c.recommended || c.chosen))
const hasTenpai = analysis => analysis.candidates.some(c => c.waits)
</script>

<template>
    <div class="analysis-body">
        <div class="compare" :class="{ single: !analysis.choice }">
            <div class="pick">
                <span class="pick-label">推奨</span>
                <MahjongTile :kind="analysis.recommendation.kind" />
                <span v-if="analysis.recommendation.riichi" class="badge riichi-badge">リーチ</span>
                <p>{{ analysis.recommendation.text }}</p>
                <p v-if="analysis.recommendation.ties?.length" class="ties">同じ評価：<MahjongTile v-for="k in analysis.recommendation.ties" :key="k" :kind="k" size="xs" /></p>
            </div>
            <div v-if="analysis.choice" class="pick" :class="{ differ: !analysis.choice.same }">
                <span class="pick-label">{{ ownerName }}の選択
                    <span class="badge" :class="analysis.choice.same ? 'same' : 'diff'">{{ analysis.choice.same ? '一致' : '不一致' }}</span>
                </span>
                <MahjongTile :kind="analysis.choice.kind" />
                <span v-if="analysis.choice.riichi" class="badge riichi-badge">リーチ</span>
                <p>{{ analysis.choice.reason }}</p>
            </div>
        </div>
        <div v-if="analysis.recommendation.riichiAdvice || analysis.choice?.riichiText" class="riichi-advice" :class="{ differ: analysis.choice?.riichiDiffers }">
            <h3>リーチの判断<span v-if="analysis.choice?.riichiDiffers" class="badge diff">推奨と違う</span></h3>
            <p v-if="analysis.recommendation.riichiAdvice">推奨：{{ analysis.recommendation.riichiAdvice.riichi ? 'リーチ' : 'ダマ' }}（{{ analysis.recommendation.riichiAdvice.text }}）</p>
            <p v-if="analysis.choice?.riichiText">{{ ownerName }}：{{ analysis.choice.riichiText }}</p>
        </div>
        <p v-if="analysis.threats.length" class="threat-note">警戒：{{ analysis.threats.map(t => t.text).join('、') }}</p>
        <div v-if="analysis.plans && !hidePlans" class="plans">
            <h3>役の方針</h3>
            <table class="candidates">
                <thead><tr><th>方針</th><th>距離</th><th>見込み打点</th></tr></thead>
                <tbody>
                    <tr v-for="r in analysis.plans.rows" :key="r.id"
                        :class="{ rec: r.id === analysis.plans.recommended, chosen: r.id === analysis.plans.chosen && r.id !== analysis.plans.recommended }">
                        <td>{{ r.name }}<span v-if="r.id === analysis.plans.recommended" class="tag">推奨</span><span v-if="r.id === analysis.plans.chosen && r.id !== analysis.plans.recommended" class="tag chosen-tag">選択</span></td>
                        <td>{{ planDistance(r.distance) }}</td>
                        <td>{{ r.points.toLocaleString() }}点</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <table class="candidates">
            <thead>
                <tr><th>打牌</th><th>シャンテン</th><th>受け入れ</th><th v-if="hasTenpai(analysis)">和了点</th><th v-if="analysis.threats.length">危険度（目安）</th></tr>
            </thead>
            <tbody>
                <tr v-for="c in candidateList(analysis, focusKind)" :key="c.kind" :class="{ rec: c.recommended, chosen: c.chosen, focus: c.kind === focusKind }">
                    <td>
                        <MahjongTile :kind="c.kind" size="xs" />
                        <span v-if="c.recommended" class="tag">推奨</span>
                        <span v-if="c.kind === focusKind" class="tag focus-tag">選択中</span>
                        <span v-if="c.chosen && !c.recommended" class="tag chosen-tag">選択</span>
                    </td>
                    <td>{{ c.shanten === 0 ? 'テンパイ' : c.shanten }}</td>
                    <td>{{ c.ukeireTypes }}種{{ c.ukeire }}枚</td>
                    <td v-if="hasTenpai(analysis)">{{ waitSummary(c) }}</td>
                    <td v-if="analysis.threats.length">{{ c.danger }}</td>
                </tr>
            </tbody>
        </table>
        <div v-for="c in tenpaiRows(analysis)" :key="'w' + c.kind" class="waits">
            <h3><MahjongTile :kind="c.kind" size="xs" />切りのテンパイ<span v-if="c.recommended" class="tag">推奨</span><span v-if="c.chosen && !c.recommended" class="tag chosen-tag">選択</span></h3>
            <ul>
                <li v-for="w in c.waits" :key="w.kind">
                    <MahjongTile :kind="w.kind" size="xs" /><span class="left">残り{{ w.left }}枚</span>
                    <strong>{{ w.points ? `${w.points.toLocaleString()}点` : '役なし' }}</strong>
                    <span v-if="w.damaPoints !== w.points" class="dama">リーチ時（ダマなら{{ w.damaPoints ? `${w.damaPoints.toLocaleString()}点` : '役なし' }}）</span>
                    <span v-if="w.furiten" class="furiten">フリテン（ツモのみ）</span>
                    <span class="yaku-list">{{ w.yaku.join('・') }}</span>
                </li>
            </ul>
        </div>
    </div>
</template>

<style scoped>
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.compare.single { grid-template-columns: 1fr; }
.pick { border: 1px solid var(--line); border-radius: 8px; padding: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; align-content: flex-start; }
.pick.differ { border-color: #f0a46b; background: #fff7f0; }
.pick-label { flex-basis: 100%; font-size: 12px; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.pick p { flex-basis: 100%; margin: 0; font-size: 13px; line-height: 1.6; }
.pick p.ties { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; font-size: 12px; color: var(--muted); }
.badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 999px; }
.riichi-badge { background: #ffd43b; color: #5c3d00; }
.badge.same { background: #dff1e7; color: #17533d; }
.badge.diff { background: #ffe1cc; color: #8a3200; }
.riichi-advice { margin: 0 0 10px; border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; font-size: 13px; }
.riichi-advice.differ { border-color: #f0a46b; background: #fff7f0; }
.riichi-advice h3 { display: flex; align-items: center; gap: 6px; }
.riichi-advice p { margin: 2px 0 0; }
.threat-note { margin: 0 0 8px; font-size: 13px; background: #fff4e5; border-left: 3px solid #f0a46b; border-radius: 4px; padding: 6px 8px; }
.plans { margin-bottom: 10px; }
h3 { margin: 0 0 4px; font-size: 13px; }
.candidates { width: 100%; border-collapse: collapse; font-size: 13px; }
.candidates th, .candidates td { padding: 4px 6px; border-bottom: 1px solid var(--line); text-align: left; }
.candidates th { font-size: 12px; color: var(--muted); font-weight: 600; }
.candidates td:first-child { display: flex; align-items: center; gap: 4px; }
.candidates tr.rec { background: #f0f8f3; }
.candidates tr.chosen { background: #fff4ea; }
.tag { font-size: 10px; background: var(--accent); color: #fff; border-radius: 4px; padding: 1px 4px; margin-left: 4px; }
.chosen-tag { background: #e8590c; }
.candidates tr.focus td { box-shadow: inset 0 2px 0 #e8590c, inset 0 -2px 0 #e8590c; }
.candidates tr.focus td:first-child { box-shadow: inset 2px 2px 0 #e8590c, inset 0 -2px 0 #e8590c; }
.candidates tr.focus td:last-child { box-shadow: inset -2px 2px 0 #e8590c, inset 0 -2px 0 #e8590c; }
.focus-tag { background: #e8590c; }
.waits { margin-top: 10px; }
.waits h3 { display: flex; align-items: center; gap: 4px; }
.waits ul { list-style: none; margin: 0; padding: 0; }
.waits li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 4px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.waits .left { color: var(--muted); font-size: 12px; }
.waits strong { font-variant-numeric: tabular-nums; }
.dama { font-size: 12px; color: var(--muted); }
.furiten { font-size: 11px; font-weight: 700; color: #a33a00; background: #ffe1cc; border-radius: 4px; padding: 1px 5px; }
.yaku-list { flex-basis: 100%; color: var(--muted); font-size: 12px; }
</style>
