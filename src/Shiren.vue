<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import ShirenMonsterFinder from './ShirenMonsterFinder.vue'
import ShirenMonsterRanking from './ShirenMonsterRanking.vue'
import { buildIndex, groupItems, groupedItemRows, formatFloors, methods, normalize } from './shiren.js'

const data = ref(null), index = ref(new Map()), loading = ref(true), error = ref('')
const query = ref(''), category = ref(''), selected = ref(''), dungeon = ref(''), method = ref(''), sort = ref('rate')
const params = new URLSearchParams(location.search)
selected.value = params.get('item') || ''
const mode = ref(params.get('mode') === 'ranking' ? 'ranking' : params.get('mode') === 'monster' || params.has('monster') ? 'monster' : 'item')
watch(mode, value => {
  const url = new URL(location.href)
  if (value === 'monster' || value === 'ranking') url.searchParams.set('mode', value)
  else { url.searchParams.delete('mode'); url.searchParams.delete('monster') }
  history.replaceState(null, '', url)
})
const items = computed(() => data.value ? groupItems(data.value.items) : [])
const categories = computed(() => [...new Set(items.value.map(item => item.categoryId))].map(id => ({ id, name: data.value.categories[id] || `種類 #${id}` })))
const candidates = computed(() => {
  const name = normalize(query.value)
  return items.value.filter(item => name ? normalize(item.name).includes(name) : !category.value || item.categoryId === category.value)
})
const currentItem = computed(() => items.value.find(item => item.id === selected.value))
const allRows = computed(() => groupedItemRows(currentItem.value, index.value))
const rows = computed(() => {
  return allRows.value.filter(row => (!dungeon.value || row.dungeon === dungeon.value) && (method.value === '' || row.method === Number(method.value)))
    .filter(row => row.floors.length).sort((a, b) => sort.value === 'rate' ? b.probability - a.probability || a.dungeon.localeCompare(b.dungeon) : a.dungeon.localeCompare(b.dungeon) || a.floors[0] - b.floors[0] || a.method - b.method)
})
function choose(id) { query.value = ''; category.value = ''; selected.value = id }
function resetFilters() { dungeon.value = ''; method.value = '' }
watch(selected, id => {
  const url = new URL(location.href)
  if (id) url.searchParams.set('item', id)
  else url.searchParams.delete('item')
  history.replaceState(null, '', url)
})
async function load() {
  loading.value = true; error.value = ''
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}shiren/data.json`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const snapshot = await response.json()
    index.value = buildIndex(snapshot); data.value = snapshot
    selected.value = items.value.find(item => item.variants.some(variant => variant.id === selected.value))?.id || ''
  } catch { error.value = 'データを読み込めませんでした。再読み込みをお試しください。' }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <div class="shiren-app">
    <header class="topbar"><a class="brand" href="./shiren.html"><span class="brand-mark" aria-hidden="true">探</span> シレン6 データ検索</a></header>
    <main>
      <nav class="search-tabs" aria-label="検索対象"><button :class="{ active: mode === 'item' }" :aria-pressed="mode === 'item'" @click="mode = 'item'">アイテムを探す</button><button :class="{ active: mode === 'monster' }" :aria-pressed="mode === 'monster'" @click="mode = 'monster'">モンスターを探す</button><button :class="{ active: mode === 'ranking' }" :aria-pressed="mode === 'ranking'" @click="mode = 'ranking'">モンスターランキング</button></nav>
      <KeepAlive>
        <ShirenMonsterFinder v-if="mode === 'monster'" />
        <ShirenMonsterRanking v-else-if="mode === 'ranking'" />
      </KeepAlive>
      <div v-show="mode === 'item'">
      <div v-if="loading" class="notice" role="status">解析データを読み込んでいます…</div>
      <div v-else-if="error" class="notice" role="alert">{{ error }} <button @click="load">再読み込み</button></div>
      <div v-else class="workspace">
        <aside class="picker panel">
          <div class="section-title"><h2>道具を探す</h2><span>{{ items.length }} 種</span></div>
          <label class="search-label" for="item-search">アイテム名</label>
          <div class="searchbox"><span aria-hidden="true">⌕</span><input id="item-search" v-model="query" type="search" placeholder="例：復活の草、かまいたち" autocomplete="off"></div>
          <label for="category">種類で絞り込む</label><select id="category" v-model="category"><option value="">すべての種類</option><option v-for="entry in categories" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select>
          <label for="item-select">アイテム一覧（{{ candidates.length }} 件）</label>
          <select id="item-select" v-model="selected" :disabled="!candidates.length">
            <option value="">{{ candidates.length ? 'アイテムを選んでください' : '該当するアイテムがありません' }}</option>
            <option v-if="currentItem && !candidates.some(item => item.id === selected)" :value="selected" disabled>{{ currentItem.name }}</option>
            <option v-for="item in candidates" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
          <p v-if="!candidates.length" class="empty-small">見つかりませんでした。<br>名前や種類を変えてみてください。</p>
        </aside>
        <section class="results" aria-label="逆引き結果">
          <div v-if="!currentItem" class="welcome panel"><div class="welcome-icon" aria-hidden="true">品</div><h2>探したいアイテムを選んでください</h2><p>入手ダンジョン・階層・入手方法・抽選率を表示します。</p><div class="suggestions"><button v-for="name in ['復活の草', '妖刀かまいたち', '白紙の巻物']" :key="name" @click="choose(items.find(item => item.name === name)?.id || '')">{{ name }} <span aria-hidden="true">↗</span></button></div></div>
          <template v-else>
            <div class="selected-heading"><div><p class="eyebrow">{{ data.categories[currentItem.categoryId] }}</p><h2>{{ currentItem.name }}</h2></div></div>
            <div class="filterbar panel"><div><label for="dungeon">ダンジョン</label><select id="dungeon" v-model="dungeon"><option value="">すべてのダンジョン</option><option v-for="entry in data.dungeons" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select></div><div><label for="method">入手方法</label><select id="method" v-model="method"><option value="">すべての方法</option><option v-for="(name, id) in methods" :key="id" :value="String(id)">{{ name }}</option></select></div><button class="reset" @click="resetFilters">解除</button></div>
            <div class="result-toolbar"><h3>入手先一覧 <span>{{ rows.length }}</span></h3><label>並び順 <select v-model="sort" aria-label="結果の並び順"><option value="rate">抽選率が高い順</option><option value="dungeon">ダンジョン・階層順</option></select></label></div>
            <div v-if="rows.length" class="table-wrap panel"><table><thead><tr><th scope="col">ダンジョン / 階層</th><th scope="col">入手方法</th><th scope="col" class="rate-cell">{{ currentItem.equipment ? '合計抽選率 / 内訳' : '抽選率' }}</th></tr></thead><tbody><tr v-for="row in rows" :key="`${row.dungeon}:${row.method}:${row.table}`"><td><span class="dungeon-name">{{ row.name }}</span><p class="floors">{{ formatFloors(row.floors) }}</p><small v-if="row.floors.some(floor => floor > row.normalFloors)" class="extended">通常 {{ row.normalFloors }}F・御神木の拡張階層を含む</small></td><td><span class="method-chip" :class="{ floor: row.method === 0, shop: row.method === 1 || row.method === 8 }">{{ methods[row.method] || `方法 #${row.method}` }}</span><small v-if="row.incomplete" class="extended">候補データの一部が未収録</small></td><td class="rate-cell"><strong>{{ row.probability.toFixed(3) }}<small>%</small></strong><dl v-if="row.breakdown" class="rate-breakdown"><div v-for="(label, rarity) in ['通常', '青神器', '金神器']" :key="rarity"><dt>{{ label }}</dt><dd>{{ row.breakdown[rarity].toFixed(3) }}%</dd></div></dl><div class="rate-track" aria-hidden="true"><i :style="{ width: `${row.probability}%` }"></i></div></td></tr></tbody></table></div>
            <div v-else class="notice panel">{{ allRows.length ? 'この条件に一致する入手先はありません。絞り込みを解除してみてください。' : 'このアイテムを抽選する、階層に紐づいた入手テーブルはありません。' }}</div>
          </template>
          <details class="data-note" open>
            <summary>抽選率とデータについて</summary>
            <p>抽選率は、カテゴリとアイテムそれぞれの重みから計算した、アイテム1回の抽選に対する確率です。店・NPC・イベント・敵の出現率や、1フロアでそのアイテムを入手できる確率は含みません。</p>
            <p>入手方法は元の解析データの分類に基づきます。店売り・壁内店は、階層ごとの出現設定と地形条件から出現できる階層だけを表示します。交換系NPCは、徘徊NPCの出現率が0より大きく、交換役が出現候補にいる階層だけを表示します。デッ怪報酬は、デッ怪の出現設定が0より大きい階層だけを表示します。壁内アイテムは、ReportViewerで壁内アイテムの設定が有効となるランダム生成の地形で、発生率と配置数が0より大きい階層だけを表示します。表示されていても、その入手機会が毎回発生するとは限りません。他の入手方法は、階層が参照する抽選テーブルを掲載しており、入手機会の有無をすべて確認したものではありません。</p>
            <p>階層は、通常版と御神木の拡張版で実際に探索できる範囲に限定しています。解析データにだけ存在する上限外の階層は表示しません。「拡張階層を含む」は、表示中の結果に通常版の最終階を超える階層がある場合だけ表示します。</p>
            <p>武器・盾は通常・青神器・金神器をまとめて選択でき、同じ抽選テーブルでの合計と内訳を表示します。そのテーブルで抽選されない種類は0%です。武器・盾の合計に関係するカテゴリの候補が未収録の場合は注記します。未収録分を除いて残りの候補の確率を100%に補正することはありません。</p>
            <p>データは取得時点の内容をこのサイト内に保存しており、自動更新はしていません。アイテム名は攻略Wikiの一覧と照合しています。願いの横穴、階層に紐づかないテーブル、初期所持品、固定報酬、個別の敵・イベント固有の入手は検索対象外です。一覧に表示されなくても、ゲーム内で入手できないとは限りません。</p>
          </details>
        </section>
      </div>
      </div>
      <footer v-if="data"><span>このサイトは非公式のツールであり、風来のシレン6の公式とは関係ありません。</span><span>出典：<a :href="data.source" target="_blank" rel="noopener noreferrer">Dungeon Report Viewer</a> · アイテム照合：<a href="https://shiren6.game-info.wiki/" target="_blank" rel="noopener noreferrer">シレン6攻略Wiki</a></span></footer>
    </main>
  </div>
