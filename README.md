# dsh-desktop

DeepSeek Harness 的桌面外壳：启动本地 `dsh` host，把它的 Web GUI 装进原生窗口。本质是「Electron 壳 + 本地 host」，不修改 DSH 本身；可进一步把 host 一起打进安装包，做到双击即用、无需预装 Node/dsh。

## 原理

- DSH 是「本地 host + 浏览器 UI」结构，UI 不是独立应用（依赖 host 注入的 `window.__DSH_BOOT__`）。
- 壳在 Electron 主进程里 spawn 出 host（`… web --no-open --port 0`），解析它打印的 `dsh web: http://…` 得到真实端口，再把窗口指向这个 URL。
- host 来源按优先级：**userData/host 覆盖层** → **内置 host**（`<app>/resources/host/`）→ 环境变量 `DSH_DESKTOP_HOST_CMD` → 已保存配置 → 自动探测（PATH 上的 `dsh`，或 checkout 的 `pnpm dsh`）→ 首次运行选择框。
- 关窗/退出用 `taskkill /T /F`（Windows）回收整个 host 进程树。

## 前置条件

- 一个可用的 `dsh`：全局安装，或仓库 checkout（`pnpm dsh`）。
- （仅打包内置 host 时）DSH 仓库 checkout + pnpm + Node `^22.19 || >=24`。

## 开发运行（用系统 dsh）

```powershell
cd dsh-desktop
npm install                       # 下载 Electron 二进制 + 依赖
$env:DSH_DESKTOP_HOST_CMD = "pnpm dsh"
$env:DSH_DESKTOP_CWD = "D:\develop\DeepSeek Harness"
npm start
```

无头冒烟测试（不启动 Electron，只验证 host 启动/URL 检测/HTTP 可达）：

```powershell
$env:DSH_DESKTOP_HOST_CMD = "pnpm dsh"
$env:DSH_DESKTOP_CWD = "D:\develop\DeepSeek Harness"
npm run smoke
```

## 首次运行引导与托盘

- **首次运行**：没有内置 host、也没设环境变量时，壳按「自动探测 → 选择框」定位 host。选择框支持选「dsh 可执行文件」或「DSH checkout 目录（用 pnpm dsh 启动）」，结果保存到 `userData/host-config.json`，下次直接复用。
- **重新选择**：菜单 `File → 重新选择 DSH host…`，保存后重启生效。
- **托盘**：运行时常驻托盘图标（运行时程序化生成 PNG），左键显示窗口，右键菜单「显示 / 退出」。**关闭窗口会最小化到托盘**（host 继续后台运行），真正退出请用托盘右键「退出」或菜单 `File → Quit`。（未做开机自启。）

## 打包内置 host（第 1 项：双击即用、无需预装 Node/dsh）

### 一键打包（推荐）

双击 **`一键打包.bat`**，在菜单中选择：

1. **本地源码打包** — 使用本机 DSH checkout（首次会提示填写路径，写入 `pack-config.json`，下次默认复用，可选「3」修改）
2. **远程源码打包** — 从 GitHub 克隆/更新稳定 tag（默认 `dsh-v0.1.1-rc.2`）再打包
3. **修改本地源码路径** — 只改保存的 checkout，不立刻打包

等价命令：

```powershell
npm run rebuild -- --checkout "D:\develop\DeepSeek Harness"   # 本地
npm run rebuild:remote                                         # 远程
node scripts/rebuild-all.cjs --mode local --skip-host          # 只打安装包
node scripts/rebuild-all.cjs --mode local --skip-dist          # 只组装 host
```

> 前置：系统需有 pnpm（checkout 构建用）与 npm；`.npmrc` 已配置国内镜像。  
> 路径也可通过环境变量 `DSH_DESKTOP_DSH_CHECKOUT` 覆盖。

### 桌面版：一键更新内置 Host

菜单 **`File → 一键更新内置 Host…`**（托盘菜单同样有入口）：

