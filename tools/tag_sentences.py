import json
from pathlib import Path

from features import COMPLEX_JONG, COMPLEX_JUNG, DOUBLE_CHO, DOUBLE_JONG, SYMBOLS

ROOT = Path(__file__).resolve().parents[1]
TAG_ORDER = ("받침많음", "겹받침", "복합모음", "쌍자음", "어절많음", "숫자포함",
             "영문포함", "기호포함", "긴문장", "짧은문장", "줄바꿈포함")
JONG_RATIO, EOJEOL_COUNT, LONG_LEN, SHORT_LEN = 0.4, 6, 45, 20


def compute_tags(text):
    parts = [((ord(ch) - 0xAC00) // 588, ((ord(ch) - 0xAC00) % 588) // 28,
              (ord(ch) - 0xAC00) % 28) for ch in text if "\uac00" <= ch <= "\ud7a3"]
    with_jong = sum(jong != 0 for _, _, jong in parts)
    found = {
        "받침많음": bool(parts) and with_jong / len(parts) >= JONG_RATIO,
        "겹받침": any(jong in COMPLEX_JONG for _, _, jong in parts),
        "복합모음": any(jung in COMPLEX_JUNG for _, jung, _ in parts),
        "쌍자음": any(cho in DOUBLE_CHO or jong in DOUBLE_JONG for cho, _, jong in parts),
        "어절많음": len(text.split()) >= EOJEOL_COUNT,
        "숫자포함": any(ch in "0123456789" for ch in text),
        "영문포함": any(ch.isascii() and ch.isalpha() for ch in text),
        "기호포함": any(ch in SYMBOLS for ch in text),
        "긴문장": len(text) >= LONG_LEN,
        "짧은문장": len(text) <= SHORT_LEN,
        "줄바꿈포함": "\n" in text,
    }
    return [tag for tag in TAG_ORDER if found[tag]]


def tag_file(path):
    rows = []
    with path.open(encoding="utf-8") as source:
        for line in source:
            row = json.loads(line)
            rows.append({"id": row["id"], "category": path.stem,
                         "text": row["text"], "tags": compute_tags(row["text"])})
    with path.open("w", encoding="utf-8", newline="\n") as target:
        for row in rows:
            target.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(rows)


def main():
    for path in sorted((ROOT / "data" / "sentences").glob("*.jsonl")):
        print(f"{path.name}: {tag_file(path)}개 문장 태그 계산 완료")


if __name__ == "__main__":
    main()
