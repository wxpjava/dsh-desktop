'use strict'

/**
 * Assemble a self-contained DSH host into `<out>/` (default ./host):
 *
 *   host/node/node.exe                          (Node runtime)
 *   host/node_modules/@deepseek-ai/dsh/lib/bin.js  (production CLI + all plugins + frontend dist)
 *
 * Three sources, mutually exclusive:
 *   --registry <version>       npm install @deepseek-ai/dsh@<version> from the registry
 *   --checkout <dir>           build:official + pack the dsh & vendor families, then install from tarballs (hermetic)
 *   --tarballs <dir>           install from already-packed tarballs (repeatable)
 *
 * Env fallbacks: DSH_DESKTOP_DSH_CHECKOUT (= --checkout), DSH_DESKTOP_TARBALLS
 * (`;`-separated = --tarballs), DSH_DESKTOP_REGISTRY (= --registry).
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { sync: spawnSync } = require('./spawn-sync.cjs')

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${String(result.status)}`)
}

function argv() {
  const args = process.argv.slice(2)
  const get = (name, multiple = false) => {
    const out = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === name && args[i + 1] !== undefined) { out.push(args[i + 1]); i++ }
    }
    return multiple ? out : out[0]
  }
  return {
    registry: get('--registry') || process.env.DSH_DESKTOP_REGISTRY,
    checkout: get('--checkout') || process.env.DSH_DESKTOP_DSH_CHECKOUT,
    tarballs: [
      ...get('--tarballs', true),
      ...(process.env.DSH_DESKTOP_TARBALLS ? String(process.env.DSH_DESKTOP_TARBALLS).split(';').filter(Boolean) : []),
    ],
    out: get('--out') || 'host',
  }
}

/** Read the name/version from a tarball's `package/package.json` (bsdtar handles npm tgz). */
function packageIdentity(tarball) {
  const result = spawnSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`could not read ${tarball}: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

/** Map every `.tgz` in the directories to its package name → file: URL. */
function collectTarballs(dirs) {
  const deps = {}
  for (const dir of dirs) {
    for (const filename of fs.readdirSync(dir).filter((name) => name.endsWith('.tgz')).sort()) {
      const tarball = path.join(dir, filename)
      const { name } = packageIdentity(tarball)
      deps[name] = pathToFileURL(tarball).href
    }
  }
  return deps
}

/** Package directories for the `dsh` family (mirrors families.ts: packages/!(experimental)/* + apps/*). */
function dshPackageDirs(root) {
  const dirs = []
  const packagesRoot = path.join(root, 'packages')
  if (fs.existsSync(packagesRoot)) {
    for (const group of fs.readdirSync(packagesRoot)) {
      if (group === 'experimental') continue
      const groupRoot = path.join(packagesRoot, group)
      let stat
      try { stat = fs.statSync(groupRoot) } catch { continue }
      if (!stat.isDirectory()) continue
      for (const name of fs.readdirSync(groupRoot)) {
        const dir = path.join(groupRoot, name)
        if (fs.existsSync(path.join(dir, 'package.json'))) dirs.push(dir)
      }
    }
  }
  const appsRoot = path.join(root, 'apps')
  if (fs.existsSync(appsRoot)) {
    for (const name of fs.readdirSync(appsRoot)) {
      const dir = path.join(appsRoot, name)
      if (fs.existsSync(path.join(dir, 'package.json'))) dirs.push(dir)
    }
  }
  return dirs
}

/** Package directories for the `vendor` family (mirrors families.ts: vendor/*). */
function vendorPackageDirs(root) {
  const dirs = []
  const vendorRoot = path.join(root, 'vendor')
  if (fs.existsSync(vendorRoot)) {
    for (const name of fs.readdirSync(vendorRoot)) {
      const dir = path.join(vendorRoot, name)
      if (fs.existsSync(path.join(dir, 'package.json'))) dirs.push(dir)
    }
  }
  return dirs
}

/**
 * Pack every package directory into `destination` with pnpm.
 */
function packAll(dirs, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const dir of dirs) {
    run('pnpm', ['--dir', dir, 'pack', '--pack-destination', path.resolve(destination)])
  }
  return destination
}

function main() {
  const opts = argv()
  const hostDir = path.resolve(opts.out)

  fs.rmSync(hostDir, { recursive: true, force: true })
  fs.mkdirSync(hostDir, { recursive: true })

  // Use a project-local cache: the machine's global npm cache can be corrupted
  // or AV-locked (EPERM), which surfaces as confusing tar/cleanup failures.
  const npmCache = path.resolve(process.cwd(), '.npm-cache')
  const npmArgs = [
    'install',
    '--cache', npmCache,
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    // Avoid npm arborist crash: "Cannot read properties of null (reading 'edgesOut')"
    // when resolving optional/complex peers (e.g. vitest) across hundreds of local tarballs.
    '--legacy-peer-deps',
  ]
  // Keep optional deps except on Linux: koffi ships its native binding as an
  // optional platform package (@koromix/koffi-<platform>-<arch>), and omitting
  // it leaves koffi without its .node binary. On Linux only, omit optional deps
  // to skip the Landlock musl build.
  if (process.platform === 'linux') npmArgs.push('--omit=optional')
  // Skip lifecycle scripts: koffi's install script downloads prebuilds from
  // GitHub (often blocked) then falls back to CMake (often absent), aborting the
  // whole install. The optional platform package above supplies the binary, and
  // node-pty ships its prebuilds in-package, so scripts are unnecessary. Set
  // DSH_DESKTOP_HOST_BUILD_NATIVE=1 to attempt native builds instead.
  if (process.env.DSH_DESKTOP_HOST_BUILD_NATIVE !== '1') npmArgs.push('--ignore-scripts')

  if (opts.registry) {
    // Path A: published packages.
    npmArgs.push(`@deepseek-ai/dsh@${opts.registry}`)
    run('npm', npmArgs, { cwd: hostDir })
  } else {
    // Path B: hermetic install from tarballs (dsh + vendor families together,
    // because the vendor framework is declared as peers of the dsh packages).
    const tarballDirs = opts.tarballs.map((dir) => path.resolve(dir))
    if (opts.checkout) {
      const checkout = path.resolve(opts.checkout)
      console.log(`package-host: building + packing from checkout ${checkout}`)
      run('pnpm', ['run', 'build:official'], { cwd: checkout })
      const stage = path.join(os.tmpdir(), `dsh-desktop-pack-${process.pid}`)
      packAll(dshPackageDirs(checkout), path.join(stage, 'dsh'))
      packAll(vendorPackageDirs(checkout), path.join(stage, 'vendor'))
      tarballDirs.push(path.join(stage, 'dsh'), path.join(stage, 'vendor'))
    }
    if (tarballDirs.length === 0) {
      throw new Error('package-host: provide --registry <version>, --checkout <dir>, or --tarballs <dir>')
    }
    const deps = collectTarballs(tarballDirs)
    const manifest = path.join(hostDir, 'package.json')
    fs.writeFileSync(manifest, `${JSON.stringify({
      name: 'dsh-desktop-host',
      version: '0.0.0',
      private: true,
      dependencies: deps,
    }, null, 2)}\n`)
    run('npm', npmArgs, { cwd: hostDir })
    // The manifest existed only for npm; the launcher addresses bin.js directly.
    fs.rmSync(manifest, { force: true })
    const lock = path.join(hostDir, 'package-lock.json')
    if (fs.existsSync(lock)) fs.rmSync(lock, { force: true })
  }

  // Node runtime.
  run(process.execPath, [path.join(__dirname, 'fetch-node.cjs'), hostDir])

  // Verify the assembled host reports its version.
  const nodeBin = path.join(hostDir, 'node', process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'))
  const dshBin = path.join(hostDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!fs.existsSync(dshBin)) throw new Error(`install did not produce ${dshBin}`)
  const version = spawnSync(nodeBin, [dshBin, '--version'], { encoding: 'utf8', shell: false })
  console.log(`package-host: bundled host reports ${version.stdout.trim()}`)
  console.log(`package-host: done → ${hostDir}`)
}

try {
  main()
} catch (err) {
  console.error(err && err.message ? err.message : err)
  process.exit(1)
}
