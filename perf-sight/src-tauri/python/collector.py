import sys
import json
import time
import psutil
import threading

# Global state
config = {
    "running": False,
    "pids": [],
    "interval": 1.0
}
config_lock = threading.Lock()

def get_cpu_count():
    try:
        return psutil.cpu_count(logical=True)
    except:
        return 1

CPU_COUNT = get_cpu_count()

def collect_metrics():
    """Main collection loop running in a separate thread."""
    
    # Process objects cache
    process_cache = {}
    
    # CPU calculation cache: pid -> (last_time, last_total_cpu_time)
    cpu_state = {}

    while True:
        with config_lock:
            running = config["running"]
            target_pids = list(config["pids"])
            interval = config["interval"]

        if not running:
            # Clear caches to avoid stale data on resume
            if not target_pids:
                process_cache.clear()
                cpu_state.clear()
            time.sleep(0.1)
            continue

        # Cleanup caches
        target_pid_set = set(target_pids)
        for pid in list(process_cache.keys()):
            if pid not in target_pid_set:
                del process_cache[pid]
        for pid in list(cpu_state.keys()):
            if pid not in target_pid_set:
                del cpu_state[pid]

        timestamp = int(time.time() * 1000)
        now = time.time()
        metrics = {}
        has_data = False

        for pid in target_pids:
            try:
                if pid not in process_cache:
                    process_cache[pid] = psutil.Process(pid)
                
                proc = process_cache[pid]

                # --- Manual CPU Calculation (Manual Delta) ---
                # This bypasses psutil's internal state which might be finicky with interval=None
                try:
                    cpu_times = proc.cpu_times()
                    total_cpu_time = cpu_times.user + cpu_times.system
                    
                    if pid in cpu_state:
                        last_time, last_total = cpu_state[pid]
                        delta_time = now - last_time
                        delta_cpu = total_cpu_time - last_total
                        
                        if delta_time > 0 and delta_cpu >= 0:
                            # Normalize by core count to match Task Manager
                            cpu = (delta_cpu / delta_time) * 100 / CPU_COUNT
                        else:
                            cpu = 0.0
                    else:
                        # First run for this PID: cannot calc delta yet
                        cpu = 0.0
                    
                    # Update state
                    cpu_state[pid] = (now, total_cpu_time)
                    
                except Exception as e:
                    # CPU access failed
                    cpu = 0.0
                    # Remove from state to reset next time
                    if pid in cpu_state:
                        del cpu_state[pid]

                # --- Memory Logic ---
                # User confirmed 'private' matches Chrome Task Manager best
                mem_info = proc.memory_info()
                # Windows: private (Commit Size), Linux/Mac: fallback to rss
                private_mem = getattr(mem_info, 'private', mem_info.rss)
                mem_mb = private_mem / 1024 / 1024
                
                # Log only if > 0 to reduce spam, or periodic? 
                # sys.stderr.write(f"PID={pid} CPU={cpu:.2f}% Mem={mem_mb:.2f}MB\n")
                
                metrics[pid] = {
                    "cpu": round(cpu, 2),
                    "memory": round(mem_mb, 2),
                }
                has_data = True
                
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                metrics[pid] = None
                if pid in process_cache: del process_cache[pid]
                if pid in cpu_state: del cpu_state[pid]
            except Exception as e:
                sys.stderr.write(f"PID={pid} Error: {e}\n")
                metrics[pid] = None

        if has_data:
            output = {
                "type": "data",
                "timestamp": timestamp,
                "metrics": metrics
            }
            try:
                sys.stdout.write(json.dumps(output) + "\n")
                sys.stdout.flush()
            except Exception:
                break

        time.sleep(interval)

def scan_chrome_processes():
    """Scan for all Chrome processes and categorize them."""
    chrome_procs = []
    target_names = ['chrome.exe', 'google chrome', 'chrome']
    
    for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'memory_info']):
        try:
            name = proc.info['name'].lower()
            if any(t in name for t in target_names):
                cmdline = proc.info.get('cmdline') or []
                cmd_str = ' '.join(cmdline)
                
                proc_type = "Browser"
                if '--type=renderer' in cmd_str:
                    if '--extension-process' in cmd_str:
                        proc_type = "Extension"
                    else:
                        proc_type = "Renderer"
                elif '--type=gpu-process' in cmd_str:
                    proc_type = "GPU"
                elif '--type=utility' in cmd_str:
                    proc_type = "Utility"
                elif '--type=crashpad-handler' in cmd_str:
                    proc_type = "Crashpad"
                elif '--type=' in cmd_str:
                    for arg in cmdline:
                        if arg.startswith('--type='):
                            proc_type = arg.split('=')[1].capitalize()
                            break
                            
                # Use 'private' memory here too for consistency
                mem_info = proc.info['memory_info']
                mem = getattr(mem_info, 'private', mem_info.rss)
                
                chrome_procs.append({
                    "pid": proc.info['pid'],
                    "name": proc.info['name'],
                    "proc_type": proc_type, 
                    "memory": mem,
                    "cpu": 0.0
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
            
    return chrome_procs

def read_stdin():
    """Read commands from stdin."""
    for line in sys.stdin:
        try:
            line = line.strip()
            if not line:
                continue
                
            cmd = json.loads(line)
            action = cmd.get("action")
            
            with config_lock:
                if action == "scan_chrome":
                    procs = scan_chrome_processes()
                    output = {"type": "process_list", "data": procs}
                    sys.stdout.write(json.dumps(output) + "\n")
                    sys.stdout.flush()
                    
                elif action == "start":
                    config["pids"] = cmd.get("pids", [])
                    interval = cmd.get("interval", 1.0)
                    config["interval"] = max(0.5, interval)
                    config["running"] = True
                    sys.stderr.write(f"Python: Started collection for pids: {config['pids']}\n")
                    sys.stderr.flush()
                    
                elif action == "stop":
                    config["running"] = False
                    sys.stderr.write("Python: Stopped collection\n")
                    sys.stderr.flush()
                    
                elif action == "update":
                    if "pids" in cmd:
                        config["pids"] = cmd["pids"]
                    if "interval" in cmd:
                        config["interval"] = max(0.5, cmd["interval"])
                        
                elif action == "exit":
                    sys.exit(0)
                    
        except json.JSONDecodeError:
            pass
        except Exception as e:
            sys.stderr.write(f"Python Error: {e}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    if hasattr(sys, 'frozen'):
        sys.stderr.write("DEBUG: Collector v4.0 (Manual Delta + Private Mem)\n")
        sys.stderr.flush()

    t = threading.Thread(target=collect_metrics, daemon=True)
    t.start()
    
    try:
        read_stdin()
    except KeyboardInterrupt:
        pass
