#!/usr/bin/env node
// Update the CLI from the latest GitHub release: download the CLI archive, check it against SHA256SUMS.txt,
// unpack it and reinstall with install-cli.mjs. Skips the install when that release is already installed.
//
// Usage: node scripts/update-cli.mjs [--force] [--app <dir>] [--bin <dir>]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8'))
const { values } = parseArgs({ options: { force: { type: 'boolean' }, app: { type: 'string' }, bin: { type: 'string' } } })
const win = process.platform === 'win32'
const app = resolve(values.app ?? (win ? join(process.env.LOCALAPPDATA ?? homedir(), 'libre-deepseek-harness', 'cli') : join(homedir(), '.local', 'share', 'libre-deepseek-harness', 'cli')))
const ARCHIVE = 'libre-deepseek-harness-cli.zip'

const headers = { accept: 'application/vnd.github+json', 'user-agent': 'libre-deepseek-harness-updater' }
const release = await (await fetch(`https://api.github.com/repos/${brand.GH_REPO}/releases/latest`, { headers })).json()
if (!release.tag_name) throw new Error(`update-cli: no published release found for ${brand.GH_REPO}`)
const stamp = join(app, '.release.json')
if (!values.force && existsSync(stamp) && JSON.parse(readFileSync(stamp, 'utf8')).tag === release.tag_name) {
  console.log(`update-cli: ${release.tag_name} is already installed`)
  process.exit(0)
}
const asset = name => release.assets.find(a => a.name === name)?.browser_download_url
if (!asset(ARCHIVE) || !asset('SHA256SUMS.txt')) throw new Error(`update-cli: release ${release.tag_name} lacks ${ARCHIVE} or SHA256SUMS.txt`)

const work = mkdtempSync(join(tmpdir(), 'ldh-update-'))
try {
  const download = async (url) => Buffer.from(await (await fetch(url, { headers: { 'user-agent': headers['user-agent'] } })).arrayBuffer())
  const archive = await download(asset(ARCHIVE))
  const sums = (await download(asset('SHA256SUMS.txt'))).toString('utf8')
  const expected = sums.split(/\r?\n/u).map(line => line.trim().split(/\s+\*?/u)).find(([, name]) => name === ARCHIVE)?.[0]
  const actual = createHash('sha256').update(archive).digest('hex')
  if (!expected || expected.toLowerCase() !== actual) throw new Error(`update-cli: checksum mismatch for ${ARCHIVE} (expected ${expected}, got ${actual})`)
  writeFileSync(join(work, ARCHIVE), archive)
  // bsdtar (Windows 10+, macOS) and GNU tar with zip support both unpack .zip; run beside the file to avoid "C:" parsing.
  execFileSync('tar', ['-xf', ARCHIVE], { cwd: work, stdio: 'inherit' })
  const args = [join(root, 'scripts', 'install-cli.mjs'), '--app', app, '--from', join(work, 'npm', 'vendor'), '--from', join(work, 'npm', 'dsh')]
  if (values.bin) args.push('--bin', values.bin)
  execFileSync(process.execPath, args, { stdio: 'inherit' })
  writeFileSync(stamp, `${JSON.stringify({ tag: release.tag_name, installedAt: new Date().toISOString() }, null, 2)}\n`)
  console.log(`update-cli: installed ${release.tag_name}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
