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
 * Returns null when no bundled host is present — the caller then falls back to a
 * system `dsh` (env → saved config → auto-detect → picker).
 *
 * @param {{ isPackaged?: boolean, resourcesPath?: string, appPath?: string }} appInfo
 * @returns {{ program: string, baseArgs: string[], cwd: string, bundled: boolean } | null}
 */
function resolveBundledLaunch(appInfo = {}) {
  const bundledDir = appInfo.isPackaged
    ? path.join(appInfo.resourcesPath ?? '', 'host')
    : path.join(appInfo.appPath ?? process.cwd(), 'host')
  const nodeBin = path.join(
    bundledDir,
    'node',
    process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'),
  )
  const dshBin = path.join(bundledDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (fs.existsSync(nodeBin) && fs.existsSync(dshBin)) {
    return { program: nodeBin, baseArgs: [dshBin], cwd: bundledDir, bundled: true }
  }
  return null
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
  const timeoutMs = Number(options.timeoutMs ?? process.env.DSH_DESKTOP_TIMEOUT_MS ?? 60000)

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
        try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* best effort */ }
      } else {
        try { process.kill(-child.pid, 'SIGTERM') } catch { /* best effort */ }
      }
    },
  }
}

module.exports = { launchHost, resolveBundledLaunch }