</template>

<style>
:root{font-family:'Noto Sans JP',sans-serif;color:#293a32;background:#f5f6f2;font-synthesis:none}body{margin:0}.shiren-app *{box-sizing:border-box}.shiren-app button,.shiren-app input,.shiren-app select{font:inherit}.shiren-app button,.shiren-app select{cursor:pointer}.shiren-app a{color:inherit}.shiren-app button:focus-visible,.shiren-app a:focus-visible,.shiren-app input:focus-visible,.shiren-app select:focus-visible{outline:3px solid #88b59b;outline-offset:3px}.topbar{min-height:76px;padding:18px max(24px,calc((100vw - 1240px)/2));border-bottom:1px solid #dfe5db;display:flex;align-items:center;justify-content:space-between;background:#fff}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;font-weight:700;white-space:nowrap}.brand-mark{display:grid;place-items:center;background:#315d46;color:#fff;border-radius:9px;width:36px;height:36px;font-family:serif}.version{font-size:10px;letter-spacing:1.5px;color:#839184;margin-left:8px}.source-link{font-size:12px;text-decoration:none;color:#68766b!important}main{max-width:1240px;margin:auto;padding:24px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:1.7px;color:#65816c;margin:0 0 12px}.workspace{display:grid;grid-template-columns:290px minmax(0,1fr);gap:28px;align-items:start}.panel{background:white;border:1px solid #e0e5dc;border-radius:14px}.picker{padding:22px 18px 12px}.section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}.section-title h2{font-size:16px;margin:0}.section-title>span{font-size:11px;color:#839184;background:#f2f5ef;padding:4px 9px;border-radius:20px}.shiren-app label{display:block;font-size:11px;font-weight:500;color:#6b786d;margin-bottom:8px}.searchbox{display:flex;gap:9px;align-items:center;border:1px solid #dce3d8;border-radius:8px;padding:9px 10px;background:#fafbf8;margin-bottom:18px}.searchbox>span{font-size:23px;line-height:1;color:#839184}.searchbox input{min-width:0;width:100%;border:0;background:transparent;font-size:12px;outline:none;padding:3px 0}.shiren-app select{border:1px solid #dce3d8;background:#fff;border-radius:7px;padding:10px;font-size:12px;color:#354b3d;max-width:100%}.picker select{width:100%;margin-bottom:23px}.results{min-width:0}.welcome{min-height:400px;text-align:center;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:40px 24px}.welcome-icon{font-family:serif;font-size:40px;background:#f1f4e9;width:86px;height:86px;display:grid;place-items:center;border-radius:25px;color:#698263;margin-bottom:24px;transform:rotate(-6deg)}.welcome h2{font-size:19px;margin:3px 0 12px}.welcome>p:not(.eyebrow){font-size:12px;color:#829080}.suggestions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:18px}.suggestions button{background:#fff;border:1px solid #dde5d7;color:#607855;font-size:12px;padding:9px 13px;border-radius:7px}.selected-heading{display:flex;align-items:center;justify-content:space-between;margin:4px 0 22px}.selected-heading h2{font-size:27px;margin:0}.selected-heading .eyebrow{margin-bottom:7px}.selected-badge{font-size:11px;border:1px solid #d4dfcc;border-radius:20px;padding:7px 12px;color:#6d8162}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}.stats>div{border:1px solid #dce4d6;background:#f0f4e9;border-radius:11px;padding:17px 20px}.stats span{display:block;font-size:11px;color:#77856d}.stats strong{display:block;font-size:25px;margin-top:8px;color:#38533c}.stats small{font-size:11px;font-weight:400;margin-left:7px;color:#7c8b72}.filterbar{padding:17px;display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end}.filterbar select{width:100%}.filterbar>div{min-width:0}.reset{border:0;background:none;color:#7a8974;padding:10px 0;font-size:11px!important}.result-toolbar{display:flex;justify-content:space-between;align-items:center;margin:23px 0 13px}.result-toolbar h3{font-size:14px;margin:0}.result-toolbar h3 span{font-size:11px;color:#84927c;margin-left:7px;font-weight:400}.result-toolbar label{display:flex;align-items:center;gap:8px;margin:0}.result-toolbar select{font-size:11px;padding:7px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left}th{background:#f9faf6;color:#84907d;font-size:11px;font-weight:500;padding:14px 18px;border-bottom:1px solid #e5eadd}td{padding:18px;border-bottom:1px solid #edf0e8;font-size:13px}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#fafcf7}td:first-child{width:39%;min-width:180px}.dungeon-name{font-weight:600}td>a{text-decoration:none;font-weight:600;color:#3f5642!important}td>a:hover{text-decoration:underline}td>a span{font-size:11px;color:#a0ae96;margin-left:4px}.floors{font-size:12px;color:#85917c;margin:7px 0 0;line-height:1.7}.extended{font-size:10px;color:#ac8c57;display:block;margin-top:5px}.method-chip{display:inline-block;background:#f1f2ed;color:#758169;padding:5px 8px;border-radius:5px;font-size:11px;line-height:1.7}.method-chip.floor{background:#edf4e8;color:#648451}.method-chip.shop{background:#f9f1e2;color:#a18a57}.rate-cell{text-align:right;white-space:nowrap}.rate-cell strong{font-size:18px;color:#42613e;font-variant-numeric:tabular-nums}.rate-cell small{font-size:11px;font-weight:400;margin-left:3px}.rate-breakdown{margin:10px 0 0;font-size:10px;color:#6b786d;font-variant-numeric:tabular-nums}.rate-breakdown>div{display:flex;justify-content:space-between;gap:12px;margin-top:4px}.rate-breakdown dt,.rate-breakdown dd{margin:0}.rate-track{height:3px;background:#edf1e6;border-radius:3px;margin:9px 0 0 auto;width:75px}.rate-track i{display:block;background:#90aa72;height:100%;min-width:1px}.data-note{padding:20px 4px;color:#8a9482;font-size:11px;line-height:1.9}.data-note summary{cursor:pointer;color:#6b7c62;font-weight:500}.data-note p{margin:9px 0 0}.notice{text-align:center;padding:50px 25px;color:#7f8a76;font-size:13px}.notice button{margin:12px;border:1px solid #cddbc4;padding:8px 12px;background:#fff;border-radius:6px}.empty-small{font-size:12px;color:#8a9482;line-height:1.9;text-align:center;margin:30px 0}footer{border-top:1px solid #dfe5d7;margin-top:36px;padding-top:20px;display:flex;justify-content:space-between;gap:16px;font-size:10px;color:#8d9987}footer a{text-underline-offset:3px}@media(min-width:1000px){.picker{position:sticky;top:20px}}@media(max-width:900px){.workspace{grid-template-columns:245px minmax(0,1fr);gap:18px}.filterbar{grid-template-columns:1fr 1fr}.stats>div{padding:14px 12px}.stats strong{font-size:21px}.selected-badge{display:none}td,th{padding:13px}.version{display:none}}@media(max-width:650px){.topbar{padding:14px 18px;min-height:64px}.brand{font-size:13px;gap:8px}.source-link{font-size:10px}.brand-mark{width:29px;height:29px}main{padding:18px 16px 20px}.workspace{grid-template-columns:1fr}.picker{padding:18px}.section-title{margin-bottom:16px}.picker select{margin-bottom:16px}.selected-heading{margin-top:12px}.stats{gap:7px}.stats>div{padding:12px 9px}.stats span{font-size:10px}.stats strong{font-size:20px}.stats small{margin-left:3px;font-size:10px}.result-toolbar label{font-size:10px;gap:4px}.table-wrap table{min-width:500px}.data-note{padding-top:17px}footer{flex-direction:column;gap:8px;line-height:1.8}.welcome{min-height:320px}.welcome h2{font-size:17px}}
</style>

<style>
/* Compact spacing shared by the item, monster and ranking views. */
.shiren-app .topbar{min-height:56px;padding-top:10px;padding-bottom:10px}
.shiren-app main{padding:14px 18px}
.shiren-app .workspace{gap:16px;grid-template-columns:250px minmax(0,1fr)}
.shiren-app .panel{border-radius:9px}
.shiren-app .picker{padding:14px 12px 4px}
.shiren-app .section-title{margin-bottom:12px}
.shiren-app label{margin-bottom:5px}
.shiren-app select{padding:7px 9px}
.shiren-app .picker select{margin-bottom:13px}
.shiren-app .searchbox{padding:5px 8px;margin-bottom:12px}
.shiren-app .search-tabs{margin-bottom:12px;gap:6px}
.shiren-app .search-tabs button{padding:7px 12px}
.shiren-app .selected-heading{margin:2px 0 12px}
.shiren-app .selected-heading h2{font-size:23px}
.shiren-app .stats{gap:8px;margin-bottom:12px}
.shiren-app .stats>div{padding:10px 12px}
.shiren-app .stats strong{font-size:22px;margin-top:4px}
.shiren-app .filterbar,.shiren-app .ranking-controls{padding:10px 12px;gap:10px}
.shiren-app .behemoth-toggle{min-height:28px}
.shiren-app .result-toolbar{margin:13px 0 8px}
.shiren-app .table-wrap table th{padding:8px 12px}
.shiren-app .table-wrap table td{padding:3px 12px}
.shiren-app .table-wrap .floors{margin:3px 0 0;line-height:1.4}
.shiren-app .table-wrap .extended{margin-top:1px;line-height:1.3}
.shiren-app .ranking-runes span{line-height:1.5}
.shiren-app .rate-cell strong{font-size:16px}
.shiren-app .rate-breakdown{margin:5px 0 0}
.shiren-app .method-chip{padding:3px 6px}
.shiren-app .monster-status{padding:12px 14px;margin-bottom:12px}
.shiren-app .monster-status h3{margin-bottom:9px}
.shiren-app .monster-status dl{gap:8px}
.shiren-app .monster-status dd{font-size:21px;margin-top:3px}
.shiren-app .monster-status p{margin-top:8px}
.shiren-app .monster-traits{margin-top:10px}
.shiren-app .monster-traits h4{margin:10px 0 5px}
.shiren-app .ability-list{line-height:1.6}
.shiren-app .monster-rate-note{margin-top:4px;line-height:1.4}
.shiren-app .data-note{padding-top:10px}
@media(max-width:650px){.shiren-app main{padding:12px}.shiren-app .workspace{grid-template-columns:1fr;gap:12px}.shiren-app .ranking-controls{gap:8px}.shiren-app .table-wrap table th{padding:7px 9px}.shiren-app .table-wrap table td{padding:3px 9px}}
</style>

<style>
.shiren-app{min-height:100vh;color:#38332b;background-color:#f2ecdd;background-image:radial-gradient(ellipse at 15% 0%,#fffaf0aa,transparent 55%),repeating-linear-gradient(0deg,#735a3210 0,#735a3210 1px,transparent 1px,transparent 5px)}
.shiren-app .topbar{background:#302e28;color:#f5ebd4;border-bottom:3px solid #9e4434}
.shiren-app .brand,.shiren-app h2,.shiren-app h3{font-family:'Noto Serif JP','Yu Mincho','Hiragino Mincho ProN',serif;letter-spacing:.04em}
.shiren-app .brand-mark{background:#a34736;border:1px solid #c17c60;border-radius:3px;transform:rotate(-4deg)}
.shiren-app .source-link{color:#ded1b9!important}.shiren-app .version{color:#c1ad88}
.shiren-app .panel{background:#fffaf0;border-color:#cfc1a5;border-radius:4px;box-shadow:0 2px 5px #58432808}
.shiren-app .picker{border-top:3px solid #7b6342}
.shiren-app .search-tabs{border-bottom:1px solid #bfae8f;padding-bottom:8px}
.shiren-app .search-tabs button{background:#faf4e7;color:#65543e;border-color:#c6b594;border-radius:3px}
.shiren-app .search-tabs button.active{background:#863d30;color:#fff4df;border-color:#863d30}
@media(min-width:400px) and (max-width:650px){
  .shiren-app .search-tabs{flex-wrap:nowrap;gap:4px}
  .shiren-app .search-tabs button{padding:7px 8px;font-size:12px;white-space:nowrap}
}
.shiren-app .searchbox,.shiren-app select{background:#fffdf6;border-color:#cfc1a5;border-radius:3px;color:#393a30}
.shiren-app label,.shiren-app .eyebrow{color:#776449}
.shiren-app .section-title>span{background:#ece3ce;color:#75644b;border-radius:3px}
.shiren-app .welcome-icon{color:#983f30;background:#f3e5cf;border:1px solid #b96f51;border-radius:4px;box-shadow:inset 0 0 0 4px #fffaf0}
.shiren-app .welcome>p,.shiren-app .floors{color:#83765f}
.shiren-app .suggestions button{background:#fffaf0;border:1px solid #bca582;color:#6e4e36;border-radius:3px}
.shiren-app .suggestions button:hover{background:#f1e3cc;border-color:#9e4434}
.shiren-app .stats>div{background:#eee5d2;border-color:#ccbd9e;border-radius:4px}
.shiren-app .stats strong,.shiren-app .monster-status dd,.shiren-app .rate-cell strong{color:#714d35}
.shiren-app .table-wrap table th{background:#eae0c9;color:#6c5940;border-bottom-color:#c9b895}
.shiren-app .table-wrap table td{border-bottom-color:#e5dac3}
.shiren-app .table-wrap tbody tr:hover{background:#f3ead7}
.shiren-app td>a{color:#654d32!important}
.shiren-app .ranking-highlight{color:#853b2c;background:#f3e4d1}
.shiren-app .ranking-table th{box-shadow:0 1px 0 #c9b895}
.shiren-app .ranking-sort-button span{color:#983f30}
.shiren-app .method-chip{background:#ece3d1;color:#756047;border-radius:3px}
.shiren-app .method-chip.floor{background:#e7ead7;color:#5e6746}.shiren-app .method-chip.shop{background:#f0dfc7;color:#886039}
.shiren-app .rate-track i{background:#987349}
.shiren-app .behemoth-toggle input{accent-color:#983f30}
.shiren-app .ranking-controls{grid-template-columns:1fr 1fr auto}
@media(max-width:650px){.shiren-app .ranking-controls{grid-template-columns:1fr 1fr}.shiren-app .ranking-controls>div:first-child{grid-column:auto}.shiren-app .ranking-toggles{grid-column:1/-1;flex-direction:row;gap:18px}}

@media(max-width:650px){
  .shiren-app .table-wrap table{min-width:0;width:100%;table-layout:fixed}
  .shiren-app .table-wrap table th,.shiren-app .table-wrap table td{min-width:0;padding-left:5px;padding-right:5px;font-size:11px;overflow-wrap:anywhere}
  .shiren-app .table-wrap table td:first-child{width:40%;min-width:0}
  .shiren-app .table-wrap table th:first-child{width:40%}
  .shiren-app .table-wrap table th:last-child{width:25%}
  .shiren-app .table-wrap .floors{font-size:10px}
  .shiren-app .table-wrap .extended{font-size:9px}
  .shiren-app .table-wrap .method-chip{font-size:10px;padding:2px 4px;white-space:normal}
  .shiren-app .table-wrap .rate-cell{white-space:normal}
  .shiren-app .table-wrap .rate-cell strong{font-size:12px;white-space:nowrap}
  .shiren-app .table-wrap .rate-cell strong small{font-size:9px;margin-left:1px}
  .shiren-app .table-wrap .rate-track{max-width:100%}
  .shiren-app .table-wrap .rate-breakdown>div{gap:3px;flex-wrap:wrap}
  .shiren-app .table-wrap .monster-row-stats{white-space:normal;font-size:10px;line-height:1.6}
  .shiren-app .table-wrap table.ranking-table th,.shiren-app .table-wrap table.ranking-table td{padding-left:3px;padding-right:3px;font-size:10px}
  .shiren-app .table-wrap table.ranking-table th:first-child,.shiren-app .table-wrap table.ranking-table td:first-child{width:7%}
  .shiren-app .table-wrap table.ranking-table th:nth-child(2),.shiren-app .table-wrap table.ranking-table td:nth-child(2){width:29%;min-width:0}
  .shiren-app .table-wrap table.ranking-table th:nth-child(n+3){width:auto}
  .shiren-app .table-wrap table.ranking-table .ranking-runes-heading,.shiren-app .table-wrap table.ranking-table .ranking-runes,
  .shiren-app .table-wrap table.ranking-table .ranking-abilities-heading,.shiren-app .table-wrap table.ranking-table .ranking-abilities{display:none}
  .shiren-app .table-wrap table.ranking-table .ranking-sort-button{font-size:10px;white-space:normal;overflow-wrap:anywhere;line-height:1.4}
  .shiren-app .table-wrap table.ranking-table .ranking-sort-button span{position:static;transform:none;font-size:8px}
  .shiren-app .result-toolbar{gap:6px;flex-wrap:wrap}
}
</style>
