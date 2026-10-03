import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { shopSettings } from '../scripts/shiren-shops.mjs'
import { buriedItemSettings } from '../scripts/shiren-buried-items.mjs'
import { exchangeNpcSettings } from '../scripts/shiren-npc.mjs'
import { playableFloorLimits } from './shirenFloors.js'
import { buildIndex, categoryId, groupItems, groupedItemRows, formatFloors, normalize, tableProbabilities } from './shiren.js'
const data = JSON.parse(fs.readFileSync(new URL('../public/shiren/data.json', import.meta.url)))

test('category and item weights both contribute; duplicate entries combine', () => {
  const table = { categories: [{ category_id: 1, weight: 30 }, { category_id: 2, weight: 70 }], items: [{ item_id: 10, category_id: 1, weight: 1 }, { item_id: 10, category_id: 1, weight: 2 }, { item_id: 11, category_id: 1, weight: 3 }, { item_id: 12, category_id: 2, weight: 5 }] }
  const result = tableProbabilities(table, {})
  assert.equal(result.get('10'), 15)
  assert.equal(result.get('11'), 15)
  assert.equal(result.get('12'), 70)
})
test('blue and gold sacred equipment use distinct category denominators', () => {
  const items = { 1: { rarity: 0 }, 2: { rarity: 1 }, 3: { rarity: 2 } }
  const entries = [1, 2, 3].map(item_id => ({ item_id, category_id: 432758880, weight: 1 }))
  assert.deepEqual(entries.map(entry => categoryId(entry, items)), [432758880, 1045712042, 1688617513])
  const result = tableProbabilities({ categories: [{ category_id: 432758880, weight: 70 }, { category_id: 1045712042, weight: 20 }, { category_id: 1688617513, weight: 10 }], items: entries }, items)
  assert.deepEqual([...result.values()], [70, 20, 10])
})
test('unused tables are excluded, method zero is retained, actual floor numbers are grouped', () => {
  const table = { categories: [{ category_id: 1, weight: 1 }], items: [{ item_id: 1, category_id: 1, weight: 1 }] }
  const index = buildIndex({ items: { 1: { name: '薬草' }, 2: { name: '復活の草' } }, dungeons: [{ id: 'D001', name: 'test', normalFloors: 3, tables: { 0: table, 99: { ...table, items: [{ item_id: 2, category_id: 1, weight: 1 }] } }, floors: [{ floor: 2, tables: [0, 0], exposedShopProb: 10 }, { floor: 4, tables: [0, 0], exposedShopProb: 10 }] }] })
  assert.equal(index.has('2'), false)
  assert.deepEqual(index.get('1').map(row => [row.method, row.floors]), [[0, [2, 4]], [1, [2, 4]]])
})
test('development items are excluded without inflating real item rates', () => {
  const table = { categories: [{ category_id: 1, weight: 1 }], items: [1, 2, 3].map(item_id => ({ item_id, category_id: 1, weight: 1 })) }
  const index = buildIndex({ items: { 1: { name: '薬草' }, 2: { name: '不明なアイテム #2' } }, dungeons: [{ id: 'D001', tables: { 0: table }, floors: [{ floor: 1, tables: [0] }] }] })
  assert.deepEqual([...index.keys()], ['1'])
  assert.ok(Math.abs(index.get('1')[0].probability - 100 / 3) < 1e-10)
})
test('selectable snapshot items all belong to the wiki-checked catalog', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../scripts/shiren-item-catalog.json', import.meta.url)))
  const names = new Set(catalog.names)
  assert.equal(Object.keys(data.items).length, 595)
  for (const item of Object.values(data.items)) {
    assert.ok(names.has(item.name), item.name)
    assert.ok(!item.name.startsWith('不明なアイテム #'))
  }
})
test('missing category candidates are not renormalized into misleading rates', () => {
  const table = { categories: [{ category_id: 1, weight: 1 }, { category_id: 2, weight: 1 }], items: [{ item_id: 1, category_id: 1, weight: 1 }] }
  assert.equal(tableProbabilities(table, {}).get('1'), 50)
  assert.equal(tableProbabilities({ categories: [], items: table.items }, {}).size, 0)
})
test('floor ranges and Japanese searches normalize correctly', () => {
  assert.equal(formatFloors([7, 1, 2, 4, 5, 7]), '1–2F、4–5F、7F')
  assert.equal(formatFloors([]), '')
  assert.equal(normalize(' シレン６ '), normalize('しれん6'))
  assert.equal(normalize('ｶﾀｶﾅ'), 'かたかな')
})
test('snapshot has valid referenced tables and rates; D001 revival grass matches source weights', () => {
  assert.equal(data.dungeons.length, 38)
  for (const dungeon of data.dungeons) {
    for (const floor of dungeon.floors) for (const id of floor.tables) assert.ok(dungeon.tables[id], `${dungeon.id} ${floor.floor}F missing #${id}`)
    for (const table of Object.values(dungeon.tables)) {
      const rates = [...tableProbabilities(table, data.items).values()]
      assert.ok(rates.every(rate => Number.isFinite(rate) && rate > 0 && rate <= 100))
      assert.ok(rates.reduce((sum, rate) => sum + rate, 0) <= 100 + 1e-8)
    }
  }
  const index = buildIndex(data)
  const row = index.get('1063442895').find(row => row.dungeon === 'D001' && row.method === 0 && row.table === '0')
  assert.deepEqual(row.floors, [1, 2, 3, 4])
  assert.ok(Math.abs(row.probability - 1.06951871657754) < 1e-10)
})

