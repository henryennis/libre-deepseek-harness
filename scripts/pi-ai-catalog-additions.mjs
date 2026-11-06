#!/usr/bin/env node
// Add models from a newer @earendil-works/pi-ai catalog to the pi-ai version ./harness pins, without changing its code
// or any existing catalog entry. Regenerates upstream's pnpm patch for that version as: upstream's own changes, plus
// dist/providers/data/<provider>.additions.json files and a merge in each affected dist/providers/<provider>.models.js.
// Run `pnpm install --no-frozen-lockfile` in ./harness afterwards so the lockfile records the new patch hash.
//
// Usage: node scripts/pi-ai-catalog-additions.mjs [--from <newer pi-ai version, default latest>]
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = join(root, 'harness')
const { values } = parseArgs({ options: { from: { type: 'string', default: 'latest' } } })
const workspace = readFileSync(join(harness, 'pnpm-workspace.yaml'), 'utf8')
const pinned = workspace.match(/^\s*'@earendil-works\/pi-ai@([^']+)':\s*(\S+)\s*$/mu)
if (!pinned) throw new Error('pi-ai-catalog-additions: no patchedDependencies entry for @earendil-works/pi-ai in pnpm-workspace.yaml')
const [, version, patchPath] = pinned
const work = mkdtempSync(join(tmpdir(), 'ldh-pi-ai-'))
const shell = process.platform === 'win32'

/** Download and unpack one pi-ai version into <work>/<name>; tar runs beside the file (GNU tar misreads "C:"). */
function unpack(spec, name) {
  const file = execFileSync('npm', ['pack', `@earendil-works/pi-ai@${spec}`, '--silent'], { cwd: work, encoding: 'utf8', shell }).trim().split(/\r?\n/u).pop()
  mkdirSync(join(work, name))
  execFileSync('tar', ['-xzf', file, '-C', name, '--strip-components=1'], { cwd: work, stdio: 'ignore' })
  return JSON.parse(readFileSync(join(work, name, 'package.json'), 'utf8')).version
}
try {
  unpack(version, 'a')
  const newer = unpack(values.from, 'newer')
  cpSync(join(work, 'a'), join(work, 'b'), { recursive: true })
  // Upstream's own changes to this version come first, read from the pinned upstream commit so a re-run never
  // stacks additions on additions.
  const upstreamPatch = join(harness, patchPath)
  const upstreamCommit = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8')).commit
  let original = ''
  try { original = execFileSync('git', ['-C', harness, 'show', `${upstreamCommit}:${patchPath}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }
  catch { /* upstream does not patch this version */ }
  if (original !== '') {
    writeFileSync(join(work, 'upstream.patch'), original)
    execFileSync('git', ['apply', '--whitespace=nowarn', join(work, 'upstream.patch')], { cwd: join(work, 'b'), stdio: 'inherit' })
  }
  const data = join(work, 'b', 'dist', 'providers', 'data')
  const newerData = join(work, 'newer', 'dist', 'providers', 'data')
  let total = 0
  const providers = []
  for (const file of readdirSync(data).filter(n => n.endsWith('.json') && !n.startsWith('.') && !n.endsWith('.additions.json'))) {
    if (!existsSync(join(newerData, file))) continue
    const current = JSON.parse(readFileSync(join(data, file), 'utf8'))
    const later = JSON.parse(readFileSync(join(newerData, file), 'utf8'))
    const additions = {}
    for (const [api, entries] of Object.entries(later)) {
      if (!(api in current)) continue // a protocol this version cannot serve
      for (const [key, entry] of Object.entries(entries)) {
        if (!(key in current[api])) (additions[api] ??= {})[key] = entry
      }
    }
    const count = Object.values(additions).reduce((sum, entries) => sum + Object.keys(entries).length, 0)
    if (count === 0) continue
    const provider = file.slice(0, -'.json'.length)
    const module = join(work, 'b', 'dist', 'providers', `${provider}.models.js`)
    const importLine = `import values from "./data/${file}" with { type: "json" };`
    const source = existsSync(module) ? readFileSync(module, 'utf8') : ''
    if (!source.includes(importLine)) { console.warn(`  skipped ${provider}: ${provider}.models.js does not import ./data/${file} the expected way`); continue }
    writeFileSync(join(data, `${provider}.additions.json`), `${JSON.stringify(additions, null, 1)}\n`)
    writeFileSync(module, source.replace(importLine, [
      `import catalog from "./data/${file}" with { type: "json" };`,
      `import additions from "./data/${provider}.additions.json" with { type: "json" };`,
      `// libre-deepseek-harness: models from pi-ai ${newer}'s catalog, added without changing existing entries.`,
      'const values = Object.fromEntries(Object.entries(catalog).map(([api, entries]) => [api, { ...entries, ...(additions[api] ?? {}) }]));',
    ].join('\n')))
    total += count
    providers.push(`${provider} (${count})`)
  }
  // The patch is a diff of pristine `a` against `b`, with package-relative paths as pnpm writes them.
  let diff = ''
  try { execFileSync('git', ['diff', '--no-index', '--no-color', 'a', 'b'], { cwd: work, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }) }
  catch (error) { diff = error.stdout } // exit code 1 means "differences found"
  // `git diff --no-index a b` prefixes paths with the compared folder; a file that exists on one side only keeps that
  // side's folder in both header paths (a/b/..., b/b/...). Strip whichever folder it is.
  diff = diff
    .replace(/^diff --git a\/[ab]\/(\S+) b\/[ab]\/(\S+)$/gmu, 'diff --git a/$1 b/$2')
    .replace(/^--- a\/[ab]\//gmu, '--- a/')
    .replace(/^\+\+\+ b\/[ab]\//gmu, '+++ b/')
  writeFileSync(upstreamPatch, diff)
  console.log(`pi-ai-catalog-additions: ${total} models from pi-ai ${newer} added to ${version}: ${providers.join(', ')}`)
  console.log(`pi-ai-catalog-additions: wrote ${patchPath}; now run \`pnpm install --no-frozen-lockfile\` in ./harness`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
