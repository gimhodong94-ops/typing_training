import { describe, expect, it } from "vitest";
import { josa } from "./grammar";

describe("Korean postpositions", () => {
  it("selects 으로/로 for final consonants and vowels", () => {
    expect(josa("왼손", "으로", "로")).toBe("왼손으로");
    expect(josa("오른손", "으로", "로")).toBe("오른손으로");
    expect(josa("엄지", "으로", "로")).toBe("엄지로");
    expect(josa("새끼손가락", "으로", "로")).toBe("새끼손가락으로");
    expect(josa("길", "으로", "로")).toBe("길로");
  });
});
