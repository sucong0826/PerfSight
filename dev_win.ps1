# 1. 编译 Python Sidecar
Write-Host "正在构建 Python Sidecar..." -ForegroundColor Cyan
cd perf-sight/src-tauri/python
python -m PyInstaller --onefile --name collector collector.py

# 确保目标目录存在
if (!(Test-Path "../binaries")) {
    New-Item -ItemType Directory -Force -Path "../binaries"
}

# 移动并重命名为 Tauri 预期的文件名 (Windows)
Move-Item -Force dist/collector.exe ../binaries/collector-x86_64-pc-windows-msvc.exe

# 清理构建临时文件 (可选)
# Remove-Item -Recurse -Force build, dist, collector.spec

# 回到项目根目录
cd ../../..

# 2. 启动 Tauri 开发环境
Write-Host "正在启动 PerfSight Dev..." -ForegroundColor Green
cd perf-sight
npm run tauri dev

