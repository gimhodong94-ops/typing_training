export type KeyDef = { code: string; label: string; x: number; y: number; w: number };

const JAMO: Record<string, string> = {
  q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ", y: "ㅛ", u: "ㅕ", i: "ㅑ", o: "ㅐ", p: "ㅔ",
  a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ", h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
  z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ", b: "ㅠ", n: "ㅜ", m: "ㅡ",
};

const letters = (chars: string): [string, string, number][] =>
  [...chars].map((c) => [`Key${c.toUpperCase()}`, c.toUpperCase(), 1]);

const ROW_DEFS: [string, string, number][][] = [
  [["Backquote", "`", 1], ...[..."1234567890"].map((c): [string, string, number] => [`Digit${c}`, c, 1]),
    ["Minus", "-", 1], ["Equal", "=", 1], ["Backspace", "지움", 2]],
  [["Tab", "Tab", 1.5], ...letters("qwertyuiop"), ["BracketLeft", "[", 1], ["BracketRight", "]", 1], ["Backslash", "\\", 1.5]],
  [["CapsLock", "Caps", 1.75], ...letters("asdfghjkl"), ["Semicolon", ";", 1], ["Quote", "'", 1], ["Enter", "Enter", 2.25]],
  [["ShiftLeft", "Shift", 2.25], ...letters("zxcvbnm"), ["Comma", ",", 1], ["Period", ".", 1], ["Slash", "/", 1], ["ShiftRight", "Shift", 2.75]],
  [["ControlLeft", "Ctrl", 1.25], ["MetaLeft", "Win", 1.25], ["AltLeft", "Alt", 1.25], ["Space", "Space", 6.25],
    ["Lang1", "한/영", 1.25], ["Lang2", "한자", 1.25], ["ControlRight", "Ctrl", 1.25], ["MetaRight", "Win", 1.25]],
];

export const KEYS: KeyDef[] = ROW_DEFS.flatMap((row, y) => {
  let x = 0;
  return row.map(([code, label, w]) => {
    const key = { code, label, x, y, w };
    x += w;
    return key;
  });
});

export const KEYPOS: Record<string, { x: number; y: number }> = Object.fromEntries(
  KEYS.map((k) => [k.code, { x: k.x + k.w / 2, y: k.y }]),
);

export type WristAnchors = { left: { x: number; y: number }; right: { x: number; y: number } };
export const DEFAULT_WRISTS: WristAnchors = {
  left: { x: 4.25, y: 5.65 },
  right: { x: 9.5, y: 5.65 },
};

export const MODIFIERS = new Set(["ShiftLeft", "ShiftRight"]);
const LEFT_HAND = new Set(
  ["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Tab", "CapsLock",
    ..."QWERTASDFGZXCVB".split("").map((c) => `Key${c}`)],
);
const RIGHT_HAND = new Set(
  ["Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", "BracketLeft", "BracketRight",
    "Backslash", "Semicolon", "Quote", "Enter", "Comma", "Period", "Slash",
    ..."YUIOPHJKLNM".split("").map((c) => `Key${c}`)],
);
export const handOf = (code: string, wrists: WristAnchors = DEFAULT_WRISTS): "L" | "R" | null => {
  if (code === "Space") return null;
  const pos = KEYPOS[code];
  if (!pos) return null;
  const left = Math.hypot(pos.x - wrists.left.x, pos.y - wrists.left.y);
  const right = Math.hypot(pos.x - wrists.right.x, pos.y - wrists.right.y);
  if (Math.abs(left - right) < 0.01) return LEFT_HAND.has(code) ? "L" : RIGHT_HAND.has(code) ? "R" : null;
  return left < right ? "L" : "R";
};

const WRISTS_KEY = "typing-coach-wrist-anchors-v1";
const DZ_KEY = "typing-coach-keyboard-dz-mm-v1";
export const DEFAULT_DZ_MM = 25;
export const FINGER_MAP_VERSION = "qwerty-standard-v1";
export function loadWristAnchors(): WristAnchors {
  try {
    const value = JSON.parse(localStorage.getItem(WRISTS_KEY) ?? "null") as WristAnchors | null;
    if (value && [value.left?.x, value.left?.y, value.right?.x, value.right?.y].every(Number.isFinite)) return value;
  } catch { /* use the standard estimate */ }
  return DEFAULT_WRISTS;
}

export function saveWristAnchors(value: WristAnchors) {
  localStorage.setItem(WRISTS_KEY, JSON.stringify(value));
}

export function loadKeyboardDz(): number {
  const raw = localStorage.getItem(DZ_KEY);
  if (raw === null) return DEFAULT_DZ_MM;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 80 ? value : DEFAULT_DZ_MM;
}

export function saveKeyboardDz(value: number) {
  localStorage.setItem(DZ_KEY, String(Math.max(0, Math.min(80, value))));
}

