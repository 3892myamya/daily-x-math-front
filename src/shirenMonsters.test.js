import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { playableFloorLimits } from './shirenFloors.js'
import { buildMonsterIndex } from './shirenMonsters.js'

const data = JSON.parse(fs.readFileSync(new URL('../public/shiren/monsters.json', import.meta.url)))

test('weakness runes cover multiple attributes and abilities distinguish levels and behemoths', () => {
  const find = name => Object.values(data.monsters).find(monster => monster.name === name)
  assert.deepEqual(find('マムル').weaknessRunes, [])
  assert.deepEqual(find('ドラゴン').weaknessRunes, ['ドラゴン特攻【竜】'])
  assert.deepEqual(new Set(find('パコレプキン').weaknessRunes), new Set(['ゴースト特攻【仏】', '浮遊特攻【浮】']))
  assert.equal(find('ばくだんウニ').weaknessRunes.length, 3)
  assert.ok(find('マゼルン').abilities.some(ability => ability.includes('最大2個')))
  assert.ok(find('マゼドン').abilities.some(ability => ability.includes('最大5個')))
  const behemoth = find('デッ怪・ドラゴン')
  assert.ok(behemoth.weaknessRunes.includes('デッ怪特攻【デ】（バリア無視）'))
  assert.ok(behemoth.abilities.some(ability => ability.includes('バリア')))
  assert.deepEqual(behemoth.baseAbilities, find('ドラゴン').abilities)
  for (const monster of Object.values(data.monsters)) {
    assert.ok(Array.isArray(monster.weaknessRunes))
    assert.ok(monster.abilities.length > 0, monster.name)
    assert.ok(monster.wiki.startsWith('https://shiren6.game-info.wiki/'))
  }
})

test('natural, house, summon and behemoth pools have separate denominators', () => {
  const fixture = {
    monsters: Object.fromEntries([1, 2, 3, 4, 5, 6].map(id => [id, { hp: 8, attack: 3, defense: 4, exp: 2 }])),
    definitions: Object.fromEntries([1, 2, 3, 4, 5, 6].map(id => [id, { behemoth: id === 5 }])),
    dungeons: [{ id: 'D1', name: 'test', normalFloors: 2, specs: { 1: { hp: 10, attack: 5, defense: 6, exp: 4 } }, floors: [
      { floor: 1, behemothProb: 20, entries: [
        { creature_id: 1, weight: 1 }, { creature_id: 1, weight: 1 }, { creature_id: 2, weight: 2 },
        { creature_id: 3, weight: 4, flag: { MH_only: true } }, { creature_id: 4, weight: 4, flag: { summon_only: true } },
        { creature_id: 5, weight: 7 }, { creature_id: 6, weight: 100, flag: { boss: true } }, { creature_id: 99, weight: 1000 },
      ] },
      { floor: 2, behemothProb: 0, entries: [{ creature_id: 5, weight: 7 }] },
    ] }],
  }
  const index = buildMonsterIndex(fixture)
  assert.equal(index.get('1')[0].probability, 50)
  assert.equal(index.get('1')[0].hp, 10)
  assert.equal(index.get('2')[0].hp, 8)
  assert.equal(index.get('3')[0].probability, 50)
  assert.equal(index.get('3')[0].method, 1)
  assert.equal(index.get('4')[0].probability, 50)
  assert.equal(index.get('4')[0].method, 2)
  assert.equal(index.get('5')[0].probability, 100)
  assert.deepEqual(index.get('5')[0].floors, [1])
  assert.equal(index.get('5')[0].behemothProb, 20)
  assert.equal(index.get('6')[0].probability, null)
  assert.equal(index.has('99'), false)
})

