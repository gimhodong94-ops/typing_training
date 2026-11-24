import { useEffect, useMemo, useState } from "react";
import { Keyboard } from "./Keyboard";
import { requestFeedback, requestPractice, requestSentenceAnalysis } from "../lib/ai";
import { PRACTICE_COUNT, meanLength, sentences as allSentences, type Sentence } from "../lib/sentences";
import { aiSummary, analyze, compareWeakKeys, weaknessBaseline } from "../lib/stats";
import { sessionRoundCount } from "../lib/sessionData";
import type { Feedback, Session } from "../lib/types";
import aiFeatures from "../../config/aiFeatures.json";
import { capSessionQuestions, chunkSentenceAnalysis, selectSentenceAnalysisRounds, validateSentenceAnalysis } from "../lib/sentenceAnalysis";
import type { AIQuestionAnswer } from "../lib/types";
import { josa } from "../lib/grammar";
import { rankComparisonRows, selectWeaknessCards } from "../lib/weaknessPresentation";

const fmt = (v: number, d = 0) => v.toFixed(d);
const sec = (ms: number) => `${(ms / 1000).toFixed(2)}초`;
const confidenceLabel: Record<string, string> = { 높음: "최근 3번 합산에서 뚜렷했어요", 중간: "최근 3번 합산에서 어느 정도 보여요", 낮음: "아직 기록이 적어요" };

function groupCard(group: any, sessions: number) {
  const actor = group.category === "finger" || group.category === "hand" ? josa(group.label, "으로", "로") : group.label;
  const title = group.category === "finger" ? `${actor} 입력에서 반복된 오타`
    : group.category === "hand" ? `${actor} 입력에서 반복된 오타`
      : `${group.label} 입력에서 반복된 오타`;
  const detail = `최근 ${sessions}번 합산 기준으로 ${group.n}번 입력 중 ${group.k}번 오타가 있었어요 (${group.rate.toFixed(1)}%).`;
  const causes = group.category === "finger" || group.category === "hand"
    ? [`${actor} 담당 키의 위치를 찾는 동안 손가락이 흔들렸을 수 있어요.`, "위아래 키로 이동할 때 손가락이 익숙한 경로를 아직 찾는 중일 수 있어요."]
    : group.category === "reach" ? ["먼 키를 누를 때 손가락이 목표를 지나쳤을 수 있어요.", "먼 키로 이동한 뒤 기본 자리로 돌아오는 과정이 익숙하지 않을 수 있어요."]
      : group.category === "space" ? ["어절 사이에서 스페이스 타이밍이 일정하지 않았을 수 있어요.", "다음 어절을 먼저 입력하면서 공백 위치가 밀렸을 수 있어요."]
        : group.category === "shift" ? ["Shift를 누르고 떼는 순서가 익숙하지 않을 수 있어요.", "대문자나 겹자음을 입력할 때 양손 협응이 달라질 수 있어요."]
          : ["이 입력 묶음의 키 배치가 아직 익숙하지 않을 수 있어요.", "문장 안에서 해당 글자 흐름이 빠르게 이어졌을 수 있어요."];
  const advice = group.category === "finger" || group.category === "hand"
    ? `${actor} 담당 키를 기본 자리에 손을 둔 채 천천히 10번씩 입력해 보세요.`
    : group.category === "reach" ? "먼 키로 이동한 뒤 기본 자리로 돌아오는 짧은 문장을 천천히 연습해 보세요."
      : group.category === "space" ? "두 어절 사이마다 공백을 확인하며 짧은 문장 5개를 입력해 보세요."
        : group.category === "shift" ? "Shift가 필요한 글자를 포함한 짧은 문장을 천천히 5번 입력해 보세요."
          : `${josa(group.label, "이", "가")} 들어간 짧은 문장을 천천히 5번 입력해 보세요.`;
  return { id: group.id, title, confidence: group.confidence, evidence: detail, causes, checkNext: `${actor} 움직임과 공백 위치를 다음 입력에서 하나씩 확인해 보세요.`, advice, ci: group.ci, category: group.category };
}

type Props = {
  session: Session;
  sessions: Session[];
  onBack: () => void;
  onSettings: () => void;
  onFeedback: (feedback: Feedback) => void;
  onPractice: (rounds: Sentence[], generalPractice: boolean) => void;
  onAIAnalysis: (analysis: unknown) => void;
  onAnswers: (answers: AIQuestionAnswer[]) => void;
};

