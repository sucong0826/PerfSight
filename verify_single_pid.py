import psutil
import time
import sys

# 获取系统逻辑核心数量，用于标准化 CPU 数据
LOGICAL_CORES = psutil.cpu_count(logical=True)
print(f"系统检测到 {LOGICAL_CORES} 个逻辑核心。CPU 数据将据此标准化。")

# --- 新增配置：刷新间隔 ---
# 将间隔设置为 0.5 秒，比之前的 1.0 秒快一倍，提高实时感。
REFRESH_INTERVAL = 0.5 
# ------------------------

def find_chrome_gpu_pid():
    """
    遍历所有进程，通过检查命令行参数找到 Chrome GPU 进程的 PID。
    """
    print("正在寻找 Chrome GPU 进程...")
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if proc.info['name'] and 'chrome.exe' in proc.info['name'].lower():
                cmdline = proc.info['cmdline']
                # 检查命令行参数中是否包含定义 GPU 进程的标志
                if cmdline and '--type=gpu-process' in cmdline:
                    print(f"找到 Chrome GPU 进程，PID: {proc.info['pid']}")
                    return proc.info['pid']
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    print("未找到 Chrome GPU 进程。请确保 Chrome 正在运行。")
    return None

def monitor_process(pid):
    """
    实时监控指定 PID 的 CPU 和内存开销。
    """
    try:
        proc = psutil.Process(pid)
        
        print(f"\n开始监控 PID: {pid} (按 Ctrl+C 停止)")
        print(f"刷新频率: 每 {REFRESH_INTERVAL} 秒更新一次")
        print("-" * 55)
        print(f"{'时间':<10} | {'CPU (TaskMgr)':<15} | {'内存 (专用工作集)':<20}")
        print("-" * 55)

        # --- 关键修改 1: 初始化参考点 ---
        # 首次调用 interval=None，返回值始终为 0.0，但它建立了一个
        # 时间基准点 (T1)，供下一次调用计算差值使用。
        proc.cpu_percent(interval=None) 

        while True:
            # --- 关键修改 2: 手动控制刷新节奏 ---
            # 在这里睡眠，决定了采样的时间窗口大小。
            time.sleep(REFRESH_INTERVAL)

            # --- 关键修改 3: 非阻塞获取 CPU ---
            # interval=None 会计算自上次调用以来的使用率。
            # 时间窗口就是上面 sleep 的时间。
            raw_cpu_percent = proc.cpu_percent(interval=None)

            # 标准化 CPU 使用率 (匹配任务管理器 0-100% 的视图)
            normalized_cpu_percent = raw_cpu_percent / LOGICAL_CORES
            
            # 获取准确的内存信息 (USS - Unique Set Size)
            try:
                # 尝试获取最准确的专用内存
                mem_info = proc.memory_full_info()
                memory_mb = mem_info.uss / (1024 * 1024)
            except (psutil.AccessDenied, AttributeError):
                 # 如果受限，回退到 RSS (稍微不那么准确，但通常可用)
                 mem_info = proc.memory_info()
                 memory_mb = mem_info.rss / (1024 * 1024)
            
            current_time = time.strftime("%H:%M:%S", time.localtime())
            # 打印时保留一位小数即可，变化太快看太多位也没意义
            print(f"{current_time:<10} | {normalized_cpu_percent:>14.1f} % | {memory_mb:>18.2f} MB")

    except psutil.NoSuchProcess:
        print(f"\n进程 PID {pid} 已结束。监控停止。")
    except KeyboardInterrupt:
        print("\n监控已由用户停止。")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"\n发生错误: {e}")

if __name__ == "__main__":
    # 建议：以管理员身份运行此脚本可以提高获取 memory_full_info(USS) 的成功率
    gpu_pid = find_chrome_gpu_pid()

    if gpu_pid:
        time.sleep(0.5) 
        if psutil.pid_exists(gpu_pid):
            monitor_process(gpu_pid)
        else:
             print("找到的进程在启动监控前已消失。")