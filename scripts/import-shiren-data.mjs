// Download exported_reports.js from the source site, then pass its path to this script.
import fs from 'node:fs'
import { inflateSync } from 'node:zlib'
import { importMonsters } from './import-shiren-monsters.mjs'
import { exchangeNpcSettings } from './shiren-npc.mjs'
import { shopSettings } from './shiren-shops.mjs'
import { buriedItemSettings } from './shiren-buried-items.mjs'
import { sourceInfo } from './shiren-source.mjs'
const source = fs.readFileSync(process.argv[2], 'utf8')
const decode = key => JSON.parse(inflateSync(Buffer.from(source.match(new RegExp(`const compressed${key} = "([^"]+)"`))[1], 'base64')))
const reports = decode('Reports'), dicts = decode('Dicts'), localization = decode('Localization')
const items = {}
// Only names confirmed in the game's item lists are selectable. Keep raw table
// weights intact so excluding development data does not inflate probabilities.
const catalog = JSON.parse(fs.readFileSync(new URL('./shiren-item-catalog.json', import.meta.url)))
const gameItemNames = new Set(catalog.names)
for (const report of reports) for (const table of Object.values(report.dungeon.item_tables)) for (const entry of table.items) {
  const item = dicts.item_data[entry.item_id]
  const name = localization.item_name[entry.item_id]?.ja
  if (!gameItemNames.has(name)) continue
  items[entry.item_id] = { name, category: item?.category_id ?? entry.category_id, rarity: item?.rarity || 0, order: item?.sort_order || 0 }
}
const data = {
  ...sourceInfo, itemReference: catalog.reference, items,
  categories: Object.fromEntries(Object.entries(localization.item_category).map(([id, text]) => [id, text.ja])),
  dungeons: reports.map(({ dungeon, floors }) => ({ id: dungeon.dungeon_id, name: dungeon.dungeon_name_ja, normalFloors: dungeon.floors.normal, tables: dungeon.item_tables, floors: Object.entries(floors).map(([floor, data]) => ({ floor: Number(floor), tables: data.item.item_tables, behemothProb: data.monster.behemoth_prob, ...exchangeNpcSettings(data, dicts), ...shopSettings(data), ...buriedItemSettings(data, dicts) })) })),
}
fs.mkdirSync('public/shiren', { recursive: true })
fs.writeFileSync('public/shiren/data.json', JSON.stringify(data))
console.log(`${data.dungeons.length} dungeons, ${Object.keys(items).length} items`)
importMonsters(reports, dicts, localization)
