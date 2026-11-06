#!/usr/bin/env node
// Package the unsigned Windows x64 desktop installer from the prepared ./harness and collect the release files
// (installer, blockmap, nightly.yml and stable.yml update manifests) into dist/desktop.
// Upstream's packager rebuilds the repository itself with its "local" client profile.
//
// Usage: node scripts/package-desktop.mjs [--build-version <product>.<yyyymmdd>.<n>]
//   Needs Windows x64 with Visual Studio C++ build tools, a Windows SDK, PowerShell 7 (pwsh) and Python
//   (set PYTHON if python is not on PATH).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = join(root, 'harness')
const desktop = join(harness, 'apps', 'desktop')
const out = join(root, 'dist', 'desktop')
const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8'))
const { values } = parseArgs({ options: { 'build-version': { type: 'string' } } })
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('package-desktop: needs Windows x64')
if (!existsSync(join(harness, '.libre-prepared.json'))) throw new Error('package-desktop: run scripts/prepare.mjs first')

const product = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version
const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
const buildVersion = values['build-version'] ?? `${product}.${today}.1`

// The packager reads only these keys from .env.windows; no mandatory-update origin is needed after
// patches/desktop/no-mandatory-update-service.patch, and no signing settings for an unsigned build.
writeFileSync(join(desktop, '.env.windows'), [
  `DSH_DESKTOP_APP_ID=${brand.APP_ID}`,
  'DSH_DESKTOP_AUTO_UPDATE_ENV=production',
  'DSH_DESKTOP_NPM_REGISTRY=https://registry.npmjs.org/',
  'DSH_DESKTOP_WINDOWS_COMPRESSION_LEVEL=3',
  '',
].join('\n'))

const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1' }
// Upstream's packager passes absolute C:\ paths to `tar`; only Windows' bsdtar accepts them (Git Bash's GNU tar
// reads "C:" as a remote host), so System32 goes first on PATH.
const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
env[pathKey] = `${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')};${env[pathKey] ?? ''}`
// Release settings must come from .env.windows, never from the parent environment.
for (const key of Object.keys(env)) if (/^(DSH_DESKTOP_|DOWNLOAD_(TEST|PROD)_|CSC_|WIN_CSC_)/iu.test(key)) delete env[key]
console.log(`package-desktop: packaging ${brand.APP_NAME} ${buildVersion}`)
execFileSync('pnpm', ['run', 'package:desktop:win:x64:unsigned', '--', '--build-version', buildVersion], { cwd: harness, env, stdio: 'inherit', shell: true })

const artifacts = join(desktop, '.desktop-build', 'targets', 'win-x64', 'unsigned-artifacts')

// Domain-scan what the installer actually contains: the desktop shell and every bundled @deepseek-ai package.
const resources = join(artifacts, 'win-unpacked', 'resources')
const extracted = join(root, 'dist', 'desktop-app')
rmSync(extracted, { recursive: true, force: true })
const asarDir = readdirSync(join(harness, 'node_modules', '.pnpm')).find(name => name.startsWith('@electron+asar@'))
if (!asarDir) throw new Error('package-desktop: @electron/asar is not installed in ./harness')
const { createRequire } = await import('node:module')
createRequire(import.meta.url)(join(harness, 'node_modules', '.pnpm', asarDir, 'node_modules', '@electron', 'asar')).extractAll(join(resources, 'app.asar'), extracted)
execFileSync(process.execPath, [join(root, 'scripts', 'scan-domains.mjs'), join(extracted, 'dsh'), extracted,
  `@deepseek-ai/dsh-desktop=${join(extracted, 'lib')}`, `@deepseek-ai/dsh-desktop-renderer=${join(extracted, 'renderer')}`,
  join(resources, 'app.asar.unpacked', 'dsh')], { stdio: 'inherit' })
rmSync(extracted, { recursive: true, force: true })
const installer = readdirSync(artifacts).find(name => name.startsWith(`${brand.PACKAGE_NAME}-${buildVersion}-`) && name.endsWith('.exe'))
if (!installer) throw new Error(`package-desktop: no ${brand.PACKAGE_NAME}-${buildVersion}-*.exe in ${artifacts}`)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const name of [installer, `${installer}.blockmap`]) {
  if (!existsSync(join(artifacts, name))) throw new Error(`package-desktop: missing ${name}`)
  copyFileSync(join(artifacts, name), join(out, name))
}

// electron-updater's generic provider reads <channel>.yml from the feed; write both channels the app offers.
const file = join(out, installer)
const sha512 = createHash('sha512').update(readFileSync(file)).digest('base64')
const manifest = [
  `version: ${buildVersion}`,
  'files:',
  `  - url: ${installer}`,
  `    sha512: ${sha512}`,
  `    size: ${statSync(file).size}`,
  `path: ${installer}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n')
for (const channel of ['nightly', 'stable']) writeFileSync(join(out, `${channel}.yml`), manifest)
writeFileSync(join(out, 'version.txt'), `${buildVersion}\n`)
console.log(`package-desktop: ${out}\n  ${readdirSync(out).join('\n  ')}`)
