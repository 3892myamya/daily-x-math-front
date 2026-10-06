import { playableFloors } from './shirenFloors.js'

// Only natural spawns and behemoths are shown. House-only, summon-only and
// boss entries stay out of both denominators.
function isRestricted(entry) {
  return Boolean(entry.flag?.boss || entry.flag?.summon_only || entry.flag?.MH_only)
}

export function buildMonsterIndex(data) {
  const index = new Map()
  for (const dungeon of data.dungeons) {
    const groups = new Map()
    for (const floor of playableFloors(dungeon)) {
      // NPCs and companions must never enter monster probability denominators.
      const entries = floor.entries.filter(entry => data.definitions[entry.creature_id] && entry.weight > 0)
      const isBehemoth = entry => Boolean(data.definitions[entry.creature_id].behemoth)
      const pools = {
        natural: entries.filter(entry => !isBehemoth(entry) && !isRestricted(entry)),
        behemoth: floor.behemothProb > 0 ? entries.filter(isBehemoth) : [],
      }
      for (const [kind, pool] of Object.entries(pools)) {
        const total = pool.reduce((sum, entry) => sum + entry.weight, 0)
        const weights = new Map()
        for (const entry of pool) {
          const id = String(entry.creature_id)
          if (data.monsters[id]) weights.set(id, (weights.get(id) || 0) + entry.weight)
        }
        for (const [id, weight] of weights) {
          const monster = data.monsters[id]
          const stats = dungeon.specs[id] || { hp: monster.hp, attack: monster.attack, defense: monster.defense, exp: monster.exp }
          const behemoth = kind === 'behemoth', probability = weight / total * 100
          const key = JSON.stringify([id, behemoth, probability, stats])
          if (!groups.has(key)) groups.set(key, { id, behemoth, probability, ...stats, dungeon: dungeon.id, name: dungeon.name, normalFloors: dungeon.normalFloors, floors: [] })
          groups.get(key).floors.push(floor.floor)
        }
      }
    }
    for (const row of groups.values()) {
      if (!index.has(row.id)) index.set(row.id, [])
      index.get(row.id).push(row)
    }
  }
  return index
}
