'use strict'

const { app, BrowserWindow, dialog, Menu, nativeImage, Notification, shell, Tray, nativeTheme } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const spawn = require('cross-spawn')
const { launchHost, resolveBundledLaunch } = require('./host-launcher.cjs')
const hostConfig = require('./host-config.cjs')
const packConfig = require('./scripts/pack-config.cjs')
const { whichOnPath } = require('./scripts/rebuild-shared.cjs')
const { writeBadge } = require('./tray-icon.cjs')

let mainWindow = null
let host = null
let tray = null
let quitting = false
let trayHintShown = false
let updatingHost = false

// Match the dark web UI: native Windows title bar follows system theme unless forced.
nativeTheme.themeSource = 'dark'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(start)
}

function packConfigDir() {
  return app.getPath('userData')
}

function scriptsDir() {
  const base = app.getAppPath()
  // System Node cannot read Electron asar; prefer asarUnpack path.
  const unpacked = base.includes(`${path.sep}app.asar`)
    ? base.replace(`${path.sep}app.asar`, `${path.sep}app.asar.unpacked`)
    : (base.endsWith('app.asar') ? `${base}.unpacked` : null)
  if (unpacked) {
    const candidate = path.join(unpacked, 'scripts')
    if (fs.existsSync(path.join(candidate, 'update-host.cjs'))) return candidate
  }
  return path.join(base, 'scripts')
}

async function start() {
  Menu.setApplicationMenu(buildMenu())
  try {
    const launch = await resolveLaunch()
    if (!launch) {
      app.quit()
      return
    }
    host = launchHost(launch)

    // If the host dies after startup, surface it instead of showing a dead page.
    host.child.on('exit', (code, signal) => {
      if (updatingHost) return
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox('DeepSeek Harness Desktop', `The local host exited unexpectedly (code=${code}, signal=${signal}).`)
      }
      host = null
      app.quit()
    })

    const url = await host.ready
    createTray()
    createWindow(url)
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    dialog.showErrorBox('DeepSeek Harness Desktop', `Failed to start the local host:\n${message}`)
    app.quit()
  }
}

/**
 * Resolve how to launch the host, in priority order:
 *   bundled host (userData override → install/dev host) → env → saved → detect → picker.
 */
async function resolveLaunch() {
  const bundled = resolveBundledLaunch({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    userDataPath: app.getPath('userData'),
  })
  if (bundled) return bundled

  const env = hostConfig.envLaunch()
  if (env) return { ...env, bundled: false }

  const saved = hostConfig.readConfig(app.getPath('userData'))
  if (saved) return { ...saved, bundled: false }

  const detected = hostConfig.detect()
  if (detected) {
    hostConfig.writeConfig(app.getPath('userData'), detected)
    return { ...detected, bundled: false }
  }

  const picked = await pickHost()
  if (!picked) return null
  hostConfig.writeConfig(app.getPath('userData'), picked)
  return { ...picked, bundled: false }
}

/** Onboarding dialog: pick a `dsh` executable or a DSH checkout directory. */
async function pickHost() {
  const choice = await dialog.showMessageBox({
    type: 'info',
    title: 'DeepSeek Harness Desktop',
    message: '未找到可用的 DeepSeek Harness',
    detail: '请选择 dsh 可执行文件，或选择 DSH 仓库 checkout 目录（将用 pnpm dsh 启动）。',
    buttons: ['选择 dsh 可执行文件…', '选择 checkout 目录…', '取消'],
    defaultId: 0,
    cancelId: 2,
  })
  if (choice.response === 2) return null

  const pickingFile = choice.response === 0
  const result = await dialog.showOpenDialog({
    title: pickingFile ? '选择 dsh 可执行文件' : '选择 DSH checkout 目录',
    properties: pickingFile ? ['openFile'] : ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  if (pickingFile) return { program: result.filePaths[0], baseArgs: [], cwd: process.cwd() }
  return { program: 'pnpm', baseArgs: ['dsh'], cwd: result.filePaths[0] }
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: 'DeepSeek Harness',
    backgroundColor: '#111418',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) shell.openExternal(target)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== new URL(url).origin) {
        event.preventDefault()
        shell.openExternal(target)
      }
    } catch { /* ignore unparseable URLs */ }
  })

  mainWindow.loadURL(url)

  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow.hide()
      notifyHiddenToTray()
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

function showWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function notifyHiddenToTray() {
  if (trayHintShown) return
  trayHintShown = true
  try {
    new Notification({
      title: 'DeepSeek Harness 仍在运行',
      body: '已最小化到托盘，点击托盘图标可重新打开。',
    }).show()
  } catch { /* notification unavailable */ }
}

function createTray() {
  if (tray) return
  try {
    const iconPath = path.join(app.getPath('userData'), 'tray.png')
    writeBadge(iconPath, 32)
    tray = new Tray(nativeImage.createFromPath(iconPath))
    tray.setToolTip('DeepSeek Harness Desktop')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 DeepSeek Harness', click: () => showWindow() },
      { type: 'separator' },
      { label: '一键更新内置 Host…', click: () => { void updateBundledHost() } },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]))
    tray.on('click', () => showWindow())
  } catch { /* tray unavailable */ }
}

async function reconfigureHost() {
  const picked = await pickHost()
  if (!picked) return
  hostConfig.writeConfig(app.getPath('userData'), picked)
  await dialog.showMessageBox({
    type: 'info',
    title: 'DeepSeek Harness Desktop',
    message: '已保存新的 host 配置。',
    detail: '重启应用后生效。',
    buttons: ['好'],
  })
}

