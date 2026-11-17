import json
import statistics
from pathlib import Path

from features import KEYS, analyze

folder = Path(__file__).resolve().parents[1] / "data" / "sentences"
rows = []
for path in sorted(folder.glob("*.jsonl")):
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            try:
                rows.append(analyze(json.loads(line)["text"]))
            except (json.JSONDecodeError, KeyError, TypeError) as error:
                raise ValueError(f"{path.name}:{line_number}: {error}") from error

if not rows:
    raise SystemExit("문장 데이터가 없습니다.")

print("특성별 통계 (최소 / 중앙값 / 최대 / 평균)")
print(f"{'특성':<22} {'최소':>10} {'중앙값':>10} {'최대':>10} {'평균':>10}")
for key in KEYS:
    values = [row[key] for row in rows]
    print(f"{key:<22} {min(values):>10.3f} {statistics.median(values):>10.3f} "
          f"{max(values):>10.3f} {statistics.mean(values):>10.3f}")

print(f"\n특성별 10구간 히스토그램 (문장 {len(rows)}개, 막대 1개 = 문장 1개)")
for key in KEYS:
    values = [row[key] for row in rows]
    low, high = min(values), max(values)
    bins = [0] * 10
    for value in values:
        index = 0 if high == low else min(9, int((value - low) / (high - low) * 10))
        bins[index] += 1
    print(f"\n{key} [{low:.3f}, {high:.3f}]")
    for index, count in enumerate(bins):
        start = low + (high - low) * index / 10
        end = low + (high - low) * (index + 1) / 10
        print(f"  {start:8.3f} - {end:8.3f} | {'#' * count} {count}")
