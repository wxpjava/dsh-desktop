'use strict'

/**
 * Headless smoke test for the host-launcher wiring: resolve the host (bundled
 * first, then env / auto-detect), wait for its URL, and confirm it answers HTTP.
 *
 *   DSH_DESKTOP_HOST_CMD="pnpm dsh" DSH_DESKTOP_CWD="D:\develop\DeepSeek Harness" npm run smoke
 */

const path = require('node:path')
const { launchHost, resolveBundledLaunch } = require('../host-launcher.cjs')
const hostConfig = require('../host-config.cjs')

async function main() {
  const launch = resolveBundledLaunch({ appPath: path.join(__dirname, '..') })
    ?? hostConfig.envLaunch()
    ?? hostConfig.detect()
  if (!launch) {
    console.error('no host found — set DSH_DESKTOP_HOST_CMD or DSH_DESKTOP_DSH_CHECKOUT')
    process.exit(1)
  }
  console.log(`host source: ${launch.bundled ? 'bundled' : 'system'} → ${launch.program}`)
  const host = launchHost(launch)
  try {
    const url = await host.ready
    console.log('host ready at', url)

    const res = await fetch(url)
    console.log('HTTP', res.status, '|', res.headers.get('content-type') || '')
    if (res.status >= 500) throw new Error(`unexpected status ${res.status}`)
    console.log('RESULT: PASS')
  } catch (err) {
    console.error('RESULT: FAIL')
    console.error(err && err.message ? err.message : err)
    process.exitCode = 1
  } finally {
    host.kill()
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}

main()
