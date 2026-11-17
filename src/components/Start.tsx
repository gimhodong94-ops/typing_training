import { useState } from "react";
import { Keyboard } from "./Keyboard";
import { ROUND_COUNT, sentences } from "../lib/sentences";
import type { KeyboardType, Session } from "../lib/types";

type Props = {
  history: Session[];
  onStart: (keyboard: KeyboardType, hint: boolean) => void;
  onOpen: (session: Session) => void;
};

export function Start({ history, onStart, onOpen }: Props) {
  const [keyboard, setKeyboard] = useState<KeyboardType>("desktop");
  const [hint, setHint] = useState(true);
  const rounds = Math.min(ROUND_COUNT, sentences.length);

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

        <button className="primary" disabled={!sentences.length} onClick={() => onStart(keyboard, hint)}>
          {rounds}라운드 시작
        </button>
        {!sentences.length && <p className="note">문장이 없어요. data/sentences 폴더에 문장 파일을 넣어 주세요.</p>}
        <p className="note">한글은 두벌식, 영문은 QWERTY 기준이에요. 키 위치와 한/영 입력 상태를 함께 판정하니, 문장에 맞게 한/영 키를 눌러 주세요.</p>
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
