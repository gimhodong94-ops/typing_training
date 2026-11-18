import { useCallback, useRef, useState } from "react";
import { Play } from "./components/Play";
import { Result } from "./components/Result";
import { Start } from "./components/Start";
import { buildRounds, sentences, type Sentence } from "./lib/sentences";
import { loadWristAnchors, type WristAnchors } from "./lib/keyboard";
import type { PauseInterval } from "./lib/types";
import type { RoundSelection } from "./lib/roundSelection";
import { loadSessions, saveSession } from "./lib/storage";
import { createDesktopSession } from "./lib/sessionData";
import type { Feedback, KeyboardType, RoundRecord, Session } from "./lib/types";

type Screen =
  | { name: "start" }
  | { name: "play"; rounds: Sentence[]; keyboard: KeyboardType; hint: boolean; mode: "normal" | "practice"; wristAnchors: WristAnchors; roundCount: number }
  | { name: "result"; session: Session };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "start" });
  const [history, setHistory] = useState(loadSessions);

  const start = (keyboard: KeyboardType, hint: boolean, wristAnchors: WristAnchors, selection?: RoundSelection) => {
    const desktop = Boolean(window.typingCoach);
    const rounds = desktop && selection ? selection.rounds : buildRounds(sentences).rounds;
    setScreen({ name: "play", rounds, keyboard, hint, mode: "normal", wristAnchors, roundCount: desktop ? (selection?.count ?? rounds.length) : rounds.length });
  };

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const finish = useCallback((records: RoundRecord[], pauses: PauseInterval[] = []) => {
    const current = screenRef.current;
    if (current.name !== "play") return;
    const desktop = Boolean(window.typingCoach);
    const sessionData: Omit<Session, "roundCount" | "pauses" | "schemaVersion"> = {
      id: Date.now(), at: new Date().toISOString(), keyboard: current.keyboard, mode: current.mode,
      rounds: records, wristAnchors: current.wristAnchors,
    };
    const session: Session = desktop ? createDesktopSession(sessionData, current.roundCount, pauses) : sessionData;
    saveSession(session);
    setHistory(loadSessions());
    setScreen({ name: "result", session });
  }, []);
  const keepFeedback = (feedback: Feedback) => {
    if (screen.name !== "result") return;
    const session = { ...screen.session, feedback };
    saveSession(session);
    setHistory(loadSessions());
    setScreen({ name: "result", session });
  };
  const practice = (rounds: Sentence[]) => {
    if (screen.name !== "result") return;
    setScreen({ name: "play", rounds, keyboard: screen.session.keyboard, hint: true, mode: "practice", wristAnchors: screen.session.wristAnchors ?? loadWristAnchors(), roundCount: rounds.length });
  };
  const abort = useCallback(() => setScreen({ name: "start" }), []);

  if (screen.name === "play") return <Play key={screen.rounds[0].id + screen.rounds.length} rounds={screen.rounds} hint={screen.hint} wristAnchors={screen.wristAnchors} electron={Boolean(window.typingCoach)} roundCount={screen.roundCount} onFinish={finish} onAbort={abort} />;
  if (screen.name === "result") return <Result key={screen.session.id} session={screen.session} onBack={abort} onFeedback={keepFeedback} onPractice={practice} />;
  return <Start history={history} onStart={start} onOpen={(session) => setScreen({ name: "result", session })} />;
}
