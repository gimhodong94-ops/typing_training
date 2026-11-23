
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
  imeEvidence?: "process" | "legacy-229" | "composing" | "latin-key" | "unknown";
  inputModeKey?: "toggle" | "hanja";
  sessionMs?: number;
  pauseSeq?: number;
  resumedAfterPause?: boolean;
  resumeDelayMs?: number;
  episodeId?: number;
  episodeRole?: "first" | "cascade";
  removedUnit?: string;
  removedWasCorrect?: boolean;
  removedNeeded?: boolean;
  removed?: boolean;
};

export type PauseInterval = { seq: number; startMs: number; endMs: number };

export type RoundRecord = {
  id: string;
  text: string;
  tags?: string[];
  events: KeyEvent[];
};

export type FeedbackItem = {
  title: string;
  confidence: "높음" | "중간" | "낮음";
  evidence: string;
  possibleCauses: string[];
  checkNext: string;
  advice: string;
  factIds?: string[];
};

export type Feedback = {
  headline: string;
  strengths: { text: string; evidence: string; factIds?: string[] }[];
  weaknesses: FeedbackItem[];
  watchItems?: FeedbackItem[];
  freeNotes?: { text: string; factIds: string[] }[];
  nextStep: string;
};

export type AIQuestionAnswer = {
  questionId: string;
  answer: "맞아요" | "아니에요" | "모르겠어요" | "건너뜀";
  note?: string;
  at: string;
};

export type Session = {
  id: number;
  at: string;
  keyboard: KeyboardType;
  mode?: "normal" | "practice";
  /** Runtime marker for records that exist only in browser localStorage, not Electron JSONL. */
  isLocalStorageOnly?: boolean;
  roundCount?: number;
  pauses?: PauseInterval[];
  schemaVersion?: 2 | 3 | 4;
  hintOn?: boolean;
  dz?: number;
  reachCutoffs?: [number, number];
  fingerMapVersion?: string;
  accuracyA?: number;
  accuracyB?: number;
  wrongErase?: number;
  wristAnchors?: WristAnchors;
  rounds: RoundRecord[];
  feedback?: Feedback;
  aiAnalysis?: unknown;
  analysis?: unknown;
  answers?: AIQuestionAnswer[];
  noteAnswers?: { noteId: string; answer: "맞아요" | "아니에요" | "모르겠어요"; note?: string; at: string }[];
};
