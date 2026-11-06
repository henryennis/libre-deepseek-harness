#!/usr/bin/env node
// Build the prepared ./harness: install dependencies, build the official artifacts, pack the npm
// tarballs into dist/npm/{vendor,dsh}, and fail if any shipped file references a blocked host.
//
// Usage: node scripts/build.mjs [--skip-install] [--desktop]
//   --desktop  also package the unsigned Windows desktop installer (see scripts/package-desktop.mjs)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = join(root, 'harness')
const dist = join(root, 'dist')
const { values } = parseArgs({ options: { 'skip-install': { type: 'boolean' }, desktop: { type: 'boolean' } } })
if (!existsSync(join(harness, '.libre-prepared.json'))) throw new Error('build: run scripts/prepare.mjs first')

const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1' }
const shell = process.platform === 'win32'
const run = (command, args, cwd = harness) => {
  console.log(`build: ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, env, stdio: 'inherit', shell })
}

if (!values['skip-install']) run('pnpm', ['install', '--frozen-lockfile'])
run('pnpm', ['exec', 'tsx', 'scripts/build.ts', '--scope', 'artifacts', '--profile', 'official'])
mkdirSync(join(dist, 'npm'), { recursive: true })
for (const family of ['vendor', 'dsh']) {
  run('pnpm', ['exec', 'tsx', 'scripts/release/pack.ts', '--family', family, '--out', join(dist, 'npm', family), '--concurrency', '8'])
}
run('node', [join(root, 'scripts', 'scan-domains.mjs'), join(dist, 'npm', 'vendor'), join(dist, 'npm', 'dsh')], root)
if (values.desktop) run('node', [join(root, 'scripts', 'package-desktop.mjs')], root)
console.log('build: done')
