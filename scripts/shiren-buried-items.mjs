// ReportViewer shows buried item settings only for randomly generated maps.
export function buriedItemSettings(floor, dicts) {
  const random = dicts.map_data[floor.terrein.map_data]?.is_random === true
  return {
    buriedItemProb: random && floor.item.buried_item_count > 0 ? floor.item.buried_item_prob : 0,
  }
}
