import { execSync } from "node:child_process";

function log(msg) {
  process.stdout.write(msg + "\n");
}

function warn(msg) {
  process.stderr.write(msg + "\n");
}

function nowMs() {
  return Date.now();
}

function isWindows() {
  return process.platform === "win32";
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function getProcessStartMsWindows(pid) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { [Math]::Floor(($p.StartTime.ToFileTimeUtc()-116444736000000000)/10000) }"`,
      { encoding: "utf8" }
    )
      .trim()
      .replace(/\r?\n/g, "");
    if (!out) return null;
    const ms = Number(out);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function findPidsOnPortWindows(port) {
  // netstat -ano output example:
  // TCP    127.0.0.1:1420         0.0.0.0:0              LISTENING       12345
  const out = execSync("netstat -ano", { encoding: "utf8" });
  const pids = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    if (!line.includes(`:${port}`)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid)) pids.push(Number(pid));
  }
  return uniq(pids);
}

function killPidWindows(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findPidsOnPortUnix(port) {
  // Best effort: lsof -ti :PORT
  try {
    const out = execSync(`lsof -ti :${port} 2>/dev/null || true`, {
      encoding: "utf8",
      shell: "/bin/bash",
    });
    const pids = out
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    return uniq(pids);
  } catch {
    return [];
  }
}

function killPidUnix(pid) {
  try {
    execSync(`kill -9 ${pid}`, { stdio: "ignore", shell: "/bin/bash" });
    return true;
  } catch {
    return false;
  }
}

function killPort(port) {
  const p = Number(port);
  if (!Number.isFinite(p) || p <= 0) return;

  let pids = [];
  try {
    pids = isWindows() ? findPidsOnPortWindows(p) : findPidsOnPortUnix(p);
  } catch (e) {
    warn(`[kill_ports] Failed to inspect port ${p}: ${String(e)}`);
    return;
  }

  if (!pids.length) {
    log(`[kill_ports] Port ${p} is free.`);
    return;
  }

  for (const pid of pids) {
    if (isWindows()) {
      const startMs = getProcessStartMsWindows(pid);
      // Safety: if we cannot determine start time, skip to avoid killing current dev instance.
      if (startMs == null) {
        log(`[kill_ports] Port ${p} is used by PID ${pid}, but start time is unknown. Skipping.`);
        continue;
      }
      const ageMs = nowMs() - startMs;
      // Guard: avoid killing a process that recently started (tauri dev race)
      if (ageMs >= 0 && ageMs < 15000) {
        log(
          `[kill_ports] Port ${p} is used by PID ${pid}, but it started ${Math.round(
            ageMs
          )}ms ago. Skipping (likely current dev instance).`
        );
        continue;
      }
    }
    log(`[kill_ports] Port ${p} is in use by PID ${pid}. Killing...`);
    const ok = isWindows() ? killPidWindows(pid) : killPidUnix(pid);
    if (!ok) warn(`[kill_ports] Failed to kill PID ${pid} (port ${p}).`);
  }
}

const ports = process.argv.slice(2).map((x) => x.trim()).filter(Boolean);
if (!ports.length) {
  log("[kill_ports] No ports specified. Usage: node scripts/kill_ports.mjs 1420 23333");
  process.exit(0);
}

for (const port of ports) {
  killPort(port);
}


