import requests
import json
import websocket
import time

def explore():
    try:
        # 1. /json/list
        print("--- /json/list ---")
        try:
            resp = requests.get('http://localhost:9222/json/list', timeout=2)
            targets = resp.json()
            if targets:
                print(f"Found {len(targets)} targets.")
                print("First Target Keys:", targets[0].keys())
                # Check for PID in list
                if 'procId' in targets[0]:
                    print("PID found in /json/list:", targets[0]['procId'])
            else:
                print("No targets found.")
        except Exception as e:
            print("Failed to fetch /json/list:", e)
            return

        # 2. /json/version
        print("\n--- /json/version ---")
        try:
            resp = requests.get('http://localhost:9222/json/version', timeout=2)
            version = resp.json()
            print("Browser WS:", version.get('webSocketDebuggerUrl'))
            
            browser_ws = version.get('webSocketDebuggerUrl')
            
            if browser_ws:
                ws = websocket.create_connection(browser_ws)
                
                # 3. Target.getTargets
                print("\n--- Target.getTargets ---")
                ws.send(json.dumps({"id": 1, "method": "Target.getTargets"}))
                res = json.loads(ws.recv())
                if 'result' in res:
                    t_infos = res['result']['targetInfos']
                    if t_infos:
                        print("First TargetInfo:", t_infos[0])
                
                # 4. SystemInfo.getProcessInfo
                print("\n--- SystemInfo.getProcessInfo ---")
                ws.send(json.dumps({"id": 2, "method": "SystemInfo.getProcessInfo"}))
                res = json.loads(ws.recv())
                if 'result' in res and 'processInfo' in res['result']:
                    infos = res['result']['processInfo']
                    print(f"Total processInfo entries: {len(infos)}")

                    # Print the first entry (raw)
                    print("\nFirst processInfo entry (raw):")
                    print(json.dumps(infos[0], indent=2, ensure_ascii=False))

                    # Print any GPU entries (raw)
                    gpu_infos = [p for p in infos if p.get("type") == "gpu"]
                    print(f"\nGPU entries: {len(gpu_infos)}")
                    for i, p in enumerate(gpu_infos[:5]):
                        print(f"\nGPU[{i}] (raw):")
                        print(json.dumps(p, indent=2, ensure_ascii=False))

                    # Print a compact table for quick scanning
                    print("\n--- Compact list (id, type, cpuTime, privateMemorySize?) ---")
                    for p in infos[:50]:
                        pid = p.get("id")
                        ptype = p.get("type")
                        cpu_time = p.get("cpuTime")
                        pmem = p.get("privateMemorySize")
                        print(f"id={pid} type={ptype} cpuTime={cpu_time} privateMemorySize={pmem}")

                ws.close()
        except Exception as e:
            print("Failed to connect to Browser WS:", e)

    except Exception as e:
        print("Global Error:", e)

if __name__ == "__main__":
    explore()
