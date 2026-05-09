import { describe, expect, it } from "vitest";

import { API_BASE, silentLogger } from "../src/index";

describe("wild-apricot-exports", () => {
  it("exports API_BASE", () => {
    expect(API_BASE).toContain("wildapricot");
  });

  it("silentLogger is non-throwing", () => {
    expect(() => silentLogger.info("ok")).not.toThrow();
  });
});
