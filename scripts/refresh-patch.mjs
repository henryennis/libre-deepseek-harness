#!/usr/bin/env node
// Rewrite one patch file from the uncommitted changes in ./harness (relative to the last applied patch).
// Run after `prepare.mjs --stop-before <patch>` and your edits. Keeps the patch's description paragraph,
// or uses --message for a new patch, and appends a new patch to patches/series if it is not listed yet.
//
// Usage: node scripts/refresh-patch.mjs <patch path under patches/> [--message "<what and why>"]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = join(root, 'harness')
const { values, positionals } = parseArgs({ allowPositionals: true, options: { message: { type: 'string' } } })
const name = positionals[0]
if (!name || !name.endsWith('.patch')) throw new Error('usage: refresh-patch.mjs <dir/name.patch> [--message "..."]')
const file = join(root, 'patches', name)

execFileSync('git', ['-C', harness, 'add', '-A'], { stdio: 'ignore' })
execFileSync('git', ['-C', harness, 'reset', '--quiet', '--', '.libre-prepared.json'], { stdio: 'ignore' })
const diff = execFileSync('git', ['-C', harness, 'diff', '--cached', '--no-color', 'HEAD'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (diff.trim() === '') throw new Error('refresh-patch: ./harness has no changes on top of the last applied patch')

let description = values.message
if (description === undefined && existsSync(file)) description = readFileSync(file, 'utf8').split(/^diff --git /mu)[0].trim()
if (!description) throw new Error(`refresh-patch: ${name} is new; pass --message describing what it changes and why`)
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, `${description}\n\n${diff}`)

const seriesFile = join(root, 'patches', 'series')
const series = readFileSync(seriesFile, 'utf8')
if (!series.split(/\r?\n/u).some(line => line.trim() === name)) {
  writeFileSync(seriesFile, `${series.trimEnd()}\n${name}\n`)
  console.log(`refresh-patch: added ${name} to the end of patches/series (move it if order matters)`)
}
const files = (diff.match(/^diff --git /gmu) ?? []).length
console.log(`refresh-patch: wrote patches/${name} (${files} file${files === 1 ? '' : 's'}); run scripts/prepare.mjs to re-apply the series`)
