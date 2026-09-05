'use strict'

/**
 * Shared helpers for rebuild-all / update-host.
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync: nodeSpawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')

/** System-Node-safe spawn (no cross-spawn). Windows needs shell for .cmd shims. */
function spawnSync(command, args, opts = {}) {
  const options = { encoding: 'utf8', ...opts }
  if (process.platform === 'win32' && options.shell === undefined) {
    options.shell = true
  }
  return nodeSpawnSync(command, args, options)
}

function getArg(argv, name) {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : undefined
}

function hasFlag(argv, name) {
  return argv.includes(name)
}

function run(command, args, opts = {}) {
  const label = opts.label || `${command} ${args.join(' ')}`
  console.log('\n' + '='.repeat(68))
  console.log('>> ' + label)
  console.log('='.repeat(68))
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: opts.cwd || root,
    env: { ...process.env, ...(opts.env || {}) },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} 退出码 ${result.status}`)
  return result
}

/**
 * Fix dsh-app-boot junction delete bug on Windows (rmdirSync for dir junctions).
 */
function patchHostDshAppBoot(hostDir) {
  const target = path.join(hostDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
  if (!fs.existsSync(target)) {
    console.log('  [patch] dsh-app-boot 未找到，跳过 junction 修复')
    return
  }
  const before = fs.readFileSync(target, 'utf8')
  let content = before

  content = content.replace(
    /import \{ existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync \} from "node:fs";/,
    'import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";',
  )

  content = content.replace(
    /\t\tif \(readlinkSync\(link\) === target\) return;\n\t\tunlinkSync\(link\);/,
    '\t\tif (readlinkSync(link) === target) return;\n\t\ttry { rmdirSync(link); } catch (e) { if (e.code === "ENOTDIR" || e.code === "EISDIR") unlinkSync(link); else if (e.code !== "ENOENT") throw e; }',
  )

  if (content !== before) {
    fs.writeFileSync(target, content)
    console.log('  [patch] 已应用 dsh-app-boot junction 修复')
  } else {
    console.log('  [patch] dsh-app-boot 已是修复版或未匹配到，跳过')
  }
}

function collectDistArtifacts(distDir) {
  const installExts = new Set(['exe'])
  const artifacts = []
  if (!fs.existsSync(distDir)) return artifacts
  for (const name of fs.readdirSync(distDir)) {
    const ext = path.extname(name).slice(1)
    const full = path.join(distDir, name)
    if (installExts.has(ext) && fs.statSync(full).isFile()) artifacts.push(full)
  }
  artifacts.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return artifacts
}

function printArtifacts(artifacts, started) {
  console.log('\n' + '='.repeat(68))
  console.log(artifacts.length > 0 ? '  [OK] 打包完成' : '  [!] 结束，但未在 dist/ 找到安装包产物')
  for (const a of artifacts) {
    console.log('    - ' + path.basename(a) + '  (' + (fs.statSync(a).size / 1024 / 1024).toFixed(1) + ' MB)')
  }
  console.log('  耗时   : ' + ((Date.now() - started) / 60000).toFixed(1) + ' 分钟')
  console.log('='.repeat(68))
}

function whichOnPath(name) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
  if (result.status !== 0) return null
  return String(result.stdout).split(/\r?\n/).find(Boolean) ?? null
}

module.exports = {
  root,
  getArg,
  hasFlag,
  run,
  patchHostDshAppBoot,
  collectDistArtifacts,
  printArtifacts,
  whichOnPath,
}
