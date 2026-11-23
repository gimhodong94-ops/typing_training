import { useMemo, useState } from "react";
import { Keyboard } from "./Keyboard";
import { requestFeedback, requestPractice } from "../lib/ai";
import { PRACTICE_COUNT, meanLength, sentences as allSentences, type Sentence } from "../lib/sentences";
import { aiSummary, analyze, compareWeakKeys } from "../lib/stats";
import { sessionRoundCount } from "../lib/sessionData";
import { loadSessions } from "../lib/storage";
import type { Feedback, Session } from "../lib/types";

const fmt = (v: number, d = 0) => v.toFixed(d);
const sec = (ms: number) => `${(ms / 1000).toFixed(2)}초`;

type Props = {
  session: Session;
  onBack: () => void;
  onFeedback: (feedback: Feedback) => void;
  onPractice: (rounds: Sentence[], generalPractice: boolean) => void;
};

export function Result({ session, onBack, onFeedback, onPractice }: Props) {
  const a = useMemo(() => analyze(session), [session]);
  const previousSession = useMemo(() => {
    const sessions = loadSessions();
    const index = sessions.findIndex((item) => item.id === session.id);
    return index >= 0 ? sessions[index + 1] : sessions.find((item) => item.id !== session.id);
  }, [session.id]);
  const weakKeyComparisons = useMemo(() => previousSession ? compareWeakKeys(previousSession, session) : [], [previousSession, session]);
  const [mode, setMode] = useState<"err" | "slow">("err");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"" | "feedback" | "practice">("");
  const [aiError, setAiError] = useState("");
  const [localOnly, setLocalOnly] = useState(false);
  const feedback = localOnly ? undefined : session.feedback;
  const summaryText = useMemo(() => {
    const data = aiSummary(session, a);
    return JSON.stringify(window.typingCoach ? { ...data, pauses: a.pauseMetrics } : data, null, 1);
  }, [session, a]);

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
    return window.typingCoach ? { ...data, pauses: a.pauseMetrics } : data;
  }, [session, a]);
  const askFeedback = async () => {
    setBusy("feedback");
    setAiError("");
    try {
      const result = await requestFeedback(summary);
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
  const askPractice = async () => {
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
    const blob = new Blob([JSON.stringify(session)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `typing-session-${session.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
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
          <p className="lead">
            평균 <b>{fmt(a.totals.kpm)}타/분</b>({fmt(a.totals.cpm)}자/분), 정확도 <b>{fmt(a.totals.acc, 1)}%</b>, 첫 입력까지 평균 <b>{sec(a.totals.first)}</b>.
          </p>
          {window.typingCoach && <p className="note pause-summary">
            일시정지 {a.pauseMetrics.count}회 · 총 {sec(a.pauseMetrics.totalMs)}
            {a.pauseMetrics.count > 0 ? ` · 정지 전 ${fmt(a.pauseMetrics.prePauseCpm)} CPM · 정지 후 ${fmt(a.pauseMetrics.postPauseCpm)} CPM` : ""}
            {a.pauseMetrics.resumeDelaysMs.length > 0 ? ` · 재개 후 첫 키 지연 평균 ${sec(a.pauseMetrics.resumeDelaysMs.reduce((sum, ms) => sum + ms, 0) / a.pauseMetrics.resumeDelaysMs.length)}` : ""}
          </p>}
        </div>
        <div className="actions">
          <button className="ghost" onClick={download}>기록 내려받기</button>
          <button className="primary small" onClick={onBack}>처음으로</button>
        </div>
      </header>

      <section className="panel">
        <h2>약점 요약</h2>
        <ul className="insights">
          {a.insights.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </section>

      <section className="panel coach" aria-busy={busy !== ""}>
        <div className="panel-head">
          <h2>AI 코치</h2>
          <div className="actions">
            <button className="ghost" disabled={busy !== ""} onClick={askFeedback}>
              {busy === "feedback" ? "분석하는 중..." : feedback ? "다시 분석" : "AI 피드백 받기"}
            </button>
            <button className="primary small" disabled={busy !== ""} onClick={askPractice}>
              {busy === "practice" ? "문장 만드는 중..." : `약점 연습 ${PRACTICE_COUNT}라운드`}
            </button>
          </div>
        </div>
        {busy && <p className="note" role="status">{busy === "feedback" ? "기록을 분석하고 있어요. 10~30초 걸릴 수 있어요." : "약점에 맞춘 문장을 만들고 있어요. 조건을 맞추느라 시간이 걸릴 수 있어요."}</p>}
        {aiError && <p className="error" role="alert">{aiError}</p>}
        {!feedback && !busy && !aiError && (
          <p className="note">기록 요약을 AI에게 보내 약점 분석과 맞춤 연습 문장을 받아요. 키 입력 원본은 보내지 않아요.</p>
        )}
        {feedback && (
          <div className="feedback">
            {feedback.headline && <p className="headline">{feedback.headline}</p>}
            {feedback.strengths.length > 0 && (
              <ul className="strengths">{feedback.strengths.map((s, n) => <li key={s.text + n}><b>{s.text}</b>{s.evidence && <small> 근거: {s.evidence}</small>}</li>)}</ul>
            )}
            <div className="weak-list">
              {feedback.weaknesses.map((w, n) => (
                <article key={w.title} className="weak">
                  <h3><span>{n + 1}</span>{w.title}<em className="confidence">확신도 {w.confidence}</em></h3>
                  {w.evidence && <p><b>근거</b> {w.evidence}</p>}
                  {w.possibleCauses.length > 0 && <p><b>가능한 원인</b> {w.possibleCauses.join(" 또는 ")}</p>}
                  {w.checkNext && <p><b>확인 연습</b> {w.checkNext}</p>}
                  <p className="advice">{w.advice}</p>
                </article>
              ))}
            </div>
            {feedback.nextStep && <p className="next-step"><b>다음 연습</b> {feedback.nextStep}</p>}
          </div>
        )}
      </section>

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
        <p className="note">{mode === "err" ? "진할수록 그 키를 눌러야 할 때 자주 틀렸어요." : "진할수록 그 키를 치기 직전 키에서 넘어오는 데 오래 걸렸어요."} 키 간 거리 1칸은 약 19mm예요.</p>
      </section>

      <div className="two">
        <section className="panel">
          <h2>키별 오타율 신뢰구간</h2>
          {a.weakKeys.length === 0 ? <p className="note">표본 5회 이상인 키 오타가 아직 없어요.</p> : (
            <table>
              <thead><tr><th>키</th><th>오타/시도</th><th>오타율</th><th>95% 구간</th><th>확신도</th></tr></thead>
              <tbody>{a.weakKeys.map((key) => (
                <tr key={key.code}><td>{key.label}</td><td>{key.err} / {key.n}</td><td>{fmt(key.errRate, 1)}%</td>
                  <td>{Math.round(key.interval.lower * 100)}~{Math.round(key.interval.upper * 100)}%</td><td>{key.confidence}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <h2>Shift 조합</h2>
          {a.shiftCombo.n === 0 ? <p className="note">집계 안 됨</p> : (
            <p>{a.shiftCombo.err} / {a.shiftCombo.n} 오타 · {fmt(a.shiftCombo.err / a.shiftCombo.n * 100, 1)}% · 95% 구간 {Math.round(a.shiftCombo.interval.lower * 100)}~{Math.round(a.shiftCombo.interval.upper * 100)}%</p>
          )}
        </section>
        <section className="panel">
          <h2>자주 틀린 키</h2>
          {a.pairs.length === 0 ? <p className="note">다른 키를 잘못 누른 기록이 없어요.</p> : (
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
          {kinds.length === 0 ? <p className="note">오입력이 없었어요.</p> : (
            <table>
              <thead><tr><th>종류</th><th>횟수</th></tr></thead>
              <tbody>{kinds.map(([k, n]) => <tr key={k}><td>{k === "longGap" ? `longGap (${a.intervalSummary.longGapThresholdMs}ms 초과, 표시용)` : k}</td><td>{n}</td></tr>)}</tbody>
            </table>
          )}
          <p className="note">
            Backspace {a.totals.backspaces}번, 고친 오타 {a.corr.n}건
            {a.corr.n ? `(평균 ${sec(a.corr.mean)}, 같은 자리에서 다시 틀림 ${a.corr.reErr}번)` : ""}
          </p>
        </section>

        <section className="panel">
          <h2>입력 패턴 감지</h2>
          <p className="note">정렬 분류: 누락 {a.detection.alignment.omission}, 초과 {a.detection.alignment.extra}, 치환 {a.detection.alignment.substitution}, 전치 {a.detection.alignment.transposition}, 모호 {a.detection.alignment.ambiguous} (n={a.detection.alignment.n}) · {a.detection.alignment.status}</p>
          {a.detection.spaces && <p>공백 누락 {a.detection.spaces.omission} · 초과 {a.detection.spaces.extra} · 위치 오류 {a.detection.spaces.position}</p>}
          <p>키 타이밍: {a.detection.keyTiming.status}{a.detection.keyTiming.simultaneous !== undefined ? ` · 동시 누름 ${a.detection.keyTiming.simultaneous} · 중복 입력 ${a.detection.keyTiming.duplicate}` : ""}{a.detection.keyTiming.shiftReleaseDelayMedianMs !== undefined ? ` · Shift 떼기 지연 중앙값 ${Math.round(a.detection.keyTiming.shiftReleaseDelayMedianMs)}ms` : ""}</p>
          <p>오타 후 수정 전 입력 최대 {a.detection.unresolvedTypos.maximumFollowingKeys}키 · 감속 기준 중앙값 {a.detection.slowdown.baselineMedianMs === undefined ? "집계 안 됨" : `${Math.round(a.detection.slowdown.baselineMedianMs)}ms`}</p>
          {a.detection.slowdown.status === "연쇄 표본 부족" && <p className="note">오타 연쇄 표본이 부족해 감속 연쇄를 판정하지 않았어요.</p>}
          {a.detection.rush && <p>짧은 문장 성급함 관찰 {a.detection.rush.observed}/{a.detection.rush.n} · 확신도 {a.detection.rush.confidence}</p>}
          <p className="note">거리별 k/n (Wilson 95%): {a.detection.distance.map((row) => `${row.band} ${row.k}/${row.n}${row.wilson95 ? ` (${Math.round(row.wilson95.lower * 100)}–${Math.round(row.wilson95.upper * 100)}%)` : " (집계 안 됨)"}`).join(" · ") || "집계 안 됨"}</p>
          <p className="note">손가락별 오타 (Wilson 95%): {a.detection.fingers.map((row) => `${row.key} ${row.k}/${row.n}${row.wilson95 ? ` (${Math.round(row.wilson95.lower * 100)}–${Math.round(row.wilson95.upper * 100)}%)` : ""}`).join(" · ") || "표본 부족"}</p>
          <p className="note">한글 위치별 오타: {a.detection.koreanPositions.map((row) => `${row.key} ${row.k}/${row.n}${row.wilson95 ? ` (${Math.round(row.wilson95.lower * 100)}–${Math.round(row.wilson95.upper * 100)}%)` : ""}`).join(" · ") || "표본 부족"} · 받침별: {a.detection.batchim.map((row) => `${row.key} ${row.k}/${row.n}${row.wilson95 ? ` (${Math.round(row.wilson95.lower * 100)}–${Math.round(row.wilson95.upper * 100)}%)` : ""}`).join(" · ") || "표본 부족"}</p>
          <p>한/영 상태: {a.detection.languageState.status}{a.detection.languageState.mismatchCount !== undefined ? ` · 오류 ${a.detection.languageState.mismatchCount}` : ""} · 정렬 모호 {a.detection.languageState.ambiguousCount}</p>
          <p className="note">입력 간격 중앙값 {a.detection.intervals.n ? `${Math.round(a.detection.intervals.medianMs!)}ms` : "집계 안 됨"}. pause 경계 간격은 제외합니다.</p>
        </section>

        {previousSession && (
          <section className="panel">
            <h2>이전 연습과 약점 키 비교</h2>
            {weakKeyComparisons.length ? <>
              <table>
                <thead><tr><th>키</th><th>이전 k/n (95% 구간)</th><th>현재 k/n (95% 구간)</th><th>해석</th></tr></thead>
                <tbody>{weakKeyComparisons.map((row) => <tr key={row.code}>
                  <th>{row.label}</th>
                  <td>{row.previous ? `${row.previous.k}/${row.previous.n} (${Math.round(row.previous.interval.lower * 100)}–${Math.round(row.previous.interval.upper * 100)}%)` : "집계 안 됨"}</td>
                  <td>{row.current ? `${row.current.k}/${row.current.n} (${Math.round(row.current.interval.lower * 100)}–${Math.round(row.current.interval.upper * 100)}%)` : "집계 안 됨"}</td>
                  <td>{row.status}</td>
                </tr>)}</tbody>
              </table>
            </> : <p className="note">표본 5회 이상인 약점 키가 없어 비교할 항목이 없어요.</p>}
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
        <h2>입력 간격 분포</h2>
        {a.intervalSummary.n === 0 ? <p className="note">집계 안 됨</p> : <p>
          간격 n={a.intervalSummary.n} · 중앙값 {fmt(a.intervalSummary.medianIkiMs ?? 0, 1)}ms · IQR {fmt(a.intervalSummary.iqrIkiMs ?? 0, 1)}ms · longGap {a.intervalSummary.longGapCount}회 ({fmt((a.intervalSummary.longGapRatio ?? 0) * 100, 1)}%, {a.intervalSummary.longGapThresholdMs}ms 초과 표시용)
        </p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>AI에 보낼 요약 데이터</h2>
          <button className="ghost" onClick={copy}>{copied ? "복사했어요" : "복사"}</button>
        </div>
        <p className="note">키 입력 원본 대신 위 분석을 줄인 값이에요. 약 {summaryText.length.toLocaleString()}자예요. AI 피드백을 붙일 때 이 데이터를 보내요.</p>
        <details>
          <summary>내용 보기</summary>
          <pre>{summaryText}</pre>
        </details>
      </section>
    </main>
  );
}
