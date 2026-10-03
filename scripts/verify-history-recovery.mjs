import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), "flow-shuttle-history-tests-"));
const profile = join(root, "profile");
mkdirSync(profile);
try {
  const shim = join(root, "electron-shim.cjs");
  writeFileSync(shim, `
    const path = require('node:path');
    const profile = process.env.FLOW_SHUTTLE_HISTORY_TEST_PROFILE;
    if (!profile) throw new Error('An isolated test profile is required');
    exports.app = {
      getPath: name => name === 'userData' ? profile : path.join(path.dirname(profile), 'system-paths', name),
      getAppPath: () => process.env.FLOW_SHUTTLE_HISTORY_TEST_REPO,
      getName: () => 'Flow Shuttle history tests', isPackaged: false
    };
    exports.nativeTheme = { shouldUseDarkColors: false, themeSource: 'light' };
    exports.safeStorage = { isEncryptionAvailable: () => false };
  `);
  const bundle = join(root, "database.cjs");
  buildSync({
    entryPoints: [join(repo, "src/main/database.ts")], outfile: bundle,
    bundle: true, platform: "node", format: "cjs", target: "node20",
    alias: { electron: shim }, external: ["better-sqlite3"],
    banner: { js: `require = require('node:module').createRequire(${JSON.stringify(join(repo, "package.json"))});` }
  });
  const result = spawnSync(require("electron"), ["--test", join(repo, "scripts/verify-history-recovery.cjs")], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", FLOW_SHUTTLE_HISTORY_TEST_PROFILE: profile,
      FLOW_SHUTTLE_HISTORY_TEST_REPO: repo, FLOW_SHUTTLE_HISTORY_TEST_DATABASE: bundle }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  rmSync(root, { recursive: true, force: true });
}
