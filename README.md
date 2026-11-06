# Libre DeepSeek Harness

An unofficial build of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with every China-bound network path removed, in the spirit of [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium) and [VSCodium](https://github.com/VSCodium/vscodium). It is not affiliated with or endorsed by DeepSeek. DeepSeek Harness is MIT-licensed; this project keeps that license and its notices.

This repository holds no copy of the upstream code. It holds a pinned upstream commit, an ordered set of patches, a domain block-list that every build is checked against, and the scripts and workflows that turn them into releases.

## What is different from upstream

| Upstream | This build |
|---|---|
| Default model on api.deepseek.com | OpenRouter, `anthropic/claude-sonnet-5.5` (add your key in Settings > Models) |
| Session logs uploaded to DeepSeek's telemetry collector (deepseeksvc.com) | Off on every launch |
| Full session log and installed-plugin list attached to DeepSeek API requests | Off |
| DeepSeek account sign-in, account panel, DeepSeek web search | Off (`web_fetch` still works) |
| npm mirror in China (npmmirror.com) pinged and used as a fallback | Removed |
| Contact form on feishu.cn | Removed |
| Voice-input model downloaded from a China-run Hugging Face mirror | huggingface.co only |
| MCP tools that return plain text despite declaring an output schema fail opaquely | The model gets the server's text as a tool error |
| Desktop app updates from download.deepseek.com (Tencent Cloud, Beijing) | Updates from this repository's GitHub Releases |
| Desktop mandatory-update service, with Feishu login in test builds | Removed |
| Desktop product analytics | Off |
| Desktop first run offers DeepSeek sign-in or a DeepSeek key | Asks for an OpenRouter key (or skip) |
| DeepSeek name and whale artwork | Libre DeepSeek Harness name and original icon; installs beside the official app with its own data folder |

DeepSeek and other Chinese model providers remain selectable if you add your own key for them.

## Install

Releases are published at <https://github.com/henryennis/libre-deepseek-harness/releases>.

**Desktop app** (Windows x64): download `libre-deepseek-harness-<version>-win-x64-unsigned.exe` from the latest release and run it. The installer is not code-signed, so Windows SmartScreen asks you to confirm ("More info", then "Run anyway") the first time. After that the app checks this repository's releases and offers updates itself (Settings > General chooses the nightly or stable channel; both follow every release).

**CLI and web UI** (Windows, macOS or Linux; needs Node.js 24.9+):

```
git clone https://github.com/henryennis/libre-deepseek-harness
cd libre-deepseek-harness
node scripts/update-cli.mjs
dsh web
```

Run `node scripts/update-cli.mjs` again to update; it does nothing if the latest release is already installed.

## How it works

| Path | Role |
|---|---|
| `upstream.json` | The upstream commit every build starts from |
| `patches/series` | Patch order; each `patches/**/*.patch` starts with what it changes and why |
| `brand.json` | Values substituted for `!!NAME!!` placeholders inside patches |
| `domains/blocklist.txt` | China-bound hosts that must not appear in shipped files |
| `domains/allowlist.txt` | Justified exceptions (opt-in providers, labels, lookup tables) |
| `scripts/prepare.mjs` | Checks out the pinned upstream into `harness/` and applies the series |
| `scripts/build.mjs` | Builds, packs the npm tarballs into `dist/`, runs the domain scan |
| `scripts/scan-domains.mjs` | Fails on any blocked host in the packed files that the allowlist does not excuse |
| `scripts/refresh-patch.mjs` | Rewrites one patch from your edits in `harness/` |
| `scripts/install-cli.mjs`, `scripts/update-cli.mjs` | Install the CLI from local tarballs or from the latest release |
| `scripts/package-desktop.mjs` | Packages the unsigned Windows installer and update manifests into `dist/desktop`, then domain-scans the packaged app |
| `brand/source/icon.svg`, `brand/render-artwork.mjs` | Original artwork, rendered into `brand/overlay/` (copied over upstream files by `prepare.mjs`) |
| `scripts/pin-upstream.mjs` | Moves `upstream.json` to another upstream commit |

### Building the desktop app locally

Windows x64 with Visual Studio C++ build tools and a Windows SDK, PowerShell 7 (`pwsh`) and Python on PATH (or set `PYTHON`):

```
node scripts/prepare.mjs
node scripts/build.mjs
node scripts/package-desktop.mjs
```

### Workflows

- **Upstream sync** (daily): pins the newest upstream commit, prepares and builds. If a patch no longer applies or the scan finds a new China-bound host, [Claude Code](https://github.com/anthropics/claude-code-action) repairs the patch set following `.github/claude/repair-patches.md`. The result arrives as a pull request for review.
- **CI**: every pull request must prepare, build, pass the domain scan and pass the tests of patched packages.
- **Release**: merging to `main` builds and publishes a release.

The upstream sync needs one repository secret: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY`.

### Working on a patch

```
node scripts/prepare.mjs --stop-before privacy/no-npmmirror.patch
# edit files under harness/
node scripts/refresh-patch.mjs privacy/no-npmmirror.patch
node scripts/prepare.mjs && node scripts/build.mjs --skip-install
```

New patch: make the edits after a full `prepare.mjs`, then `node scripts/refresh-patch.mjs privacy/new-thing.patch --message "What it changes and why."`.
