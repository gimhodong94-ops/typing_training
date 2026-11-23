export function selectWeaknessCards<T>(canDiagnose: boolean, groupCards: T[], keyCards: T[]): T[] {
  return canDiagnose ? [...groupCards, ...keyCards].slice(0, 2) : [];
}

export function rankComparisonRows<T extends { previous?: { k: number; n: number } | null; current?: { k: number; n: number } | null }>(rows: T[]): T[] {
  return rows.map((row) => ({
    ...row,
    change: Math.abs((row.current ? row.current.k / row.current.n : 0) - (row.previous ? row.previous.k / row.previous.n : 0)),
  })).sort((a, b) => b.change - a.change).slice(0, 3);
}
