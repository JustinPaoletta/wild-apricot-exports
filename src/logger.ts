// src/logger.ts
// Default logger implementations. Library code uses `silentLogger` by default
// (so importing the lib into a long-lived process doesn't fill stderr/stdout
// with progress noise). The CLI uses `consoleLogger` to keep today's
// human-readable output behavior.

import type { Logger } from "./types";

export const consoleLogger: Logger = {
  info(message) {
    console.log(message);
  },
  warn(message) {
    console.warn(message);
  },
  error(message) {
    console.error(message);
  },
  progress(message) {
    process.stdout.write(message);
  },
};

export const silentLogger: Logger = {
  info() {
    /* no-op */
  },
  warn() {
    /* no-op */
  },
  error() {
    /* no-op */
  },
  progress() {
    /* no-op */
  },
};

/**
 * Resolve the logger an exporter should use. Library default is silent;
 * pass `consoleLogger` (or your own implementation) to opt into output.
 */
export function resolveLogger(logger: Logger | undefined): Logger {
  return logger ?? silentLogger;
}