export function Result({ session, sessions, onBack, onSettings, onFeedback, onPractice, onAIAnalysis, onAnswers }: Props) {
  const a = useMemo(() => analyze(session), [session]);
  const storedSessions = useMemo(() => sessions, [sessions]);
  const baseline = useMemo(() => weaknessBaseline(storedSessions, session.hintOn, session.id), [storedSessions, session.hintOn, session.id]);
  const previousSession = useMemo(() => {
    return session.hintOn === undefined ? undefined : storedSessions.find((item) => item.id < session.id && item.hintOn === session.hintOn);
  }, [storedSessions, session.id]);
  const weakKeyComparisons = useMemo(() => previousSession ? compareWeakKeys(previousSession, session) : [], [previousSession, session]);
  const comparisonTop = useMemo(() => rankComparisonRows(weakKeyComparisons), [weakKeyComparisons]);
  const [mode, setMode] = useState<"err" | "slow">("err");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"" | "feedback" | "practice">("");
  const [aiError, setAiError] = useState("");
  const [localOnly, setLocalOnly] = useState(false);
  const [features, setFeatures] = useState({ sentenceAnalysisEnabled: aiFeatures.sentenceAnalysisEnabled, questionCardsEnabled: aiFeatures.questionCardsEnabled, sentenceAnalysisConsent: false });
  const [sentenceMessage, setSentenceMessage] = useState("");
  const [sentenceFailed, setSentenceFailed] = useState(false);
  const [sentenceBusy, setSentenceBusy] = useState(false);
  const [answers, setAnswers] = useState<AIQuestionAnswer[]>(session.answers ?? []);
  useEffect(() => { window.typingCoach?.getFeatureSettings().then(setFeatures).catch(() => {}); }, []);
  const feedback = useMemo(() => {
    if (localOnly || !session.feedback) return undefined;
    if (!baseline.weaknessEligibility.canDiagnose) {
      return { ...session.feedback, weaknesses: [], watchItems: [] };
    }
    const confidenceByKey = new Map(baseline.weakKeys.map((item) => [String(item.key), String(item.confidence)]));
    const grounded = session.feedback.weaknesses.flatMap((item) => {
      const key = [...confidenceByKey.keys()].find((name) => item.title.includes(name));
      if (!key) return [];
      return [{ ...item, confidence: confidenceByKey.get(key) as Feedback["weaknesses"][number]["confidence"] }];
    });
    const currentWatch = (session.feedback.watchItems ?? []).flatMap((item) => {
      const key = [...confidenceByKey.keys()].find((name) => item.title.includes(name));
      return key ? [{ ...item, confidence: "낮음" as const }] : [];
    });
    return {
      ...session.feedback,
      weaknesses: grounded.filter((item) => item.confidence !== "낮음").slice(0, 2),
      watchItems: [...currentWatch, ...grounded.filter((item) => item.confidence === "낮음")].slice(0, 3),
    };
  }, [localOnly, session.feedback, baseline]);
  const summaryText = useMemo(() => {
    const data = aiSummary(session, a);
    const grounded = { ...data, ...baseline };
    return JSON.stringify(window.typingCoach ? { ...grounded, pauses: a.pauseMetrics } : grounded, null, 1);
  }, [session, a, baseline]);

  const heat: Record<string, number> = {};
  const tip: Record<string, string> = {};
  const maxMs = Math.max(...a.keyStats.map((k) => k.ms), 1);
  const minMs = Math.min(...a.keyStats.filter((k) => k.msN >= 2).map((k) => k.ms), maxMs);
  a.keyStats.forEach((k) => {
    if (mode === "err") {
      heat[k.code] = k.n >= 2 ? Math.min(k.errRate / 40, 1) : 0;
      tip[k.code] = `${k.label}: ${k.err} / ${k.n}, 오타율 ${fmt(k.errRate, 1)}%, 95% 구간 ${Math.round(k.interval.lower * 100)}~${Math.round(k.interval.upper * 100)}%`;
    } else {
      heat[k.code] = k.msN >= 2 && maxMs > minMs ? (k.ms - minMs) / (maxMs - minMs) : 0;
      tip[k.code] = `${k.label}: 평균 ${fmt(k.ms)}ms`;
    }
  });

  const maxKpm = Math.max(...a.rounds.map((r) => r.kpm), 1);
  const avgKpm = a.totals.kpm;
  const kinds = Object.entries(a.byKind).sort((x, y) => y[1] - x[1]);
  const summary = useMemo(() => {
    const data = aiSummary(session, a);
    const grounded = { ...data, ...baseline };
    return window.typingCoach ? { ...grounded, pauses: a.pauseMetrics } : grounded;
  }, [session, a, baseline]);
  const askFeedback = async () => {
    if (session.isLocalStorageOnly) { setAiError("이전 브라우저 기록은 AI 분석에 사용하지 않아요."); return; }
    setBusy("feedback");
    setAiError("");
    try {
      const verifiedAnalyses = Array.isArray(session.aiAnalysis) ? session.aiAnalysis : [];
      const result = await requestFeedback({ ...summary, sentenceAnalyses: verifiedAnalyses, answers });
      if (result) { setLocalOnly(false); onFeedback(result); }
      else {
        setLocalOnly(true);
        setAiError("AI 근거의 숫자를 기록에서 확인하지 못해 결과를 제외했어요. 아래 로컬 약점 요약을 참고해 주세요.");
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "요청에 실패했어요.");
    }
    setBusy("");
  };
  const sendSentenceAnalysis = async () => {
    if (!window.typingCoach) { setSentenceMessage("문장 분석은 데스크톱 앱에서만 사용할 수 있어요."); return; }
    setSentenceBusy(true); setSentenceFailed(false); setSentenceMessage("문장을 살펴보는 중이에요.");
    try {
      const settings = await window.typingCoach.getAISettings();
      let savedFeatures = await window.typingCoach.getFeatureSettings();
      if (!savedFeatures.sentenceAnalysisConsent) savedFeatures = await window.typingCoach.saveFeatureSettings({ sentenceAnalysisConsent: true });
      setFeatures(savedFeatures);
      const blocked: string[] = [];
      if (!settings.hasGeminiKey) blocked.push("Gemini 키가 저장되어 있지 않아요. 설정에서 키를 입력해 주세요.");
      if (!savedFeatures.sentenceAnalysisEnabled) blocked.push("문장 분석이 꺼져 있어요. 설정에서 켜 주세요.");
      if (blocked.length) { setSentenceFailed(true); setSentenceMessage(blocked.join(" ")); return; }
      const selected = selectSentenceAnalysisRounds(session);
      if (!selected.length) { setSentenceMessage("이번 연습은 분석할 만큼 오타가 많은 문장이 없어요."); return; }
      const analyses: any[] = [];
      const usedModels = new Set<string>();
      for (const chunk of chunkSentenceAnalysis(selected)) {
        const response = await requestSentenceAnalysis(chunk);
        usedModels.add(response.model);
        analyses.push(...validateSentenceAnalysis(response.analyses, new Set(chunk.map((row: any) => row.roundId))).map((row: any) => ({
          ...(features.questionCardsEnabled ? row : { ...row, questions: [] }), model: response.model,
        })));
      }
      const saved = capSessionQuestions(analyses.map((item) => ({ ...item, roundIndex: selected.find((round) => round.roundId === item.roundId)?.roundIndex })));
      onAIAnalysis(saved);
      if (!saved.length) throw new Error("분석 응답을 확인하지 못했어요.");
      setSentenceMessage(`문장 분석을 저장했어요. 사용 모델: ${[...usedModels].join(", ")}`);
    } catch (error) { setSentenceFailed(true); setSentenceMessage(error instanceof Error ? error.message : "문장 분석에 실패했어요."); }
    finally { setSentenceBusy(false); }
  };
  const recordAnswer = (questionId: string, answer: AIQuestionAnswer["answer"]) => {
    const next = [...answers.filter((item) => item.questionId !== questionId), { questionId, answer, at: new Date().toISOString() }];
    setAnswers(next); onAnswers(next);
  };
  const startSentenceAnalysis = () => {
    if (!selectSentenceAnalysisRounds(session).length) { setSentenceMessage("이번 연습은 오타가 적어서 따로 분석할 문장이 없어요"); return; }
    void sendSentenceAnalysis();
  };
  const storedSentenceAnalyses = Array.isArray(session.aiAnalysis) ? session.aiAnalysis as any[] : [];
  const bundleCards = baseline.eligibleWeakGroups.map((group: any) => groupCard(group, baseline.weaknessEligibility.matchingSessions));
  const coveredFingers = new Set(baseline.eligibleWeakGroups.filter((group: any) => group.category === "finger").map((group: any) => group.label));
  const keyCards = baseline.weakKeys.filter((item: any) => item.confidence !== "낮음" && !coveredFingers.has(item.finger)).map((item: any) => {
    const actor = josa(item.finger, "으로", "로");
    return { id: `key:${item.key}`, title: `${item.key} 키 입력`, confidence: item.confidence,
      evidence: `최근 ${baseline.weaknessEligibility.matchingSessions}번 합산 기준으로 ${item.n}번 입력 중 ${item.err}번 오타가 있었어요 (${item.errPct}%).`,
      causes: [`${actor} 키를 누를 때 손가락 위치가 흔들렸을 수 있어요.`, "해당 키가 포함된 글자 흐름이 아직 익숙하지 않을 수 있어요."],
      checkNext: `${actor} 움직임과 키 위치를 다음 입력에서 확인해 보세요.`,
      advice: `${actor} 담당 키를 천천히 10번 입력한 뒤 짧은 문장에 넣어 연습해 보세요.`,
      ci: item.wilson95, category: "key" };
  });
  const weakCards = selectWeaknessCards(baseline.weaknessEligibility.canDiagnose, bundleCards, keyCards);
  const cardIds = new Set(weakCards.map((item) => item.id));
  const watchRows = [
    ...baseline.weakGroups.filter((group: any) => group.n >= 5).map((group: any) => ({ id: group.id, title: `${group.label} 입력`, k: group.k, n: group.n, rate: group.rate, ci: group.ci })),
    ...baseline.weakKeys.map((item: any) => ({ id: `key:${item.key}`, title: `${item.key} 키`, k: item.err, n: item.n, rate: item.errPct, ci: item.wilson95 })),
  ].filter((item) => item.k > 0 && !cardIds.has(item.id)).sort((x, y) => y.rate - x.rate).slice(0, 3);
  const clearWeakness = weakCards.some((item) => item.confidence === "높음");
  const askPractice = async () => {
    if (session.isLocalStorageOnly) { setAiError("이전 브라우저 기록은 AI 분석에 사용하지 않아요."); return; }
    setBusy("practice");
    setAiError("");
    try {
      const result = await requestPractice(summary, feedback, PRACTICE_COUNT, meanLength(allSentences));
      onPractice(result.sentences, result.generalPractice);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "요청에 실패했어요.");
      setBusy("");
    }
  };
  const download = () => {
    const exportData = {
      ...session,
      rawData: {
        rounds: session.rounds.map((round, index) => ({
          index: index + 1,
          id: round.id,
          text: round.text,
          tags: round.tags ?? [],
          events: round.events,
        })),
      },
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `typing-session-${session.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(summaryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="page result">
      <header className="result-head">
        <div>
          <h1>{window.typingCoach ? `${sessionRoundCount(session)}문장` : `${a.rounds.length}라운드`} {session.mode === "practice" ? "약점 연습 " : ""}결과</h1>
          <p className="lead result-summary">정확도 {fmt(a.totals.accuracyA, 0)}%, 분당 {fmt(a.totals.kpm)}타예요. {clearWeakness ? "뚜렷한 약점이 있어요." : "뚜렷한 약점은 아직 없어요."}</p>
        </div>
        <div className="actions">
          <button className="ghost" onClick={onSettings}>설정</button>
          <button className="ghost" onClick={download}>기록 내려받기</button>
          <button className="primary small" onClick={onBack}>처음으로</button>
        </div>
      </header>

      <section className="panel weakness-panel">
        <h2>약점</h2>
        {weakCards.length ? <div className="weak-list">{weakCards.map((card, index) => {
          return <article className="weak" key={card.id}>
            <h3><span>{index + 1}</span>{card.title}<em className="confidence">{confidenceLabel[card.confidence] ?? confidenceLabel.낮음}</em></h3>
            <p title={`95% 신뢰구간: ${card.ci.lower}~${card.ci.upper}%`}><b>근거</b> {card.evidence} <span aria-hidden="true">ⓘ</span></p>
            <ul>{card.causes.map((cause) => <li key={cause}>{cause}</li>)}</ul>
            <p><b>확인해 볼 방법</b> {card.checkNext}</p>
            <p className="advice"><b>오늘 해볼 연습</b> {card.advice}</p>
          </article>;
        })}</div> : <p className="note">뚜렷한 약점은 아직 없어요.</p>}
        {baseline.weaknessEligibility.canDiagnose && <p className="note">최근 3번 합산 기준</p>}
        {!baseline.weaknessEligibility.canDiagnose && <p className="note">같은 힌트 설정의 연습을 {baseline.weaknessEligibility.requiredSessions - baseline.weaknessEligibility.matchingSessions}번 더 하면 손가락별 패턴을 볼 수 있어요.</p>}
      </section>

      <section className="panel watch-items">
        <h2>지켜볼 것</h2>
        {watchRows.length ? <ul>{watchRows.map((item) => <li key={item.id} title={`오타율 95% 신뢰구간 ${item.ci.lower}~${item.ci.upper}%`}>
          {item.title}: {item.n}번 입력 중 {item.k}번 오타 ({item.rate.toFixed(1)}%) <span aria-hidden="true">ⓘ</span>
        </li>)}</ul> : <p className="note">더 살펴볼 항목이 없어요.</p>}
      </section>

      {window.typingCoach && !session.isLocalStorageOnly && <section className="panel sentence-analysis">
        <div className="panel-head"><h2>AI가 궁금한 점</h2><button className="ghost" disabled={sentenceBusy} onClick={startSentenceAnalysis}>{sentenceBusy ? "분석하는 중..." : storedSentenceAnalyses.length ? "다시 분석" : "문장 분석하기"}</button></div>
        {sentenceMessage && <p className={sentenceFailed ? "error" : "note"} role={sentenceFailed ? "alert" : "status"}>{sentenceBusy ? "문장을 살펴보는 중이에요." : sentenceMessage}</p>}
        {sentenceFailed && <button className="ghost" disabled={sentenceBusy} onClick={() => void sendSentenceAnalysis()}>다시 시도</button>}
        <button className="text-link" onClick={onSettings}>문장 분석 설정 열기</button>
        {!storedSentenceAnalyses.length && <p className="note">오타가 많은 문장을 AI가 살펴보고 짧은 질문을 만들어요. 원시 키 입력은 전송하지 않습니다.</p>}
        {storedSentenceAnalyses.map((item, index) => <article className="sentence-ai-item" key={`${item.roundId}-${index}`}>
          <h3>{item.roundIndex ?? item.roundId}번 문장</h3><p>{item.summary}</p><small>{item.evidence} · 사용 모델: {item.model ?? "기록 없음"}</small>
            {features.questionCardsEnabled && Array.isArray(item.questions) && item.questions.map((question: any) => {
            const answer = answers.find((row) => row.questionId === question.id)?.answer;
            return <div className="question-card" key={question.id}><p>{question.prompt}</p><small>이 질문은 AI가 입력 패턴을 바탕으로 만든 확인 질문이에요.</small>
              <div className="actions">{(["맞아요", "아니에요", "모르겠어요", "건너뜀"] as const).map((value) => <button className={answer === value ? "on" : "ghost"} key={value} onClick={() => recordAnswer(question.id, value)}>{value}</button>)}</div>
              <small>확인해 볼 방법: {question.checkMethod}</small>
            </div>;
          })}
        </article>)}
      </section>}

      <details className="result-details"><summary>자세히 보기</summary><div className="details-content">
      <section className="panel">
        <h2>라운드별 속도</h2>
        <div className="bars" role="group" aria-label="라운드별 분당 타수 막대그래프">
          {a.rounds.map((r) => (
            <div key={r.id + r.i} className="bar-col" tabIndex={0} data-tooltip={`문장 ${r.i + 1}: ${fmt(r.kpm)}타/분 · 오입력 ${r.errs}번 · 첫 입력 ${sec(r.first)}`} title={`라운드 ${r.i + 1}: ${fmt(r.kpm)}타/분, 오입력 ${r.errs}번, 첫 입력 ${sec(r.first)}`}>
              <div className="bar-fill"><i className={r.errs ? "has-err" : ""} style={{ height: `${(r.kpm / maxKpm) * 100}%` }} /></div>
              <span>{r.i + 1}</span>
            </div>
          ))}
          <div className="avg-line" style={{ bottom: `calc(18px + (100% - 18px) * ${avgKpm / maxKpm})` }}><span>평균 {fmt(avgKpm)}</span></div>
        </div>
        <p className="note">붉은 막대는 오입력이 있었던 라운드예요. 막대에 올리면 자세한 값이 보여요.</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>키보드 지도</h2>
          <div className="seg small" role="radiogroup" aria-label="지도 종류">
            <button role="radio" aria-checked={mode === "err"} className={mode === "err" ? "on" : ""} onClick={() => setMode("err")}>오타율</button>
            <button role="radio" aria-checked={mode === "slow"} className={mode === "slow" ? "on" : ""} onClick={() => setMode("slow")}>느린 키</button>
          </div>
        </div>
        <Keyboard heat={heat} tip={tip} />
        <p className="note">{mode === "err" ? "오타율 지도는 첫 오입력 기준이에요. 진할수록 그 키를 눌러야 할 때 자주 틀렸어요." : "진할수록 그 키를 치기 직전 키에서 넘어오는 데 오래 걸렸어요."} 키 간 거리 1칸은 약 19mm예요.</p>
      </section>

      <div className="two">
        <section className="panel">
            <h2>키별 오타율</h2>
          {a.weakKeys.length === 0 ? <p className="note">키별 기록이 더 필요해요.</p> : (
            <table>
              <thead><tr><th>키</th><th>오타</th><th>시도</th><th>오타율</th><th>관찰</th></tr></thead>
              <tbody>{a.weakKeys.map((key) => (
                <tr key={key.code}><td>{key.label}</td><td>{key.err}번</td><td>{key.n}번</td><td title={`95% 신뢰구간 ${Math.round(key.interval.lower * 100)}~${Math.round(key.interval.upper * 100)}%`}>{fmt(key.errRate, 1)}% ⓘ</td>
                  <td>{confidenceLabel[key.confidence] ?? confidenceLabel.낮음}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <h2>Shift 조합</h2>
          {a.shiftCombo.n === 0 ? <p className="note">기록이 부족해 계산할 수 없어요.</p> : (
            <p title={`95% 신뢰구간 ${Math.round(a.shiftCombo.interval.lower * 100)}~${Math.round(a.shiftCombo.interval.upper * 100)}%`}>{a.shiftCombo.err}번 오타, {a.shiftCombo.n}번 시도 · {fmt(a.shiftCombo.err / a.shiftCombo.n * 100, 1)}% ⓘ</p>
          )}
        </section>
        <section className="panel">
          <h2>자주 틀린 키</h2>
          {a.pairs.length === 0 ? <p className="note">같은 키 조합의 오타가 반복된 기록은 아직 없어요. 전체 오타 {a.totals.errs}번은 여러 키에 흩어져 있어요.</p> : (
            <table>
              <thead><tr><th>눌러야 할 키</th><th>누른 키</th><th>횟수</th><th>오차</th></tr></thead>
              <tbody>
                {a.pairs.map((p) => (
                  <tr key={p.exp + p.act}><td>{p.exp}</td><td>{p.act}</td><td>{p.n}</td><td>{p.dir} {fmt(p.dist, 1)}칸</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <h2>오입력 종류</h2>
          {kinds.length === 0 ? <p className="note">오타 기록이 없어요.</p> : (
            <table>
              <thead><tr><th>종류</th><th>횟수</th></tr></thead>
              <tbody>{kinds.map(([k, n]) => <tr key={k}><td>{k === "longGap" ? "긴 입력 간격 (2초 이상)" : k}</td><td>{n}</td></tr>)}</tbody>
            </table>
          )}
          <p className="note">
            Backspace {a.totals.backspaces}번, 고친 오타 {a.corr.n}건
            {a.corr.n ? `(평균 ${sec(a.corr.mean)}, 같은 자리에서 다시 틀림 ${a.corr.reErr}번)` : ""}
          </p>
          <p className="note" title="오타와 불필요하게 지운 정타를 함께 반영한 정확도입니다.">지우기 포함 정확도: {a.totals.accuracyB === undefined ? "기록이 부족해 계산할 수 없어요." : `${fmt(a.totals.accuracyB, 1)}% · 불필요하게 지운 정타 ${a.totals.wrongErase}회`} ⓘ</p>
        </section>

        <section className="panel">
          <h2>입력 패턴 감지</h2>
          <p className="note" title={`입력 수 ${a.detection.alignment.n}, 계산 상태 ${a.detection.alignment.status}`}>입력 흐름 살펴보기 ⓘ</p>
          <p title="오타가 난 입력 묶음을 기대한 글자와 실제 입력 순서로 맞춰 봅니다.">오타 유형: 빠짐 {a.detection.alignment.omission} · 더 입력 {a.detection.alignment.extra} · 다른 키 {a.detection.alignment.substitution} · 순서 바뀜 {a.detection.alignment.transposition} · 분류 어려움 {a.detection.alignment.ambiguous} ⓘ</p>
          {a.detection.spaces && <p>공백 빠짐 {a.detection.spaces.omission} · 불필요한 공백 {a.detection.spaces.extra} · 위치가 다른 공백 {a.detection.spaces.position}</p>}
          <p>키 입력 시각: {a.detection.keyTiming.status === "집계됨" ? `겹쳐 누른 입력 ${a.detection.keyTiming.simultaneous ?? 0}번 · 빠르게 반복한 입력 ${a.detection.keyTiming.duplicate ?? 0}번` : "기록된 입력 시각이 부족해 계산할 수 없어요."}{a.detection.keyTiming.shiftReleaseDelayMedianMs !== undefined ? ` · Shift를 뗀 시간의 중앙값 ${Math.round(a.detection.keyTiming.shiftReleaseDelayMedianMs)}ms` : ""}</p>
          <p title="실수 묶음은 첫 오입력부터 그 자리를 올바르게 고칠 때까지 이어진 입력입니다.">오타 뒤에 이어 친 입력 최대 {a.detection.unresolvedTypos.maximumFollowingKeys}개 · 평소 간격 중앙값 {a.detection.slowdown.baselineMedianMs === undefined ? "기록이 부족해 계산할 수 없어요." : `${Math.round(a.detection.slowdown.baselineMedianMs)}ms`} ⓘ</p>
          {a.detection.slowdown.status === "연쇄 표본 부족" && <p className="note">오타 뒤 입력 기록이 적어 이어지는 변화는 아직 살펴보기 어려워요.</p>}
          {a.detection.rush && <p>짧은 문장에서 급하게 시작한 입력 {a.detection.rush.observed}번 (전체 {a.detection.rush.n}문장)</p>}
          <p className="note" title="손목과 키의 거리를 세 구간으로 나눕니다.">손 뻗는 거리: {a.detection.distance.map((row) => `${row.band} ${row.k}번 오타 / ${row.n}번 입력`).join(" · ") || "기록이 부족해 계산할 수 없어요."} ⓘ</p>
          <p className="note">손가락별 오타: {a.detection.fingers.map((row) => `${row.key} ${row.k}번 / ${row.n}번 (${fmt(row.k / Math.max(row.n, 1) * 100, 1)}%)`).join(" · ") || "기록이 더 필요해요."}</p>
          <p className="note">한글 위치별 오타: {a.detection.koreanPositions.map((row) => `${row.key} ${row.k}번 / ${row.n}번`).join(" · ") || "기록이 더 필요해요."} · 받침: {a.detection.batchim.map((row) => `${row.key} ${row.k}번 / ${row.n}번`).join(" · ") || "기록이 더 필요해요."}</p>
          <p>한/영 입력 상태: {a.detection.languageState.status === "집계됨" ? `오류 ${a.detection.languageState.mismatchCount}건, 고친 오류 ${a.detection.languageState.removedMismatchCount}건` : "기록이 부족해 계산할 수 없어요."} · 분류하기 어려운 입력 {a.detection.languageState.ambiguousCount}건</p>
          <p className="note">입력 상태 신호: Process {a.detection.languageState.processSignalCount}건 · keyCode 229 {a.detection.languageState.legacy229SignalCount}건 · 조합 중 {a.detection.languageState.composingSignalCount}건 · 영문 키 {a.detection.languageState.latinKeySignalCount}건 · 미확인 {a.detection.languageState.unknownSignalCount}건 · 기록된 한/영 키 누름 {a.detection.languageState.toggleKeyPressCount}회. 이전 버전은 신호 종류와 물리 키 누름 기록이 없어 원인을 구분할 수 없어요.</p>
          <p className="note" title="키 입력 사이 간격의 중앙값입니다. 일시정지 전후의 간격은 빼고 계산합니다.">입력 간격 중앙값 {a.detection.intervals.n ? `${Math.round(a.detection.intervals.medianMs!)}ms` : "기록이 부족해 계산할 수 없어요."} ⓘ</p>
        </section>

        {previousSession && (
          <section className="panel">
            <h2>이전 연습과 약점 키 비교</h2>
            {comparisonTop.length ? <>
              <table>
                <thead><tr><th>키</th><th>이전 연습</th><th>이번 연습</th><th>변화</th></tr></thead>
                <tbody>{comparisonTop.map((row) => <tr key={row.code}>
                  <th>{row.label}</th>
                  <td title={row.previous ? `95% 신뢰구간 ${Math.round(row.previous.interval.lower * 100)}~${Math.round(row.previous.interval.upper * 100)}%` : "기록이 부족합니다."}>{row.previous ? `${row.previous.n}번 중 ${row.previous.k}번` : "기록이 부족해요"}</td>
                  <td title={row.current ? `95% 신뢰구간 ${Math.round(row.current.interval.lower * 100)}~${Math.round(row.current.interval.upper * 100)}%` : "기록이 부족합니다."}>{row.current ? `${row.current.n}번 중 ${row.current.k}번` : "기록이 부족해요"}</td>
                  <td>{row.overlap ? "변화를 단정하기 어려워요" : row.status.includes("증가") ? "늘었어요" : row.status.includes("감소") ? "줄었어요" : "기록이 부족해요"}</td>
                </tr>)}</tbody>
              </table>
            </> : <p className="note">비교할 만큼 입력 기록이 모인 약점 키가 없어요.</p>}
          </section>
        )}
      </div>

      <div className="two">
        <section className="panel">
          <h2>문장 특성별 속도</h2>
          {a.tags.length === 0 ? <p className="note">비교할 만큼 데이터가 모이지 않았어요.</p> : (
            <table>
              <thead><tr><th>특성</th><th>문장</th><th>타/분</th><th>오입력률</th></tr></thead>
              <tbody>
                {[...a.tags].sort((x, y) => x.kpm - y.kpm).map((t) => (
                  <tr key={t.tag}><td>{t.tag}</td><td>{t.n}</td><td>{fmt(t.kpm)}</td><td>{fmt(t.errRate, 1)}%</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {a.tags.length > 0 && <p className="note">문장 구성이 섞여 있어 태그 효과로 단정할 수 없어요.</p>}
        </section>
        <section className="panel">
          <h2>가장 느렸던 어절</h2>
          {a.slowWords.length === 0 ? <p className="note">기록이 없어요.</p> : (
            <table>
              <thead><tr><th>어절</th><th>타/분</th><th>걸린 시간</th></tr></thead>
              <tbody>{a.slowWords.map((w, n) => <tr key={w.word + n}><td>{w.word}</td><td>{fmt(w.kpm)}</td><td>{sec(w.ms)}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>입력 간격</h2>
        {a.intervalSummary.n === 0 ? <p className="note">기록이 부족해 계산할 수 없어요.</p> : <>
          <p title={`입력 수 ${a.intervalSummary.n}, 입력 간격 중앙값 ${fmt(a.intervalSummary.medianIkiMs ?? 0, 1)}ms, 사분위 범위 ${fmt(a.intervalSummary.iqrIkiMs ?? 0, 1)}ms`}>입력 간격 중앙값 {fmt(a.intervalSummary.medianIkiMs ?? 0, 1)}ms ⓘ · 2초 이상 벌어진 입력 {a.intervalSummary.longGapCount}번</p>
          {a.intervalSummary.longGapCount === 0 && <p className="note">키 입력이 2초 이상 멈춘 구간은 없었어요. 문장 사이의 쉼은 이 값에 포함하지 않아요.</p>}
        </>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>AI에 전달하는 내용</h2>
          <button className="ghost" onClick={copy}>{copied ? "복사했어요" : "복사"}</button>
        </div>
        <p className="note">키 입력 원본 대신 계산된 사실을 전달해요. 내용은 복사해 확인할 수 있어요. 약 {summaryText.length.toLocaleString()}자예요.</p>
      </section>
      </div></details>

      <section className="panel coach ai-free-notes" aria-busy={busy !== ""}>
        <div className="panel-head"><h2>AI 기타 제언</h2><div className="actions">
          <button className="ghost" disabled={busy !== "" || !!session.isLocalStorageOnly} onClick={askFeedback}>{busy === "feedback" ? "피드백을 만들고 있어요..." : feedback ? "다시 요청" : "AI 피드백 받기"}</button>
          <button className="primary small" disabled={busy !== "" || !!session.isLocalStorageOnly} onClick={askPractice}>{busy === "practice" ? "문장을 만들고 있어요..." : `약점 연습 ${PRACTICE_COUNT}라운드`}</button>
        </div></div>
        {busy && <p className="note" role="status">AI가 계산된 사실과 질문 답변을 살펴보고 있어요.</p>}
        {aiError && <p className="error" role="alert">{aiError}</p>}
        {session.isLocalStorageOnly && <p className="note">이전 브라우저 기록은 AI 분석에 사용하지 않아요.</p>}
        {!feedback && !busy && !aiError && !session.isLocalStorageOnly && <p className="note">요청하면 계산된 사실, 문장 분석, 답변을 바탕으로 조언을 만들어요. 원시 키 입력은 전송하지 않습니다.</p>}
        {feedback && <>
          {feedback.headline && <p className="headline">{feedback.headline}</p>}
          {feedback.strengths.length > 0 && <ul className="strengths">{feedback.strengths.map((item, index) => <li key={item.text + index}>{item.text}</li>)}</ul>}
          {feedback.nextStep && <p className="next-step"><b>다음에 해볼 일</b> {feedback.nextStep}</p>}
          {feedback.freeNotes?.length ? <><p className="note">AI 의견 · 검증되지 않은 제안이에요</p><ul>{feedback.freeNotes.slice(0, 3).map((item, index) => <li key={index}>{item.text}</li>)}</ul></> : null}
        </>}
      </section>
    </main>
  );
}
