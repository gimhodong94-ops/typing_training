import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "./components/Play";
import { Result } from "./components/Result";
import { Start } from "./components/Start";
import { buildRounds, sentences, type Sentence } from "./lib/sentences";
import { FINGER_MAP_VERSION, loadKeyboardDz, loadWristAnchors, type WristAnchors } from "./lib/keyboard";
import type { PauseInterval } from "./lib/types";
import type { RoundSelection } from "./lib/roundSelection";
import { loadSessions, saveSession } from "./lib/storage";
import { createDesktopSession } from "./lib/sessionData";
import { analyze } from "./lib/stats";
import { buildFactList } from "./lib/facts";
import { selectSentenceAnalysisRounds } from "./lib/sentenceAnalysis";
import { calculateReachCutoffs } from "./lib/detection";
import type { Feedback, RoundRecord, Session } from "./lib/types";

type Screen =
  | { name: "start" }
  | { name: "play"; rounds: Sentence[]; hint: boolean; mode: "normal" | "practice"; wristAnchors: WristAnchors; dz: number; roundCount: number; generalPractice?: boolean }
  | { name: "result"; session: Session };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "start" });
  const [history, setHistory] = useState(loadSessions);
  const [openSettings, setOpenSettings] = useState(false);
  useEffect(() => {
    window.typingCoach?.loadSessions().then((saved) => {
      const merged = new Map<number, Session>();
      const savedIds = new Set(saved.map((session) => session.id));
      loadSessions().forEach((session) => merged.set(session.id, { ...session, isLocalStorageOnly: !savedIds.has(session.id) }));
      saved.forEach((session) => merged.set(session.id, { ...merged.get(session.id), ...session, isLocalStorageOnly: false }));
      const list = [...merged.values()].sort((a, b) => b.id - a.id).slice(0, 50);
      setHistory(list);
    }).catch(() => {});
  }, []);

  const start = (hint: boolean, wristAnchors: WristAnchors, selection?: RoundSelection, dz = loadKeyboardDz()) => {
    const desktop = Boolean(window.typingCoach);
    const rounds = desktop && selection ? selection.rounds : buildRounds(sentences).rounds;
    setScreen({ name: "play", rounds, hint, mode: "normal", wristAnchors, dz, roundCount: desktop ? (selection?.count ?? rounds.length) : rounds.length });
  };

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const finish = useCallback((records: RoundRecord[], pauses: PauseInterval[] = []) => {
    const current = screenRef.current;
    if (current.name !== "play") return;
    const desktop = Boolean(window.typingCoach);
    const sessionData: Omit<Session, "roundCount" | "pauses" | "schemaVersion"> = {
      id: Date.now(), at: new Date().toISOString(), keyboard: "desktop", mode: current.mode, hintOn: current.hint,
      rounds: records, wristAnchors: current.wristAnchors, dz: current.dz,
      reachCutoffs: calculateReachCutoffs(current.wristAnchors, current.dz), fingerMapVersion: FINGER_MAP_VERSION,
    };
    const draft: Session = desktop ? createDesktopSession(sessionData, current.roundCount, pauses, current.hint) : sessionData;
    const metrics = analyze(draft).totals;
    const analysis = analyze(draft);
    const session: Session = { ...draft, accuracyA: metrics.accuracyA, accuracyB: metrics.accuracyB, wrongErase: metrics.wrongErase,
      analysis: { selectedRounds: selectSentenceAnalysisRounds(draft), facts: buildFactList(analysis) } };
    saveSession(session);
    if (desktop) void window.typingCoach!.appendSession(session.id, true, [
      { sessionId: session.id, type: "analysis", data: session.analysis },
      { sessionId: session.id, type: "raw", data: session },
    ]).catch((error) => console.error("세션 JSONL 저장 실패", error));
    setHistory((previous) => [session, ...previous.filter((item) => item.id !== session.id)].slice(0, 50));
    setScreen({ name: "result", session });
  }, []);
  const keepFeedback = (feedback: Feedback) => {
    if (screen.name !== "result") return;
    const session = { ...screen.session, feedback };
    saveSession(session);
    if (window.typingCoach) void window.typingCoach.appendSession(session.id, false, [{ sessionId: session.id, type: "feedback", data: feedback }]).catch((error) => console.error("피드백 저장 실패", error));
    setHistory(loadSessions());
    setScreen({ name: "result", session });
  };
  const keepAIAnalysis = (analysis: unknown) => {
    if (screen.name !== "result") return;
    const session = { ...screen.session, aiAnalysis: analysis };
    saveSession(session);
    if (window.typingCoach) void window.typingCoach.appendSession(session.id, false, [{ sessionId: session.id, type: "ai_analysis", data: analysis }]).catch((error) => console.error("문장 분석 저장 실패", error));
    setHistory(loadSessions());
    setScreen({ name: "result", session });
  };
  const keepAnswers = (answers: import("./lib/types").AIQuestionAnswer[]) => {
    if (screen.name !== "result") return;
    const session = { ...screen.session, answers };
    saveSession(session);
    if (window.typingCoach) void window.typingCoach.appendSession(session.id, false, [{ sessionId: session.id, type: "answers", data: answers }]).catch((error) => console.error("답변 저장 실패", error));
    setScreen({ name: "result", session });
  };
  const practice = (rounds: Sentence[], generalPractice: boolean) => {
    if (screen.name !== "result") return;
    setScreen({ name: "play", rounds, hint: true, mode: "practice", wristAnchors: screen.session.wristAnchors ?? loadWristAnchors(), dz: screen.session.dz ?? loadKeyboardDz(), roundCount: rounds.length, generalPractice });
  };
  const abort = useCallback(() => { setOpenSettings(false); setScreen({ name: "start" }); }, []);
  const openAISettings = useCallback(() => { setOpenSettings(true); setScreen({ name: "start" }); }, []);

  if (screen.name === "play") return <Play key={screen.rounds[0].id + screen.rounds.length} rounds={screen.rounds} hint={screen.hint} wristAnchors={screen.wristAnchors} electron={Boolean(window.typingCoach)} roundCount={screen.roundCount} onFinish={finish} onAbort={abort} generalPractice={screen.generalPractice} />;
  if (screen.name === "result") return <Result key={screen.session.id} session={screen.session} sessions={[screen.session, ...history.filter((item) => item.id !== screen.session.id)]} onBack={abort} onSettings={openAISettings} onFeedback={keepFeedback} onPractice={practice} onAIAnalysis={keepAIAnalysis} onAnswers={keepAnswers} />;
  return <Start history={history} onStart={start} onOpen={(session) => setScreen({ name: "result", session })} openSettings={openSettings} />;
}
