import type { KeyEvent, PauseInterval, RoundRecord, Session } from "./types";

export function shouldIgnoreKeyWhilePaused(paused: boolean) {
  return paused;
}

export function totalPauseDuration(pauses: PauseInterval[] = []) {
  return pauses.reduce((sum, pause) => sum + Math.max(0, pause.endMs - pause.startMs), 0);
}

export function activeElapsedMs(startMs: number, nowMs: number, pauses: PauseInterval[] = [], openPauseStartMs?: number) {
  const openPause = openPauseStartMs === undefined ? 0 : Math.max(0, nowMs - openPauseStartMs);
  return Math.max(0, nowMs - startMs - totalPauseDuration(pauses) - openPause);
}

export function crossesPauseBoundary(previous: KeyEvent, current: KeyEvent) {
  return !!current.resumedAfterPause || (
    previous.pauseSeq !== undefined && current.pauseSeq !== undefined && previous.pauseSeq !== current.pauseSeq
  );
}

function completedCharacters(round: RoundRecord) {
  const stack: KeyEvent[] = [];
  for (const event of round.events) {
    if (event.kind === "char") stack.push(event);
    else if (event.kind === "backspace") stack.pop();
  }
  return stack.filter((event) => event.ok && event.sessionMs !== undefined);
}

function phaseCpm(rounds: RoundRecord[], postPause: boolean) {
  let count = 0;
  let duration = 0;
  for (const round of rounds) {
    const completedByPhase = new Map<number, KeyEvent[]>();
    for (const event of completedCharacters(round)) {
      const phase = event.pauseSeq ?? 0;
      if (postPause ? phase === 0 : phase !== 0) continue;
      const list = completedByPhase.get(phase) ?? [];
      list.push(event);
      completedByPhase.set(phase, list);
    }
    for (const [phase, characters] of completedByPhase) {
      const inputs = round.events.filter((event) => event.kind !== "submit" && event.sessionMs !== undefined && (event.pauseSeq ?? 0) === phase);
      inputs.sort((a, b) => a.sessionMs! - b.sessionMs!);
      characters.sort((a, b) => a.sessionMs! - b.sessionMs!);
      count += characters.length;
      const firstInput = inputs[0] ?? characters[0];
      const lastCharacter = characters[characters.length - 1];
      const resumeDelay = phase > 0 ? inputs.find((event) => event.resumeDelayMs !== undefined)?.resumeDelayMs ?? 0 : 0;
      duration += lastCharacter.sessionMs! - firstInput.sessionMs! + resumeDelay;
    }
  }
  return duration > 0 ? (count * 60000) / duration : 0;
}

export type PauseMetrics = {
  count: number;
  totalMs: number;
  prePauseCpm: number;
  postPauseCpm: number;
  resumeDelaysMs: number[];
};

export function calculatePauseMetrics(session: Session): PauseMetrics {
  const pauses = session.pauses ?? [];
  const resumeDelaysMs = session.rounds.flatMap((round) => round.events)
    .filter((event) => event.resumedAfterPause && event.resumeDelayMs !== undefined)
    .map((event) => event.resumeDelayMs!);
  return {
    count: pauses.length,
    totalMs: totalPauseDuration(pauses),
    prePauseCpm: phaseCpm(session.rounds, false),
    postPauseCpm: phaseCpm(session.rounds, true),
    resumeDelaysMs,
  };
}
