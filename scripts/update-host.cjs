'use strict'

/**
 * Update the desktop's host override layer (userData/host), without building an installer.
 *
 *   node scripts/update-host.cjs --out <userData/host> --mode local [--checkout <dir>]
 *   node scripts/update-host.cjs --out <userData/host> --mode remote [--src <dir>]
 *
 * Pack-config dir can be overridden with --config-dir (typically Electron userData).
 */

const fs = require('node:fs')
const path = require('node:path')
const packConfig = require('./pack-config.cjs')
const {
  root,
  getArg,
  run,
  patchHostDshAppBoot,
  whichOnPath,
} = require('./rebuild-shared.cjs')

function ensureRemoteCheckout(repo, ref, srcDir) {
  const srcPkg = path.join(srcDir, 'package.json')
  if (!fs.existsSync(srcPkg)) {
    fs.mkdirSync(path.dirname(srcDir), { recursive: true })
    run('git', ['clone', '--depth', '1', '--branch', ref, repo, srcDir], {
      label: '克隆 DSH 源码（浅克隆）',
    })
  } else {
    console.log(`\n[clone] ${srcDir} 已存在，更新到 ${ref}`)
    run('git', ['-C', srcDir, 'fetch', '--depth', '1', 'origin', ref], {
      label: '拉取 DSH 最新（浅拉取）',
    })
    run('git', ['-C', srcDir, 'reset', '--hard', 'FETCH_HEAD'], {
      label: '重置到目标版本',
    })
  }
}

function main() {
  const argv = process.argv.slice(2)
  const mode = getArg(argv, '--mode') || 'local'
  const configDir = getArg(argv, '--config-dir') || packConfig.REPO_ROOT
  const outHost = getArg(argv, '--out')
  if (!outHost) throw new Error('需要 --out <host 输出目录>')

  if (!whichOnPath('pnpm')) {
    throw new Error('未找到 pnpm，请先安装 pnpm 后再更新 Host')
  }

  const cfg = packConfig.readPackConfig(configDir)
  let checkout

  if (mode === 'local') {
    checkout = getArg(argv, '--checkout') || cfg.checkout
    if (!packConfig.isValidCheckout(checkout)) {
      throw new Error(`本地 checkout 无效：${checkout || '(空)'}`)
    }
    packConfig.writePackConfig({ checkout, mode: 'local' }, configDir)
  } else if (mode === 'remote') {
    if (!whichOnPath('git')) {
      throw new Error('未找到 git，远程更新需要 git')
    }
    const repo = getArg(argv, '--repo') || cfg.remoteRepo
    const ref = getArg(argv, '--ref') || cfg.remoteRef
    const srcDir = getArg(argv, '--src') || path.join(configDir, '.dsh-src')
    packConfig.writePackConfig({ mode: 'remote', remoteRepo: repo, remoteRef: ref }, configDir)
    ensureRemoteCheckout(repo, ref, srcDir)
    checkout = srcDir
  } else {
    throw new Error(`未知 --mode: ${mode}`)
  }

  console.log('='.repeat(68))
  console.log('  一键更新内置 Host')
  console.log('  模式     : ' + mode)
  console.log('  checkout : ' + checkout)
  console.log('  输出     : ' + outHost)
  console.log('='.repeat(68))

  // Always run from a writable directory (userData when invoked from desktop).
  // Scripts themselves may live inside app.asar (read-only).
  const cwd = getArg(argv, '--cwd') || configDir || root
  fs.mkdirSync(cwd, { recursive: true })
  const packageHost = path.join(path.dirname(__filename), 'package-host.cjs')

  run(process.execPath, [packageHost, '--checkout', checkout, '--out', outHost], {
    label: '组装 Host（build:official → pack → npm install → 下载 Node）',
    cwd,
  })
  patchHostDshAppBoot(outHost)

  console.log('\n[OK] Host 已更新 → ' + outHost)
}

try {
  main()
} catch (err) {
  console.error('\n[FAIL] 更新 Host 失败：' + (err && err.message ? err.message : err))
  process.exit(1)
}
