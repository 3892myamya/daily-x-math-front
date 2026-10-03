// Same effective shop probabilities as ReportViewer.calculatePreciseFloorProbs.
// Special MH layouts and large mazes exclude exposed shops; buried shops require
// a normal layout. Raw shop configuration alone is not sufficient.
export function shopSettings(floor) {
  const terrain = floor.terrein
  const total = terrain.normal_floor_weight + terrain.special_floor_weight
  const normal = total > 0 ? terrain.normal_floor_weight / total : 0
  const special = total > 0 ? terrain.special_floor_weight / total : 0
  const weights = terrain.special_floor_type_weights
  const specialTotal = Object.values(weights).reduce((sum, weight) => sum + (weight || 0), 0)
  const excludedWeight = ['largest_MH', 'pond_large_MH', 'wall_large_MH',
    'medium_large_MH', 'two_rooms_MH', 'large_maze']
    .reduce((sum, type) => sum + (weights[type] || 0), 0)
  const excluded = specialTotal > 0 ? excludedWeight / specialTotal * special : 0
  return {
    exposedShopProb: (normal * (1 - floor.shop.buried_shop_prob / 100)
      + special - excluded) * floor.shop.exposed_shop_prob,
    buriedShopProb: normal * floor.shop.buried_shop_prob,
  }
}
