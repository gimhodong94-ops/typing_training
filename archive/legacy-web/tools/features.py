SYMBOLS = set("`~!@#$%^&*()-_=+[]{}\\|;:'\",.<>/?")
COMPLEX_JONG = {3, 5, 6, 9, 10, 11, 12, 13, 14, 15, 18}
COMPLEX_JUNG = {9, 10, 11, 14, 15, 16, 19}
DOUBLE_CHO = {1, 4, 8, 10, 13}
DOUBLE_JONG = {2, 20}
KEYS = ("length", "eojeol", "jong_ratio", "complex_jong_ratio",
        "complex_jung_ratio", "double_ratio", "digit_ratio", "alpha_ratio",
        "symbol_ratio", "newline_count")


def analyze(text):
    length, eojeol = len(text), len(text.split())
    parts = [((ord(ch) - 0xAC00) // 588, ((ord(ch) - 0xAC00) % 588) // 28,
              (ord(ch) - 0xAC00) % 28) for ch in text if "\uac00" <= ch <= "\ud7a3"]
    total, jong = len(parts), sum(part[2] != 0 for part in parts)
    complex_jong = sum(part[2] in COMPLEX_JONG for part in parts)
    complex_jung = sum(part[1] in COMPLEX_JUNG for part in parts)
    double = sum(part[0] in DOUBLE_CHO or part[2] in DOUBLE_JONG for part in parts)
    korean = [count / total if total else 0.0 for count in
              (jong, complex_jong, complex_jung, double)]
    counts = [sum(ch.isascii() and ch.isdigit() for ch in text),
              sum(ch.isascii() and ch.isalpha() for ch in text),
              sum(ch in SYMBOLS for ch in text)]
    ratios = [count / length if length else 0.0 for count in counts]; return dict(zip(KEYS, (length, eojeol, *korean, *ratios, text.count("\n"))))
