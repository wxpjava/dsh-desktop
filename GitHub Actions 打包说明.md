# DeepSeek Harness Desktop — GitHub Actions 打包说明

> 用 GitHub 的 **macOS 云主机**（免费额度）自动打出 Mac 版 `.dmg` / `.zip`，**全程不需要本地 Mac**。原理：把打包流程写成 CI workflow，推代码后在云端「组装 Mac host → 打包 → 上传产物」。

---

## 一、方案概述

- **能解决什么**：本地是 Windows，无法直接产出 Mac 包（Mac 包的 Node 运行时与原生依赖必须是 macOS 环境生成的）。
- **流程**：把 `dsh-desktop` 推上 GitHub → 在 Actions 页面手动触发 → CI 自动完成打包 → 下载产物发给 Mac 用户。
- **产物**：`mac-arm64`（M 系列）、`mac-x64`（Intel）两组，每组含 `.dmg` + `.zip`。

---

## 二、前置条件

| 项目 | 说明 |
| --- | --- |
| GitHub 账号 | 免费账号即可 |
| 本机 git | 用于推送代码 |
| DSH 源码 | 已在公开仓库 `github.com/deepseek-ai/deepseek-harness`，CI 直接 clone |

---

## 三、部署（一次性）

### 1. 把 `dsh-desktop` 变成 git 仓库

```powershell
cd D:\wkSpace\个人\兴趣\个人研究\dsh-desktop
git init
git add .
git commit -m "init dsh-desktop"
```

> `.gitignore` 已排除 `host/`、`node_modules/`、`dist/`、`.npm-cache/` 等大目录，只会提交源码与配置。

### 2. 在 GitHub 新建仓库

1. 登录 github.com → 右上角 **+** → **New repository**；
2. 仓库名填 `dsh-desktop`（或任意名），选 **Private** 或 **Public**；
3. **不要**勾选「Initialize this repository with a README」（保持空仓库）。

### 3. 推送

```powershell
git remote add origin https://github.com/你的用户名/dsh-desktop.git
git branch -M main
git push -u origin main
```

推送成功后，仓库里会出现 `.github/workflows/build-mac.yml`，workflow 自动就绪。

---

## 四、触发打包

### 方式 A —— 手动触发（推荐）

1. 仓库页面点 **Actions** 标签；
2. 左侧选 **Build macOS (dmg + zip)**；
3. 右侧 **Run workflow** → 绿色 **Run workflow** 按钮。

### 方式 B —— 打 tag 自动触发

```powershell
git tag v0.1.0
git push origin v0.1.0
```

推 `v*` 开头的 tag 会自动触发一次打包。

---

## 五、下载产物

1. 等 Actions 页面两个 job（`arm64`、`x64`）跑完（首次约 10~20 分钟）；
2. 页面底部 **Artifacts** 区有 `mac-arm64`、`mac-x64` 两个下载项；
3. 下载后解压，得到对应架构的 `.dmg` 与 `.zip`，即可发给 Mac 用户。

> Mac 用户安装与 Gatekeeper 绕过方法见 [Mac打包说明.md](Mac打包说明.md)。

---

## 六、workflow 做了什么

每个架构一个 job（`macos-14` = arm64，`macos-13` = x64），流程一致：

1. **Checkout** dsh-desktop 源码；
2. **装 Node 22 + pnpm**；
3. **clone** DSH 源码（公开仓库，浅克隆）；
4. **pnpm install** 安装 DSH 依赖；
5. **npm install** 安装桌面壳依赖（Electron 等）；
6. **rebuild**：组装该架构的 Mac host（下载 Darwin Node + 装原生依赖）→ electron-builder 打 `.dmg` + `.zip`；
7. **upload-artifact** 上传产物。

---

## 七、常见问题

### 1. 首次跑很慢
正常。首次要 `pnpm install`（DSH 依赖多）+ `build:official`（完整构建）+ 下载 Node/Electron。之后有缓存会明显变快。

### 2. 打的是 GitHub 上的 DSH，不是我本地改的
CI clone 的是 `deepseek-harness` 仓库的 `master`。若你改过 DSH 源码，需要先 fork 官方仓库、push 你的改动，再把 workflow 里的 clone 地址改成你的 fork。

### 3. 只想要 arm64（M 系列）
删除 `.github/workflows/build-mac.yml` 里 `matrix.include` 中的 `x64` 那一项即可。

### 4. 私有化 / 换 DSH 来源
若以后 DSH 仓库变成私有，把 workflow 里 clone 步骤改为带 token：
```yaml
run: git clone --depth 1 https://x-access-token:${{ secrets.DSH_REPO_TOKEN }}@github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
```
并在仓库 Settings → Secrets 里配 `DSH_REPO_TOKEN`。

### 5. 顺便打 Windows 包
本地已有 `一键打包.bat`；如需 CI 也打 Windows，可仿照 `build-mac.yml` 增加一个 `runs-on: windows-latest` 的 job。
