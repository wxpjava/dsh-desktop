'use strict'

const { app, BrowserWindow, dialog, Menu, nativeImage, Notification, shell, Tray, nativeTheme } = require('electron')
const path = require('node:path')
const { launchHost, resolveBundledLaunch } = require('./host-launcher.cjs')
const hostConfig = require('./host-config.cjs')
const { writeBadge } = require('./tray-icon.cjs')

let mainWindow = null
let host = null
let tray = null
let quitting = false
let trayHintShown = false

// Match the dark web UI: native Windows title bar follows system theme unless forced.
nativeTheme.themeSource = 'dark'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(start)
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
 *   bundled host → explicit env → saved config → auto-detect → onboarding picker.
 */
async function resolveLaunch() {
  const bundled = resolveBundledLaunch({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
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

  // External links open in the system browser; the GUI stays in-window.
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

  // Close-to-tray: hide instead of closing, so the host keeps running.
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
    // Best-effort: Windows toast needs a packaged AppUserModelID; silent in dev.
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
      { label: '退出', click: () => app.quit() },
    ]))
    tray.on('click', () => showWindow())
  } catch { /* tray unavailable (e.g. headless) — keep running without it */ }
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

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: '重新选择 DSH host…', click: () => { void reconfigureHost() } },
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

// With close-to-tray the window is hidden rather than closed, so this fires
// only during an actual quit — the quit path below already tears everything down.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  quitting = true
  stopHost()
  if (tray) {
    tray.destroy()
    tray = null
  }
})
