import fs from 'node:fs'

export function importMonsters(reports, dicts, localization) {
  const catalog = JSON.parse(fs.readFileSync(new URL('./shiren-monster-catalog.json', import.meta.url)))
  const traits = JSON.parse(fs.readFileSync(new URL('./shiren-monster-traits.json', import.meta.url)))
  const typeRunes = {
    43934998: ['一ツ目', '一ツ目特攻【目】'],
    696614100: ['水棲', '水棲特攻【水】'],
    926299769: ['金属', '金属特攻【斬】'],
    958097212: ['爆発', '爆発特攻【爆】'],
    1056021541: ['浮遊', '浮遊特攻【浮】'],
    1142106294: ['ケモノ', 'ケモノ特攻【獣】'],
    1272099217: ['ドレイン', 'ドレイン特攻【ド】'],
    1946636817: ['ゴースト', 'ゴースト特攻【仏】'],
    1461775922: ['ドラゴン', 'ドラゴン特攻【竜】'],
  }
  // Names are missing from localization. Match unique default stats to Wiki
  // Part3 shop NPC profiles; guards must also stay out of ordinary spawn pools.
  const shopNames = {
    1105784178: '店主(赤色)', 1491188936: '店主(灰色)',
    803638366: '店主(黄色)', 830609917: '店主(黒色)',
    1227565621: '番犬', 1752415330: '盗賊番',
  }
  const definitions = {}, monsters = {}
  // The current export labels HP as exp_point and EXP as hp. Detect the
  // orientation against independent creature defaults, so a corrected upstream
  // export will not be swapped again. Wiki examples confirm HP 8 / EXP 2 for
  // Mamul and HP 5 / EXP 2000 for Cave Mamul.
  let normalMatches = 0, reversedMatches = 0
  for (const report of reports) for (const spec of report.dungeon.monster_specs) {
    const creature = dicts.creature_data[spec.creature_id]
    if (!creature || creature.creature_kind_str !== 'monster' || creature.default_hp === creature.default_exp) continue
    if (spec.hp === creature.default_hp && spec.exp_point === creature.default_exp) normalMatches++
    if (spec.hp === creature.default_exp && spec.exp_point === creature.default_hp) reversedMatches++
  }
  const reversed = reversedMatches > normalMatches
  for (const [id, creature] of Object.entries(dicts.creature_data)) {
    if (creature.creature_kind_str !== 'monster' && !shopNames[id]) continue
    if (!shopNames[id]) definitions[id] = { behemoth: creature.is_behemoth }
    const name = shopNames[id] ?? localization.creature_name[id]?.ja?.replace(/\[M:[^\]]+\]/g, '')
    const family = catalog.families[name]
    if (!family) continue
    const profile = traits.monsters[name]
    if (!profile) throw new Error(`Missing monster traits: ${name}`)
    const types = [...new Set(creature.monster_types)].map(type => typeRunes[type]).filter(Boolean)
    monsters[id] = {
      name: `${creature.is_behemoth ? 'デッ怪・' : ''}${name}`, family, level: catalog.levels[name] ?? null, behemoth: creature.is_behemoth,
      specialSpawn: Boolean(shopNames[id]),
      hp: creature.default_hp, attack: creature.default_atk, defense: creature.default_def, exp: creature.default_exp,
      attributes: types.map(type => type[0]), weaknessRunes: types.map(type => type[1]),
      abilities: creature.is_behemoth
        ? ['正面と側面のバリアが攻撃や魔法弾などを防ぐ', '通常攻撃の範囲は正面3方向', '通常個体より行動速度が1段階遅い状態で現れる']
        : profile.abilities,
      baseAbilities: creature.is_behemoth ? profile.abilities : [],
      wiki: creature.is_behemoth ? traits.behemothSource : profile.wiki,
      baseWiki: profile.wiki,
    }
    if (family === 'ボス系') {
      const locations = reports.filter(report => Object.values(report.floors).some(floor =>
        floor.monster.monster_table.some(entry => String(entry.creature_id) === id)
      )).map(report => report.dungeon.dungeon_name_ja)
      monsters[id].baseName = name
      if (locations.length) monsters[id].name = `${name}（${[...new Set(locations)].join('・')}）`
    }
    if (creature.is_behemoth) monsters[id].weaknessRunes.push('デッ怪特攻【デ】（バリア無視）')
  }
  const data = {
    source: 'https://tsuemaki-daisuki.vercel.app/', retrieved: '2026-10-03', wiki: catalog.sources, correctedHpExp: reversed, monsters, definitions,
    dungeons: reports.map(({ dungeon, floors }) => ({ id: dungeon.dungeon_id, name: dungeon.dungeon_name_ja, normalFloors: dungeon.floors.normal,
      specs: Object.fromEntries(dungeon.monster_specs.map(spec => [spec.creature_id, { hp: reversed ? spec.exp_point : spec.hp, attack: spec.attack, defense: spec.defense, exp: reversed ? spec.hp : spec.exp_point }])),
      floors: Object.entries(floors).map(([floor, data]) => ({ floor: Number(floor), entries: data.monster.monster_table, behemothProb: data.monster.behemoth_prob }))
    }))
  }
  fs.mkdirSync('public/shiren', { recursive: true })
  fs.writeFileSync('public/shiren/monsters.json', JSON.stringify(data))
  console.log(`${Object.keys(monsters).length} monsters`)
}