test('equipment selection merges rarities and preserves ordinary canonical IDs', () => {
  const groups = groupItems(data.items)
  for (const name of ['妖刀かまいたち', '鉄甲の盾']) {
    const matches = groups.filter(item => item.name === name)
    assert.equal(matches.length, 1)
    assert.deepEqual(matches[0].variants.map(v => v.rarity).sort(), [0, 1, 2])
    assert.equal(data.items[matches[0].id].rarity, 0)
    assert.equal(matches[0].categoryId, String(data.items[matches[0].id].category))
  }
  const grass = groups.find(item => item.name === '復活の草')
  assert.equal(grass.equipment, false)
  assert.equal(grass.variants.length, 1)
})
test('variant rates sum only within the same dungeon, draw table and method', () => {
  const item = { equipment: true, variants: [{ id: 'a', rarity: 0 }, { id: 'b', rarity: 1 }, { id: 'c', rarity: 2 }] }
  const base = { dungeon: 'D001', method: 0, table: '0', floors: [1, 2], incomplete: false }
  const index = new Map([
    ['a', [{ ...base, probability: 10 }]],
    ['b', [{ ...base, probability: 2 }, { ...base, method: 1, probability: 4 }]],
    ['c', [{ ...base, probability: 1 }, { ...base, table: '1', floors: [3], probability: 5 }, { ...base, dungeon: 'D002', probability: 6 }]],
  ])
  const rows = groupedItemRows(item, index)
  assert.equal(rows.length, 4)
  assert.equal(rows[0].probability, 13)
  assert.deepEqual(rows[0].breakdown, [10, 2, 1])
  assert.deepEqual(rows[1].breakdown, [0, 4, 0])
  assert.deepEqual(rows[2].floors, [3])
  assert.equal(index.get('a')[0].probability, 10)
})
test('all equipment breakdowns agree with original snapshot probabilities', () => {
  const index = buildIndex(data)
  for (const item of groupItems(data.items)) {
    const rows = groupedItemRows(item, index)
    if (!item.equipment) {
      assert.deepEqual(rows, index.get(item.id) || [])
      continue
    }
    for (const row of rows) {
      const expected = [0, 0, 0]
      for (const variant of item.variants) for (const original of index.get(variant.id) || []) {
        if (original.dungeon === row.dungeon && original.method === row.method && original.table === row.table) expected[variant.rarity] += original.probability
      }
      assert.deepEqual(row.breakdown, expected)
      assert.ok(Math.abs(row.probability - expected.reduce((a, b) => a + b, 0)) < 1e-10)
      assert.ok(row.probability <= 100 + 1e-8)
    }
  }
})

test('unrelated missing categories do not warn for clairvoyance bracelets', () => {
  const index = buildIndex(data)
  const item = groupItems(data.items).find(item => item.name === '透視の腕輪')
  const row = groupedItemRows(item, index).find(row => row.dungeon === 'D078' && row.table === '15' && row.method === 8)
  assert.ok(row.missingCategories.length > 0)
  assert.equal(row.incomplete, false)
  assert.ok(Math.abs(row.probability - 100 / 18) < 1e-10)
})
test('equipment warns only for missing categories in its own weapon or shield family', () => {
  const item = { category: 432758880, equipment: true, variants: [{ id: 'a', rarity: 0 }] }
  const base = { dungeon: 'D001', method: 0, table: '0', floors: [1], probability: 10, incomplete: false }
  const unrelated = new Map([['a', [{ ...base, missingCategories: [1197509669, 1773773493] }]]])
  assert.equal(groupedItemRows(item, unrelated)[0].incomplete, false)
  const related = new Map([['a', [{ ...base, missingCategories: [1045712042] }]]])
  assert.equal(groupedItemRows(item, related)[0].incomplete, true)
})

