'use strict'

/**
 * 一键打包：从 DSH checkout 重新组装内置 host，再打出 Windows 安装包。
 *
 * 用法（在 dsh-desktop 根目录下）：
 *   npm run rebuild                              # checkout 默认 D:\develop\DeepSeek Harness
 *   node scripts/rebuild.cjs --checkout <目录>    # 指定 checkout
 *   node scripts/rebuild.cjs --skip-host         # host 没变，只重新打安装包
 *   node scripts/rebuild.cjs --skip-dist         # 只组装 host，不打包
 *
 * 环境变量：DSH_DESKTOP_DSH_CHECKOUT（等价于 --checkout）。
 * 前置：系统需有 pnpm（checkout 构建用）、npm（本仓库依赖用），以及可访问的
 *       npm 镜像（.npmrc 已配置国内镜像）。
 */

const fs = require('node:fs')
const path = require('node:path')
const spawn = require('cross-spawn')

const root = path.join(__dirname, '..')

function getArg(name) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : undefined
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function run(command, args, opts = {}) {
  const label = opts.label || `${command} ${args.join(' ')}`
  console.log('\n' + '='.repeat(68))
  console.log('>> ' + label)
  console.log('='.repeat(68))
  const result = spawn.sync(command, args, {
    stdio: 'inherit',
    cwd: opts.cwd || root,
    env: { ...process.env, ...(opts.env || {}) },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} 退出码 ${result.status}`)
}

/**
 * 修复打包出的 dsh-app-boot 在 Windows 上的 junction 删除 bug。
 * DSH 的 ensureSymlink 用 unlinkSync 删目录 junction 会 EPERM（例如 checkout 与
 * 打包 host 之间切换时）。这里把它改写为：目录 junction 用 rmdirSync，文件链接
 * 用 unlinkSync 兜底。这样从 checkout 重新组装 host 后，重新打包也不带 bug。
 */
function patchHostDshAppBoot(hostDir) {
  const target = path.join(hostDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
  if (!fs.existsSync(target)) {
    console.log('  [patch] dsh-app-boot 未找到，跳过 junction 修复')
    return
  }
  const before = fs.readFileSync(target, 'utf8')
  let content = before

  // 1) import 行补上 rmdirSync
  content = content.replace(
    /import \{ existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync \} from "node:fs";/,
    'import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";',
  )

  // 2) ensureSymlink 里删链接改为 rmdirSync（目录 junction）+ unlinkSync（文件链接）兜底
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

function main() {
  const checkout = getArg('--checkout') || process.env.DSH_DESKTOP_DSH_CHECKOUT || 'D:\\develop\\DeepSeek Harness'
  const arch = getArg('--arch')
  const skipHost = hasFlag('--skip-host')
  const skipDist = hasFlag('--skip-dist')

  const started = Date.now()
  console.log('='.repeat(68))
  console.log('  DeepSeek Harness Desktop 一键打包')
  console.log('  checkout : ' + checkout)
  console.log('  步骤 1/2 : ' + (skipHost ? '跳过 (--skip-host)' : '组装内置 host'))
  console.log('  步骤 2/2 : ' + (skipDist ? '跳过 (--skip-dist)' : '打包安装包'))
  console.log('='.repeat(68))

  if (!skipHost) {
    const checkoutManifest = path.join(checkout, 'package.json')
    if (!fs.existsSync(checkoutManifest)) {
      throw new Error(`找不到 checkout：${checkout}\n请用 --checkout <目录> 指定，或设置环境变量 DSH_DESKTOP_DSH_CHECKOUT`)
    }
    run(process.execPath, [path.join(root, 'scripts', 'package-host.cjs'), '--checkout', checkout], {
      label: '步骤 1/2：组装内置 host（build:official → pack → npm install → 下载 Node）',
    })
    patchHostDshAppBoot(path.join(root, 'host'))
  }

  if (!skipDist) {
    const ebCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js')
    const archArgs = arch ? [`--${arch}`] : []
    run(process.execPath, [ebCli, ...archArgs], {
      label: '步骤 2/2：打包安装包（electron-builder' + (arch ? ' [' + arch + ']' : '') + '）',
    })
  }

  // 跨平台收集产物：Windows .exe、macOS .dmg/.zip、Linux .AppImage。
  const distDir = path.join(root, 'dist')
  const installExts = new Set(['exe', 'dmg', 'zip', 'AppImage'])
  const artifacts = []
  if (fs.existsSync(distDir)) {
    for (const name of fs.readdirSync(distDir)) {
      const ext = path.extname(name).slice(1)
      const full = path.join(distDir, name)
      if (installExts.has(ext) && fs.statSync(full).isFile()) artifacts.push(full)
    }
    artifacts.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  }

  console.log('\n' + '='.repeat(68))
  console.log(artifacts.length > 0 ? '  [OK] 打包完成' : '  [!] 结束，但未在 dist/ 找到安装包产物')
  for (const a of artifacts) {
    console.log('    - ' + path.basename(a) + '  (' + (fs.statSync(a).size / 1024 / 1024).toFixed(1) + ' MB)')
  }
  console.log('  耗时   : ' + ((Date.now() - started) / 60000).toFixed(1) + ' 分钟')
  console.log('='.repeat(68))
}

try {
  main()
} catch (err) {
  console.error('\n[FAIL] 打包失败：' + (err && err.message ? err.message : err))
  process.exit(1)
}
