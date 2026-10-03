// Exchange actors identified using the viewer's actor names and NPC references.
// NPC spawn probability and candidate weights come exclusively from ReportViewer.
const exchangeNpcIds = new Set([
  934257497, // 風来のコーカ
  1547550710, // 行商のツエマキ
  1632901494, // 侍のタブ
  1843883378, // 畑のクサン
  98665479, // 陶芸家ヤキ
  66309212, // 宝石商のレット
  1637277178, // めし炊きのホク
])

export function exchangeNpcSettings(floor, dicts) {
  return {
    npcProb: floor.npc?.npc_prob ?? 0,
    exchangeNpcCandidates: [...new Set(floor.monster.monster_table
      .filter(entry => entry.weight > 0 && exchangeNpcIds.has(entry.creature_id)
        && dicts.creature_data[entry.creature_id]?.creature_kind_str === 'wandering_npc')
      .map(entry => entry.creature_id))],
  }
}
