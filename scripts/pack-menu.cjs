'use strict'

/**
 * Interactive packaging menu (called by 一键打包.bat).
 * Avoids fragile cmd.exe parsing of UTF-8 Chinese batch files.
 */

const path = require('node:path')
const readline = require('node:readline')
const { sync: spawnSync } = require('./spawn-sync.cjs')
const packConfig = require('./pack-config.cjs')

const root = packConfig.REPO_ROOT

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(String(answer || '').trim()))
  })
}

function runRebuild(mode, extraArgs = []) {
  const script = path.join(root, 'scripts', 'rebuild-all.cjs')
  const args = [script, '--mode', mode, ...extraArgs]
  console.log('\n' + '='.repeat(68))
  console.log('>> node ' + args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '))
  console.log('='.repeat(68) + '\n')
  // Keep paths with spaces as one argv entry (no shell joining).
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`打包退出码 ${result.status}`)
}

async function promptCheckout(rl, current) {
  if (current) console.log(`当前路径: ${current}`)
  const input = await ask(rl, '请输入 DSH 源码目录完整路径: ')
  if (!input) {
    console.log('已取消。')
    return null
  }
  const dir = input.replace(/^["']|["']$/g, '')
  if (!packConfig.isValidCheckout(dir)) {
    console.log(`[错误] 找不到 ${path.join(dir, 'package.json')}`)
    return null
  }
  packConfig.writePackConfig({ checkout: dir, mode: 'local' })
  console.log(`[OK] 已保存: ${dir}`)
  return dir
}

async function ensureCheckout(rl) {
  let checkout = packConfig.readPackConfig().checkout
  if (!packConfig.isValidCheckout(checkout)) {
    console.log('尚未保存有效的本地源码路径。')
    return promptCheckout(rl, '')
  }
  console.log('当前本地源码路径:')
  console.log(`  ${checkout}`)
  const use = await ask(rl, '直接使用该路径？[Y=直接用 / N=更改]: ')
  if (/^n/i.test(use)) {
    return promptCheckout(rl, checkout)
  }
  if (!packConfig.isValidCheckout(checkout)) {
    console.log(`[错误] 目录无效: ${checkout}`)
    return null
  }
  return checkout
}

async function main() {
  console.log('')
  console.log('============================================================')
  console.log('  DeepSeek Harness Desktop - 一键打包')
  console.log('============================================================')
  console.log('')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    while (true) {
      console.log('  1) 本地源码打包')
      console.log('  2) 远程源码打包')
      console.log('  3) 修改本地源码路径')
      console.log('  0) 退出')
      console.log('')
      const choice = await ask(rl, '请选择 [0-3]: ')

      if (choice === '0') {
        console.log('已退出。')
        return 0
      }

      if (choice === '3') {
        await promptCheckout(rl, packConfig.readPackConfig().checkout)
        console.log('')
        continue
      }

      if (choice === '1') {
        const checkout = await ensureCheckout(rl)
        if (!checkout) {
          console.log('')
          continue
        }
        console.log(`\n使用本地源码: ${checkout}\n`)
        runRebuild('local', ['--checkout', checkout])
        console.log('\n[DONE] 安装包已生成到 dist\\ 目录。')
        return 0
      }

      if (choice === '2') {
        console.log('\n将从 GitHub 克隆/更新稳定版并打包...\n')
        runRebuild('remote')
        console.log('\n[DONE] 安装包已生成到 dist\\ 目录。')
        return 0
      }

      console.log('无效选择，请重试。\n')
    }
  } finally {
    rl.close()
  }
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    console.error('\n[FAILED] ' + (err && err.message ? err.message : err))
    process.exit(1)
  })
