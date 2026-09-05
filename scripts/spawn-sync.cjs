'use strict'

/**
 * spawnSync helper that works under system Node (no cross-spawn dependency).
 * On Windows, shell:true is required so `.cmd` shims (npm/pnpm) resolve.
 */

const { spawnSync } = require('node:child_process')

function sync(command, args, opts = {}) {
  const options = {
    encoding: 'utf8',
    ...opts,
  }
  if (process.platform === 'win32' && options.shell === undefined) {
    options.shell = true
  }
  return spawnSync(command, args, options)
}

module.exports = { sync }
