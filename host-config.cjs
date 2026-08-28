'use strict'

/**
 * System-host resolution for the desktop shell: saved-config read/write,
 * command-line parsing, and auto-detection (PATH `dsh`, then a DSH checkout
 * with pnpm). Pure Node (no Electron), so it is unit-testable headlessly.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const spawn = require('cross-spawn')

const CONFIG_FILE = 'host-config.json'

/** Read the persisted host config (`{ program, baseArgs, cwd }`) or null. */
function readConfig(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(userDataDir, CONFIG_FILE), 'utf8'))
    if (data && typeof data.program === 'string' && data.program) return data
  } catch { /* no saved config */ }
  return null
}

function writeConfig(userDataDir, launch) {
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, CONFIG_FILE), `${JSON.stringify(launch, null, 2)}\n`)
}

/** Split a command line like `"pnpm dsh"` into `{ program, baseArgs }`. */
function parseCommand(command) {
  const [program, ...baseArgs] = String(command).trim().split(/\s+/).filter(Boolean)
  return { program, baseArgs }
}

/** First match of `name` on PATH (via `where`/`which`), or null. */
function whichOnPath(name) {
  const result = spawn.sync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
  if (result.status !== 0) return null
  return String(result.stdout).split(/\r?\n/).find(Boolean) ?? null
}

/** Is `dir` a DeepSeek Harness checkout (root package named @deepseek-ai/dsh-root)? */
function isDshCheckout(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return pkg && pkg.name === '@deepseek-ai/dsh-root'
  } catch { return false }
}

function candidateCheckouts() {
  const home = os.homedir()
  const candidates = []
  if (process.env.DSH_DESKTOP_DSH_CHECKOUT) candidates.push(process.env.DSH_DESKTOP_DSH_CHECKOUT)
  candidates.push(
    path.join(home, 'DeepSeek Harness'),
    path.join(home, 'deepseek-harness'),
    path.join(home, 'dev', 'DeepSeek Harness'),
    path.join(home, 'dev', 'deepseek-harness'),
    path.join(home, 'workspace', 'DeepSeek Harness'),
    'D:\\develop\\DeepSeek Harness',
    'C:\\develop\\DeepSeek Harness',
    'D:\\dev\\DeepSeek Harness',
  )
  return [...new Set(candidates.filter(Boolean))]
}

/** Explicit per-run override from `DSH_DESKTOP_HOST_CMD`, or null. */
function envLaunch() {
  if (!process.env.DSH_DESKTOP_HOST_CMD) return null
  const { program, baseArgs } = parseCommand(process.env.DSH_DESKTOP_HOST_CMD)
  return { program, baseArgs, cwd: process.env.DSH_DESKTOP_CWD ?? process.cwd() }
}

/** Auto-detect: `dsh` on PATH, else a checkout with pnpm. Returns a launch or null. */
function detect() {
  if (whichOnPath('dsh')) return { program: 'dsh', baseArgs: [], cwd: process.cwd() }
  if (whichOnPath('pnpm')) {
    for (const dir of candidateCheckouts()) {
      if (isDshCheckout(dir)) return { program: 'pnpm', baseArgs: ['dsh'], cwd: dir }
    }
  }
  return null
}

module.exports = {
  CONFIG_FILE,
  readConfig,
  writeConfig,
  parseCommand,
  whichOnPath,
  isDshCheckout,
  envLaunch,
  detect,
}
