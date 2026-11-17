export type KeyboardType = "desktop" | "laptop";

export type KeyEvent = {
  t: number;
  code: string;
  kind: "char" | "backspace" | "modifier" | "other" | "overflow";
  pos: number;
  shift: boolean;
  caps: boolean;
  exp?: string;
  expShift?: boolean;
  ok?: boolean;
  err?: string;
  dx?: number;
  dy?: number;
  isNext?: boolean;
  isPrev?: boolean;
  ime?: boolean;
};

export type RoundRecord = {
  id: string;
  text: string;
  tags: string[];
  events: KeyEvent[];
};

export type Feedback = {
  headline: string;
  strengths: string[];
  weaknesses: { title: string; evidence: string; advice: string }[];
  nextStep: string;
};

export type Session = {
  id: number;
  at: string;
  keyboard: KeyboardType;
  mode?: "normal" | "practice";
  rounds: RoundRecord[];
  feedback?: Feedback;
};
