import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = set("`~!@#$%^&*()-_=+[]{}\\|;:'\",.<>/?")


def allowed(ch):
    return ("\uac00" <= ch <= "\ud7a3" or ch == " " or
            ch in SYMBOLS or ch.isascii() and ch.isalnum())


def check_text(text, path):
    errors = []
    bad = sorted(set(ch for ch in text if not allowed(ch)))
    if bad:
        errors.append("허용 문자 위반: " + "".join(repr(ch) for ch in bad))
    limit = 120 if any(ch.isascii() and ch.isalpha() for ch in text) else 60
    if len(text) < 5 or len(text) > limit:
        errors.append(f"길이 위반: {len(text)}자 (허용 5~{limit}자)")
    if "\n" in text and path.name != "coding.jsonl":
        errors.append("줄바꿈은 coding.jsonl에서만 허용")
    return errors


def check_record(path, number, row, seen):
    if not isinstance(row, dict): return [f"{path.name} | line {number} | JSON 객체가 아님"]
    sid, errors = row.get("id", "?"), []
    if set(row) != {"id", "text"}: errors.append("필드는 id, text만 허용 (category/tags 금지)")
    if not isinstance(sid, str) or not re.fullmatch(r"[A-Za-z0-9_-]+_\d{3}", sid): errors.append("id 형식 위반")
    else:
        if sid in seen: errors.append("중복 id")
        seen.add(sid)
        if sid != f"{path.stem}_{number:03d}": errors.append(f"id 순서 위반 (예상: {path.stem}_{number:03d})")
    text = row.get("text")
    if not isinstance(text, str): errors.append("text가 문자열이 아님")
    else: errors.extend(check_text(text, path))
    return [f"{path.name} | {sid} | {error}" for error in errors]


def check_file(path):
    issues, seen = [], set()
    with path.open(encoding="utf-8") as source:
        for number, line in enumerate(source, 1):
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                issues.append(f"{path.name} | line {number} | JSON 파싱 실패: {error.msg}")
                continue
            issues.extend(check_record(path, number, row, seen))
    return issues


def main():
    files = sorted((ROOT / "data" / "sentences").glob("*.jsonl"))
    issues = [issue for path in files for issue in check_file(path)]
    print("\n".join(issues) if issues else "OK")


if __name__ == "__main__":
    main()
