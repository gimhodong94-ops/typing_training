import argparse
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUND_COUNT, TOLERANCE, MAX_RETRY = 30, 0.30, 1000


def load_sentences(category=None):
    rows = []
    for path in sorted((ROOT / "data" / "sentences").glob("*.jsonl")):
        if category and path.stem != category:
            continue
        with path.open(encoding="utf-8") as source:
            rows.extend(json.loads(line) for line in source)
    return rows


def target_total(rows, count=ROUND_COUNT):
    return count * sum(len(row["text"]) for row in rows) / len(rows)


def total_ok(total, target, tolerance=TOLERANCE):
    return target * (1 - tolerance) <= total <= target * (1 + tolerance)


def build_rounds(rows, count=ROUND_COUNT, tolerance=TOLERANCE, seed=None):
    if len(rows) < count:
        raise ValueError(f"문장이 {count}개보다 적습니다.")
    rng = random.Random(seed)
    target = target_total(rows, count)
    for attempt in range(1, MAX_RETRY + 1):
        picked = rng.sample(rows, count)
        if total_ok(sum(len(row["text"]) for row in picked), target, tolerance):
            return picked, target, attempt
    raise ValueError("총 글자 수 조건을 만족하는 라운드 구성을 만들 수 없습니다.")


def main():
    parser = argparse.ArgumentParser(description="문장 1개 = 1라운드. 총 글자 수 조건을 지킨 라운드 목록을 만든다.")
    parser.add_argument("--category")
    parser.add_argument("--rounds", type=int, default=ROUND_COUNT)
    parser.add_argument("--seed", type=int)
    args = parser.parse_args()
    rows = load_sentences(args.category)
    if not rows:
        raise SystemExit("문장 데이터가 없습니다.")
    picked, target, attempt = build_rounds(rows, args.rounds, seed=args.seed)
    total = sum(len(row["text"]) for row in picked)
    print(f"기준 {target:.1f}자 (문장 평균 길이 x {args.rounds}라운드), "
          f"허용 {target * (1 - TOLERANCE):.1f}~{target * (1 + TOLERANCE):.1f}자")
    print(f"총 {total}자, {attempt}번째 시도에 통과\n")
    for number, row in enumerate(picked, 1):
        print(f"[라운드 {number}] {row['id']} ({len(row['text'])}자) {row['text']}")


if __name__ == "__main__":
    main()
