// 解説の要因ごとの重み。lishogi の人間同士の対局42局（約3,300局面）で、
// アプリと同じ設定の K-P 評価値に合うようにリッジ回帰で決めた。
// 解説が常識と逆の理由を挙げないよう、係数は0以上に制約している。
export const EXPLAIN_WEIGHTS = {
    intercept: -6.6,
    coef: {
        material: 0.368,
        mobility: 0.0632,
        majorMobility: 0,
        campAttacks: 5.85,
        kingRingDefense: 18.5,
        kingRingAttacked: 22.9,
        kingGuards: 20.6,
        kingEscapes: 0,
        handVsKing: 0.0125,
        kingRingLosing: 0,
        kingDanger: 0.705,
        control: 2.68,
        campControl: 0,
        inCheck: 385,
        stmThreat: 0.62,
        oppThreat: 0.455,
        tempo: 50.9,
    },
}
