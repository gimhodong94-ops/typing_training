
import type { WristAnchors } from "./keyboard";

export type KeyboardType = "desktop" | "laptop";

export type KeyEvent = {
  t: number;
  keyupT?: number;
  keyupPauseSeq?: number;
  code: string;
  kind: "char" | "backspace" | "modifier" | "other" | "overflow" | "submit";
  pos: number;
  shift: boolean;
  caps: boolean;
  exp?: string;
  expShift?: boolean;
  targetKey?: string;
  typedKey?: string;
  targetShift?: boolean;
  typedShift?: boolean;
  shiftSide?: "ShiftLeft" | "ShiftRight" | "both" | "unknown";
  nextTargetKey?: string;
  targetPressedLaterOk?: boolean;
  ok?: boolean;
  err?: string;
  dx?: number;
  dy?: number;
  isNext?: boolean;
  isPrev?: boolean;
  ime?: boolean;
  imeKnown?: boolean;
  sessionMs?: number;
  pauseSeq?: number;
  resumedAfterPause?: boolean;
  resumeDelayMs?: number;
};

export type PauseInterval = { seq: number; startMs: number; endMs: number };

export type RoundRecord = {
  id: string;
  text: string;
  tags?: string[];
  events: KeyEvent[];
};

export type Feedback = {
  headline: string;
  strengths: { text: string; evidence: string }[];
  weaknesses: {
    title: string;
    confidence: "높음" | "중간" | "낮음";
    evidence: string;
    possibleCauses: string[];
    checkNext: string;
    advice: string;
  }[];
  nextStep: string;
};

export type Session = {
  id: number;
  at: string;
  keyboard: KeyboardType;
  mode?: "normal" | "practice";
  roundCount?: number;
  pauses?: PauseInterval[];
  schemaVersion?: 2;
  wristAnchors?: WristAnchors;
  rounds: RoundRecord[];
  feedback?: Feedback;
};
