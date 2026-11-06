#!/usr/bin/env node
// Scan what actually ships for blocked hosts from domains/blocklist.txt. A match passes only when
// domains/allowlist.txt names its package and a pattern for the matched text, with a reason.
//
// Usage: node scripts/scan-domains.mjs <target> [...more targets]
//   <dir with .tgz files>     every packed npm tarball in it
//   <dir with node_modules>   every @deepseek-ai package installed under it (nested copies included)
//   <package-name>=<dir>      one unpacked package directory, scanned under that name
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targets = process.argv.slice(2)
if (targets.length === 0) throw new Error('usage: scan-domains.mjs <dir-with-.tgz | dir-with-node_modules | name=dir> [...]')

const rules = file => readFileSync(join(root, 'domains', file), 'utf8').split(/\r?\n/u)
  .map(line => line.replace(/\s+#.*$/u, '').trim()).filter(line => line !== '' && !line.startsWith('#'))
const blocked = rules('blocklist.txt').map(source => new RegExp(source, 'giu'))
// allowlist line: <package-name> <regex matching the offending text>
const allowed = rules('allowlist.txt').map((line) => {
  const [pkg, ...rest] = line.split(/\s+/u)
  return { pkg, pattern: new RegExp(rest.join(' '), 'iu'), line }
})
const used = new Set()

const SCANNED = /\.(js|mjs|cjs|json|ya?ml|html|css|txt|ps1|sh|py|svg|nsh|cmd)$/u
const SKIPPED = /(\.d\.ts|\.map|\.md)$|(^|\/)(LICENSE|NOTICE|THIRD_PARTY)|(^|\/)node_modules\//u
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

const failures = []
let scannedFiles = 0
let scannedPackages = 0
/** Scan one unpacked package directory; nested node_modules are scanned as their own packages. */
function scanPackage(name, dir) {
  scannedPackages += 1
  for (const file of walk(dir)) {
    const rel = relative(dir, file).replaceAll('\\', '/')
    if (!SCANNED.test(rel) || SKIPPED.test(rel)) continue
    scannedFiles += 1
    const text = readFileSync(file, 'utf8')
    for (const rule of blocked) {
      for (const match of text.matchAll(rule)) {
        const excuse = allowed.find(a => a.pkg === name && a.pattern.test(match[0]))
        if (excuse) { used.add(excuse.line); continue }
        const line = text.slice(0, match.index).split('\n').length
        failures.push(`${name}  ${rel}:${line}  ${match[0]}`)
      }
    }
  }
}
/** Find every @deepseek-ai package below a directory, following nested node_modules. */
function* deepseekPackages(dir) {
  const modules = join(dir, 'node_modules')
  if (!existsSync(modules)) return
  for (const entry of readdirSync(modules)) {
    const scopeDir = join(modules, entry)
    if (entry === '@deepseek-ai') {
      for (const pkg of readdirSync(scopeDir)) {
        const pkgDir = join(scopeDir, pkg)
        if (existsSync(join(pkgDir, 'package.json'))) { yield { name: `@deepseek-ai/${pkg}`, dir: pkgDir }; yield* deepseekPackages(pkgDir) }
      }
    } else if (entry.startsWith('@') && statSync(scopeDir).isDirectory()) {
      for (const pkg of readdirSync(scopeDir)) yield* deepseekPackages(join(scopeDir, pkg))
    } else if (statSync(scopeDir).isDirectory()) {
      yield* deepseekPackages(scopeDir)
    }
  }
}

for (const target of targets) {
  const named = target.match(/^(@?[^=]+)=(.+)$/u)
  if (named) { scanPackage(named[1], resolve(named[2])); continue }
  const dir = resolve(target)
  const tarballs = readdirSync(dir).filter(name => name.endsWith('.tgz'))
  if (tarballs.length > 0) {
    for (const tarball of tarballs) {
      const out = mkdtempSync(join(tmpdir(), 'ldh-scan-'))
      try {
        // GNU tar reads "C:" as a remote host; run beside the tarball and give it a drive-less path.
        execFileSync('tar', ['-xzf', tarball, '-C', out.replaceAll('\\', '/').replace(/^([A-Za-z]):/u, '/$1')], { cwd: dir, stdio: 'ignore' })
        const manifest = JSON.parse(readFileSync(join(out, 'package', 'package.json'), 'utf8'))
        scanPackage(manifest.name, join(out, 'package'))
      } finally {
        rmSync(out, { recursive: true, force: true })
      }
    }
  } else if (existsSync(join(dir, 'node_modules'))) {
    for (const { name, dir: pkgDir } of deepseekPackages(dir)) scanPackage(name, pkgDir)
  } else {
    throw new Error(`scan-domains: ${target} has no .tgz files and no node_modules`)
  }
}
const stale = allowed.filter(a => !used.has(a.line))
for (const a of stale) console.warn(`scan-domains: allowlist entry did not match in this scan: ${a.line}`)
if (failures.length > 0) {
  console.error(`scan-domains: ${failures.length} blocked host reference(s) in shipped files:`)
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`)
  process.exit(1)
}
console.log(`scan-domains: OK, ${scannedFiles} files in ${scannedPackages} packages clean (${used.size} allowlisted reference kinds)`)
