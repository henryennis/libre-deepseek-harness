#!/usr/bin/env node
// Point upstream.json at another upstream commit (default: the current tip of the tracked branch).
// Usage: node scripts/pin-upstream.mjs [<commit sha>]   prints the pinned sha
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'upstream.json')
const upstream = JSON.parse(readFileSync(file, 'utf8'))
let commit = process.argv[2]
if (!commit) {
  const line = execFileSync('git', ['ls-remote', upstream.repository, `refs/heads/${upstream.branch}`], { encoding: 'utf8' }).trim()
  commit = line.split(/\s+/u)[0]
}
if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error(`pin-upstream: not a full commit sha: ${commit}`)
const slug = new URL(upstream.repository).pathname.replace(/^\/|\.git$/gu, '')
let date = null
try {
  const response = await fetch(`https://api.github.com/repos/${slug}/commits/${commit}`, { headers: { accept: 'application/vnd.github+json' } })
  if (response.ok) date = (await response.json()).commit.committer.date
} catch { /* the date is informational only */ }
writeFileSync(file, `${JSON.stringify({ ...upstream, commit, date }, null, 2)}\n`)
console.log(commit)