test('item results exclude unused floors and retain playable extended floors', () => {
  const index = buildIndex(data)
  const seen = new Map()
  for (const rows of index.values()) for (const row of rows) {
    assert.ok(row.floors.every(floor => floor <= playableFloorLimits[row.dungeon]), `${row.name}: ${row.floors}`)
    seen.set(row.dungeon, Math.max(seen.get(row.dungeon) || 0, ...row.floors))
    if (['D001', 'D002', 'D003', 'D004'].includes(row.dungeon)) {
      assert.ok(row.floors.every(floor => floor <= row.normalFloors))
    }
  }
  for (const id of ['D001', 'D002', 'D003', 'D004', 'D014', 'D018', 'D019', 'D008', 'D009', 'D068']) {
    assert.equal(seen.get(id), playableFloorLimits[id], id)
  }
})

test('exchange rows require both NPC spawns and an exchange candidate on each floor', () => {
  const table = { categories: [{ category_id: 1, weight: 1 }], items: [{ item_id: 1, category_id: 1, weight: 1 }] }
  const floors = [
    { floor: 1, npcProb: 0, exchangeNpcCandidates: [934257497] },
    { floor: 2, npcProb: 100, exchangeNpcCandidates: [] },
    { floor: 3, npcProb: 30, exchangeNpcCandidates: [934257497] },
    { floor: 4 },
  ].map(floor => ({ ...floor, tables: Array(6).fill(0) }))
  const index = buildIndex({ items: { 1: { name: '薬草' } }, dungeons: [{ id: 'test', name: 'test', floors, tables: { 0: table } }] })
  assert.deepEqual(index.get('1').find(row => row.method === 5).floors, [3])
  assert.deepEqual(index.get('1').find(row => row.method === 0).floors, [1, 2, 3, 4])
})

test('actual exchange results exclude inactive NPCs and non-exchange NPC dungeons', () => {
  const index = buildIndex(data)
  const rows = [...index.values()].flat().filter(row => row.method === 5)
  assert.ok(rows.some(row => row.dungeon === 'D001'))
  // Golden Highway: no NPC spawns. Kune-Kune: NPCs exist, but none exchange items.
  assert.ok(!rows.some(row => ['D004', 'D071'].includes(row.dungeon)))
  // Weapon and Shield Battlefield does have the exchange actor 侍のタブ.
  assert.ok(rows.some(row => row.dungeon === 'D078'))
  for (const row of rows) {
    const dungeon = data.dungeons.find(dungeon => dungeon.id === row.dungeon)
    for (const number of row.floors) {
      const floor = dungeon.floors.find(floor => floor.floor === number)
      assert.ok(floor.npcProb > 0 && floor.exchangeNpcCandidates.length, `${row.name} ${number}F`)
    }
  }
})

test('NPC import ignores zero-weight candidates, other actors, and other creature kinds', () => {
  const floor = { npc: { npc_prob: 40 }, monster: { monster_table: [
    { creature_id: 934257497, weight: 5 },
    { creature_id: 934257497, weight: 10 },
    { creature_id: 1547550710, weight: 0 },
    { creature_id: 1632901494, weight: 5 },
    { creature_id: 539601111, weight: 5 },
  ] } }
  const dicts = { creature_data: {
    934257497: { creature_kind_str: 'wandering_npc' },
    1547550710: { creature_kind_str: 'wandering_npc' },
    1632901494: { creature_kind_str: 'monster' },
    539601111: { creature_kind_str: 'wandering_npc' },
  } }
  assert.deepEqual(exchangeNpcSettings(floor, dicts), { npcProb: 40, exchangeNpcCandidates: [934257497] })
})

