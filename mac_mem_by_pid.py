#!/usr/bin/env python3
# chrome_mem_diagnose.py
#
# macOS 上使用 psutil 统计 Chrome 进程的内存占用：
# - 汇总所有 Chrome 相关进程的内存
# - 单独汇总 GPU 相关进程的内存（--type=gpu-process）

import psutil


def format_mb(b: int) -> str:
    return f"{b / (1024 ** 2):.2f} MB"


def format_gb(b: int) -> str:
    return f"{b / (1024 ** 3):.2f} GB"


def is_chrome_process(name: str) -> bool:
    lname = name.lower()
    return "chrome" in lname  # 覆盖 Google Chrome / Chrome Helper 等


def collect_processes():
    chrome_procs = []
    gpu_procs = []

    for p in psutil.process_iter(["pid", "name", "cmdline", "memory_info"]):
        try:
            name = p.info["name"] or ""
            cmdline = p.info["cmdline"] or []
            mem = p.info["memory_info"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

        if not is_chrome_process(name):
            continue

        # 所有 Chrome 相关进程
        chrome_procs.append((p, mem))

        # 判断是否为 GPU 相关进程
        cmd = " ".join(cmdline)
        if "--type=gpu-process" in cmd or "GPU" in name:
            gpu_procs.append((p, mem))

    return chrome_procs, gpu_procs


def main():
    chrome_procs, gpu_procs = collect_processes()

    if not chrome_procs:
        print("❌ 未找到任何 Chrome 相关进程。")
        return

    print("=== 所有 Chrome 相关进程 ===")
    total_chrome_rss = 0
    for p, mem in chrome_procs:
        if mem:
            total_chrome_rss += mem.rss
            print(
                f"PID {p.pid:6d} | {p.name():25s} | RSS = {format_mb(mem.rss):>10}"
            )

    print("\n=== Chrome GPU 相关进程（子集） ===")
    if not gpu_procs:
        print("（未检测到 GPU 相关进程）")
    else:
        total_gpu_rss = 0
        for p, mem in gpu_procs:
            if mem:
                total_gpu_rss += mem.rss
            print(
                f"PID {p.pid:6d} | {p.name():25s} | RSS = {format_mb(mem.rss):>10}"
            )
        print(f"\nChrome GPU 相关进程 RSS 总计: {format_gb(total_gpu_rss)}")

    print("\n=== 汇总 ===")
    print(f"Chrome 相关进程 RSS 总计: {format_gb(total_chrome_rss)}")


if __name__ == "__main__":
    main()