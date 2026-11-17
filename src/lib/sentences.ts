const files = import.meta.glob("../../data/sentences/*.jsonl", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type Sentence = { id: string; category: string; text: string; tags: string[]; focus?: string };

export const sentences: Sentence[] = Object.values(files).flatMap((raw) =>
  raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Sentence),
);

export const ROUND_COUNT = 30;
export const PRACTICE_COUNT = 10;

export const meanLength = (rows: Sentence[]) =>
  rows.reduce((sum, r) => sum + r.text.length, 0) / Math.max(rows.length, 1);
const TOLERANCE = 0.3;

export function buildRounds(rows: Sentence[], count = ROUND_COUNT) {
  const size = Math.min(count, rows.length);
  const mean = rows.reduce((sum, r) => sum + r.text.length, 0) / rows.length;
  const target = mean * size;
  for (let attempt = 1; attempt <= 1000; attempt++) {
    const pool = [...rows];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, size);
    const total = picked.reduce((sum, r) => sum + r.text.length, 0);
    if (total >= target * (1 - TOLERANCE) && total <= target * (1 + TOLERANCE)) return { rounds: picked, attempt };
  }
  return { rounds: [...rows].slice(0, size), attempt: 1000 };
}
