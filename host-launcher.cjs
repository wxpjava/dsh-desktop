'use strict'

/**
 * Host launch glue shared by the Electron main process and the headless smoke
 * test. It detects the bundled host (when the installer ships one), spawns the
 * resolved host, watches for the `dsh web: http://…` URL line (so `--port 0`
 * works), and exposes a tree-scoped kill for teardown.
 */

const fs = require('node:fs')
const path = require('node:path')
// cross-spawn fixes the classic Windows gotcha where `dsh` / `pnpm` / `npm` are
// `.cmd` shims that node's built-in spawn refuses to run without a shell.
const spawn = require('cross-spawn')

const URL_LINE = /dsh web:\s*(https?:\/\/\S+)/

/**
 * Resolve the bundled host, when the app ships one (see scripts/package-host.cjs):
 *   <app>/host/node/node(.exe)                          Node runtime
 *   <app>/host/node_modules/@deepseek-ai/dsh/lib/bin.js CLI entry
 *
 * Priority:
 *   1) userData/host override (one-click update layer)
 *   2) packaged resources/host or dev ./host
 *
 * Returns null when no bundled host is present — the caller then falls back to a
 * system `dsh` (env → saved config → auto-detect → picker).
 *
 * @param {{ isPackaged?: boolean, resourcesPath?: string, appPath?: string, userDataPath?: string }} appInfo
 * @returns {{ program: string, baseArgs: string[], cwd: string, bundled: boolean, override?: boolean } | null}
 */
function resolveBundledLaunch(appInfo = {}) {
  const candidates = []
  if (appInfo.userDataPath) {
    candidates.push({ dir: path.join(appInfo.userDataPath, 'host'), override: true })
  }
  const bundledDir = appInfo.isPackaged
    ? path.join(appInfo.resourcesPath ?? '', 'host')
    : path.join(appInfo.appPath ?? process.cwd(), 'host')
  candidates.push({ dir: bundledDir, override: false })

  for (const { dir, override } of candidates) {
    const nodeBin = path.join(
      dir,
      'node',
      process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'),
    )
    const dshBin = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (fs.existsSync(nodeBin) && fs.existsSync(dshBin)) {
      return { program: nodeBin, baseArgs: [dshBin], cwd: dir, bundled: true, override }
    }
  }
  return null
}

/**
 * Kill leftover dsh-pet Electron helpers from a previous host process.
 * On Windows, host exit/restart often leaves the transparent pet window alive;
 * the next host then starts another → two pets.
 */
function killOrphanDshPetHelpers() {
  if (process.platform !== 'win32') {
    try {
      spawn('pkill', ['-f', 'dsh-pet/runtime/electron-helper'], { stdio: 'ignore' })
    } catch { /* best effort */ }
    return
  }
  try {
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -match 'dsh-pet[\\\\/]+runtime[\\\\/]+electron-helper' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', windowsHide: true },
    )
  } catch { /* best effort */ }
}

/**
 * Launch the host and resolve with the URL it reports.
 *
 * @param {{ program: string, baseArgs?: string[], cwd?: string }} launch
 * @param {{ port?: string|number, timeoutMs?: number }} options
 * @returns {{ child: import('child_process').ChildProcess, ready: Promise<string>, kill: () => void }}
 */
function launchHost(launch, options = {}) {
  const program = launch.program
  const baseArgs = launch.baseArgs ?? []
  const cwd = launch.cwd ?? process.cwd()
  const port = options.port ?? process.env.DSH_DESKTOP_PORT ?? '0'
  const timeoutMs = Number(options.timeoutMs ?? process.env.DSH_DESKTOP_TIMEOUT_MS ?? 180000)

  killOrphanDshPetHelpers()

  const args = [...baseArgs, 'web', '--no-open', '--port', String(port)]

  const child = spawn(program, args, {
    cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, DSH_DESKTOP: '1' },
  })

  let tail = ''
  const ready = new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    timer = setTimeout(() => {
      finish(reject, new Error(`timed out after ${timeoutMs}ms waiting for the host URL.\n--- output ---\n${tail}`))
    }, timeoutMs)

    const onData = (chunk) => {
      tail = (tail + chunk.toString()).slice(-8000)
      const match = tail.match(URL_LINE)
      if (match) finish(resolve, match[1])
    }
    if (child.stdout) child.stdout.on('data', onData)
    if (child.stderr) child.stderr.on('data', onData)

    child.on('error', (err) => {
      finish(reject, new Error(`could not run "${program}": ${err.message}. Is the host installed?`))
    })
    child.on('exit', (code, signal) => {
      finish(reject, new Error(`host exited before it became ready (code=${code}, signal=${signal}).\n--- output ---\n${tail}`))
    })
  })

  return {
    child,
    ready,
    kill() {
      if (child.pid == null) return
      if (process.platform === 'win32') {
        // Kill the whole tree: the host spawns LSP servers, shells, sandboxes.
        try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* best effort */ }
      } else {
        try { process.kill(-child.pid, 'SIGTERM') } catch { /* best effort */ }
      }
    },
  }
}

module.exports = { launchHost, resolveBundledLaunch, killOrphanDshPetHelpers }
