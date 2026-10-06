<script setup>
import { computed, onMounted, ref } from 'vue'
import { effectiveDurability } from './shirenDurability.js'
import ShirenMonsterAbilities from './ShirenMonsterAbilities.vue'

const data = ref(null), loading = ref(true), error = ref('')
const includeBosses = ref(false)
const includeBehemoths = ref(false), sortKey = ref('hp'), descending = ref(true)
const columns = { hp: 'HP', attack: '攻撃力', defense: '防御力', exp: '経験値', durability: '実効耐久力' }
const rows = computed(() => {
  const monsters = data.value ? Object.entries(data.value.monsters).map(([id, monster]) => {
    const { value, note } = effectiveDurability(monster)
    return { ...monster, id, durability: value, durabilityNote: note }
  }) : []
  const sorted = monsters.filter(monster => (includeBehemoths.value || !monster.behemoth) && (includeBosses.value || monster.family !== 'ボス系'))
    .sort((a, b) => (a[sortKey.value] === null ? (b[sortKey.value] === null ? 0 : 1) : b[sortKey.value] === null ? -1 : descending.value ? b[sortKey.value] - a[sortKey.value] : a[sortKey.value] - b[sortKey.value]) || a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id))
  let rank = 0
  return sorted.map((monster, index) => {
    if (index === 0 || monster[sortKey.value] !== sorted[index - 1][sortKey.value]) rank = index + 1
    return { ...monster, rank: monster[sortKey.value] === null ? '—' : rank }
  })
})
function sortBy(key) {
  if (sortKey.value === key) descending.value = !descending.value
  else { sortKey.value = key; descending.value = true }
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}shiren/monsters.json`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    data.value = await response.json()
  } catch { error.value = 'ランキングデータを読み込めませんでした。' }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <section aria-label="モンスターランキング">
    <div class="selected-heading"><div><h2>モンスターランキング</h2></div></div>
    <div v-if="loading" class="notice" role="status">ランキングを読み込んでいます…</div>
    <div v-else-if="error" class="notice" role="alert">{{ error }} <button @click="load">再読み込み</button></div>
    <template v-else>
      <div class="ranking-controls panel">
        <div><label for="ranking-sort">ランキング項目</label><select id="ranking-sort" v-model="sortKey"><option v-for="(label, key) in columns" :key="key" :value="key">{{ label }}</option></select></div>
        <div><label for="ranking-direction">並び順</label><select id="ranking-direction" v-model="descending"><option :value="true">高い順</option><option :value="false">低い順</option></select></div>
        <div class="ranking-toggles"><label class="behemoth-toggle"><input v-model="includeBehemoths" type="checkbox">デッ怪を含める</label><label class="behemoth-toggle"><input v-model="includeBosses" type="checkbox">ボス系を含める</label></div>
      </div>
      <div class="result-toolbar"><h3>{{ columns[sortKey] }}ランキング <span>{{ rows.length }} 件</span></h3><span class="ranking-hint">列名を押して並べ替え</span></div>
      <div v-if="rows.length" class="table-wrap panel ranking-scroll" tabindex="0" role="region" aria-label="モンスターランキング一覧（縦・横にスクロールできます）">
        <table class="ranking-table"><thead><tr><th scope="col">順位</th><th scope="col">モンスター / 系統</th><th v-for="(label, key) in columns" :key="key" scope="col" :aria-sort="sortKey === key ? descending ? 'descending' : 'ascending' : 'none'"><button class="ranking-sort-button" @click="sortBy(key)">{{ label }} <span v-if="sortKey === key" aria-hidden="true">{{ descending ? '▼' : '▲' }}</span></button></th><th scope="col" class="ranking-runes-heading">弱点印</th><th scope="col" class="ranking-abilities-heading">特殊能力</th></tr></thead>
          <tbody><tr v-for="monster in rows" :key="monster.id"><td class="ranking-number">{{ monster.rank }}</td><td><a :href="`?mode=monster&monster=${monster.id}`">{{ monster.name }} ↗</a><p class="floors">{{ monster.family }}<span v-if="monster.level"> · Lv{{ monster.level }}</span></p></td><td v-for="(label, key) in columns" :key="key" class="ranking-value" :class="{ 'ranking-highlight': sortKey === key }"><template v-if="monster[key] === null">—<small v-if="key === 'durability'" class="ranking-null-note">{{ monster.durabilityNote }}</small></template><template v-else>{{ monster[key].toLocaleString('ja-JP') }}</template></td><td class="ranking-runes"><span v-for="rune in monster.weaknessRunes" :key="rune">{{ rune }}</span><span v-if="!monster.weaknessRunes.length">—</span></td><td class="ranking-abilities"><ShirenMonsterAbilities :monster="monster" /></td></tr></tbody>
        </table>
      </div>
      <div v-else class="notice panel">該当するモンスターがいません。表示条件を変えてみてください。</div>
      <details class="data-note" open><summary>実効耐久力・弱点印・特殊能力について</summary><p>実効耐久力は、満タンの基本HPを通常攻撃1回で削るための攻撃力の推定値です。攻撃力は武器の強さそのものではなく、レベル・ちから・武器による合計値です。</p><p>検証式「ダメージ ≈ 攻撃力 × 乱数 − 防御力 ÷ 2 ＋ 1」を逆算し、「HP ＋ 防御力 ÷ 2 − 1」（乱数100％固定）を整数に切り上げています。特攻印・会心・ドスコイ・状態変化は計算に含めません。端数処理は未確定のため、一撃撃破を保証する数値ではありません。</p><p>1ダメージ固定の敵とデッ怪は実効耐久力の計算対象外で、表にその理由を表示します。</p><p>弱点印は属性特攻印とデッ怪特攻印です。汎用的な攻撃印は含めません。特殊能力は主要な能力の要約です。デッ怪はデッ怪としての共通能力を表示します。詳細・例外はモンスター名から開く個別ページの攻略Wikiリンクを参照してください。</p><p>参考：<a href="https://shiren6.game-info.wiki/d/%B4%F0%CB%DC%A5%B7%A5%B9%A5%C6%A5%E0" target="_blank" rel="noopener noreferrer">シレン6攻略Wiki・基本システム（ダメージ計算式） ↗</a></p></details>
      <p class="data-note">同じ値は同順位で表示します。HP・攻撃力・防御力・経験値は元データの基本ステータス、実効耐久力はそこから計算した推定値です。特殊能力や攻撃回数を含めた総合的な強さを表す順位ではありません。</p>
    </template>
  </section>
</template>

<style>
.durability-control{display:flex;gap:12px;align-items:center;margin:16px 0}.durability-control label{margin:0}.ranking-runes{min-width:180px;font-size:11px}.ranking-runes span,.durability-note{display:block;line-height:1.8}.durability-note{white-space:normal;font-size:10px;color:#829080}.ranking-table th.ranking-runes-heading{text-align:left}.ranking-toggles{display:flex;flex-direction:column}.ranking-description{font-size:12px;color:#728075;line-height:1.8;margin:0 0 20px}.ranking-controls{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:18px;padding:18px;align-items:end}.ranking-controls select{width:100%}.ranking-controls .searchbox{margin:0}.shiren-app .behemoth-toggle{display:flex;gap:8px;align-items:center;min-height:39px;margin:0;font-size:12px;color:#475348;cursor:pointer}.behemoth-toggle input{accent-color:#315d46;width:16px;height:16px}.ranking-table{min-width:1050px}.ranking-table td:first-child{width:65px;min-width:0}.ranking-table th:first-child,.ranking-number{text-align:center}.ranking-table td:nth-child(2){min-width:200px}.ranking-table th:nth-child(n+3){text-align:right}.ranking-sort-button{background:none;border:0;padding:0;color:inherit;font-size:12px;font-weight:600;white-space:nowrap}.ranking-sort-button span{font-size:9px;color:#315d46}.ranking-value{text-align:right;font-variant-numeric:tabular-nums}.ranking-highlight{font-weight:700;color:#38533c;background:#f4f8ef}.ranking-number{color:#829080;font-variant-numeric:tabular-nums}.ranking-hint{font-size:11px;color:#829080}@media(max-width:650px){.ranking-controls{grid-template-columns:1fr 1fr;gap:14px}.ranking-controls>div:first-child{grid-column:1/-1}.search-tabs{flex-wrap:wrap}.search-tabs button{padding:10px 12px;font-size:12px}}
</style>

<style>
.shiren-app .ranking-scroll{max-height:70vh;max-height:70dvh;overflow:auto;overscroll-behavior:contain}
.shiren-app .ranking-table{border-collapse:separate;border-spacing:0}
.shiren-app .ranking-table th{position:sticky;top:0;z-index:1;background:#f9faf6;box-shadow:0 1px 0 #e5eadd}
.shiren-app .ranking-table th,.shiren-app .ranking-table td{padding-left:18px;padding-right:18px}
.shiren-app .table-wrap table.ranking-table td{padding-top:3px;padding-bottom:3px}
.shiren-app .ranking-table .monster-ability-content .ability-list li+li{margin-top:1px}
.shiren-app .ranking-table .monster-ability-content .monster-action-speed{margin:0;line-height:1.3}
.shiren-app .ranking-table th:nth-child(n+3),.shiren-app .ranking-table td.ranking-value{text-align:right}
.shiren-app .ranking-table th.ranking-runes-heading,.shiren-app .ranking-table td.ranking-runes{text-align:left}
.shiren-app .ranking-table .ranking-sort-button{position:relative;text-align:inherit}
.shiren-app .ranking-table .ranking-sort-button span{position:absolute;right:calc(100% + 5px);top:50%;transform:translateY(-50%)}
.shiren-app .ranking-table .ranking-null-note{display:block;font-size:9px;line-height:1.3;white-space:normal;color:#83765f}
.shiren-app .ranking-table th.ranking-abilities-heading,.shiren-app .ranking-table td.ranking-abilities{text-align:left}
.ranking-table td.ranking-abilities{min-width:260px;width:34%;white-space:normal}
</style>
