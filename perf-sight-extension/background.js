// background.js (基于您的V5代码修改 - 修复内存N/A问题)

console.log("Chrome Process Monitor V6 (Full Data) started. Attempting to activate CPU & Memory monitoring...");

/**
 * 将字节转换为易读的 MB 字符串
 */
function formatMemory(bytes) {
    // 如果 bytes 是 undefined 或 null (或者0)，返回 N/A
    // 使用 onUpdatedWithMemory 后，这里应该能拿到数值了
    if (!bytes && bytes !== 0) return 'N/A';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * 格式化 CPU 字符串
 */
function formatCpu(cpuStr) {
    // 如果 cpuStr 是 undefined 或 null，说明浏览器还没计算出来
    if (cpuStr === undefined || cpuStr === null) return 'N/A';
    // API 返回的是浮点数，保留一位小数
    return cpuStr.toFixed(1) + '%';
}

// WebSocket Connection
let ws = null;
const WS_URL = "ws://127.0.0.1:23333";

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    console.log(`Connecting to PerfSight at ${WS_URL}...`);
    ws = new WebSocket(WS_URL);

    ws.onopen = () => console.log("✅ Connected to PerfSight!");
    ws.onerror = (e) => {
        // console.log("WS Error (PerfSight might not be running)"); 
    };
    ws.onclose = () => {
        // console.log("WS Closed. Retrying in 2s...");
        setTimeout(connectWebSocket, 2000);
    };
}

// Start immediately
connectWebSocket();

/**
 * 核心处理函数：接收进程数据并打印
 * 这个函数会被 onUpdatedWithMemory 事件反复调用
 */
function handleProcessUpdate(processes) {
    // Reconnect if needed
    if (!ws || ws.readyState === WebSocket.CLOSED) connectWebSocket();

    // Prepare JSON payload matching what PerfSight expects (similar to Python Sidecar)
    const metricsPayload = {};

    for (const internalId in processes) {
        const proc = processes[internalId];
        const pid = proc.osProcessId;

        // Some process entries may not have a stable OS PID (0/undefined) on some platforms/updates.
        // Skip them to avoid mixing keys and causing chart gaps/spikes.
        if (!Number.isFinite(pid) || pid <= 0) continue;

        // Chrome API provides:
        // cpu: double (percentage)
        // privateMemory: double (bytes)

        // Convert to format: { cpu: %, memory: MB }
        const cpu = Number.isFinite(proc.cpu) ? proc.cpu : 0.0;
        const priv = Number.isFinite(proc.privateMemory) ? proc.privateMemory : 0;
        metricsPayload[pid] = {
            cpu: cpu,
            // PerfSight websocket expects memory in MB.
            memory: priv / (1024 * 1024)
        };
    }

    // Send to PerfSight
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: "data", // Matches Python sidecar 'type'
            timestamp: Date.now(),
            metrics: metricsPayload
        };
        ws.send(JSON.stringify(message));
    }

    console.clear();
    console.log(`--- Real-time Process Update [${new Date().toLocaleTimeString()}] ---`);
    console.log(`📡 Sending ${Object.keys(metricsPayload).length} process metrics to PerfSight...`);

    const header = `OS PID`.padEnd(12) + `| Type`.padEnd(16) + `| CPU`.padEnd(10) + `| Memory (Private)`.padEnd(20) + `| Tasks`;
    console.log(header);
    console.log('-'.repeat(header.length + 30));

    // 遍历返回的进程字典
    for (const internalId in processes) {
        const proc = processes[internalId];

        const pid = proc.osProcessId.toString().padEnd(12);
        const type = proc.type.padEnd(16);
        // 尝试获取 CPU
        const cpu = formatCpu(proc.cpu).padEnd(10);
        // 尝试获取内存
        const memory = formatMemory(proc.privateMemory).padEnd(20);

        let taskDescriptions = [];
        if (proc.tasks && Array.isArray(proc.tasks)) {
            taskDescriptions = proc.tasks.map(task => {
                // 优先显示标签页标题，如果是扩展则显示扩展名或ID
                return task.title || (task.extensionId ? `Ext: ${task.extensionId.substring(0, 8)}...` : 'Unknown Task');
            });
        }

        let taskStr = taskDescriptions.join(', ');
        if (taskStr.length > 100) {
            taskStr = taskStr.substring(0, 100) + '...';
        }

        console.log(`${pid}| ${type}| ${cpu}| ${memory}| ${taskStr}`);
    }
}


// ==========================================
// 新的架构：完全基于事件监听 (全量数据版)
// ==========================================

try {
    // 1. 注册监听器。
    // 【关键修改】使用 onUpdatedWithMemory 替代 onUpdated
    // 这个频道确保推送的数据包中包含 privateMemory 字段。
    chrome.processes.onUpdatedWithMemory.addListener(handleProcessUpdate);
    console.log("onUpdatedWithMemory listener registered successfully (Full data channel active).");

    // 2. 首次手动触发。
    // 获取一次全量快照以便立刻显示初始状态。
    chrome.processes.getProcessInfo([], true, (data) => {
        if (chrome.runtime.lastError) {
            console.error("Initial fetch failed:", chrome.runtime.lastError);
        } else {
            console.log("Initial fetch successful. Waiting for updates...");
            handleProcessUpdate(data);
        }
    });

} catch (err) {
    console.error("Fatal Error setting up listeners:", err);
    console.warn("请确保当前 Chrome 版本支持 chrome.processes API，并已启用相关实验性标志。");
}