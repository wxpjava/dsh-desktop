'use strict'

/**
 * Persist packaging / host-update preferences:
 *   checkout, mode, remoteRepo, remoteRef
 *
 * Lookup order for config file:
 *   1) explicit dir argument
 *   2) DSH_DESKTOP_PACK_CONFIG_DIR
 *   3) repo root (next to package.json) — developer packaging
 */

const fs = require('node:fs')
const path = require('node:path')

const CONFIG_NAME = 'pack-config.json'
const DEFAULT_REMOTE_REPO = 'https://github.com/deepseek-ai/deepseek-harness.git'
const DEFAULT_REMOTE_REF = 'dsh-v0.1.1-rc.2'
const DEFAULT_CHECKOUT = 'D:\\develop\\DeepSeek Harness'

const REPO_ROOT = path.join(__dirname, '..')

function configPath(baseDir) {
  const dir = baseDir
    || process.env.DSH_DESKTOP_PACK_CONFIG_DIR
    || REPO_ROOT
  return path.join(dir, CONFIG_NAME)
}

function defaults() {
  return {
    checkout: process.env.DSH_DESKTOP_DSH_CHECKOUT || DEFAULT_CHECKOUT,
    mode: 'local',
    remoteRepo: process.env.DSH_REPO || DEFAULT_REMOTE_REPO,
    remoteRef: process.env.DSH_REF || DEFAULT_REMOTE_REF,
  }
}

function readPackConfig(baseDir) {
  const file = configPath(baseDir)
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object') return { ...defaults(), _path: file }
    return { ...defaults(), ...data, _path: file }
  } catch {
    return { ...defaults(), _path: file }
  }
}

function writePackConfig(partial, baseDir) {
  const file = configPath(baseDir)
  const current = readPackConfig(baseDir)
  const next = {
    checkout: partial.checkout !== undefined ? partial.checkout : current.checkout,
    mode: partial.mode !== undefined ? partial.mode : current.mode,
    remoteRepo: partial.remoteRepo !== undefined ? partial.remoteRepo : current.remoteRepo,
    remoteRef: partial.remoteRef !== undefined ? partial.remoteRef : current.remoteRef,
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  return { ...next, _path: file }
}

/** Resolve local checkout path: CLI > env > saved config > default. */
function resolveCheckout(explicit, baseDir) {
  if (explicit) return explicit
  if (process.env.DSH_DESKTOP_DSH_CHECKOUT) return process.env.DSH_DESKTOP_DSH_CHECKOUT
  return readPackConfig(baseDir).checkout
}

function isValidCheckout(dir) {
  try {
    return fs.existsSync(path.join(dir, 'package.json'))
  } catch {
    return false
  }
}

module.exports = {
  CONFIG_NAME,
  DEFAULT_REMOTE_REPO,
  DEFAULT_REMOTE_REF,
  DEFAULT_CHECKOUT,
  REPO_ROOT,
  configPath,
  defaults,
  readPackConfig,
  writePackConfig,
  resolveCheckout,
  isValidCheckout,
}
