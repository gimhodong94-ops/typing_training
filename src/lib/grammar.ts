/** Chooses a Korean postposition based on the final Hangul syllable. */
export function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  const last = [...word].at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return `${word}${withoutBatchim}`;
  const jong = code % 28;
  if (withBatchim === "으로" && withoutBatchim === "로" && jong === 8) return `${word}로`;
  return `${word}${jong === 0 ? withoutBatchim : withBatchim}`;
}
