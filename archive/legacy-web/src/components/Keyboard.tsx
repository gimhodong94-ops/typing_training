import { KEYS, jamoOf } from "../lib/keyboard";

type Props = {
  next?: string[];
  wrong?: string | null;
  heat?: Record<string, number>;
  tip?: Record<string, string>;
};

export function Keyboard({ next = [], wrong, heat, tip }: Props) {
  return (
    <div className="kb" role="img" aria-label="키보드 배열">
      {KEYS.map((k) => {
        const value = heat?.[k.code];
        const hot = value !== undefined && value > 0;
        const style = {
          left: `${(k.x / 15) * 100}%`,
          top: `${(k.y / 5) * 100}%`,
          width: `${(k.w / 15) * 100}%`,
          ...(hot ? { background: `rgba(229, 51, 75, ${0.12 + value * 0.88})`, color: value > 0.55 ? "#fff" : undefined } : {}),
        };
        const cls = ["key", next.includes(k.code) && "next", wrong === k.code && "wrong"].filter(Boolean).join(" ");
        const jamo = jamoOf(k.code);
        return (
          <div key={k.code} className="key-slot" style={{ left: style.left, top: style.top, width: style.width }}>
            <div className={cls} style={{ background: style.background, color: style.color }} title={tip?.[k.code]}>
              <span className="key-main">{k.label}</span>
              {jamo && <span className="key-jamo">{jamo}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
