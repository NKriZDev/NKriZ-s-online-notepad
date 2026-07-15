import { describe, expect, it } from "vitest";
import { corsMethods } from "./http.js";

describe("HTTP configuration", () => {
  it("allows the cross-origin methods used by record and blob synchronization", () => {
    expect(corsMethods).toContain("PUT");
    expect(corsMethods).toContain("DELETE");
  });
});
