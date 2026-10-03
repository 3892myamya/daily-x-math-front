<script setup>
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { formatFloors, normalize } from './shiren.js'
import { buildMonsterIndex } from './shirenMonsters.js'
import ShirenMonsterAbilities from './ShirenMonsterAbilities.vue'

const data = ref(null), index = ref(new Map()), loading = ref(true), error = ref('')
const query = ref(''), family = ref(''), selected = ref(new URLSearchParams(location.search).get('monster') || '')
const dungeon = ref(''), sort = ref('rate')
const monsters = computed(() => data.value ? Object.entries(data.value.monsters).map(([id, monster]) => ({ ...monster, id })).sort((a, b) => a.family.localeCompare(b.family, 'ja') || Number(a.behemoth) - Number(b.behemoth) || (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name, 'ja')) : [])
const families = computed(() => [...new Set(monsters.value.map(monster => monster.family))])
const candidates = computed(() => {
  const name = normalize(query.value)
  return monsters.value.filter(monster => name ? normalize(monster.name).includes(name) : !family.value || monster.family === family.value)
})
const current = computed(() => monsters.value.find(monster => monster.id === selected.value))
const rows = computed(() => {
  return (index.value.get(selected.value) || []).filter(row => (row.method === 0 || row.method === 4) && (!dungeon.value || row.dungeon === dungeon.value))
    .filter(row => row.floors.length).sort((a, b) => sort.value === 'rate' ? (b.probability ?? -1) - (a.probability ?? -1) || a.dungeon.localeCompare(b.dungeon) : a.dungeon.localeCompare(b.dungeon) || a.floors[0] - b.floors[0] || a.method - b.method)
})
function chooseMonster(name) {
  family.value = ''; query.value = ''; reset()
  selected.value = monsters.value.find(monster => monster.name === name)?.id || ''
}
function reset() { dungeon.value = '' }
function syncSelectedUrl(id) {
  const url = new URL(location.href)
  if (id) url.searchParams.set('monster', id)
  else url.searchParams.delete('monster')
  history.replaceState(null, '', url)
}
watch(selected, syncSelectedUrl)
onActivated(() => syncSelectedUrl(selected.value))
async function load() {
  loading.value = true; error.value = ''
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}shiren/monsters.json`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    data.value = await response.json(); index.value = buildMonsterIndex(data.value)
    if (!data.value.monsters[selected.value]) selected.value = ''
  } catch { error.value = 'モンスターデータを読み込めませんでした。' }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <div v-if="loading" class="notice" role="status">モンスターデータを読み込んでいます…</div>
  <div v-else-if="error" class="notice" role="alert">{{ error }} <button @click="load">再読み込み</button></div>
  <div v-else class="workspace">
    <aside class="picker panel">
      <div class="section-title"><h2>モンスターを探す</h2><span>{{ monsters.length }} 種</span></div>
      <label for="monster-search">モンスター名</label>
      <div class="searchbox"><span aria-hidden="true">⌕</span><input id="monster-search" v-model="query" type="search" placeholder="例：マムル、マゼルン" autocomplete="off"></div>
      <label for="monster-family">系統で絞り込む</label><select id="monster-family" v-model="family"><option value="">すべての系統</option><option v-for="name in families" :key="name" :value="name">{{ name }}</option></select>
      <label for="monster-select">モンスター一覧（{{ candidates.length }} 件）</label>
      <select id="monster-select" v-model="selected" :disabled="!candidates.length">
        <option value="">{{ candidates.length ? 'モンスターを選んでください' : '該当するモンスターがありません' }}</option>
        <option v-if="current && !candidates.some(monster => monster.id === selected)" :value="selected" disabled>{{ current.name }}</option>
        <option v-for="monster in candidates" :key="monster.id" :value="monster.id">{{ monster.name }}</option>
      </select>
      <p v-if="!candidates.length" class="empty-small">名前や系統を変えてみてください。</p>
    </aside>
    <section class="results" aria-label="モンスター検索結果">
      <div v-if="!current" class="welcome panel"><div class="welcome-icon" aria-hidden="true">敵</div><h2>探したいモンスターを選んでください</h2><p>出現ダンジョン・階層・抽選率・ステータスを表示します。</p><div class="suggestions"><button v-for="name in ['マゼルン', '洞窟マムル', 'アビスドラゴン']" :key="name" @click="chooseMonster(name)">{{ name }} <span aria-hidden="true">↗</span></button></div></div>
      <template v-else>
        <div class="selected-heading"><div><p class="eyebrow">{{ current.family }}</p><h2>{{ current.name }}</h2></div></div>
        <div class="monster-status panel">
          <div class="monster-basic"><h3>基本ステータス</h3><dl><div v-for="(label, key) in { hp: 'HP', attack: '攻撃力', defense: '防御力', exp: '経験値' }" :key="key"><dt>{{ label }}</dt><dd>{{ current[key] ?? '—' }}</dd></div></dl></div>
          <div class="monster-weakness">
            <h4>弱点印</h4>
            <div v-if="current.weaknessRunes?.length" class="weakness-runes"><span v-for="rune in current.weaknessRunes" :key="rune" class="method-chip">{{ rune }}</span></div>
            <p v-else class="trait-text">該当する属性特攻印なし</p>
            <p v-if="current.behemoth">属性特攻印はバリアを無視できません。デッ怪特攻はバリアを無視する効果です。</p>
          </div>
          <div class="monster-abilities">
            <h4>特殊能力</h4>
            <ShirenMonsterAbilities :monster="current" />
            <details v-if="current.baseAbilities?.length" class="base-abilities"><summary>通常個体の能力（参考）</summary><ul class="ability-list"><li v-for="ability in current.baseAbilities" :key="ability">{{ ability }}</li></ul><p>デッ怪では能力の効果や挙動が異なる場合があります。</p><a :href="current.baseWiki" target="_blank" rel="noopener noreferrer">通常個体のWiki解説 ↗</a></details>
            <p class="trait-source">主要な能力の要約です。詳細・例外は <a :href="current.wiki" target="_blank" rel="noopener noreferrer">攻略Wiki ↗</a> を参照してください。</p>
          </div>
        </div>
        <div class="filterbar monster-filterbar panel">
          <div><label for="monster-dungeon">ダンジョン</label><select id="monster-dungeon" v-model="dungeon"><option value="">すべてのダンジョン</option><option v-for="entry in data.dungeons" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select></div>
          <button class="reset" @click="reset">解除</button>
        </div>
        <div class="result-toolbar"><h3>出現先一覧 <span>{{ rows.length }}</span></h3><label>並び順 <select v-model="sort" aria-label="モンスター結果の並び順"><option value="rate">抽選率が高い順</option><option value="dungeon">ダンジョン・階層順</option></select></label></div>
        <div v-if="rows.length" class="table-wrap panel"><table class="monster-table"><thead><tr><th scope="col">ダンジョン / 階層</th><th scope="col">HP / 攻撃 / 防御 / 経験値</th><th scope="col" class="rate-cell">出現抽選率</th></tr></thead><tbody><tr v-for="row in rows" :key="`${row.dungeon}:${row.method}:${row.floors.join(',')}`">
          <td><span class="dungeon-name">{{ row.name }}</span><p class="floors">{{ formatFloors(row.floors) }}</p><small v-if="row.floors.some(floor => floor > row.normalFloors)" class="extended">通常 {{ row.normalFloors }}F・御神木の拡張階層を含む</small></td>
          <td class="monster-row-stats">{{ row.hp }} / {{ row.attack }} / {{ row.defense }} / {{ row.exp }}</td>
          <td class="rate-cell"><strong>{{ row.probability === null ? '—' : row.probability.toFixed(3) }}<small v-if="row.probability !== null">%</small></strong><small v-if="row.method === 4" class="monster-rate-note">デッ怪内の割合</small></td>
        </tr></tbody></table></div>
        <div v-else class="notice panel">{{ current.specialSpawn ? '店・泥棒時の特殊出現です。通常の階層別抽選テーブルには含まれないため、出現率は表示しません。' : index.get(selected)?.some(row => row.method === 0 || row.method === 4) ? 'この条件に一致する出現先はありません。' : '表示対象の自然出現・デッ怪の設定はありません。モンスターハウス限定・召喚限定・ボス・取り巻き、レベル変化や特殊なイベントでの出現は対象外です。' }}</div>
      </template>
      <details class="data-note" open>
        <summary>出現率とステータスについて</summary>
        <p>通常のモンスターを選ぶと自然出現の設定、デッ怪を選ぶとそのデッ怪の設定を表示します。モンスターハウス限定・召喚限定・ボス・取り巻きの設定は一覧の対象外です。</p>
        <p>通常のモンスターの出現抽選率は、自然出現候補の中でその種類が選ばれる割合です。NPC・旅仲間・デッ怪・限定出現の候補は計算に含めません。デッ怪の出現抽選率は、その階層のデッ怪候補の中でその種類が選ばれる割合です。どちらも種類を選ぶ抽選の割合であり、その階層で遭遇する確率ではありません。</p>
        <p>デッ怪は出現設定が0より大きい階層だけを掲載します。フロアでのデッ怪自体の出現率は表示せず、種類別の抽選率にも掛け合わせていません。</p>
        <p>階層は、通常版と御神木の拡張版で実際に探索できる範囲に限定しています。解析データにだけ存在する上限外の階層は表示しません。「拡張階層を含む」は、表示中の結果に通常版の最終階を超える階層がある場合だけ表示します。</p>
        <p>基本ステータスはモンスターの基本値です。出現先一覧のHP・攻撃・防御・経験値は、ダンジョン別の設定がある場合はその値を使うため、基本値と異なることがあります。元データのHP・経験値の項目名の逆転は、基本データとWikiとの照合により補正しています。名前・系統・弱点印・主要な特殊能力はWikiも参考にしています。</p>
        <p>データは取得時点の内容をこのサイト内に保存しており、自動更新はしていません。レベル変化・特殊イベント・特殊ハウス固有の出現は網羅していないため、一覧にない場所でも出現する場合があります。</p>
      </details>
    </section>
  </div>
</template>

<style>
.monster-status{padding:18px 20px;margin-bottom:20px}.monster-status h3{font-size:14px;margin:0 0 14px}.monster-status dl{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0}.monster-status dt{font-size:11px;color:#77856d}.monster-status dd{font-size:24px;font-weight:700;margin:6px 0 0;color:#38533c}.monster-status p{font-size:11px;color:#829080;margin:14px 0 0}.monster-traits{border-top:1px solid #edf0e8;margin-top:18px;padding-top:4px}.monster-traits h4{font-size:12px;color:#607855;margin:16px 0 9px}.weakness-runes{display:flex;flex-wrap:wrap;gap:7px}.monster-status .trait-text{font-size:12px;margin:0;color:#475348}.ability-list{padding-left:20px;margin:0;color:#475348;font-size:12px;line-height:1.9}.ability-list li+li{margin-top:3px}.base-abilities{margin-top:12px;font-size:11px;line-height:1.8}.base-abilities summary{cursor:pointer;color:#607855}.base-abilities .ability-list{margin-top:8px}.trait-source a,.base-abilities a{text-underline-offset:3px}.monster-row-stats{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12px}.monster-rate-note{display:block;margin-top:7px;white-space:normal;font-size:10px!important;color:#829080;line-height:1.7}.monster-table{min-width:650px}.monster-table td:first-child{width:30%}.search-tabs{display:flex;gap:8px;margin-bottom:22px}.search-tabs button{padding:10px 20px;border:1px solid #dce3d8;border-radius:8px;background:#fff;color:#607855;font-size:13px}.search-tabs button.active{background:#315d46;color:white;border-color:#315d46}
</style>

<style>
.shiren-app .filterbar.monster-filterbar{grid-template-columns:minmax(0,1fr) auto}
.shiren-app .monster-status.panel{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px 18px;padding:10px 12px;margin-bottom:10px}
.shiren-app .monster-status.panel .monster-basic{flex:0 1 280px}
.shiren-app .monster-status.panel .monster-weakness{flex:1 1 130px;min-width:0}
.shiren-app .monster-status.panel .monster-abilities{flex:2 1 220px;min-width:0}
.shiren-app .monster-status.panel h3{font-size:12px;margin:0 0 7px}
.shiren-app .monster-status.panel dl{display:flex;flex-wrap:wrap;gap:8px 12px}
.shiren-app .monster-status.panel dl>div{display:flex;align-items:baseline;gap:7px}
.shiren-app .monster-status.panel dt{font-size:11px}
.shiren-app .monster-status.panel dd{font-size:15px;margin:0}
.shiren-app .monster-status.panel .monster-traits{margin-top:8px;padding-top:2px}
.shiren-app .monster-status.panel h4{font-size:11px;margin:0 0 7px}
.shiren-app .monster-status.panel p{font-size:11px;margin-top:5px;line-height:1.5}
.shiren-app .monster-status.panel .trait-text{margin:0}
.shiren-app .monster-status.panel .weakness-runes{gap:4px}
.shiren-app .monster-status.panel .method-chip{font-size:10px;padding:2px 5px}
.shiren-app .monster-status.panel .ability-list{font-size:11px;line-height:1.5;padding-left:16px}
.shiren-app .monster-status.panel .ability-list li+li{margin-top:1px}
.shiren-app .monster-status.panel .base-abilities{margin-top:6px;line-height:1.5}
.shiren-app .monster-status.panel .base-abilities .ability-list{margin-top:4px}
</style>

<style>
@media(max-width:650px){.shiren-app .filterbar.monster-filterbar{grid-template-columns:minmax(0,1fr) auto}.shiren-app .monster-filterbar .reset{justify-self:end;grid-column:2}}
</style>
