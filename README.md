# luci-app-rathole

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![OpenWrt Version](https://img.shields.io/badge/OpenWrt-21.02%20%7C%2022.03%20%7C%2023.05%20%7C%2024.10%2B-brightgreen.svg)](https://openwrt.org)
[![iStoreOS](https://img.shields.io/badge/iStoreOS-Supported-blue.svg)](https://istoreos.com)
[![Release](https://img.shields.io/badge/Release-v1.0.0-blue.svg)](https://github.com/openif/luci-app-rathole/releases)

适用于 OpenWrt / iStoreOS 路由器的 [Rathole](https://github.com/rapiz1/rathole) NAT 穿透反向代理 LuCI Web 管理插件。

[简体中文](#简体中文) | [English](#english)

---

<a name="简体中文"></a>
## 简体中文

### 为什么需要这个插件？

当您在家庭或工作环境中的宽带没有公网 IP 时，通常无法直接从外网连接路由器和局域网设备。
通过配合一台拥有公网 IP 的云服务器（VPS），`luci-app-rathole` 可以帮您将：
* 路由器的 Web 管理后台（HTTP / HTTPS）
* 路由器的 SSH 终端
* 局域网内的 NAS、群晖、打印机或 Windows 远程桌面 (RDP)
* 其他内网 TCP / UDP 服务

通过加密隧道映射到公网 VPS 端口上，在外网随时随地直接访问。

---

### 前置准备

在开始使用前，您需要准备：
1. **一台运行 OpenWrt 或 iStoreOS 的路由器**（已正常接入互联网）；
2. **一台具有独立公网 IP 的云服务器（VPS）**（如阿里云、腾讯云、华为云、AWS 或轻量应用服务器等）；
3. **确认云服务器防火墙规则**：在云服务器控制台的“安全组 / 防火墙”中，提前放行 Rathole 所需的端口（例如控制通信端口 `2333`，以及您计划对外开放的业务端口如 `8443` 或 `8080`）。

---

### 安装步骤

#### 步骤一：安装 Rathole 核心运行程序
本插件为 LuCI Web 控制面板，后台依赖 Rust 编写的 `rathole` 核心二进制程序。
由于官方 OpenWrt 软件源通常未收录 `rathole`，请先下载适合您路由器 CPU 架构的预编译程序：

1. 前往 [Rathole Releases](https://github.com/rapiz1/rathole/releases) 下载对应架构压缩包：
   * x86_64 软路由：下载 `rathole-x86_64-unknown-linux-musl.zip`
   * ARM64 路由器（如常见高端 WiFi6 路由器）：下载 `rathole-aarch64-unknown-linux-musl.zip`
   * MIPS 架构路由器：下载对应 mips 架构压缩包
2. 解压得到名为 `rathole` 的二进制文件；
3. 上传到路由器的 `/usr/bin/rathole` 并赋予执行权限：
   ```bash
   chmod +x /usr/bin/rathole
   ```
*(您也可以在插件界面的“常规设置”中自定义程序路径)*

#### 步骤二：安装 Web 界面插件

**方式 A：终端一键在线安装（推荐）**
通过 SSH 登录路由器后台终端，运行以下命令即可全自动安装插件与语言包：
```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/openif/luci-app-rathole/main/install.sh)"
```

**方式 B：手动下载 IPK 安装**
1. 前往 [Releases 页面](https://github.com/openif/luci-app-rathole/releases) 下载最新版的两个安装包：
   * `luci-app-rathole_1.0.0-1_all.ipk`（主程序）
   * `luci-i18n-rathole-zh-cn_1.0.0-1_all.ipk`（简体中文语言包）
2. 登录路由器网页后台，进入 **系统** > **软件包**（或 **iStore** 应用商店）-> 点击 **上传软件包** 依次安装；
3. 或通过命令行安装：
   ```bash
   opkg install /tmp/luci-app-rathole_*.ipk /tmp/luci-i18n-rathole-zh-cn_*.ipk
   ```

安装完成后刷新网页，在 **服务** 菜单下即可看到 **Rathole**。

---

### 快速配置指引（以映射路由器后台 443 端口为例）

假设您的 VPS 公网 IP 为 `198.51.100.1`（或域名 `vps.example.com`），计划将本地路由器的 HTTPS `443` 端口穿透到 VPS 的 `8443` 端口。

#### 1. 路由器端配置（OpenWrt LuCI）
进入 **服务 -> Rathole -> 基本设置**：
1. **启用**：勾选；
2. **运行模式**：选择 `客户端模式`；
3. **服务端公网地址**：填入 `198.51.100.1:2333`（或 `vps.example.com:2333`）*(VPS_IP:控制端口)*；
4. **默认认证密钥 (Token)**：输入一个用于认证的密钥，如 `MySecretToken123`；
5. *(可选安全加密)* **启用 Noise 传输加密**：勾选后点击【生成密钥对】，复制弹出的“服务端私钥”，然后点击【应用服务端公钥到客户端】；
6. 在下方 **服务映射列表** 点击 **【添加】**：
   * 服务名称：填入 `router_https` *(必须为纯英文字母/数字/下划线)*
   * 协议类型：`TCP`
   * 本地地址：`10.0.0.1:443`
   * VPS 映射端口：`8443`
   * 启用：勾选
7. 点击右下角 **【保存并应用】**。

#### 2. VPS 服务端配置
在 VPS 上运行 Rathole 服务端有多种方式。您可以在路由器界面顶部点击 **【导出配套 VPS 配置】**，直接按需选择并复制：

* **方式一：Docker 运行（推荐）**
  在 VPS 上创建目录并在 `/etc/rathole/server.toml` 保存配置文件后，执行：
  ```bash
  docker run -d \
    --name rathole \
    --restart always \
    --net=host \
    -v /etc/rathole/server.toml:/app/config.toml \
    rapiz1/rathole:latest --server /app/config.toml
  ```

* **方式二：直接以守护进程运行**
  1. 在 VPS 上编写 `/etc/rathole/server.toml`：
     ```toml
     [server]
     bind_addr = "0.0.0.0:2333"
     default_token = "MySecretToken123"
     heartbeat_interval = 30

     # 如启用了 Noise 加密，加入以下配置：
     # [server.transport]
     # type = "noise"
     # [server.transport.noise]
     # pattern = "Noise_NK_25519_ChaChaPoly_BLAKE2s"
     # local_private_key = "刚才复制的服务端私钥"

     [server.services.router_https]
     type = "tcp"
     bind_addr = "0.0.0.0:8443"
     ```
  2. 启动服务：
     ```bash
     rathole --server /etc/rathole/server.toml
     ```

#### 3. 访问测试
在任意外部网络（如手机流量），打开浏览器访问：
👉 `https://198.51.100.1:8443`（或 `https://vps.example.com:8443`）
即可直接进入家里的 OpenWrt / iStoreOS 管理后台。

---

### 常见问题与排障指南 (FAQ)

#### Q1: 外网打不开网页，排查顺序是什么？
1. **在路由器端测试连通性**：在插件状态卡片中点击【连通性测试】，观察 Ping 延迟。若提示无法连通，说明路由器连接该 VPS 存在网络障碍；
2. **检查云服务器安全组/防火墙**：确认云服务商控制台（阿里云/腾讯云等）是否已将控制通信端口（如 `2333`）和对外业务端口（如 `8443`）加入安全组入站规则；
3. **查看路由器日志**：进入 **服务 -> Rathole -> 运行日志**，若日志末尾显示 `Control channel established`，说明客户端与服务端已成功接通。

#### Q2: 浏览器打开提示“您的连接不是私密连接 / 证书不受信任”？
这是正常现象。因为路由器后台默认使用局域网内签发的 SSL 证书（未绑定公网权威域名机构）。
只需在浏览器拦截页面点击 **“高级”** -> **“继续前往 (不安全)”** 即可进入后台页面。

#### Q3: 客户端与服务端的端口是怎么对应的？
Rathole 出于安全性设计，客户端无法单方面决定服务端开放什么端口。
**服务名称（Service Name）是两端绑定的唯一依据**：
* 客户端声明：`[client.services.router_https]` 本地地址为 `10.0.0.1:443`；
* 服务端声明：`[server.services.router_https]` 对外开放 `0.0.0.0:8443`；
只要两端配置节名字完全一致且 Token 正确，Rathole 就会自动把 VPS 的 `8443` 端口流量转发给路由器的 `443`。

---

### 功能特性

* **运行状态监控**：实时查看进程 PID、运行状态、目标服务器及当前活动服务统计；
* **一键连通性测试**：集成 Ping 延迟探针与网络诊断建议，快速定位网络与安全组问题；
* **多形态 VPS 配置导出**：一键生成 `server.toml`、`Docker Run`、`Docker Compose` 及 `Systemd 单元文件`；
* **Noise 传输加密**：支持端到端数据传输加密，内置 X25519 密钥对生成器与一键公钥填入；
* **端口冲突校验**：服务映射表格自动校验同协议下重复绑定的远程端口；
* **运行日志工作台**：支持实时关键字过滤搜索、错误/警告统计、日志截断保护；
* **原生 TOML 模式**：保留高级用户自定义 TOML 自由度，并提供常用预置模板一键载入。

---

<a name="english"></a>
## English

### Overview

`luci-app-rathole` is a LuCI web management interface designed for OpenWrt and iStoreOS routers to configure and run [Rathole](https://github.com/rapiz1/rathole), a reverse proxy written in Rust for NAT traversal.

It helps you securely expose local router web interfaces, SSH terminals, NAS devices, or LAN services to a public VPS without needing a public IPv4 address on your home broadband.

---

### Prerequisites

1. An OpenWrt or iStoreOS router with internet access.
2. A cloud VPS with a dedicated public IP address.
3. Firewall / Cloud Security Group rules configured to allow your chosen Rathole ports (e.g., control port `2333` and service ports such as `8443` or `8080`).

---

### Installation

#### Step 1: Install `rathole` Binary
Download the pre-compiled binary matching your router architecture from [Rathole Releases](https://github.com/rapiz1/rathole/releases):
* x86_64: `rathole-x86_64-unknown-linux-musl.zip`
* ARM64: `rathole-aarch64-unknown-linux-musl.zip`

Extract and place the binary at `/usr/bin/rathole`:
```bash
chmod +x /usr/bin/rathole
```

#### Step 2: Install LuCI Package

**Option A: 1-Click Online Installer**
```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/openif/luci-app-rathole/main/install.sh)"
```

**Option B: Manual IPK Installation**
Download the latest packages from [Releases](https://github.com/openif/luci-app-rathole/releases):
* `luci-app-rathole_1.0.0-1_all.ipk`
* `luci-i18n-rathole-zh-cn_1.0.0-1_all.ipk`

Install via command line:
```bash
opkg install /tmp/luci-app-rathole_*.ipk /tmp/luci-i18n-rathole-zh-cn_*.ipk
```
Or upload via **System -> Software** in LuCI.

---

### Key Features

* **Status Dashboard**: Live process indicator, PID tracking, and target server display.
* **Network Diagnostics**: Built-in ping latency probe for troubleshooting VPS reachability.
* **Multi-Platform VPS Export**: One-click generation of `server.toml`, `docker run`, `docker-compose.yml`, and `systemd service` files.
* **Noise Protocol Encryption**: Built-in X25519 keypair generator with one-click public key auto-fill.
* **Port Conflict Validation**: Prevents duplicate remote port assignments under the same protocol.
* **Runtime Log Console**: Real-time keyword filter, error/warning count indicators, and log download.
* **Raw Mode Support**: Includes template quick-loaders for custom configurations.

---

### License

Licensed under the [Apache License, Version 2.0](LICENSE).
