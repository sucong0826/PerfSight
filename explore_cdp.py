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
                    print("First Process Entry:", res['result']['processInfo'][0])
                    # We expect: { 'id': 1234, 'type': 'renderer', 'cpuTime': ... }

                ws.close()
        except Exception as e:
            print("Failed to connect to Browser WS:", e)

    except Exception as e:
        print("Global Error:", e)

if __name__ == "__main__":
    explore()
