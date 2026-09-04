'use strict'

/**
 * Unified one-click rebuild: local checkout or remote clone.
 *
 *   node scripts/rebuild-all.cjs --mode local
 *   node scripts/rebuild-all.cjs --mode local --checkout <dir>
 *   node scripts/rebuild-all.cjs --mode remote
 *   node scripts/rebuild-all.cjs --mode remote --ref <tag> --repo <url>
 *   node scripts/rebuild-all.cjs --mode local --skip-host
 *   node scripts/rebuild-all.cjs --mode local --skip-dist
 *   node scripts/rebuild-all.cjs --mode local --out <hostDir>   # only assemble host (no dist unless not skipped)
 *
 * Env: DSH_DESKTOP_DSH_CHECKOUT, DSH_REPO, DSH_REF
 */

const fs = require('node:fs')
const path = require('node:path')
const packConfig = require('./pack-config.cjs')
const {
  root,
  getArg,
  hasFlag,
  run,
  patchHostDshAppBoot,
  collectDistArtifacts,
  printArtifacts,
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
  if (mode !== 'local' && mode !== 'remote') {
    throw new Error(`未知 --mode: ${mode}（应为 local 或 remote）`)
  }

  const cfg = packConfig.readPackConfig()
  const skipHost = hasFlag(argv, '--skip-host')
  const skipDist = hasFlag(argv, '--skip-dist')
  const arch = getArg(argv, '--arch')
  const outHost = getArg(argv, '--out') || path.join(root, 'host')
  const onlyHost = hasFlag(argv, '--host-only')

  let checkout
  let repo
  let ref
  let srcDir

  if (mode === 'local') {
    checkout = packConfig.resolveCheckout(getArg(argv, '--checkout'))
    if (!packConfig.isValidCheckout(checkout)) {
      throw new Error(
        `找不到 checkout：${checkout}\n请用 --checkout <目录>、一键打包.bat 设置路径，或写入 pack-config.json`,
      )
    }
    packConfig.writePackConfig({ checkout, mode: 'local' })
  } else {
    repo = getArg(argv, '--repo') || cfg.remoteRepo
    ref = getArg(argv, '--ref') || cfg.remoteRef
    srcDir = getArg(argv, '--src') || path.join(root, '.dsh-src')
    packConfig.writePackConfig({ mode: 'remote', remoteRepo: repo, remoteRef: ref })
  }

  const started = Date.now()
  console.log('='.repeat(68))
  console.log('  DeepSeek Harness Desktop 一键打包')
  console.log('  模式     : ' + mode)
  if (mode === 'local') {
    console.log('  checkout : ' + checkout)
  } else {
    console.log('  源码仓库 : ' + repo)
    console.log('  版本/分支: ' + ref)
    console.log('  克隆到   : ' + srcDir)
  }
  console.log('  host 输出: ' + outHost)
  console.log('  步骤 1/2 : ' + (skipHost ? '跳过 (--skip-host)' : '组装内置 host'))
  console.log('  步骤 2/2 : ' + (skipDist || onlyHost ? '跳过' : '打包安装包'))
  console.log('='.repeat(68))

  if (mode === 'remote' && !skipHost) {
    ensureRemoteCheckout(repo, ref, srcDir)
    checkout = srcDir
  }

  if (!skipHost) {
    const packageHostArgs = [
      path.join(root, 'scripts', 'package-host.cjs'),
      '--checkout', checkout,
      '--out', outHost,
    ]
    run(process.execPath, packageHostArgs, {
      label: '步骤 1/2：组装内置 host（build:official → pack → npm install → 下载 Node）',
    })
    patchHostDshAppBoot(outHost)
  }

  if (!skipDist && !onlyHost) {
    const ebCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js')
    if (!fs.existsSync(ebCli)) {
      throw new Error('找不到 electron-builder，请先在 dsh-desktop 根目录执行 npm install')
    }
    // electron-builder always packs ./host — when --out differs, sync is caller's job.
    // For normal rebuild, outHost is ./host.
    if (path.resolve(outHost) !== path.resolve(root, 'host')) {
      console.log('  [warn] --out 不是 ./host，跳过 electron-builder（安装包仍使用仓库 host/）')
    } else {
      const archArgs = [...(arch ? [`--${arch}`] : []), '--publish', 'never']
      run(process.execPath, [ebCli, ...archArgs], {
        label: '步骤 2/2：打包安装包（electron-builder' + (arch ? ' [' + arch + ']' : '') + '）',
      })
    }
  }

  if (!onlyHost && !skipDist) {
    printArtifacts(collectDistArtifacts(path.join(root, 'dist')), started)
  } else {
    console.log('\n' + '='.repeat(68))
    console.log('  [OK] host 组装完成 → ' + outHost)
    console.log('  耗时   : ' + ((Date.now() - started) / 60000).toFixed(1) + ' 分钟')
    console.log('='.repeat(68))
  }
}

try {
  main()
} catch (err) {
  console.error('\n[FAIL] 打包失败：' + (err && err.message ? err.message : err))
  process.exit(1)
}