async function pickOrSaveCheckout() {
  const userCfg = packConfig.readPackConfig(packConfigDir())
  const repoCfg = packConfig.readPackConfig(packConfig.REPO_ROOT)
  let checkout = userCfg.checkout
  if (!packConfig.isValidCheckout(checkout) && packConfig.isValidCheckout(repoCfg.checkout)) {
    checkout = repoCfg.checkout
    packConfig.writePackConfig({ checkout, mode: 'local' }, packConfigDir())
  }

  if (packConfig.isValidCheckout(checkout)) {
    const keep = await dialog.showMessageBox({
      type: 'question',
      title: 'DeepSeek Harness Desktop',
      message: '使用已保存的本地源码路径？',
      detail: checkout,
      buttons: ['使用该路径', '重新选择…', '取消'],
      defaultId: 0,
      cancelId: 2,
    })
    if (keep.response === 2) return null
    if (keep.response === 0) return checkout
  }

  const result = await dialog.showOpenDialog({
    title: '选择 DSH 源码 checkout 目录',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const dir = result.filePaths[0]
  if (!packConfig.isValidCheckout(dir)) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness Desktop',
      message: '目录无效',
      detail: '所选目录没有 package.json，请选择 DeepSeek Harness 源码根目录。',
      buttons: ['好'],
    })
    return null
  }
  packConfig.writePackConfig({ checkout: dir, mode: 'local' }, packConfigDir())
  if (!app.isPackaged) {
    try { packConfig.writePackConfig({ checkout: dir, mode: 'local' }, packConfig.REPO_ROOT) } catch { /* ignore */ }
  }
  return dir
}

function runUpdateHost(args) {
  return new Promise((resolve, reject) => {
    const nodeBin = whichOnPath('node')
    if (!nodeBin) {
      reject(new Error('未找到系统 Node.js（node）。一键更新 Host 需要本机安装 Node + pnpm。'))
      return
    }
    const script = path.join(scriptsDir(), 'update-host.cjs')
    if (!fs.existsSync(script)) {
      reject(new Error(`找不到更新脚本：${script}\n请使用开发版或重新打包包含 scripts 的安装包。`))
      return
    }
    const outHost = path.join(app.getPath('userData'), 'host')
    const fullArgs = [
      script,
      '--out', outHost,
      '--config-dir', packConfigDir(),
      '--cwd', app.getPath('userData'),
      ...args,
    ]
    const child = spawn(nodeBin, fullArgs, {
      cwd: app.getPath('userData'),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    })
    let log = ''
    const onData = (chunk) => {
      log = (log + chunk.toString()).slice(-12000)
    }
    if (child.stdout) child.stdout.on('data', onData)
    if (child.stderr) child.stderr.on('data', onData)
    child.on('error', (err) => reject(err))
    child.on('exit', (code) => {
      if (code === 0) resolve({ outHost, log })
      else reject(new Error(`更新进程退出码 ${code}\n--- 输出 ---\n${log}`))
    })
  })
}

async function updateBundledHost() {
  if (updatingHost) return

  if (!whichOnPath('pnpm')) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'DeepSeek Harness Desktop',
      message: '无法一键更新 Host',
      detail: '本机需要安装 pnpm（以及 Node.js）。也可使用仓库里的「一键打包.bat」生成新安装包。',
      buttons: ['好'],
    })
    return
  }

  const choice = await dialog.showMessageBox({
    type: 'question',
    title: 'DeepSeek Harness Desktop',
    message: '一键更新内置 Host',
    detail: '将重新组装 Host 到用户目录覆盖层（不重新打安装包）。完成后需重启应用。\n需要本机有 Node + pnpm；远程模式还需要 git。',
    buttons: ['用本地源码更新', '从远程稳定版更新', '取消'],
    defaultId: 0,
    cancelId: 2,
  })
  if (choice.response === 2) return

  let args
  if (choice.response === 0) {
    const checkout = await pickOrSaveCheckout()
    if (!checkout) return
    args = ['--mode', 'local', '--checkout', checkout]
  } else {
    if (!whichOnPath('git')) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'DeepSeek Harness Desktop',
        message: '未找到 git',
        detail: '远程更新需要本机安装 git。',
        buttons: ['好'],
      })
      return
    }
    args = ['--mode', 'remote']
  }

  updatingHost = true
  const progressPromise = dialog.showMessageBox({
    type: 'info',
    title: 'DeepSeek Harness Desktop',
    message: '正在更新 Host…',
    detail: '首次可能需要数分钟（构建 + 下载依赖）。请勿关闭应用。',
    buttons: ['后台进行中'],
    noLink: true,
  })

  try {
    if (host) {
      try { host.kill() } catch { /* ignore */ }
      host = null
    }
    const result = await runUpdateHost(args)
    await progressPromise
    const again = await dialog.showMessageBox({
      type: 'info',
      title: 'DeepSeek Harness Desktop',
      message: 'Host 更新完成',
      detail: `已写入：\n${result.outHost}\n\n需要重启应用以加载新 Host。`,
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (again.response === 0) {
      quitting = true
      app.relaunch()
      app.exit(0)
      return
    }
  } catch (err) {
    await progressPromise
    await dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness Desktop',
      message: 'Host 更新失败',
      detail: err && err.message ? err.message : String(err),
      buttons: ['好'],
    })
  } finally {
    updatingHost = false
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: '重新选择 DSH host…', click: () => { void reconfigureHost() } },
        { label: '一键更新内置 Host…', click: () => { void updateBundledHost() } },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ])
}

function stopHost() {
  if (host) {
    host.kill()
    host = null
  }
}

app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  quitting = true
  stopHost()
  if (tray) {
    tray.destroy()
    tray = null
  }
})
