import { describe, expect, it } from "vitest";
import { rankComparisonRows, selectWeaknessCards } from "./weaknessPresentation";

describe("weakness result presentation", () => {
  it("shows no cards below the three-session baseline and at most two above it", () => {
    const groups = [{ id: "finger" }, { id: "hand" }, { id: "row" }];
    const keys = [{ id: "key-a" }];
    expect(selectWeaknessCards(false, groups, keys)).toEqual([]);
    expect(selectWeaknessCards(true, groups, keys)).toEqual(groups.slice(0, 2));
  });

  it("prioritizes bundles over individual keys and ranks only the three largest changes", () => {
    const cards = selectWeaknessCards(true, [{ id: "group" }], [{ id: "key" }]);
    expect(cards.map((card) => card.id)).toEqual(["group", "key"]);
    const rows = rankComparisonRows([
      { id: "small", previous: { k: 1, n: 100 }, current: { k: 2, n: 100 } },
      { id: "large", previous: { k: 1, n: 100 }, current: { k: 31, n: 100 } },
      { id: "medium", previous: { k: 2, n: 10 }, current: { k: 5, n: 10 } },
      { id: "fourth", previous: { k: 2, n: 20 }, current: { k: 3, n: 20 } },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["large", "medium", "fourth"]);
  });
});
