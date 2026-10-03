// Invert the experimentally reported Shiren 6 melee formula. Rounding in the
// game is not fully verified; this is an integer attack estimate, not a guarantee.
export function effectiveDurability(monster, random = 1) {
  if (monster.behemoth) return { value: null, note: 'バリア・特殊仕様のため対象外' }
  if (monster.abilities?.some(ability => ability.includes('ダメージを1にする')) && monster.hp > 1) {
    return { value: null, note: '通常攻撃は1ダメージ固定' }
  }
  return { value: Math.max(1, Math.ceil((monster.hp + monster.defense / 2 - 1) / random)), note: '' }
}
