export type TypedKey = { text: string; jamo: boolean; ok: boolean };
export type Shown = { text: string; ok: boolean };

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["", ...("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ")];
const VOWEL_PAIR: Record<string, string> = { ㅗㅏ: "ㅘ", ㅗㅐ: "ㅙ", ㅗㅣ: "ㅚ", ㅜㅓ: "ㅝ", ㅜㅔ: "ㅞ", ㅜㅣ: "ㅟ", ㅡㅣ: "ㅢ" };
const FINAL_PAIR: Record<string, string> = {
  ㄱㅅ: "ㄳ", ㄴㅈ: "ㄵ", ㄴㅎ: "ㄶ", ㄹㄱ: "ㄺ", ㄹㅁ: "ㄻ", ㄹㅂ: "ㄼ", ㄹㅅ: "ㄽ", ㄹㅌ: "ㄾ", ㄹㅍ: "ㄿ", ㄹㅎ: "ㅀ", ㅂㅅ: "ㅄ",
};
const isCho = (c: string) => CHO.includes(c);
const isJung = (c: string) => JUNG.includes(c);
const canBeFinal = (c: string) => JONG.includes(c) && c !== "";

type Part = { c: string; ok: boolean };
type Syllable = { cho: Part; jung: Part[]; jong: Part[] };

function render(s: Syllable): Shown {
  const ok = [s.cho, ...s.jung, ...s.jong].every((p) => p.ok);
  if (!s.jung.length) return { text: s.cho.c, ok };
  const jung = s.jung.length === 2 ? VOWEL_PAIR[s.jung[0].c + s.jung[1].c] : s.jung[0].c;
  const jong = s.jong.length === 2 ? FINAL_PAIR[s.jong[0].c + s.jong[1].c] : (s.jong[0]?.c ?? "");
  const code = 0xac00 + (CHO.indexOf(s.cho.c) * 21 + JUNG.indexOf(jung)) * 28 + JONG.indexOf(jong);
  return { text: String.fromCharCode(code), ok };
}

export function composeTyped(keys: TypedKey[]): Shown[] {
  const out: Shown[] = [];
  let cur: Syllable | null = null;
  const flush = () => {
    if (cur) out.push(render(cur));
    cur = null;
  };
  for (const k of keys) {
    const part: Part = { c: k.text, ok: k.ok };
    if (!k.jamo || (!isCho(k.text) && !isJung(k.text))) {
      flush();
      out.push({ text: k.text, ok: k.ok });
    } else if (isJung(k.text)) {
      if (!cur) {
        out.push({ text: k.text, ok: k.ok });
      } else if (!cur.jung.length) {
        cur.jung.push(part);
      } else if (!cur.jong.length) {
        if (cur.jung.length === 1 && VOWEL_PAIR[cur.jung[0].c + k.text]) cur.jung.push(part);
        else {
          flush();
          out.push({ text: k.text, ok: k.ok });
        }
      } else {
        const moved: Part = cur.jong[cur.jong.length - 1];
        const rest = cur.jong.slice(0, -1);
        cur.jong = rest;
        flush();
        cur = { cho: moved, jung: [part], jong: [] };
      }
    } else if (!cur || !cur.jung.length) {
      flush();
      cur = { cho: part, jung: [], jong: [] };
    } else if (!cur.jong.length) {
      if (canBeFinal(k.text)) cur.jong.push(part);
      else {
        flush();
        cur = { cho: part, jung: [], jong: [] };
      }
    } else if (cur.jong.length === 1 && FINAL_PAIR[cur.jong[0].c + k.text]) {
      cur.jong.push(part);
    } else {
      flush();
      cur = { cho: part, jung: [], jong: [] };
    }
  }
  flush();
  return out;
}

