#!/usr/bin/env node
// Scan packed npm tarballs (what actually ships) for blocked hosts from domains/blocklist.txt.
// A match passes only when domains/allowlist.txt names its package and host pattern with a reason.
//
// Usage: node scripts/scan-domains.mjs <dir-with-.tgz> [...more dirs]
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dirs = process.argv.slice(2)
if (dirs.length === 0) throw new Error('usage: scan-domains.mjs <dir-with-.tgz> [...]')

const rules = file => readFileSync(join(root, 'domains', file), 'utf8').split(/\r?\n/u)
  .map(line => line.replace(/\s+#.*$/u, '').trim()).filter(line => line !== '' && !line.startsWith('#'))
const blocked = rules('blocklist.txt').map(source => new RegExp(source, 'giu'))
// allowlist line: <package-name> <regex matching the offending text>
const allowed = rules('allowlist.txt').map((line) => {
  const [pkg, ...rest] = line.split(/\s+/u)
  return { pkg, pattern: new RegExp(rest.join(' '), 'iu'), line }
})
const used = new Set()

const SCANNED = /\.(js|mjs|cjs|json|ya?ml|html|css|txt|ps1|sh|py)$/u
const SKIPPED = /(\.d\.ts|\.map|\.md)$|(^|\/)(LICENSE|NOTICE|THIRD_PARTY)/u
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

const failures = []
let scannedFiles = 0
for (const dir of dirs.map(d => resolve(d))) {
  for (const tarball of readdirSync(dir).filter(name => name.endsWith('.tgz'))) {
    const out = mkdtempSync(join(tmpdir(), 'ldh-scan-'))
    try {
      // GNU tar reads "C:" as a remote host; run beside the tarball instead.
      execFileSync('tar', ['-xzf', tarball, '-C', out.replaceAll('\\', '/').replace(/^([A-Za-z]):/u, '/$1')], { cwd: dir, stdio: 'ignore' })
      const manifest = JSON.parse(readFileSync(join(out, 'package', 'package.json'), 'utf8'))
      for (const file of walk(join(out, 'package'))) {
        const rel = relative(join(out, 'package'), file).replaceAll('\\', '/')
        if (!SCANNED.test(rel) || SKIPPED.test(rel)) continue
        scannedFiles += 1
        const text = readFileSync(file, 'utf8')
        for (const rule of blocked) {
          for (const match of text.matchAll(rule)) {
            const excuse = allowed.find(a => a.pkg === manifest.name && a.pattern.test(match[0]))
            if (excuse) { used.add(excuse.line); continue }
            const line = text.slice(0, match.index).split('\n').length
            failures.push(`${manifest.name}  ${rel}:${line}  ${match[0]}`)
          }
        }
      }
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }
}
const stale = allowed.filter(a => !used.has(a.line))
for (const a of stale) console.warn(`scan-domains: allowlist entry never matched (remove it?): ${a.line}`)
if (failures.length > 0) {
  console.error(`scan-domains: ${failures.length} blocked host reference(s) in shipped files:`)
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`)
  process.exit(1)
}
console.log(`scan-domains: OK, ${scannedFiles} shipped files clean (${used.size} allowlisted reference kinds)`)
