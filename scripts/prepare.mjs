#!/usr/bin/env node
// Check out the pinned upstream commit into ./harness and apply patches/series on a clean tree.
// Fails on the first patch that does not apply, naming it, so the patch set can be repaired.
//
// Each applied patch is recorded as a local commit in ./harness ("patch: <name>"), so `git -C harness diff HEAD`
// shows only what you change on top. To repair or edit one patch:
//   node scripts/prepare.mjs --stop-before privacy/foo.patch   # series applied up to (not including) that patch
//   ...edit files in ./harness...
//   node scripts/refresh-patch.mjs privacy/foo.patch            # rewrite the patch from your edits
//   node scripts/prepare.mjs                                    # whole series again
//
// Usage: node scripts/prepare.mjs [--commit <sha>] [--stop-before <patch>]
//   --commit overrides upstream.json, e.g. to try a newer upstream
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = join(root, 'harness')
const { values } = parseArgs({ options: { commit: { type: 'string' }, 'stop-before': { type: 'string' } } })
const upstream = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8'))
const commit = values.commit ?? upstream.commit
const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8'))

const git = (...args) => execFileSync('git', ['-C', harness, ...args], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim()

if (!existsSync(join(harness, '.git'))) {
  mkdirSync(harness, { recursive: true })
  git('init', '--quiet')
  git('config', 'core.longpaths', 'true')
  git('config', 'core.autocrlf', 'false')
  git('remote', 'add', 'origin', upstream.repository)
}
let have = ''
try { have = git('rev-parse', '--verify', '--quiet', `${commit}^{commit}`) } catch { /* not fetched yet */ }
if (have === '') {
  console.log(`prepare: fetching upstream ${commit.slice(0, 12)}`)
  git('fetch', '--quiet', '--depth', '1', 'origin', commit)
}
// Back to pristine upstream; ignored files (node_modules, build output) are kept for faster rebuilds.
git('checkout', '--quiet', '--force', '--detach', commit)
git('clean', '--quiet', '-fd')

const series = readFileSync(join(root, 'patches', 'series'), 'utf8').split(/\r?\n/u)
  .map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#'))
const stopBefore = values['stop-before']
if (stopBefore !== undefined && !series.includes(stopBefore)) console.log(`prepare: ${stopBefore} is not in patches/series yet; applying the whole series`)
const scratch = join(root, '.prepare')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
// Bookkeeping commits only: upstream's own git hooks are skipped and nothing is pushed.
const record = message => execFileSync('git', ['-C', harness, '-c', 'user.name=libre-prepare', '-c', 'user.email=libre-prepare@localhost',
  'commit', '--quiet', '--no-verify', '--allow-empty', '-a', '-m', message], { stdio: ['ignore', 'ignore', 'inherit'] })
const applied = []
for (const [index, name] of series.entries()) {
  if (name === stopBefore) {
    console.log(`prepare: stopped before ${name}; edit ./harness, then run scripts/refresh-patch.mjs ${name}`)
    break
  }
  let text = readFileSync(join(root, 'patches', name), 'utf8')
  for (const [key, value] of Object.entries(brand)) text = text.replaceAll(`!!${key}!!`, value)
  const unknown = text.match(/!![A-Z_]+!!/u)
  if (unknown) throw new Error(`prepare: ${name} uses ${unknown[0]}, which brand.json does not define`)
  const filled = join(scratch, `${String(index).padStart(3, '0')}.patch`)
  writeFileSync(filled, text)
  try {
    execFileSync('git', ['-C', harness, 'apply', '--whitespace=nowarn', filled], { stdio: ['ignore', 'inherit', 'pipe'] })
  } catch (error) {
    console.error(`prepare: FAILED to apply ${name} on upstream ${commit.slice(0, 12)}`)
    console.error(String(error.stderr ?? error.message))
    process.exit(1)
  }
  // New files must be tracked before `commit -a` picks them up.
  execFileSync('git', ['-C', harness, 'add', '-A'], { stdio: 'ignore' })
  record(`patch: ${name}`)
  applied.push(name)
  console.log(`prepare: applied ${name}`)
}
rmSync(scratch, { recursive: true, force: true })
const complete = applied.length === series.length
writeFileSync(join(harness, '.libre-prepared.json'), `${JSON.stringify({ commit, complete, patches: applied }, null, 2)}\n`)
console.log(`prepare: ${applied.length}/${series.length} patches applied on ${commit.slice(0, 12)}`)
