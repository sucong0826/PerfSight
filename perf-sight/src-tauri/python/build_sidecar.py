import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def _run(cmd, cwd=None):
    print(f"[sidecar] $ {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd)


def _venv_python(venv_dir: Path) -> Path:
    if platform.system() == "Windows":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def _ensure_venv(venv_dir: Path) -> Path:
    py = _venv_python(venv_dir)
    if py.exists():
        return py

    print(f"[sidecar] creating venv at {venv_dir}")
    _run([sys.executable, "-m", "venv", str(venv_dir)])
    py = _venv_python(venv_dir)
    if not py.exists():
        raise RuntimeError(f"venv python not found at {py}")
    return py


def _pip_install(py: Path, requirements: Path):
    _run([str(py), "-m", "pip", "install", "--upgrade", "pip"])
    _run([str(py), "-m", "pip", "install", "-r", str(requirements)])


def _default_target_triple() -> str:
    # Match what tauri-build expects for externalBin resource naming.
    sysname = platform.system()
    machine = platform.machine().lower()

    if sysname == "Darwin":
        if machine in ("arm64", "aarch64"):
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"
    if sysname == "Linux":
        return "x86_64-unknown-linux-gnu"
    if sysname == "Windows":
        # GitHub Actions uses this naming convention in our workflow.
        return "x86_64-pc-windows-msvc.exe"

    raise RuntimeError(f"Unsupported platform for sidecar build: {sysname} / {machine}")


def main():
    # Allow passing TAURI_ENV_TARGET_TRIPLE explicitly (tauri-build sets this).
    target = os.environ.get("TAURI_ENV_TARGET_TRIPLE") or _default_target_triple()

    here = Path(__file__).resolve().parent  # src-tauri/python
    src_tauri_dir = here.parent
    binaries_dir = src_tauri_dir / "binaries"
    binaries_dir.mkdir(parents=True, exist_ok=True)

    out_name = f"collector-{target}"
    out_path = binaries_dir / out_name
    if out_path.exists():
        print(f"[sidecar] already exists: {out_path}")
        return

    venv_dir = here / ".venv"
    requirements = here / "requirements.txt"
    if not requirements.exists():
        raise RuntimeError(f"Missing requirements.txt at {requirements}")

    py = _ensure_venv(venv_dir)
    _pip_install(py, requirements)

    # Build with PyInstaller.
    # We build into python/dist/collector(.exe) and then move it into src-tauri/binaries/.
    dist_dir = here / "dist"
    build_dir = here / "build"
    for p in (dist_dir, build_dir):
        if p.exists():
            shutil.rmtree(p)

    collector_py = here / "collector.py"
    if not collector_py.exists():
        raise RuntimeError(f"Missing collector.py at {collector_py}")

    # `--name collector` ensures output is dist/collector(.exe)
    _run(
        [
            str(py),
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--onefile",
            "--name",
            "collector",
            str(collector_py),
        ],
        cwd=str(here),
    )

    built = dist_dir / ("collector.exe" if platform.system() == "Windows" else "collector")
    if not built.exists():
        raise RuntimeError(f"PyInstaller output not found at {built}")

    print(f"[sidecar] moving {built} -> {out_path}")
    shutil.move(str(built), str(out_path))

    if platform.system() != "Windows":
        out_path.chmod(out_path.stat().st_mode | 0o111)  # ensure executable bit

    print(f"[sidecar] done: {out_path}")


if __name__ == "__main__":
    main()