- 从**已保存本地源码**或**远程稳定版**重新组装 Host
- 写入 `%APPDATA%\dsh-desktop\host` 覆盖层（不改安装目录、不重新打安装包）
- 完成后可立即重启以加载新 Host
- 需要本机 **Node + pnpm**；远程模式还需要 **git**

Host 解析优先级：`userData/host` 覆盖层 → 安装包内 `resources/host` → 系统 dsh。

---

下面三步是手动分步流程（等价于 `rebuild` 的 1/2 步），便于排障或只重做其中某一步：

### 1) 组装 `host/`

`host/` 目录 = Node 运行时 + 生产依赖安装的 `@deepseek-ai/dsh`（含全部插件与前端 `dist/`）。

**方式 A —— 从 npm registry**（前提：`@deepseek-ai/dsh` 已发布到 npm）：

```powershell
node scripts/package-host.cjs --registry 0.1.1-rc.2
```

**方式 B —— 从 checkout 自包含打包**（不依赖 registry，最可靠）：

```powershell
$env:DSH_DESKTOP_DSH_CHECKOUT = "D:\develop\DeepSeek Harness"
npm run package:host
```

这会在 checkout 里跑 `pnpm run build:official`，再 `pack` 出 `dsh` + `vendor` 两族 tgz，用 `file:` 依赖一次性 `npm install` 进 `host/`（只对第三方依赖走网络），最后下载 Node 运行时。首次较慢（完整构建）。

也可以用 `--tarballs <目录>` 指定已打包好的 tgz 目录（可多次），跳过构建。

### 2) 打包安装包

```powershell
npm run dist
```

electron-builder 会把 `host/` 作为 `extraResources` 打进 `resources/host/`，产出 Windows NSIS 安装包（`dist/` 下）。

### 3) 运行安装后的程序

安装后双击启动，壳会检测到内置 host 并优先使用它（`host/node/node.exe host/node_modules/@deepseek-ai/dsh/lib/bin.js web …`），**无需系统里装 Node 或 dsh**。若删掉内置 host 目录，则回退到系统 `dsh`。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_DESKTOP_HOST_CMD` | `dsh` | 系统 host 命令行（内置 host 存在时被忽略） |
| `DSH_DESKTOP_CWD` | 当前目录 | 系统 host 的工作目录 |
| `DSH_DESKTOP_PORT` | `0`（OS 自动选） | 显式指定端口 |
| `DSH_DESKTOP_TIMEOUT_MS` | `60000` | 等待 host 就绪超时 |
| `DSH_DESKTOP_DSH_CHECKOUT` | — | 自动探测的 checkout 提示路径；也是 package-host 的 checkout 路径 |
| `DSH_DESKTOP_TARBALLS` | — | `;` 分隔的已打包 tgz 目录 |
| `DSH_DESKTOP_REGISTRY` | — | package-host 的 registry 版本 |
| `DSH_DESKTOP_NODE_VERSION` | `22.19.0` | 内置 Node 版本 |
| `DSH_DESKTOP_NODE_MIRROR` | — | Node 下载镜像 base（默认 nodejs.org，失败自动回退 npmmirror） |

## 已知注意点

- **原生模块**：`@deepseek-ai/dsh` 依赖 `node-pty`、`koffi` 等原生模块。方式 B 在干净环境 `npm install` 时若没有预编译产物，可能需要编译工具链（Windows 上 Visual Studio Build Tools / node-gyp）。可先在目标机器验证 `host/node/node.exe host/node_modules/@deepseek-ai/dsh/lib/bin.js --version`。
- **体积**：Electron + 内置 Node + host 依赖，安装包会明显偏大（数百 MB 量级）。
- **host 版本与壳解耦**：安装包内 host 是打包时快照；可用菜单「一键更新内置 Host」写入用户目录覆盖层，或重新 `一键打包.bat` 生成新安装包。

## 给 Web GUI 的钩子

预加载脚本暴露 `window.dshDesktop`（`{ isDesktop, platform, versions }`），前端可据此判断自己跑在桌面壳里（当前为最小占位）。
