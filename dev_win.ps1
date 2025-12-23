# 1. 编译 Python Sidecar
Write-Host "正在构建 Python Sidecar..." -ForegroundColor Cyan
Set-Location perf-sight/src-tauri/python
python -m PyInstaller --onefile --name collector collector.py

# 0. 检查并释放 Vite dev server 端口（默认 1420）
function Stop-ProcessOnPort {
    param(
        [Parameter(Mandatory=$true)]
        [int]$Port
    )

    Write-Host "检查端口 $Port 是否被占用..." -ForegroundColor Cyan

    $pids = @()

    # 优先使用 Get-NetTCPConnection（更可靠）
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        foreach ($c in $conns) {
            if ($c.OwningProcess -and $c.OwningProcess -ne 0) {
                $pids += [int]$c.OwningProcess
            }
        }
    } catch {
        # 兜底：用 netstat 解析 PID
        try {
            $lines = netstat -ano | Select-String -Pattern "LISTENING" | Select-String -Pattern (":$Port\s")
            foreach ($line in $lines) {
                $parts = ($line -replace "\s+", " ").Trim().Split(" ")
                $procId = $parts[-1]
                if ($procId -match "^\d+$") { $pids += [int]$procId }
            }
        } catch {
            Write-Host "⚠️ 无法检测端口占用情况（Get-NetTCPConnection 和 netstat 均失败）。将继续尝试启动。" -ForegroundColor Yellow
            return
        }
    }

    $pids = $pids | Sort-Object -Unique
    if (-not $pids -or $pids.Count -eq 0) {
        Write-Host "端口 $Port 未被占用。" -ForegroundColor Green
        return
    }

    foreach ($procId in $pids) {
        try {
            $proc = Get-Process -Id $procId -ErrorAction Stop
            Write-Host "端口 $Port 被占用：PID=$procId Name=$($proc.ProcessName)。正在强制结束..." -ForegroundColor Yellow
        } catch {
            Write-Host "端口 $Port 被占用：PID=$procId。正在强制结束..." -ForegroundColor Yellow
        }

        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host "已结束 PID=$procId" -ForegroundColor Green
        } catch {
            Write-Host "⚠️ 无法结束 PID=$procId：$($_.Exception.Message)" -ForegroundColor Red
        }
    }

    Start-Sleep -Milliseconds 300
}

# 默认 Vite 端口：1420（Tauri/Vite 默认 devUrl/port）
Stop-ProcessOnPort -Port 1420

# 确保目标目录存在
if (!(Test-Path "../binaries")) {
    New-Item -ItemType Directory -Force -Path "../binaries"
}

# 移动并重命名为 Tauri 预期的文件名 (Windows)
Move-Item -Force dist/collector.exe ../binaries/collector-x86_64-pc-windows-msvc.exe

# 清理构建临时文件 (可选)
# Remove-Item -Recurse -Force build, dist, collector.spec

# 回到项目根目录
Set-Location ../../..

# 2. 启动 Tauri 开发环境
Write-Host "正在启动 PerfSight Dev..." -ForegroundColor Green
Set-Location perf-sight
npm run tauri dev

