import { describe, expect, it } from "vitest";
import { reconcileTags, tagColor, tagDefinitions } from "./tags";

describe("vault tag definitions", () => {
  it("renames and removes existing tags by stable definition id", () => {
    const before = [
      { id: "work", name: "Work", color: "#111111" },
      { id: "old", name: "Old", color: "#222222" }
    ];
    const after = [{ id: "work", name: "Projects", color: "#abcdef" }];

    expect(reconcileTags(["Work", "Old", "Unmanaged"], before, after)).toEqual(["Projects", "Unmanaged"]);
  });

  it("keeps an explicitly empty tag collection and uses configured colors", () => {
    expect(tagDefinitions([])).toEqual([]);
    expect(tagColor("Projects", [{ id: "work", name: "Projects", color: "#abcdef" }])).toBe("#abcdef");
  });
});
