import { execSync } from "node:child_process";

function log(msg) {
  process.stdout.write(msg + "\n");
}

function warn(msg) {
  process.stderr.write(msg + "\n");
}

const names = process.argv.slice(2).map((x) => x.trim()).filter(Boolean);
if (!names.length) {
  log("[kill_process] No process names specified. Usage: node scripts/kill_process.mjs perf-sight.exe");
  process.exit(0);
}

if (process.platform !== "win32") {
  // Best-effort no-op for non-Windows dev envs.
  log("[kill_process] Non-Windows platform; skipping.");
  process.exit(0);
}

function listPidsByImageName(name) {
  // Use PowerShell for richer data. For "perf-sight.exe" image name, process name is "perf-sight".
  const procName = name.toLowerCase().endsWith(".exe")
    ? name.slice(0, -4)
    : name;
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | Select-Object Id,@{Name='StartMs';Expression={[Math]::Floor(($_.StartTime.ToFileTimeUtc()-116444736000000000)/10000)}} | ConvertTo-Json"`,
      { encoding: "utf8" }
    ).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .map((x) => ({
        pid: Number(x?.Id),
        startMs: Number(x?.StartMs),
      }))
      .filter((x) => Number.isFinite(x.pid));
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

for (const name of names) {
  const procs = listPidsByImageName(name);
  if (!procs.length) {
    log(`[kill_process] Process not running: ${name}`);
    continue;
  }
  for (const p of procs) {
    if (!Number.isFinite(p.startMs)) {
      // Safety: if we can't determine start time, do NOT kill.
      log(`[kill_process] PID ${p.pid} (${name}) start time unknown. Skipping.`);
      continue;
    }
    const ageMs = Date.now() - p.startMs;
    // Guard: don't kill a process that recently started (tauri dev race).
    if (ageMs >= 0 && ageMs < 15000) {
      log(
        `[kill_process] PID ${p.pid} (${name}) started ${Math.round(
          ageMs
        )}ms ago. Skipping (likely current dev instance).`
      );
      continue;
    }
    const ok = killPid(p.pid);
    if (ok) log(`[kill_process] Killed PID ${p.pid} (${name})`);
    else warn(`[kill_process] Failed to kill PID ${p.pid} (${name})`);
  }
}


