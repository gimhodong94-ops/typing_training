import { useEffect, useMemo, useState } from "react";
import { Keyboard } from "./Keyboard";
import { WristSetup } from "./WristSetup";
import { DEFAULT_DZ_MM, DEFAULT_WRISTS, hasSavedWristAnchors, loadKeyboardDz, loadWristAnchors, saveKeyboardDz, saveWristAnchors, type WristAnchors } from "../lib/keyboard";
import { createRoundSelection, isSentenceLengthAllowed, sessionUsageFromHistory, type RoundSelection } from "../lib/roundSelection";
import { ROUND_COUNT, sentences } from "../lib/sentences";
import type { Session } from "../lib/types";
import { AI_MODELS, type AIProvider } from "../../shared/aiModels";
import aiFeatures from "../../config/aiFeatures.json";

type Props = {
  history: Session[];
  onStart: (hint: boolean, anchors: WristAnchors, selection?: RoundSelection, dz?: number) => void;
  onOpen: (session: Session) => void;
  openSettings?: boolean;
};

export function Start({ history, onStart, onOpen, openSettings = false }: Props) {
  const [hint, setHint] = useState(true);
  const [anchors, setAnchors] = useState(loadWristAnchors);
  const [dz, setDz] = useState(loadKeyboardDz);
  const [roundCount, setRoundCount] = useState(ROUND_COUNT);
  const [selectedHand, setSelectedHand] = useState<"left" | "right">("left");
  const [anchorsSaved, setAnchorsSaved] = useState(hasSavedWristAnchors);
  const [anchorMessage, setAnchorMessage] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [aiProvider, setAIProvider] = useState<AIProvider>("gemini");
  const [aiModel, setAIModel] = useState<string>(AI_MODELS.gemini[0]);
  const [aiKeyStatus, setAIKeyStatus] = useState({ hasGeminiKey: false, hasMultiAIKey: false });
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");
  const [featureSettings, setFeatureSettings] = useState({ sentenceAnalysisEnabled: aiFeatures.sentenceAnalysisEnabled, questionCardsEnabled: aiFeatures.questionCardsEnabled, sentenceAnalysisConsent: false, sentenceAnalysisConsentAt: null as string | null });
  const [settingsError, setSettingsError] = useState("");
  const isElectron = Boolean(window.typingCoach);
  const rounds = Math.min(ROUND_COUNT, sentences.length);
  const excludedByLength = useMemo(() => sentences.filter((row) => !isSentenceLengthAllowed(row.text)).length, []);
  const usageCounts = useMemo(() => sessionUsageFromHistory(history), [history]);
  const selection = useMemo(
    () => isElectron ? createRoundSelection(sentences, roundCount, usageCounts) : undefined,
    [isElectron, roundCount, usageCounts],
  );

  useEffect(() => {
    window.typingCoach?.getAISettings().then((settings) => {
      setAIProvider(settings.provider);
      setAIModel(settings.model);
      setAIKeyStatus({ hasGeminiKey: settings.hasGeminiKey, hasMultiAIKey: settings.hasMultiAIKey });
    }).catch(() => setKeyMessage("AI 설정을 불러오지 못했어요."));
    window.typingCoach?.getFeatureSettings().then(setFeatureSettings).catch(() => {});
  }, []);

  const saveFeature = async (patch: Partial<typeof featureSettings>) => {
    if (!window.typingCoach) return false;
    setSettingsError("");
    try { const next = await window.typingCoach.saveFeatureSettings(patch); setFeatureSettings(next); return true; }
    catch (error) { console.error("AI 기능 설정 저장 실패", error); setSettingsError(error instanceof Error ? error.message : "설정을 저장하지 못했어요 (원인: 알 수 없음). 다시 시도해 주세요."); return false; }
  };
  const toggleAnalysis = (checked: boolean) => {
    void saveFeature(checked ? { sentenceAnalysisEnabled: true, sentenceAnalysisConsent: true } : { sentenceAnalysisEnabled: false });
  };

  const selectedKeySaved = aiProvider === "gemini" ? aiKeyStatus.hasGeminiKey : aiKeyStatus.hasMultiAIKey;

  const refreshAISettings = async () => {
    if (!window.typingCoach) return;
    const settings = await window.typingCoach.getAISettings();
    setAIProvider(settings.provider);
    setAIModel(settings.model);
    setAIKeyStatus({ hasGeminiKey: settings.hasGeminiKey, hasMultiAIKey: settings.hasMultiAIKey });
  };

  const saveKey = async () => {
    if (!window.typingCoach) return;
    setKeyBusy(true);
    setKeyMessage("");
    try {
      await window.typingCoach.saveAISettings(aiProvider, aiModel, apiKey);
      setApiKey("");
      await refreshAISettings();
      setKeyMessage("AI 모델과 API 키를 이 Windows 계정에 암호화해 저장했어요.");
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
      await window.typingCoach.clearAIKey(aiProvider);
      setApiKey("");
      await refreshAISettings();
      setKeyMessage("현재 제공자의 저장된 API 키를 삭제했어요.");
    } catch (error) {
      setKeyMessage(error instanceof Error ? error.message : "API 키를 삭제하지 못했어요.");
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <main className="page start">
      <section className="start-main">
        <div className="panel-head"><h1>타자 코치</h1><button className="ghost" onClick={() => document.getElementById("start-ai-settings")?.scrollIntoView({ behavior: "smooth", block: "center" })}>설정</button></div>
        <p className="lead">
          문장 하나를 다 치고 Enter를 누르면 다음 라운드로 넘어가요. 키를 누른 시각과 오타를 모두 기록해서, 어떤 키에서 느려지고 어떻게 틀리는지 보여 줘요.
        </p>

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
          saveKeyboardDz(dz);
          if (selection?.usedFallback) console.warn("세션 글자 수 조건을 만족하는 구성을 찾지 못해 가장 가까운 구성을 사용합니다.", selection);
          onStart(hint, anchors, selection, dz);
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
        {excludedByLength > 0 && <p className="note" role="status">길이 상한을 넘은 문장 {excludedByLength}개를 연습에서 제외했어요.</p>}
        <p className="note">한글은 두벌식, 영문은 QWERTY 기준이에요. 키 위치와 한/영 입력 상태를 함께 판정하니, 문장에 맞게 한/영 키를 눌러 주세요.</p>
        <details className="api-settings wrist-settings" open={!anchorsSaved}>
          <summary>양손과 손목 위치 설정</summary>
          <div className="api-settings-body">
            <WristSetup anchors={anchors} selected={selectedHand} onSelect={setSelectedHand} onChange={setAnchors} />
            <label className="field">
              <span className="field-label">손목과 키보드 높이 차이: {dz}mm</span>
              <input type="range" min="0" max="80" step="1" value={dz} onChange={(event) => setDz(Number(event.target.value))} aria-label="손목과 키보드 높이 차이" />
            </label>
            <div className="api-key-actions">
              <button className="ghost" onClick={() => { setAnchors(DEFAULT_WRISTS); setDz(DEFAULT_DZ_MM); setAnchorMessage("기본 위치로 돌아갔어요. 저장을 눌러 적용하세요."); }}>기본 위치로 초기화</button>
              <button className="primary small" onClick={() => { saveWristAnchors(anchors); saveKeyboardDz(dz); setAnchorsSaved(true); setAnchorMessage("양손 손목 위치와 높이 차이를 저장했어요."); }}>위치 저장</button>
              <span className="key-status">{anchorsSaved ? "설정됨" : "초기 위치를 확인해 주세요"}</span>
            </div>
            {anchorMessage && <p className="note" role="status">{anchorMessage}</p>}
          </div>
        </details>
        {window.typingCoach && (
          <details id="start-ai-settings" className="api-settings" open={openSettings}>
            <summary>AI 코치 API 키 설정</summary>
            <div className="api-settings-body">
              <p className="note">선택한 모델과 키는 이 Windows 계정에 암호화해 저장해요. Gemini는 Google API를, Multi AI는 호환 게이트웨이를 사용해요.</p>
              <label className="check"><input type="checkbox" checked={featureSettings.sentenceAnalysisEnabled} onChange={(event) => toggleAnalysis(event.target.checked)} /> 문장별 AI 분석 사용</label>
              <label className="check"><input type="checkbox" checked={featureSettings.questionCardsEnabled} onChange={(event) => void saveFeature({ questionCardsEnabled: event.target.checked })} /> AI 질문 카드 사용</label>
              <p className="note">문장 분석: {featureSettings.sentenceAnalysisEnabled ? "저장됨 · 켜짐" : "저장됨 · 꺼짐"}</p>
              <p className="note">질문 카드: {featureSettings.questionCardsEnabled ? "저장됨 · 켜짐" : "저장됨 · 꺼짐"}</p>
              <p className="note">Gemini 키: {aiKeyStatus.hasGeminiKey ? "저장됨" : "없음"}</p>
              <p className="note">전송 동의: {featureSettings.sentenceAnalysisConsent ? "저장됨" : "없음"}</p>
              <p className="note">문장 분석 전송 동의: {featureSettings.sentenceAnalysisConsent ? `동의함${featureSettings.sentenceAnalysisConsentAt ? ` (${new Date(featureSettings.sentenceAnalysisConsentAt).toLocaleString("ko-KR")})` : ""}` : "동의하지 않음"}. 동의하지 않으면 문장을 전송하지 않아요.</p>
              {settingsError && <p className="error" role="alert">{settingsError}</p>}
              {featureSettings.sentenceAnalysisConsent && <button className="ghost" onClick={() => void saveFeature({ sentenceAnalysisConsent: false, sentenceAnalysisEnabled: false })}>전송 동의 다시 보기</button>}
              <label className="field">
                <span className="field-label">AI 제공자</span>
                <select className="api-key-input" value={aiProvider} onChange={(event) => {
                  const provider = event.target.value as AIProvider;
                  setAIProvider(provider);
                  setAIModel(AI_MODELS[provider][0]);
                  setApiKey("");
                  setKeyMessage("");
                }}>
                  <option value="gemini">Google Gemini · 기존 무료 API</option>
                  <option value="multi-ai">Multi AI · Baze 게이트웨이</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">모델</span>
                <select className="api-key-input" value={aiModel} onChange={(event) => setAIModel(event.target.value)}>
                  {AI_MODELS[aiProvider].map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{aiProvider === "gemini" ? "Gemini API 키" : "Multi AI API 키"}</span>
                <input
                  className="api-key-input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={selectedKeySaved ? "키가 저장되어 있어요. 바꾸려면 새 키를 입력하세요." : "API 키 붙여넣기"}
                />
              </label>
              <div className="api-key-actions">
                <button className="primary small" disabled={keyBusy || (apiKey.trim().length > 0 && apiKey.trim().length < 10) || (!apiKey.trim() && !selectedKeySaved)} onClick={saveKey}>모델과 키 저장</button>
                {selectedKeySaved && <button className="ghost" disabled={keyBusy} onClick={clearKey}>현재 키 삭제</button>}
                <span className="key-status">{aiProvider === "gemini" ? "Gemini" : "Multi AI"} {selectedKeySaved ? "키 사용 가능" : "키 미설정"}</span>
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
                  <span>{s.rounds.length}라운드 · {s.mode === "practice" ? "약점 연습" : "일반 연습"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