test('floor groups split when stats or probabilities differ and preserve zero stats', () => {
  const fixture = { monsters: { 1: { hp: 8, attack: 3, defense: 4, exp: 2 } }, definitions: { 1: {} }, dungeons: [
    { id: 'A', specs: { 1: { hp: 0, attack: 0, defense: 0, exp: 0 } }, floors: [1, 2, 4].map(floor => ({ floor, entries: [{ creature_id: 1, weight: 1 }] })) },
    { id: 'B', specs: {}, floors: [{ floor: 1, entries: [{ creature_id: 1, weight: 1 }] }] },
  ] }
  const rows = buildMonsterIndex(fixture).get('1')
  assert.deepEqual(rows[0].floors, [1, 2, 4])
  assert.equal(rows[0].hp, 0)
  assert.equal(rows[1].hp, 8)
})

test('real snapshot confirms Wiki stats and D001 Mamul natural spawn probability', () => {
  const index = buildMonsterIndex(data)
  const mamul = Object.entries(data.monsters).find(([, monster]) => monster.name === 'マムル')
  const cave = Object.entries(data.monsters).find(([, monster]) => monster.name === '洞窟マムル')
  const mamulRow = index.get(mamul[0]).find(row => row.dungeon === 'D001' && row.floors.includes(1) && row.method === 0)
  assert.deepEqual([mamulRow.hp, mamulRow.attack, mamulRow.defense, mamulRow.exp], [8, 3, 4, 2])
  assert.ok(Math.abs(mamulRow.probability - 150 / (150 + 100 + 100) * 100) < 1e-10)
  const caveRow = index.get(cave[0]).find(row => row.dungeon === 'D022')
  assert.equal(caveRow.hp, 5)
  assert.equal(caveRow.exp, 2000)
  for (const [id, rows] of index) {
    assert.ok(data.monsters[id].family)
    for (const row of rows) {
      assert.ok(row.probability === null || Number.isFinite(row.probability) && row.probability > 0 && row.probability <= 100)
      assert.ok(row.floors.length > 0)
      for (const key of ['hp', 'attack', 'defense', 'exp']) assert.ok(Number.isFinite(row[key]))
    }
  }
})

test('shop NPCs have basic stats without entering ordinary spawn pools', () => {
  const expected = {
    '店主(赤色)': [180, 180, 50, 0], '店主(灰色)': [190, 190, 70, 0],
    '店主(黄色)': [200, 200, 90, 0], '店主(黒色)': [210, 210, 120, 0],
    '番犬': [220, 220, 220, 1], '盗賊番': [300, 250, 250, 1],
  }
  const index = buildMonsterIndex(data)
  for (const [name, stats] of Object.entries(expected)) {
    const [id, monster] = Object.entries(data.monsters).find(([, entry]) => entry.name === name)
    assert.equal(monster.family, 'お店NPC')
    assert.equal(monster.specialSpawn, true)
    assert.deepEqual([monster.hp, monster.attack, monster.defense, monster.exp], stats)
    assert.equal(data.definitions[id], undefined)
    assert.equal(index.has(id), false)
  }
})

test('effective durability inverts melee damage and excludes special defenses', async () => {
  const { effectiveDurability } = await import('./shirenDurability.js')
  const normal = { hp: 8, defense: 4, abilities: [] }
  assert.equal(effectiveDurability(normal).value, 9)
  assert.equal(effectiveDurability(normal, 0.875).value, 11)
  for (const random of [1, 0.875]) {
    const attack = effectiveDurability(normal, random).value
    assert.ok(attack * random - normal.defense / 2 + 1 >= normal.hp)
    assert.ok((attack - 1) * random - normal.defense / 2 + 1 < normal.hp)
  }
  for (const name of ['洞窟マムル', 'ギタンマムル', 'ぼうれい武者', 'デッ怪・ドラゴン']) {
    const monster = Object.values(data.monsters).find(entry => entry.name === name)
    assert.equal(effectiveDurability(monster).value, null)
  }
})

test('monster results exclude unused floors and retain playable extended floors', () => {
  const index = buildMonsterIndex(data)
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
