import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function makeTempDir(prefix = "wae-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
