# Development

## Run it

Use Node.js 22 or newer on a graphical desktop.

```sh
npm ci
npm start                    # the client against the live site
npm start -- --settings      # with the settings window open
```

Source runs never check for updates and don't register `bunnyhop://` links. On Linux, Electron needs its usual runtime libraries.

On macOS, every unsigned build gets a new ad hoc signature, so a rebuilt app may ask for "Bunnyhop Safe Storage" in the login keychain. The smoke tests use throwaway profiles and a mock keychain and never ask.

## Scripts

| Script | |
| --- | --- |
| `npm run check` | Syntax-check every script |
| `npm test` | Unit tests, including a fake Discord IPC server |
| `npm run verify` | Both of the above |
| `npm run electron:smoke` | Launch the real app against a fixture game page and check the bridge, vault, custom CSS, settings window and benchmark round trip |
| `npm run electron:pack` | Build the unpacked app into `dist/electron` |
| `npm run electron:packaged-smoke` | The smoke test against that packaged build |
| `npm run electron:gpu` | Print what Chromium reports about the GPU |
| `npm run release:*` | The release steps in [releases](releases.md) |

Run `verify` and `electron:smoke` before every pull request, and the packaged smoke test for anything that touches packaging.

## Layout

Everything lives in `electron/`.

| File | |
| --- | --- |
| `main.mjs` | The main process: windows, IPC, Discord, updates, the vault and benchmark wiring |
| `policy.mjs` | Trusted origins, navigation rules and Chromium switches |
| `security.mjs` | Deep links, downloads, run summaries and the settings page's file list |
| `settings.mjs` | Settings defaults, profiles, migration and validation |
| `game-preload.cjs` | The bridge the game sees as `window.bunnyhopClient` |
| `settings-preload.cjs` | The bridge the settings window sees as `window.bunnyhopSettings` |
| `settings/` | The F10 settings window (plain HTML, CSS and JS) |
| `discord-rpc.mjs` | Discord's local IPC, presence, and Join |
| `run-vault.mjs` | Run summaries and PB screenshots |
| `benchmark.mjs` | Benchmark results and their store |
| `content-cache.mjs` | The hash-checked map and asset cache |
| `custom-css.mjs` | Reading and watching the custom CSS file |
| `diagnostics.mjs` | Displays, GPU and the support report |
| `update-check.mjs` | The signed update notice |
| `process-priority.mjs` | Windows process priority |
| `smoke.mjs` | The smoke-test harness (never runs in a release build) |

Tests are in `electron/test/`. The release scripts are in `scripts/`.

## The bridge to the game

The game's side lives in the separate bunnyhop.lol project (`apps/web/src/client-bridge.ts`). It looks for `window.bunnyhopClient` with `version: 1` and treats every method as optional, so the game runs the same in a browser and an older client runs a newer game.

| Method | Direction | |
| --- | --- | --- |
| `getSettings()`, `onSettings(listener)` | client → game | Public settings: profile, presence switches, `browserUncapped` |
| `setPresence(presence)` | game → client | What the player is doing, the map, and the room for Discord Join |
| `saveRunSummary(summary)` | game → client | A finished run for the vault |
| `resultSettled(id)` | game → client | The results screen has painted; a PB screenshot can be taken |
| `getCachedContent(sha256)`, `cacheContent(sha256, bytes)` | both | The map cache |
| `onBenchmark(listener)`, `benchmarkResult(result)` | both | F10's benchmark |
| `onCustomCss(listener)` | client → game | The custom CSS file as `{ name, css }`, or `null`; sent on registration and on every save |
| `openSettings()`, `setFullscreen(on)` | game → client | Open F10, toggle fullscreen |

The main process accepts these only from the top frame of the main game window on a bunnyhop.lol origin, and it bounds and validates every value. A change to the bridge needs both projects: keep the client working against today's game, and the game working without the client.

## Rules

- **No gameplay advantage, ever.** Nothing in the client may change input, timing, physics, replays or verification. No native input, no frame path a browser player can't use.
- Keep the renderer sandboxed and context-isolated, and check the sender of every IPC message.
- Treat everything from the page, Discord and the network as untrusted: validate it, bound it, and never turn it into a file path, a URL outside bunnyhop.lol, or a Chromium switch.
- Discord stays optional. The client must work without it.
- Never commit certificates, keys, tokens, player data or built installers.