export function hasSavedWristAnchors() {
  return localStorage.getItem(WRISTS_KEY) !== null;
}
const FINGERS: [string, string[]][] = [
  ["왼손 새끼손가락", ["Backquote", "Digit1", "KeyQ", "KeyA", "KeyZ", "Tab", "CapsLock", "ShiftLeft"]],
  ["왼손 약지", ["Digit2", "KeyW", "KeyS", "KeyX"]],
  ["왼손 중지", ["Digit3", "KeyE", "KeyD", "KeyC"]],
  ["왼손 검지", ["Digit4", "Digit5", "KeyR", "KeyT", "KeyF", "KeyG", "KeyV", "KeyB"]],
  ["오른손 검지", ["Digit6", "Digit7", "KeyY", "KeyU", "KeyH", "KeyJ", "KeyN", "KeyM"]],
  ["오른손 중지", ["Digit8", "KeyI", "KeyK", "Comma"]],
  ["오른손 약지", ["Digit9", "KeyO", "KeyL", "Period"]],
  ["오른손 새끼손가락", ["Digit0", "Minus", "Equal", "KeyP", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Slash", "Enter", "Backspace", "ShiftRight"]],
];
export const fingerOf = (code: string) => FINGERS.find(([, codes]) => codes.includes(code))?.[0] ?? "엄지";

export const HOME = { L: KEYPOS.KeyD, R: KEYPOS.KeyK };

const BASE = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];
const SHIFTED = ["~!@#$%^&*()_+", "QWERTYUIOP{}|", 'ASDFGHJKL:"', "ZXCVBNM<>?"];
const CODES: string[][] = [
  ["Backquote", ..."1234567890".split("").map((c) => `Digit${c}`), "Minus", "Equal"],
  [..."QWERTYUIOP".split("").map((c) => `Key${c}`), "BracketLeft", "BracketRight", "Backslash"],
  [..."ASDFGHJKL".split("").map((c) => `Key${c}`), "Semicolon", "Quote"],
  [..."ZXCVBNM".split("").map((c) => `Key${c}`), "Comma", "Period", "Slash"],
];

type KeyStroke = { code: string; shift: boolean };
const CHAR_KEY: Record<string, KeyStroke> = { " ": { code: "Space", shift: false }, "\n": { code: "Enter", shift: false } };
BASE.forEach((row, r) =>
  [...row].forEach((ch, i) => {
    CHAR_KEY[ch] = { code: CODES[r][i], shift: false };
    CHAR_KEY[SHIFTED[r][i]] = { code: CODES[r][i], shift: true };
  }),
);

export const TYPABLE = new Set([...Object.values(CHAR_KEY).map((k) => k.code)]);

const CHO = "r R s e E f a q Q t T d w W c z x v g".split(" ");
const JUNG = "k o i O j p u P h hk ho hl y n nj np nl b m ml l".split(" ");
const JONG = ["", ..."r R rt s sw sg e f fr fa fq ft fx fv fg a q qt t T d w c z x v g".split(" ")];

const strokesOf = (keys: string): KeyStroke[] =>
  [...keys].map((c) => ({ code: `Key${c.toUpperCase()}`, shift: c !== c.toLowerCase() }));

export type Expected = KeyStroke & { ch: number; lang: "ko" | "en" };

export function keysForText(text: string): Expected[] {
  const out: Expected[] = [];
  [...text].forEach((c, ch) => {
    const n = c.charCodeAt(0) - 0xac00;
    if (n >= 0 && n <= 11171) {
      const keys = CHO[Math.floor(n / 588)] + JUNG[Math.floor((n % 588) / 28)] + JONG[n % 28];
      strokesOf(keys.replace(/ /g, "")).forEach((s) => out.push({ ...s, ch, lang: "ko" }));
    } else if (CHAR_KEY[c]) {
      out.push({ ...CHAR_KEY[c], ch, lang: "en" });
    }
  });
  return out;
}

export function keyLabel(code: string, shift = false): string {
  const mark = shift ? "⇧" : "";
  if (code.startsWith("Key")) {
    const l = code.slice(3);
    return `${mark}${l}(${JAMO[l.toLowerCase()]})`;
  }
  if (code.startsWith("Digit")) return mark + code.slice(5);
  const found = KEYS.find((k) => k.code === code);
  return mark + (found ? (code === "Space" ? "스페이스" : found.label) : code);
}

export const jamoOf = (code: string) => (code.startsWith("Key") ? JAMO[code.slice(3).toLowerCase()] : "");

export function direction(dx: number, dy: number): string {
  const h = dx > 0.5 ? "오른쪽" : dx < -0.5 ? "왼쪽" : "";
  const v = dy > 0.5 ? "아래" : dy < -0.5 ? "위" : "";
  if (h || v) return `${h} ${v}`.trim();
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "오른쪽" : "왼쪽") : dy >= 0 ? "아래" : "위";
}

const SHIFT_JAMO: Record<string, string> = { q: "ㅃ", w: "ㅉ", e: "ㄸ", r: "ㄲ", t: "ㅆ", o: "ㅒ", p: "ㅖ" };
const SHIFT_SENSITIVE_CODES = new Set(["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyO", "KeyP"]);

export function isShiftMismatch(code: string, lang: "ko" | "en", targetShift: boolean, typedShift: boolean) {
  return (lang === "en" || SHIFT_SENSITIVE_CODES.has(code)) && targetShift !== typedShift;
}

export function jamoFor(code: string, shift: boolean): string {
  const l = code.slice(3).toLowerCase();
  return (shift && SHIFT_JAMO[l]) || JAMO[l] || "";
}

const CODE_CHAR: Record<string, string> = {};
Object.entries(CHAR_KEY).forEach(([ch, k]) => {
  CODE_CHAR[`${k.code}|${k.shift}`] = ch;
});
export const charFor = (code: string, shift: boolean) => CODE_CHAR[`${code}|${shift}`] ?? "";
