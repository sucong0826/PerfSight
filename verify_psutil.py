import psutil
import time
import os
import sys
import json

def get_process_info(pid):
    try:
        proc = psutil.Process(pid)
        # onseshot=True 提高效率
        with proc.oneshot():
            name = proc.name()
            # interval=None 表示非阻塞，返回自上次调用以来的平均值
            # 注意：第一次调用通常返回 0.0，需要忽略或由于我们是循环调用，后续会正常
            cpu_percent = proc.cpu_percent(interval=None) 
            # rss 是 Resident Set Size (物理内存)
            memory_info = proc.memory_info()
            memory_mb = memory_info.rss / 1024 / 1024
            
        return {
            "pid": pid,
            "name": name,
            "cpu": cpu_percent,
            "memory_mb": memory_mb
        }
    except psutil.NoSuchProcess:
        return None
    except Exception as e:
        return {"pid": pid, "error": str(e)}

def main():
    # 获取当前 Python 进程本身的 ID，方便你在 Task Manager 中找到它进行对比
    current_pid = os.getpid()
    print(f"Monitor started. My PID is: {current_pid}")
    print(f"Please open Task Manager / Activity Monitor and check CPU/Mem for PID: {current_pid} (python/verify_psutil)")
    print("-" * 50)

    # 为了制造一点 CPU 负载以便观察，我们可以在检测间隙做一点点运算，或者就检测自己
    target_pid = current_pid
    
    # 初始化 CPU 计数
    psutil.Process(target_pid).cpu_percent(interval=None)

    while True:
        info = get_process_info(target_pid)
        if info:
            # CPU 需要除以核心数吗？Task Manager 通常显示的是占总 CPU 的百分比。
            # psutil.cpu_percent 默认是逻辑核心的总和（可能超过 100%）。
            # 如果要和 Task Manager 对齐，通常不需要除以核数，除非 Task Manager 显示的是归一化的。
            # Windows Task Manager: 100% 是所有核跑满。psutil 也是这样 (但多核可能 > 100% 如果逻辑不同)。
            # 让我们直接打印原始值
            
            # 格式化输出 JSON 以便看清
            print(json.dumps(info))
        
        time.sleep(1)

if __name__ == "__main__":
    main()