test('shop imports account for layouts that prohibit shops and buried shops taking priority', () => {
  const floor = {
    terrein: { normal_floor_weight: 100, special_floor_weight: 0, special_floor_type_weights: { largest_MH: 100 } },
    shop: { exposed_shop_prob: 50, buried_shop_prob: 20 },
  }
  assert.deepEqual(shopSettings(floor), { exposedShopProb: 40, buriedShopProb: 20 })
  floor.shop.buried_shop_prob = 100
  assert.deepEqual(shopSettings(floor), { exposedShopProb: 0, buriedShopProb: 100 })
  floor.terrein.normal_floor_weight = 0
  floor.terrein.special_floor_weight = 100
  assert.deepEqual(shopSettings(floor), { exposedShopProb: 0, buriedShopProb: 0 })
  floor.terrein.special_floor_type_weights = { largest_MH: 5, pond_large_MH: 5, wall_large_MH: 5 }
  assert.deepEqual(shopSettings(floor), { exposedShopProb: 0, buriedShopProb: 0 })
  floor.terrein.special_floor_type_weights = { large_maze: 100 }
  assert.deepEqual(shopSettings(floor), { exposedShopProb: 0, buriedShopProb: 0 })
  floor.terrein.special_floor_type_weights = { three_rooms: 100 }
  assert.deepEqual(shopSettings(floor), { exposedShopProb: 50, buriedShopProb: 0 })
})

test('buried items require random maps, a positive spawn setting and item count', () => {
  const floor = { terrein: { map_data: 1 }, item: { buried_item_prob: 50, buried_item_count: 4 } }
  const dicts = { map_data: { 1: { is_random: false } } }
  assert.equal(buriedItemSettings(floor, dicts).buriedItemProb, 0)
  dicts.map_data[1].is_random = true
  assert.equal(buriedItemSettings(floor, dicts).buriedItemProb, 50)
  floor.item.buried_item_count = 0
  assert.equal(buriedItemSettings(floor, dicts).buriedItemProb, 0)
})

test('buried item rows omit unavailable floors while keeping other draws and weights', () => {
  const table = { categories: [{ category_id: 1, weight: 1 }], items: [{ item_id: 1, category_id: 1, weight: 1 }] }
  const floors = [0, 30, 0].map((buriedItemProb, i) => ({ floor: i + 1, buriedItemProb, tables: Array(8).fill(0) }))
  const rows = buildIndex({ items: { 1: { name: '薬草' } }, dungeons: [{ id: 'test', name: 'test', floors, tables: { 0: table } }] }).get('1')
  assert.deepEqual(rows.find(row => row.method === 7).floors, [2])
  assert.deepEqual(rows.find(row => row.method === 0).floors, [1, 2, 3])
  assert.ok(rows.every(row => row.probability === 100))
  const actual = [...buildIndex(data).values()].flat().filter(row => row.method === 7)
  assert.ok(actual.length > 0)
  assert.ok(!actual.some(row => row.dungeon === 'D014' && row.floors.includes(10)))
})

test('shop methods filter floors independently without changing item probabilities', () => {
  const table = { categories: [{ category_id: 1, weight: 1 }], items: [{ item_id: 1, category_id: 1, weight: 1 }] }
  const floors = [
    { floor: 1, exposedShopProb: 0, buriedShopProb: 0 },
    { floor: 2, exposedShopProb: 10, buriedShopProb: 0 },
    { floor: 3, exposedShopProb: 0, buriedShopProb: 20 },
    { floor: 4, exposedShopProb: 5, buriedShopProb: 10 },
  ].map(floor => ({ ...floor, tables: Array(9).fill(0) }))
  const index = buildIndex({ items: { 1: { name: '薬草' } }, dungeons: [{ id: 'test', name: 'test', floors, tables: { 0: table } }] })
  const rows = index.get('1')
  assert.deepEqual(rows.find(row => row.method === 1).floors, [2, 4])
  assert.deepEqual(rows.find(row => row.method === 8).floors, [3, 4])
  assert.deepEqual(rows.find(row => row.method === 0).floors, [1, 2, 3, 4])
  assert.ok(rows.every(row => row.probability === 100))
})

test('actual shop rows contain only floors where the corresponding shop can spawn', () => {
  const rows = [...buildIndex(data).values()].flat()
  for (const method of [1, 8]) {
    const shops = rows.filter(row => row.method === method)
    assert.ok(shops.length > 0)
    for (const row of shops) {
      const dungeon = data.dungeons.find(dungeon => dungeon.id === row.dungeon)
      for (const number of row.floors) {
        const floor = dungeon.floors.find(floor => floor.floor === number)
        assert.ok((method === 1 ? floor.exposedShopProb : floor.buriedShopProb) > 0, `${row.name} ${number}F method=${method}`)
      }
    }
    assert.ok(!shops.some(row => row.dungeon === 'D001' && row.floors.includes(1)))
    assert.ok(!shops.some(row => row.dungeon === 'D076' && row.floors.includes(9)))
  }
})
