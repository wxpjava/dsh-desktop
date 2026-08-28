# DeepSeek Harness Desktop — Mac 打包说明

> 在 **macOS 上**重新组装内置 host 并打出 `.dmg` 安装包。Windows 的 `.exe` 安装包**不能**用于 Mac（内置 Node 与原生依赖都是平台绑定的），必须在 Mac 机器上执行本流程。

---

## 一、前置条件

| 项目 | 要求 | 检查命令 |
| --- | --- | --- |
| 操作系统 | macOS 11（Big Sur）或更高 | `sw_vers` |
| Node.js | 18+（建议 22.x） | `node -v` |
| npm | 随 Node 自带 | `npm -v` |
| pnpm | 8+（checkout 构建用） | `pnpm -v` |
| Xcode Command Line Tools | 原生模块编译需要 | `xcode-select -p` |

### 安装依赖（缺什么装什么）

```bash
# Node（未安装时，三选一）
brew install node                       # 方式 1：Homebrew
# 或到 https://nodejs.org 下载 pkg 安装   # 方式 2：官方安装包

# pnpm
npm install -g pnpm

# Xcode Command Line Tools（原生模块 node-pty / koffi 编译需要）
xcode-select --install
```

---

## 二、准备源码

需要两个目录：

1. **dsh-desktop**（本仓库，桌面壳）
2. **DSH checkout**（`@deepseek-ai/dsh-root`，源码仓库，用于组装 host）

```bash
# 进入桌面壳目录，安装依赖（下载 Electron 与 electron-builder）
cd dsh-desktop
npm install
```

---

## 三、一键打包

```bash
npm run rebuild -- --checkout "/Users/你的用户名/DeepSeek Harness"
```

> 等价写法：`node scripts/rebuild.cjs --checkout "/Users/你的用户名/DeepSeek Harness"`

脚本会自动完成：

1. **组装 host**：在 checkout 里跑 `pnpm run build:official` → 打包 dsh/vendor → `npm install` 进 `host/` → 下载 **Darwin 版** Node → 验证版本
2. **打包**：electron-builder 产出 `.dmg` 与 `.zip`（arm64 + x64 两个架构）

> ⚠️ `rebuild` 默认 checkout 是 Windows 路径 `D:\develop\DeepSeek Harness`，在 Mac 上**必须**用 `--checkout` 指定；或先 `export DSH_DESKTOP_DSH_CHECKOUT="/你的/checkout"`。

---

## 四、产物位置

打包完成后，产物在 `dsh-desktop/dist/` 下：

| 文件 | 说明 |
| --- | --- |
| `DeepSeek Harness Desktop 0.1.0 arm64.dmg` | Apple Silicon（M 系列）安装镜像 |
| `DeepSeek Harness Desktop 0.1.0 x64.dmg` | Intel Mac 安装镜像 |
| `DeepSeek Harness Desktop 0.1.0 arm64.zip` | Apple Silicon 便携版 |
| `DeepSeek Harness Desktop 0.1.0 x64.zip` | Intel 便携版 |

---

## 五、安装与首次打开

1. 双击对应架构的 `.dmg`；
2. 把 **DeepSeek Harness Desktop** 拖入 **Applications**；
3. 首次打开时，因应用**未签名**，Gatekeeper 会拦截。

### 绕过 Gatekeeper（任选其一）

**方法 A —— 右键打开（最简单）**
在「应用程序」里 **右键** App → **「打开」** → 弹窗里再点 **「打开」**（首次之后即可正常双击启动）。

**方法 B —— 命令行解除隔离标记**
```bash
xattr -cr "/Applications/DeepSeek Harness Desktop.app"
```

**方法 C —— 系统设置放行**
「系统设置 → 隐私与安全性」拉到最下方，点 **「仍要打开」**。

---

## 六、常见问题

### 1. 原生模块编译失败（node-gyp / node-pty / koffi 报错）

先确认 Xcode Command Line Tools 已装：
```bash
xcode-select --install
```
若仍失败，尝试在 `dsh-desktop` 目录设置原生构建开关后重试（会触发源码编译）：
```bash
export DSH_DESKTOP_HOST_BUILD_NATIVE=1
npm run rebuild -- --checkout "/你的/checkout"
```

### 2. 打出来的包架构不对

- M 系列 Mac 用 `arm64`，Intel Mac 用 `x64`；
- 若只想打当前机器架构，把 `package.json` 里 `mac.target` 的 `arch` 改成 `["arm64"]` 或 `["x64"]`。

### 3. `rebuild` 找不到 checkout

报 `找不到 checkout` 时，确认 `--checkout` 指向的是 `package.json` 里 `name` 为 `@deepseek-ai/dsh-root` 的目录。

### 4. 想要正式分发（无 Gatekeeper 拦截）

需要 Apple 开发者账号做**签名 + 公证**，把 `package.json` 中 `mac.identity` 从 `null` 改为你的证书名，并配置公证（设置环境变量 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 后由 electron-builder 自动处理）。
