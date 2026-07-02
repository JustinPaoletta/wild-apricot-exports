import { describe, expect, it, vi } from "vitest";

import { consoleLogger, resolveLogger, silentLogger } from "../src/logger";

describe("logger", () => {
  it("resolveLogger defaults to silentLogger", () => {
    expect(resolveLogger(undefined)).toBe(silentLogger);
    const custom = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(resolveLogger(custom)).toBe(custom);
  });

  it("silentLogger methods do not throw", () => {
    expect(() => {
      silentLogger.info("x");
      silentLogger.warn("x");
      silentLogger.error("x");
      silentLogger.progress?.("x");
    }).not.toThrow();
  });

  it("consoleLogger delegates to console", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    consoleLogger.info("hello");
    consoleLogger.warn("careful");
    consoleLogger.error("bad");
    consoleLogger.progress?.("...");
    expect(info).toHaveBeenCalledWith("hello");
    expect(warn).toHaveBeenCalledWith("careful");
    expect(error).toHaveBeenCalledWith("bad");
    expect(write).toHaveBeenCalledWith("...");
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    write.mockRestore();
  });
});
