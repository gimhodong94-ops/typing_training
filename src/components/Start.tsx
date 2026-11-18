import { useEffect, useMemo, useState } from "react";
import { Keyboard } from "./Keyboard";
import { WristSetup } from "./WristSetup";
import { DEFAULT_WRISTS, hasSavedWristAnchors, loadWristAnchors, saveWristAnchors, type WristAnchors } from "../lib/keyboard";
import { createRoundSelection, sessionUsageFromHistory, type RoundSelection } from "../lib/roundSelection";
import { ROUND_COUNT, sentences } from "../lib/sentences";
import type { KeyboardType, Session } from "../lib/types";

type Props = {
  history: Session[];
  onStart: (keyboard: KeyboardType, hint: boolean, anchors: WristAnchors, selection?: RoundSelection) => void;
  onOpen: (session: Session) => void;
};

export function Start({ history, onStart, onOpen }: Props) {
  const [keyboard, setKeyboard] = useState<KeyboardType>("desktop");
  const [hint, setHint] = useState(true);
  const [anchors, setAnchors] = useState(loadWristAnchors);
  const [roundCount, setRoundCount] = useState(ROUND_COUNT);
  const [selectedHand, setSelectedHand] = useState<"left" | "right">("left");
  const [anchorsSaved, setAnchorsSaved] = useState(hasSavedWristAnchors);
  const [anchorMessage, setAnchorMessage] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");
  const isElectron = Boolean(window.typingCoach);
  const rounds = Math.min(ROUND_COUNT, sentences.length);
  const usageCounts = useMemo(() => sessionUsageFromHistory(history), [history]);
  const selection = useMemo(
    () => isElectron ? createRoundSelection(sentences, roundCount, usageCounts) : undefined,
    [isElectron, roundCount, usageCounts],
  );

  useEffect(() => {
    window.typingCoach?.hasApiKey().then(setHasApiKey).catch(() => setHasApiKey(false));
  }, []);

  const saveKey = async () => {
    if (!window.typingCoach) return;
    setKeyBusy(true);
    setKeyMessage("");
    try {
      await window.typingCoach.saveApiKey(apiKey);
      setApiKey("");
      setHasApiKey(true);
      setKeyMessage("API 키를 이 Windows 계정에 안전하게 저장했어요.");
    } catch (error) {
      setKeyMessage(error instanceof Error ? error.message : "API 키를 저장하지 못했어요.");
    } finally {
      setKeyBusy(false);
    }
  };

  const clearKey = async () => {
    if (!window.typingCoach) return;
    setKeyBusy(true);
    setKeyMessage("");
    try {
      await window.typingCoach.clearApiKey();
      setHasApiKey(false);
      setKeyMessage("저장한 API 키를 삭제했어요.");
    } catch (error) {
      setKeyMessage(error instanceof Error ? error.message : "API 키를 삭제하지 못했어요.");
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <main className="page start">
      <section className="start-main">
        <h1>타자 코치</h1>
        <p className="lead">
          문장 하나를 다 치고 Enter를 누르면 다음 라운드로 넘어가요. 키를 누른 시각과 오타를 모두 기록해서, 어떤 키에서 느려지고 어떻게 틀리는지 보여 줘요.
        </p>

        <div className="field">
          <span className="field-label" id="kb-label">키보드 종류</span>
          <div className="seg" role="radiogroup" aria-labelledby="kb-label">
            {([["desktop", "데스크톱"], ["laptop", "노트북"]] as const).map(([value, name]) => (
              <button key={value} role="radio" aria-checked={keyboard === value} className={keyboard === value ? "on" : ""} onClick={() => setKeyboard(value)}>
                {name}
              </button>
            ))}
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={hint} onChange={(e) => setHint(e.target.checked)} />
          다음에 칠 키를 화면 키보드에 표시
        </label>

        {isElectron && (
          <div className="field">
            <span className="field-label" id="round-count-label">연습 문장 수</span>
            <div className="seg" role="radiogroup" aria-labelledby="round-count-label">
              {([10, 20, 30] as const).map((count) => (
                <button key={count} role="radio" aria-checked={roundCount === count} className={roundCount === count ? "on" : ""} onClick={() => setRoundCount(count)}>{count}문장</button>
              ))}
            </div>
          </div>
        )}

        <button className="primary" disabled={isElectron ? !selection?.rounds.length || selection.rounds.length !== roundCount : !sentences.length} onClick={() => {
          saveWristAnchors(anchors);
          if (selection?.usedFallback) console.warn("세션 글자 수 조건을 만족하는 구성을 찾지 못해 가장 가까운 구성을 사용합니다.", selection);
          onStart(keyboard, hint, anchors, selection);
        }}>
          {isElectron ? `${roundCount}문장 연습 시작` : `${rounds}라운드 시작`}
        </button>
        {isElectron && selection && (
          <div className="session-check" role="status">
            <b>세션 검사</b>
            {selection.error ? <span>{selection.error}</span> : (
              <span>
                총 {selection.totalLength}자 · 기준 {selection.targetTotal.toFixed(0)}자 · 허용 {selection.minimumTotal.toFixed(0)}–{selection.maximumTotal.toFixed(0)}자 · {selection.attempts}회 시도
                {selection.withinRange ? " · 통과" : " · 가장 가까운 구성 사용"}
              </span>
            )}
          </div>
        )}
        {!sentences.length && <p className="note">문장이 없어요. data/sentences 폴더에 문장 파일을 넣어 주세요.</p>}
        <p className="note">한글은 두벌식, 영문은 QWERTY 기준이에요. 키 위치와 한/영 입력 상태를 함께 판정하니, 문장에 맞게 한/영 키를 눌러 주세요.</p>
        <details className="api-settings wrist-settings" open={!anchorsSaved}>
          <summary>양손과 손목 위치 설정</summary>
          <div className="api-settings-body">
            <WristSetup anchors={anchors} selected={selectedHand} onSelect={setSelectedHand} onChange={setAnchors} />
            <div className="api-key-actions">
              <button className="ghost" onClick={() => { setAnchors(DEFAULT_WRISTS); setAnchorMessage("기본 위치로 돌아갔어요. 저장을 눌러 적용하세요."); }}>기본 위치로 초기화</button>
              <button className="primary small" onClick={() => { saveWristAnchors(anchors); setAnchorsSaved(true); setAnchorMessage("양손 손목 위치를 저장했어요."); }}>위치 저장</button>
              <span className="key-status">{anchorsSaved ? "설정됨" : "초기 위치를 확인해 주세요"}</span>
            </div>
            {anchorMessage && <p className="note" role="status">{anchorMessage}</p>}
          </div>
        </details>
        {window.typingCoach && (
          <details className="api-settings">
            <summary>AI 코치 API 키 설정</summary>
            <div className="api-settings-body">
              <p className="note">키는 이 Windows 계정에 암호화해 저장하며, 앱 밖으로 표시하지 않아요. AI 피드백과 약점 연습에 사용해요.</p>
              <label className="field">
                <span className="field-label">Gemini API 키</span>
                <input
                  className="api-key-input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={hasApiKey ? "키가 저장되어 있어요. 바꾸려면 새 키를 입력하세요." : "API 키 붙여넣기"}
                />
              </label>
              <div className="api-key-actions">
                <button className="primary small" disabled={keyBusy || apiKey.trim().length < 10} onClick={saveKey}>키 저장</button>
                {hasApiKey && <button className="ghost" disabled={keyBusy} onClick={clearKey}>저장한 키 삭제</button>}
                <span className="key-status">{hasApiKey ? "키 저장됨" : "키 미설정"}</span>
              </div>
              {keyMessage && <p className="note" role="status">{keyMessage}</p>}
            </div>
          </details>
        )}
      </section>

      <section className="start-side" aria-label="키보드 미리보기">
        <Keyboard />
        <h2>지난 기록</h2>
        {history.length === 0 ? (
          <p className="note">아직 기록이 없어요. 한 번 끝까지 치면 여기에 쌓여요.</p>
        ) : (
          <ul className="history">
            {history.map((s) => (
              <li key={s.id}>
                <button onClick={() => onOpen(s)}>
                  <span>{new Date(s.at).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span>{s.rounds.length}라운드 · {s.mode === "practice" ? "약점 연습" : s.keyboard === "laptop" ? "노트북" : "데스크톱"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
