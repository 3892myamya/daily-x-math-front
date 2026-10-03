import { playableFloors } from './shirenFloors.js'

export const monsterConditions = ['自然出現', 'モンスターハウス限定', '召喚限定', 'ボス・取り巻き', 'デッ怪']

function condition(entry, definitions) {
  if (definitions[entry.creature_id]?.behemoth) return 4
  if (entry.flag?.boss) return 3
  if (entry.flag?.summon_only) return 2
  if (entry.flag?.MH_only) return 1
  return 0
}

export function buildMonsterIndex(data) {
  const index = new Map()
  for (const dungeon of data.dungeons) {
    const groups = new Map()
    for (const floor of playableFloors(dungeon)) {
      // NPCs and companions must never enter monster probability denominators.
      const entries = floor.entries.filter(entry => data.definitions[entry.creature_id] && entry.weight > 0)
      const pools = [
        entries.filter(entry => condition(entry, data.definitions) === 0),
        entries.filter(entry => [0, 1].includes(condition(entry, data.definitions))),
        entries.filter(entry => [0, 2].includes(condition(entry, data.definitions))),
        [],
        entries.filter(entry => condition(entry, data.definitions) === 4),
      ]
      const sums = pools.map(pool => pool.reduce((sum, entry) => sum + entry.weight, 0))
      const combined = new Map()
      for (const entry of entries) {
        const id = String(entry.creature_id), monster = data.monsters[id]
        if (!monster) continue
        const method = condition(entry, data.definitions)
        if (method === 4 && !floor.behemothProb) continue
        const key = `${id}:${method}`
        if (!combined.has(key)) combined.set(key, { id, method, weight: 0 })
        combined.get(key).weight += entry.weight
      }
      for (const { id, method, weight } of combined.values()) {
        const monster = data.monsters[id]
        const stats = dungeon.specs[id] || { hp: monster.hp, attack: monster.attack, defense: monster.defense, exp: monster.exp }
        // Boss flags indicate scripted encounters, not weighted natural spawns.
        const probability = method === 3 ? null : weight / sums[method] * 100
        const behemothProb = method === 4 ? floor.behemothProb : null
        const key = JSON.stringify([id, method, probability, behemothProb, stats])
        if (!groups.has(key)) groups.set(key, { id, method, probability, behemothProb, ...stats, dungeon: dungeon.id, name: dungeon.name, normalFloors: dungeon.normalFloors, floors: [] })
        groups.get(key).floors.push(floor.floor)
      }
    }
    for (const row of groups.values()) {
      if (!index.has(row.id)) index.set(row.id, [])
      index.get(row.id).push(row)
    }
  }
  return index
}
