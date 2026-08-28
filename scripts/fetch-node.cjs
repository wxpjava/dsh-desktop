'use strict'

/**
 * Download the official Node.js runtime and unpack it into `<out>/node`, so the
 * desktop app can run the bundled host without a pre-installed Node.
 *
 *   node scripts/fetch-node.cjs host
 *
 * Env: DSH_DESKTOP_NODE_VERSION (default 22.19.0), DSH_DESKTOP_NODE_PLATFORM,
 *      DSH_DESKTOP_NODE_ARCH. Defaults to the current platform/arch.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const VERSION = process.env.DSH_DESKTOP_NODE_VERSION || '22.19.0'
const PLATFORM = process.env.DSH_DESKTOP_NODE_PLATFORM || process.platform
const ARCH = process.env.DSH_DESKTOP_NODE_ARCH || process.arch

function dist() {
  const plat = PLATFORM === 'win32' ? 'win' : PLATFORM === 'darwin' ? 'darwin' : 'linux'
  const arch = ARCH === 'x64' ? 'x64' : ARCH === 'arm64' ? 'arm64' : ARCH
  const ext = PLATFORM === 'win32' ? 'zip' : 'tar.xz'
  return { name: `node-v${VERSION}-${plat}-${arch}`, ext }
}

function nodeBinary() {
  return PLATFORM === 'win32' ? 'node.exe' : path.join('bin', 'node')
}

async function main() {
  const outDir = path.resolve(process.argv[2] || 'host')
  const nodeDir = path.join(outDir, 'node')
  const { name, ext } = dist()
  const target = path.join(nodeDir, nodeBinary())

  if (fs.existsSync(target)) {
    console.log(`fetch-node: ${target} already present`)
    return
  }
  fs.mkdirSync(nodeDir, { recursive: true })

  const archive = path.join(os.tmpdir(), `${name}.${ext}`)
  const rel = `v${VERSION}/${name}.${ext}`
  // Try the configured mirror, then nodejs.org, then the npmmirror fallback —
  // nodejs.org is frequently slow/unreachable, so a working mirror matters.
  const bases = [...new Set([
    process.env.DSH_DESKTOP_NODE_MIRROR,
    'https://nodejs.org/dist/',
    'https://npmmirror.com/mirrors/node/',
  ].filter(Boolean))]

  let lastError = null
  for (const base of bases) {
    const url = `${base.replace(/\/+$/, '')}/${rel}`
    console.log(`fetch-node: downloading ${url}`)
    try {
      const res = await fetch(url)
      if (res.ok) {
        fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
        lastError = null
        break
      }
      lastError = new Error(`HTTP ${res.status} for ${url}`)
    } catch (err) {
      lastError = err
    }
  }
  if (lastError) throw lastError

  console.log(`fetch-node: extracting into ${nodeDir}`)
  // Windows ships bsdtar (tar.exe) which reads both .zip and .tar.xz.
  const result = spawnSync('tar', ['-xf', archive, '-C', nodeDir, '--strip-components=1'], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`tar failed with status ${result.status}`)
  fs.rmSync(archive, { force: true })

  if (!fs.existsSync(target)) throw new Error(`extraction did not produce ${target}`)
  console.log(`fetch-node: ready (${target})`)
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err)
  process.exit(1)
})
