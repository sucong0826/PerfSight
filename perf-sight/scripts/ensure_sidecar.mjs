import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sidecarScript = path.resolve(
  projectRoot,
  "src-tauri",
  "python",
  "build_sidecar.py"
);

if (!sidecarScript.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error("Sidecar build script path is outside the project directory.");
}

const interpreters =
  process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

for (const interpreter of interpreters) {
  const result = spawnSync(interpreter, [sidecarScript], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });

  if (result.error?.code === "ENOENT") continue;
  if (result.error) {
    console.error(`Could not start ${interpreter}: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

console.error(
  `Python was not found. Install Python 3 and ensure it is on PATH (tried: ${interpreters.join(", ")}).`
);
process.exit(1);
