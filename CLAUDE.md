# libre-deepseek-harness

A patch-queue fork of deepseek-ai/deepseek-harness (see README.md). Upstream source is never committed here: `scripts/prepare.mjs` checks it out into the ignored `harness/` folder and applies `patches/series`.

- Change upstream behavior only through patches: `prepare.mjs --stop-before <patch>`, edit `harness/`, `refresh-patch.mjs <patch>`. Never commit files under `harness/` or `dist/`.
- Every patch starts with one paragraph saying what it changes and why. Keep patches small and single-purpose; privacy changes go under `patches/privacy/`, branding under `patches/brand/`, desktop shell changes under `patches/desktop/`, unrelated fixes under `patches/fixes/`.
- `scripts/build.mjs` must pass before a change is done: it builds, packs and runs the domain scan. Never weaken `domains/blocklist.txt`; allowlist entries need a specific reason and must only cover text that is never requested or opt-in providers used with a user-supplied key.
- When upstream moves and patches break, follow `.github/claude/repair-patches.md`.
- Upstream's own conventions (its AGENTS.md) apply to code inside patches.
