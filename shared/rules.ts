export const SYMBOLS = "`~!@#$%^&*()-_=+[]{}\\|;:'\",.<>/?";
import thresholds from "../config/thresholds.json";

export const MAX_LEN_KO = thresholds.sentenceLength.maxKoreanDominant;
export const MAX_LEN_EN = thresholds.sentenceLength.maxEnglishDominant;
export const TAG_ORDER = [
  "받침많음", "겹받침", "복합모음", "쌍자음", "어절많음", "숫자포함",
  "영문포함", "기호포함", "긴문장", "짧은문장", "줄바꿈포함",
] as const;

const COMPLEX_JONG = new Set([3, 5, 6, 9, 10, 11, 12, 13, 14, 15, 18]);
const COMPLEX_JUNG = new Set([9, 10, 11, 14, 15, 16, 19]);
const DOUBLE_CHO = new Set([1, 4, 8, 10, 13]);
const DOUBLE_JONG = new Set([2, 20]);

const isHangul = (ch: string) => ch >= "\uac00" && ch <= "\ud7a3";
const isAscii = (ch: string) => ch.charCodeAt(0) < 128;
const isLetter = (ch: string) => isAscii(ch) && /[A-Za-z]/.test(ch);
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

export function sentenceLengthLimit(text: string): number {
  const korean = [...text].filter(isHangul).length;
  const english = [...text].filter(isLetter).length;
  return korean >= english || korean + english === 0 ? MAX_LEN_KO : MAX_LEN_EN;
}

export function isAllowedChar(ch: string): boolean {
  return isHangul(ch) || ch === " " || SYMBOLS.includes(ch) || isLetter(ch) || isDigit(ch);
}

export function checkText(text: string): string[] {
  const errors: string[] = [];
  const bad = [...new Set([...text].filter((ch) => !isAllowedChar(ch)))];
  if (bad.length) errors.push(`허용되지 않는 문자: ${bad.join("")}`);
  const limit = sentenceLengthLimit(text);
  if (text.length < thresholds.sentenceLength.minimum || text.length > limit) errors.push(`길이 ${text.length}자 (허용 ${thresholds.sentenceLength.minimum}~${limit}자)`);
  return errors;
}

export function computeTags(text: string): string[] {
  const parts = [...text].filter(isHangul).map((ch) => {
    const code = ch.charCodeAt(0) - 0xac00;
    return { cho: Math.floor(code / 588), jung: Math.floor((code % 588) / 28), jong: code % 28 };
  });
  const found: Record<string, boolean> = {
    받침많음: parts.length > 0 && parts.filter((p) => p.jong !== 0).length / parts.length >= 0.4,
    겹받침: parts.some((p) => COMPLEX_JONG.has(p.jong)),
    복합모음: parts.some((p) => COMPLEX_JUNG.has(p.jung)),
    쌍자음: parts.some((p) => DOUBLE_CHO.has(p.cho) || DOUBLE_JONG.has(p.jong)),
    어절많음: text.split(/\s+/).filter(Boolean).length >= 6,
    숫자포함: [...text].some(isDigit),
    영문포함: [...text].some(isLetter),
    기호포함: [...text].some((ch) => SYMBOLS.includes(ch)),
    긴문장: text.length >= 45,
    짧은문장: text.length <= 20,
    줄바꿈포함: text.includes("\n"),
  };
  return TAG_ORDER.filter((tag) => found[tag]);
}

export const TOTAL_TOLERANCE = 0.3;
export const totalInRange = (total: number, target: number) =>
  total >= target * (1 - TOTAL_TOLERANCE) && total <= target * (1 + TOTAL_TOLERANCE);
