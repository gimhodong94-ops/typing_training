import type { PointerEvent } from "react";
import { Keyboard } from "./Keyboard";
import type { WristAnchors } from "../lib/keyboard";

type Props = {
  anchors: WristAnchors;
  selected: "left" | "right";
  onSelect: (hand: "left" | "right") => void;
  onChange: (anchors: WristAnchors) => void;
};

export function WristSetup({ anchors, selected, onSelect, onChange }: Props) {
  const place = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(15, ((event.clientX - rect.left) / rect.width) * 15)),
      y: Math.max(0, Math.min(7, ((event.clientY - rect.top) / rect.height) * 7)),
    };
    onChange({ ...anchors, [selected]: point });
  };

  return (
    <div className="wrist-setup">
      <div className="seg small" role="radiogroup" aria-label="옮길 손목 기준점">
        <button className={selected === "left" ? "on" : ""} role="radio" aria-checked={selected === "left"} onClick={() => onSelect("left")}>왼손 손목</button>
        <button className={selected === "right" ? "on" : ""} role="radio" aria-checked={selected === "right"} onClick={() => onSelect("right")}>오른손 손목</button>
      </div>
      <p className="note">손목 기준점을 선택한 뒤 키보드 그림 아래쪽을 눌러 위치를 맞춰 주세요. 이 위치에서 가까운 손목을 해당 키를 쓰는 손으로 추정합니다.</p>
      <div className="wrist-board" onPointerDown={place} role="img" aria-label="키보드에서 좌우 손목 위치 지정">
        <div className="wrist-board-keys"><Keyboard /></div>
        <svg className="wrist-markers" viewBox="0 0 15 7" preserveAspectRatio="none" aria-hidden="true">
          <line x1={anchors.left.x} y1={anchors.left.y} x2={anchors.right.x} y2={anchors.right.y} />
          <circle className="left" cx={anchors.left.x} cy={anchors.left.y} r="0.28" />
          <circle className="right" cx={anchors.right.x} cy={anchors.right.y} r="0.28" />
          <text x={anchors.left.x} y={anchors.left.y + 0.65}>왼손</text>
          <text x={anchors.right.x} y={anchors.right.y + 0.65}>오른손</text>
        </svg>
        <span className="wrist-cursor" style={{ left: `${(anchors[selected].x / 15) * 100}%`, top: `${(anchors[selected].y / 7) * 100}%` }} />
      </div>
    </div>
  );
}
