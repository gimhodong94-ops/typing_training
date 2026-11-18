import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Keyboard } from "./Keyboard";
import { KEYPOS, MODIFIERS, TYPABLE, charFor, handOf, jamoFor, keysForText, type WristAnchors } from "../lib/keyboard";
import { composeTyped, type TypedKey } from "../lib/hangul";
import { activeElapsedMs, shouldIgnoreKeyWhilePaused } from "../lib/pauseMetrics";
import type { Sentence } from "../lib/sentences";
import type { KeyEvent, PauseInterval, RoundRecord } from "../lib/types";

type Entry = { ok: boolean; code: string; shift: boolean; ime: boolean; resumedAfterPause?: boolean };
type Props = {
  rounds: Sentence[];
  hint: boolean;
  wristAnchors: WristAnchors;
  electron: boolean;
  roundCount: number;
  onFinish: (records: RoundRecord[], pauses?: PauseInterval[]) => void;
  onAbort: () => void;
};

export function Play({ rounds, hint, wristAnchors, electron, roundCount, onFinish, onAbort }: Props) {
  const [idx, setIdx] = useState(0);
  const [wrong, setWrong] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [resumeNotice, setResumeNotice] = useState(false);
  const [resumeRecordedDelay, setResumeRecordedDelay] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => performance.now());
  const [, render] = useReducer((n: number) => n + 1, 0);
  const catcher = useRef<HTMLInputElement>(null);
  const sessionStartedAt = useRef(performance.now());
  const sentence = rounds[idx];
  const expected = useMemo(() => keysForText(sentence.text), [sentence]);

  const live = useRef({ idx, expected, sentence });
  live.current = { idx, expected, sentence };
  const st = useRef({
    buf: [] as Entry[], events: [] as KeyEvent[], t0: 0, locked: false, done: false, caps: false,
    lastEnter: 0, lastSpace: 0, lastPunctuation: {} as Record<string, number>, lastMismatch: false, records: [] as RoundRecord[],
    paused: false, pauseStartedAt: 0, roundPausedMs: 0, pauseSeq: 0, resumeAt: 0, resumeFirstPending: false,
    pauses: [] as PauseInterval[],
  });

  useEffect(() => {
    const s = st.current;
    s.buf = [];
    s.events = [];
    s.done = false;
    s.lastMismatch = false;
    s.lastPunctuation = {};
    s.roundPausedMs = 0;
    s.locked = true;
    const raf = requestAnimationFrame(() => {
      s.t0 = performance.now();
      s.locked = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [idx]);

  useEffect(() => {
    if (!electron || paused) return;
    const timer = window.setInterval(() => setClockNow(performance.now()), 200);
    return () => window.clearInterval(timer);
  }, [electron, paused]);

  const togglePause = () => {
    if (!electron) return;
    const s = st.current;
    const now = performance.now();
    if (!s.paused) {
      s.paused = true;
      s.pauseStartedAt = now;
      s.pauseSeq += 1;
      const mark = Math.round(now - sessionStartedAt.current);
      s.pauses.push({ seq: s.pauseSeq, startMs: mark, endMs: mark });
      setPaused(true);
      setResumeRecordedDelay(null);
      setClockNow(now);
    } else {
      const pause = s.pauses.at(-1);
      if (pause) pause.endMs = Math.round(now - sessionStartedAt.current);
      s.roundPausedMs += now - s.pauseStartedAt;
      s.paused = false;
      s.resumeAt = now;
      s.resumeFirstPending = true;
      setResumeNotice(true);
      setPaused(false);
      setClockNow(now);
    }
  };

  useEffect(() => {
    let flashTimer = 0;
    const flash = (code: string) => {
      setWrong(code);
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => setWrong(null), 280);
    };
    const onKey = (e: KeyboardEvent) => {
      const s = st.current;
      const { expected: exp, idx: i, sentence: sent } = live.current;
      if (electron && shouldIgnoreKeyWhilePaused(s.paused)) {
        e.preventDefault();
        return;
      }
      const isCtrlKey = ["ControlLeft", "ControlRight", "MetaLeft", "MetaRight"].includes(e.code);
      if ((e.ctrlKey || e.metaKey) && !isCtrlKey) return;
      e.preventDefault();
      if (s.locked || (e.repeat && e.code !== "Backspace")) return;

      if (e.code === "Comma" || e.code === "Period") {
        const now = performance.now();
        if (now - (s.lastPunctuation[e.code] ?? -Infinity) < 70) return;
        s.lastPunctuation[e.code] = now;
      }

      if (e.code === "Space") {
        // 한글 입력기가 조합을 끝내며 스페이스 keydown을 연달아 두 번 보내는 경우가 있어 짧은 간격의 중복은 무시한다
        const now = performance.now();
        if (now - s.lastSpace < 60) return;
        s.lastSpace = now;
      }

      s.caps = e.getModifierState("CapsLock");
      const now = performance.now();
      const modifier = MODIFIERS.has(e.code);
      const resumedAfterPause = electron && s.resumeFirstPending;
      const base: Omit<KeyEvent, "kind"> = {
        t: Math.max(0, Math.round(now - s.t0 - s.roundPausedMs)),
        code: e.code, pos: s.buf.length, shift: e.shiftKey, caps: s.caps,
        ...(electron ? {
          sessionMs: Math.round(now - sessionStartedAt.current),
          pauseSeq: s.pauseSeq,
          ...(resumedAfterPause ? { resumedAfterPause: true, resumeDelayMs: Math.max(0, Math.round(now - s.resumeAt)) } : {}),
        } : {}),
      };
      if (resumedAfterPause) {
        s.resumeFirstPending = false;
        setResumeNotice(false);
        setResumeRecordedDelay(base.resumeDelayMs ?? 0);
      }

      if (s.done) {
        if ((e.code === "Enter" || e.code === "NumpadEnter") && now - s.lastEnter > 250) {
          s.lastEnter = now;
          if (electron) s.events.push({ ...base, kind: "submit" });
          s.done = false;
          s.buf = [];
          s.events = [];
          if (i + 1 < rounds.length) setIdx(i + 1);
          else onFinish(s.records, s.pauses.map((pause) => ({ ...pause })));
        }
        return;
      }

      if (modifier) {
        s.events.push({ ...base, kind: "modifier" });
        return;
      }
      if (e.code === "Backspace") {
        s.events.push({ ...base, kind: "backspace" });
        s.buf.pop();
        s.lastMismatch = false;
        render();
        return;
      }
      if ((e.code === "Enter" || e.code === "NumpadEnter") && exp[s.buf.length]?.code !== "Enter") {
        flash(e.code);
        return;
      }
      if (!TYPABLE.has(e.code)) {
        s.events.push({ ...base, kind: "other", err: e.code === "CapsLock" ? "Caps Lock" : "비문자 키" });
        flash(e.code);
        return;
      }

      const pos = s.buf.length;
      if (pos >= exp.length) {
        s.events.push({ ...base, kind: "overflow", err: "초과 입력", ok: false });
        flash(e.code);
        return;
      }
      const want = exp[pos];
      const isKeyLetter = e.code.startsWith("Key");
      const ime = isKeyLetter && (e.isComposing || e.keyCode === 229 || e.key === "Process");
      const wantIme = want.lang === "ko";
      const shift = isKeyLetter && !ime && s.caps ? !e.shiftKey : e.shiftKey;
      const modeOk = !isKeyLetter || ime === wantIme;
      const koreanTenseKey = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT"].includes(want.code);
      const shiftMatters = want.lang === "en" || want.shift || koreanTenseKey;
      const shiftOk = !shiftMatters || shift === want.shift;
      const ok = e.code === want.code && shiftOk && modeOk;
      let err: string | undefined;
      if (!ok) {
        if (e.code !== want.code) err = "다른 키";
        else if (!modeOk) err = "한/영 상태";
        else if (isKeyLetter && !ime && s.caps) err = "Caps Lock";
        else err = want.shift ? "Shift 빠뜨림" : "Shift 잘못 누름";
      }
      s.lastMismatch = err === "한/영 상태";
      const a = KEYPOS[e.code];
      const b = KEYPOS[want.code];
      s.events.push({
        ...base, kind: "char", shift, exp: want.code, expShift: want.shift, ok, err, ime,
        dx: a && b ? +(a.x - b.x).toFixed(2) : undefined,
        dy: a && b ? a.y - b.y : undefined,
        isNext: !!exp[pos + 1] && e.code === exp[pos + 1].code,
        isPrev: pos > 0 && e.code === exp[pos - 1].code,
      });
      s.buf.push({ ok, code: e.code, shift, ime, ...(resumedAfterPause ? { resumedAfterPause: true } : {}) });
      if (!ok) flash(e.code);

      if (s.buf.length === exp.length && s.buf.every((x) => x.ok)) {
        s.done = true;
        s.records.push({ id: sent.id, text: sent.text, tags: sent.tags, events: s.events });
      }
      render();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(flashTimer);
    };
  }, [electron, rounds, onFinish]);

  useEffect(() => {
    catcher.current?.focus();
  }, [idx]);

  const { buf, done, lastMismatch } = st.current;
  const hasWrong = buf.some((x) => !x.ok);
  const typed = composeTyped(
    buf.map((b): TypedKey => {
      const letter = b.code.startsWith("Key");
      if (letter && b.ime) return { text: jamoFor(b.code, b.shift), jamo: true, ok: b.ok };
      return { text: charFor(b.code, b.shift) || "?", jamo: false, ok: b.ok };
    }),
  );

  const cursorKey = expected[buf.length];
  const cursorChar = cursorKey ? cursorKey.ch : -1;
  const nextLetter = expected.slice(buf.length).find((k) => k.code.startsWith("Key"));
  const needMode = nextLetter ? (nextLetter.lang === "ko" ? "한글" : "영문") : "";

  const nextKeys: string[] = [];
  if (hint) {
    if (done) nextKeys.push("Enter");
    else if (hasWrong) nextKeys.push("Backspace");
    else if (cursorKey) {
      nextKeys.push(cursorKey.code);
      if (cursorKey.shift) nextKeys.push(handOf(cursorKey.code, wristAnchors) === "L" ? "ShiftRight" : "ShiftLeft");
    }
  }

  const last = idx + 1 >= rounds.length;
  const completedText = st.current.records.reduce((sum, record) => sum + record.text.length, 0);
  const currentText = done ? 0 : buf.length;
  const displayedNow = paused ? st.current.pauseStartedAt : clockNow;
  const activeMs = activeElapsedMs(sessionStartedAt.current, displayedNow, st.current.pauses);
  const liveCpm = activeMs > 0 ? Math.round(((completedText + currentText) * 60000) / activeMs) : 0;
  const elapsedLabel = `${String(Math.floor(activeMs / 60000)).padStart(2, "0")}:${String(Math.floor(activeMs / 1000) % 60).padStart(2, "0")}`;
  let note = "위 문장과 똑같이 아래 칸에 입력하세요. 첫 키를 누른 시각부터 속도를 재요.";
  if (lastMismatch) note = `한/영 상태가 달라요. 한/영 키를 눌러 ${needMode} 입력으로 바꾼 뒤 Backspace로 지우고 다시 쳐 주세요.`;
  else if (hasWrong) note = "틀린 글자가 있어요. Backspace로 지우고 다시 쳐 보세요.";
  else if (done) note = last ? "모두 맞았어요. Enter를 누르면 결과를 볼 수 있어요." : "모두 맞았어요. Enter를 누르면 다음 라운드로 넘어가요.";

  return (
    <main className="page play" onClick={() => catcher.current?.focus()}>
      <header className="play-head">
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={rounds.length} aria-valuenow={idx + (done ? 1 : 0)}>
          {rounds.map((r, n) => (
            <i key={r.id} className={n < idx ? "past" : n === idx ? "now" : ""} />
          ))}
        </div>
        <span className="round-no">{electron ? `문장 ${idx + 1} / ${roundCount}` : `라운드 ${idx + 1} / ${rounds.length}`}</span>
        {electron && <span className="play-clock">경과 {elapsedLabel} · {liveCpm} CPM</span>}
        {electron && <button className="ghost" onMouseDown={(event) => event.preventDefault()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.preventDefault(); }} onClick={togglePause}>{paused ? "재개" : "일시정지"}</button>}
        <button className="ghost" onClick={onAbort}>그만두기</button>
      </header>

      <section className="target" aria-label="따라 칠 문장">
        {paused ? <div className="pause-mask">일시정지 중</div> : <>
          <span className="box-label">칠 문장</span>
          <p className="sentence" lang="ko">
            {[...sentence.text].map((c, n) => (
              <span key={n} className={`ch ${!done && n === cursorChar ? "cursor" : ""}`}>{c}</span>
            ))}
          </p>
        </>}
      </section>

      <section className={`typebox ${hasWrong ? "has-wrong" : ""} ${done ? "is-done" : ""}`} aria-label="입력 칸">
        {paused ? <div className="pause-mask">입력 내용이 가려졌어요</div> : <>
          <span className="box-label">
            내가 친 글자
            {needMode && !done && <em className="mode-badge">{needMode} 입력</em>}
          </span>
          <p className="typed" lang="ko" aria-live="off">
            {typed.map((t, n) => (
              <span key={n} className={t.ok ? "" : "bad"}>{t.text === " " ? "\u00a0" : t.text}</span>
            ))}
            {!done && <i className="caret" />}
          </p>
        </>}
        <input
          ref={catcher}
          className="catcher"
          aria-label="문장 입력 칸"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value=""
          onChange={() => {}}
          onBlur={() => requestAnimationFrame(() => catcher.current?.focus())}
        />
      </section>
      <p className={`play-note ${done ? "ready" : ""}`} role="status">
        {electron && paused ? "일시정지 중이에요. 재개 버튼을 누르면 이어서 칠 수 있어요." : note}
        {electron && resumeNotice && <b className="resume-note">재개 후 첫 키 지연을 기록해요.</b>}
        {electron && resumeRecordedDelay !== null && <b className="resume-note">재개 직후 첫 키 지연 {resumeRecordedDelay}ms 기록</b>}
      </p>

      <div className="play-kb">
        <Keyboard next={nextKeys} wrong={wrong} />
      </div>
    </main>
  );
}
