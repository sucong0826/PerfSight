# 技术方案设计：ChromeOS Native Performance Profiler (CNPP)

> **版本:** v1.0  
> **日期:** 2023-10  
> **目标:** 构建基于 Rust 的双通道性能测试工具，实现 ChromeOS 上页面级与宿主机系统级指标的精确关联。

---

## 1. 背景与核心挑战

在 ChromeOS 平台上进行深度性能测试时，现有的基于 Crostini (Linux 容器) 的工具链面临严重的**隔离性挑战**：

* **现状 (As-Is):** 在 Crostini 容器内运行 `top` 或 `htop`，仅能观测到容器内的进程。
* **痛点:** 无法观测宿主机 (Host) 上的 `chrome` 主进程、GPU 进程及渲染进程的真实资源开销。这导致测试人员只能依赖人工操作 Crosh (Ctrl+Alt+T) 进行肉眼观测，无法自动化。
* **目标 (To-Be):** 开发一款 Native 工具，既能通过 CDP 获取页面指标，又能“穿透”容器获取宿主机的精确进程数据 (类似 Crosh 环境)。

---

## 2. 系统架构设计

本方案采用 **Rust** 编写，利用 **双通道 (Dual-Channel)** 架构来同步采集数据。

### 2.1 架构拓扑

```mermaid
graph TD
    subgraph "Crostini Container (Runner Env)"
        Tool[Rust CNPP Binary]
        Merger[Data Aggregator]
    end

    subgraph "ChromeOS Host (System)"
        Chrome[Chrome Browser]
        ProcFS["/proc Filesystem"]
        SSH_D[SSH Daemon (Port 2222)]
    end

    %% Channel 1: CDP
    Tool --"Channel A: WebSocket (CDP)"--> Chrome
    
    %% Channel 2: System
    Tool --"Channel B: SSH Tunnel"--> SSH_D
    SSH_D --"Read"--> ProcFS

    %% Internal Data Flow
    Tool --> Merger