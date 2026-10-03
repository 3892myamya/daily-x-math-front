// Playable limits are independent of the unused floors in the exported reports.
// Sources and the complete audit: scripts/shiren-floor-audit.md.
export const playableFloorLimits = {
  D001: 31, D002: 6, D003: 7, D004: 6,
  D005: 30, D006: 20, D007: 25,
  D008: 99, D009: 50, D010: 99, D011: 99, D012: 99,
  D013: 99, D014: 50, D015: 99, D016: 99, D017: 99,
  D018: 50, D019: 50, D020: 99, D022: 99, D052: 27,
  D065: 99, D066: 99, D067: 99, D068: 50, D070: 24,
  D071: 99, D072: 99, D073: 99, D074: 99, D075: 99,
  D076: 99, D077: 99, D078: 99, D079: 99, D080: 99, D081: 5,
}

export function playableFloors(dungeon) {
  const limit = playableFloorLimits[dungeon.id] ?? Infinity
  return dungeon.floors.filter(({ floor }) => floor >= 1 && floor <= limit)
}
