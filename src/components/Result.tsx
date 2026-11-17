import { useMemo, useState } from "react";
import { Keyboard } from "./Keyboard";
import { requestFeedback, requestPractice } from "../lib/ai";
import { PRACTICE_COUNT, meanLength, sentences as allSentences, type Sentence } from "../lib/sentences";
import { aiSummary, analyze } from "../lib/stats";
import type { Feedback, Session } from "../lib/types";

const fmt = (v: number, d = 0) => v.toFixed(d);
const sec = (ms: number) => `${(ms / 1000).toFixed(2)}초`;

type Props = {
  session: Session;
  onBack: () => void;
  onFeedback: (feedback: Feedback) => void;
  onPractice: (rounds: Sentence[]) => void;
};

export function Result({ session, onBack, onFeedback, onPractice }: Props) {
  const a = useMemo(() => analyze(session), [session]);
  const [mode, setMode] = useState<"err" | "slow">("err");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"" | "feedback" | "practice">("");
  const [aiError, setAiError] = useState("");
  const feedback = session.feedback;
  const summaryText = useMemo(() => JSON.stringify(aiSummary(session, a), null, 1), [session, a]);

  const heat: Record<string, number> = {};
  const tip: Record<string, string> = {};
  const maxMs = Math.max(...a.keyStats.map((k) => k.ms), 1);
  const minMs = Math.min(...a.keyStats.filter((k) => k.msN >= 2).map((k) => k.ms), maxMs);
  a.keyStats.forEach((k) => {
    if (mode === "err") {
      heat[k.code] = k.n >= 2 ? Math.min(k.errRate / 40, 1) : 0;
      tip[k.code] = `${k.label}: ${k.n}번 중 ${k.err}번 틀림 (${fmt(k.errRate)}%)`;
    } else {
      heat[k.code] = k.msN >= 2 && maxMs > minMs ? (k.ms - minMs) / (maxMs - minMs) : 0;
      tip[k.code] = `${k.label}: 평균 ${fmt(k.ms)}ms`;
    }
  });

  const maxKpm = Math.max(...a.rounds.map((r) => r.kpm), 1);
  const avgKpm = a.totals.kpm;
  const kinds = Object.entries(a.byKind).sort((x, y) => y[1] - x[1]);
  const summary = useMemo(() => aiSummary(session, a), [session, a]);
  const askFeedback = async () => {
    setBusy("feedback");
    setAiError("");
    try {
      onFeedback(await requestFeedback(summary));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "요청에 실패했어요.");
    }
    setBusy("");
  };
  const askPractice = async () => {
    setBusy("practice");
    setAiError("");
    try {
      onPractice(await requestPractice(summary, feedback, PRACTICE_COUNT, meanLength(allSentences)));
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
          <h1>{a.rounds.length}라운드 {session.mode === "practice" ? "약점 연습 " : ""}결과</h1>
          <p className="lead">
            평균 <b>{fmt(a.totals.kpm)}타/분</b>({fmt(a.totals.cpm)}자/분), 정확도 <b>{fmt(a.totals.acc, 1)}%</b>, 첫 입력까지 평균 <b>{sec(a.totals.first)}</b>.
          </p>
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
              <ul className="strengths">{feedback.strengths.map((t) => <li key={t}>{t}</li>)}</ul>
            )}
            <div className="weak-list">
              {feedback.weaknesses.map((w, n) => (
                <article key={w.title} className="weak">
                  <h3><span>{n + 1}</span>{w.title}</h3>
                  {w.evidence && <p>{w.evidence}</p>}
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
        <div className="bars" role="img" aria-label="라운드별 분당 타수 막대그래프">
          {a.rounds.map((r) => (
            <div key={r.id + r.i} className="bar-col" title={`라운드 ${r.i + 1}: ${fmt(r.kpm)}타/분, 오입력 ${r.errs}번, 첫 입력 ${sec(r.first)}`}>
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
        <p className="note">{mode === "err" ? "진할수록 그 키를 눌러야 할 때 자주 틀렸어요." : "진할수록 그 키를 치기 직전 키에서 넘어오는 데 오래 걸렸어요."}</p>
      </section>

      <div className="two">
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
              <tbody>{kinds.map(([k, n]) => <tr key={k}><td>{k}</td><td>{n}</td></tr>)}</tbody>
            </table>
          )}
          <p className="note">
            Backspace {a.totals.backspaces}번, 고친 오타 {a.corr.n}건
            {a.corr.n ? `(평균 ${sec(a.corr.mean)}, 같은 자리에서 다시 틀림 ${a.corr.reErr}번)` : ""}
          </p>
        </section>
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
