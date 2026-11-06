# Repairing the patch set after an upstream update

You are running in GitHub Actions for libre-deepseek-harness: an unofficial build of
deepseek-ai/deepseek-harness with every China-bound network path removed. `upstream.json` now pins a
newer upstream commit, and `node scripts/prepare.mjs` or `node scripts/build.mjs` failed. Make the
patch set work on the new upstream without losing what any patch is for.

## How the repository works

- `patches/series` lists patches in order; each `patches/**/*.patch` starts with a one-paragraph
  description of what it changes and why, followed by a `git diff`.
- `node scripts/prepare.mjs` checks out the pinned upstream into `./harness` and applies the series,
  committing each patch locally. It stops at the first patch that fails and names it.
- To repair a patch: `node scripts/prepare.mjs --stop-before <patch>`, re-make the change it describes
  in `./harness` against the new upstream code, then `node scripts/refresh-patch.mjs <patch>`.
  Repeat `prepare.mjs` until every patch applies.
- `node scripts/build.mjs` installs, builds, packs and runs `scripts/scan-domains.mjs`, which fails when
  shipped files reference a host in `domains/blocklist.txt` that `domains/allowlist.txt` does not excuse.
  Use `--skip-install` on repeat runs.

## Rules

1. Keep every patch's intent. Read its description and the old diff, find where upstream moved or
   renamed that code, and make the equivalent change. Do not drop a patch because it no longer applies.
2. If upstream already made a patch unnecessary (the China-bound path is gone), delete the patch file
   and its `patches/series` line, and say so in your summary.
3. If the domain scan finds a new China-bound host, prefer a patch that removes or disables the path
   (new file under `patches/privacy/`, added to `patches/series` via `refresh-patch.mjs --message`).
   Add an allowlist entry only for text that is never requested (labels, lookup tables, documentation
   links) or for an opt-in model provider that is contacted only with a user-supplied key, and give a
   specific reason. Never remove or weaken a `domains/blocklist.txt` rule.
4. Do not edit `upstream.json`, the workflows, or anything outside `patches/` and `domains/allowlist.txt`
   unless a script itself is broken by the upstream change; explain any such edit.
5. Finish only when `node scripts/prepare.mjs` and `node scripts/build.mjs --skip-install` both pass.
   If you cannot get there, stop and explain exactly which patch or check still fails and why.
6. Write a short summary for the pull request to `.github/claude/last-repair.md`: what upstream changed,
   which patches you rewrote, added or removed, any allowlist entries added with their reasons, and
   anything a human reviewer should look at closely. Do not commit or push; the workflow does that.
