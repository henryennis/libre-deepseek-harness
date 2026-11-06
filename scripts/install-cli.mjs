#!/usr/bin/env node
// Install the packed CLI tarballs into a self-contained app folder and put `dsh` on PATH.
// Every package that has a local tarball is installed from it, never from the npm registry (the registry
// copies are the unmodified upstream build); third-party dependencies come from registry.npmjs.org.
// Fails if any installed copy of a locally packed package resolved elsewhere.
//
// Usage: node scripts/install-cli.mjs [--app <dir>] [--bin <dir on PATH>] --from <dir with .tgz> [--from ...]
//   defaults: --app %LOCALAPPDATA%\libre-deepseek-harness\cli (or ~/.local/share/...), --bin the npm global bin
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { app: { type: 'string' }, from: { type: 'string', multiple: true }, bin: { type: 'string' } } })
if (!values.from?.length) throw new Error('usage: install-cli.mjs [--app <dir>] [--bin <dir>] --from <dir> [--from ...]')
const win = process.platform === 'win32'
const app = resolve(values.app ?? (win ? join(process.env.LOCALAPPDATA ?? homedir(), 'libre-deepseek-harness', 'cli') : join(homedir(), '.local', 'share', 'libre-deepseek-harness', 'cli')))
const npmPrefix = execFileSync('npm', ['config', 'get', 'prefix'], { encoding: 'utf8', shell: win }).trim()
const binDir = resolve(values.bin ?? (win ? npmPrefix : join(npmPrefix, 'bin')))

/** Read package/package.json from a tarball without unpacking it (tar runs beside the file: GNU tar misreads "C:"). */
const manifestOf = tarball => JSON.parse(execFileSync('tar', ['-xOzf', basename(tarball), 'package/package.json'], { cwd: dirname(tarball), encoding: 'utf8' }))
const accepts = (list, current) => !Array.isArray(list) || list.length === 0
  || (list.some(v => v === current) || (list.every(v => v.startsWith('!')) && !list.includes(`!${current}`)))

const dependencies = {}
const optionalDependencies = {}
for (const dir of values.from.map(d => resolve(d))) {
  for (const file of readdirSync(dir).filter(name => name.endsWith('.tgz')).sort()) {
    const tarball = join(dir, file)
    const manifest = manifestOf(tarball)
    const compatible = accepts(manifest.os, process.platform) && accepts(manifest.cpu, process.arch)
    ;(compatible ? dependencies : optionalDependencies)[manifest.name] = pathToFileURL(tarball).href
  }
}
if (dependencies['@deepseek-ai/dsh'] === undefined) throw new Error('install-cli: @deepseek-ai/dsh is not among the tarballs')

rmSync(join(app, 'node_modules'), { recursive: true, force: true })
mkdirSync(app, { recursive: true })
writeFileSync(join(app, 'package.json'), `${JSON.stringify({ name: 'libre-deepseek-harness-cli', version: '0.0.0', private: true, dependencies, optionalDependencies }, null, 2)}\n`)
const env = { ...process.env }
for (const key of ['npm_config_user_agent', 'NPM_CONFIG_USER_AGENT', 'NODE_OPTIONS', 'NODE_PATH']) delete env[key]
console.log(`install-cli: installing ${Object.keys(dependencies).length} local packages into ${app}`)
// Optional dependencies stay on: some native packages (koffi) ship their prebuilt binary as one.
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false', '--registry=https://registry.npmjs.org/'],
  { cwd: app, env, stdio: 'inherit', shell: win })

const lock = JSON.parse(readFileSync(join(app, 'node_modules', '.package-lock.json'), 'utf8'))
const packed = new Set([...Object.keys(dependencies), ...Object.keys(optionalDependencies)])
const installed = Object.entries(lock.packages).map(([path, entry]) => ({ path, name: path.replace(/^.*node_modules\//u, ''), resolved: entry.resolved ?? '' }))
const foreign = installed.filter(row => packed.has(row.name) && !row.resolved.startsWith('file:'))
if (foreign.length > 0) throw new Error(`install-cli: packages resolved outside the local tarballs:\n${foreign.map(r => `  ${r.path} <- ${r.resolved}`).join('\n')}`)
console.log(`install-cli: verified ${installed.filter(row => packed.has(row.name)).length} installed copies came from local tarballs`)

const entry = join(app, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(entry)) throw new Error(`install-cli: missing ${entry}`)
mkdirSync(binDir, { recursive: true })
if (win) {
  writeFileSync(join(binDir, 'dsh.cmd'), `@ECHO off\r\nnode "${entry}" %*\r\n`)
  writeFileSync(join(binDir, 'dsh.ps1'), `#!/usr/bin/env pwsh\n& node "${entry}" @args\nexit $LASTEXITCODE\n`)
}
writeFileSync(join(binDir, 'dsh'), `#!/bin/sh\nexec node "${entry.replaceAll('\\', '/')}" "$@"\n`, { mode: 0o755 })
console.log(`install-cli: dsh shims written to ${binDir}`)
