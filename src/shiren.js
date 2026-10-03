export const methods = ['床落ち・一般ドロップ', '店売り', '変化の壺', 'トドドロップ', '浮島・キラ壁・柱・タベラレルー・ビックリの壺', '交換系NPC', 'デッ怪報酬', '壁内アイテム', '壁内店', '盗み・体当たり・弾き・悪戯']

import { playableFloors } from './shirenFloors.js'

export function categoryId(entry, items) {
  const rarity = items[entry.item_id]?.rarity
  if (entry.category_id === 432758880 && rarity) return rarity === 1 ? 1045712042 : 1688617513
  if (entry.category_id === 1852511598 && rarity) return rarity === 1 ? 1197509669 : 1773773493
  return entry.category_id
}

export function tableProbabilities(table, items) {
  const total = table.categories.reduce((sum, category) => sum + category.weight, 0)
  const sums = new Map()
  for (const item of table.items) {
    const id = categoryId(item, items)
    sums.set(id, (sums.get(id) || 0) + item.weight)
  }
  const result = new Map()
  for (const category of table.categories) for (const item of table.items) {
    if (categoryId(item, items) !== category.category_id || !total || !sums.get(category.category_id)) continue
    const probability = category.weight / total * item.weight / sums.get(category.category_id) * 100
    if (probability > 0) result.set(String(item.item_id), (result.get(String(item.item_id)) || 0) + probability)
  }
  return result
}

export function buildIndex(data) {
  const index = new Map()
  for (const dungeon of data.dungeons) {
    // Its special selection rules are not verified against these draw tables.
    if (dungeon.name === '願いの横穴') continue
    const groups = new Map()
    for (const floor of playableFloors(dungeon)) floor.tables.forEach((table, method) => {
      if (method === 1 && !(floor.exposedShopProb > 0)) return
      if (method === 8 && !(floor.buriedShopProb > 0)) return
      if (method === 7 && !(floor.buriedItemProb > 0)) return
      // An exchange draw table can exist even when no exchange NPC can spawn.
      if (method === 5 && !(floor.npcProb > 0 && floor.exchangeNpcCandidates?.length)) return
      const key = `${table}:${method}`
      if (!groups.has(key)) groups.set(key, { table: String(table), method, floors: [] })
      groups.get(key).floors.push(floor.floor)
    })
    for (const group of groups.values()) {
      const table = dungeon.tables[group.table]
      if (!table) continue
      const probabilities = tableProbabilities(table, data.items)
      const presentCategories = new Set(table.items.filter(item => item.weight > 0).map(item => categoryId(item, data.items)))
      const missingCategories = table.categories.filter(category => category.weight > 0 && !presentCategories.has(category.category_id)).map(category => category.category_id)
      for (const [item, probability] of probabilities) {
        if (!data.items[item] || /^不明なアイテム\s*#/.test(data.items[item].name)) continue
        if (!index.has(item)) index.set(item, [])
        index.get(item).push({ ...group, dungeon: dungeon.id, name: dungeon.name, normalFloors: dungeon.normalFloors, probability, missingCategories, incomplete: false })
      }
    }
  }
  return index
}

export function groupItems(items) {
  const groups = new Map()
  for (const [id, item] of Object.entries(items)) {
    const equipment = item.category === 432758880 || item.category === 1852511598
    const key = equipment ? `${item.category}:${item.name}` : id
    if (!groups.has(key)) groups.set(key, { ...item, id, equipment, categoryId: String(item.category), variants: [] })
    const group = groups.get(key)
    group.variants.push({ id, rarity: item.rarity })
    // Preserve ordinary-item URLs as the canonical selection whenever possible.
    if (item.rarity < group.rarity) Object.assign(group, item, { id })
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'))
}

export function groupedItemRows(item, index) {
  if (!item) return []
  if (!item.equipment) return index.get(item.id) || []
  const relevantCategories = item.category === 432758880
    ? [432758880, 1045712042, 1688617513]
    : [1852511598, 1197509669, 1773773493]
  const rows = new Map()
  for (const variant of item.variants) for (const row of index.get(variant.id) || []) {
    // Only combine rates from the same draw, never different floors or methods.
    const key = `${row.dungeon}:${row.method}:${row.table}`
    if (!rows.has(key)) rows.set(key, { ...row, probability: 0, breakdown: [0, 0, 0] })
    const combined = rows.get(key)
    combined.breakdown[variant.rarity] += row.probability
    combined.probability += row.probability
    combined.incomplete ||= (row.missingCategories || []).some(category => relevantCategories.includes(category))
  }
  return [...rows.values()]
}

export function formatFloors(floors) {
  const sorted = [...new Set(floors)].sort((a, b) => a - b), ranges = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]
    while (sorted[i + 1] === sorted[i] + 1) i++
    ranges.push(start === sorted[i] ? `${start}F` : `${start}–${sorted[i]}F`)
  }
  return ranges.join('、')
}

export const normalize = text => text.normalize('NFKC').replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60)).toLowerCase().trim()

if (typeof document !== 'undefined') {
  Promise.all([import('vue'), import('./Shiren.vue')]).then(([{ createApp }, { default: Shiren }]) => createApp(Shiren).mount('#app'))
}
