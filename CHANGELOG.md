# Changelog

## Unreleased

- **Custom CSS.** F10 → Client → Custom CSS picks a `.css` file on your computer (or saves a starter file with New…). The game restyles itself with it and reloads it every time you save, so you can edit it in VS Code and watch the change. Only the file's text and name reach the game; files over 256 KB are refused. Needs the game's Custom CSS setting.

## 0.2.1

- Electron 45.0.0 (Chromium 156.0.8078.48, Node.js 24.22.0) instead of 44.0.0: four Chromium versions newer, the same Chromium as current Chrome stable, with every security fix released since. No other changes.

## 0.2.0

- **Discord Join.** On a public server, friends get a Join button on your Discord profile that opens the same server in their client. Private lobbies only with F10 → Discord → Include private lobbies, never in privacy mode. The invite code never appears in your status.
- **Benchmark.** F10 → Performance → Benchmark measures 30 seconds of play and keeps the last 20 results with the settings they ran with.
- With **Uncap the whole browser** on, the game now waits for the GPU before each frame, so frames can't pile up.
- **A new settings window** in the game's own style: sections on the left, switches, a help line for the row under the pointer, and every change saved at once.
- Discord reconnects only when its own settings change.

Join, the benchmark and the GPU wait need the game update from 2026-10-15; with an older game they stay off.

## 0.1.1

- Discord presence is on by default, and turned on once for settings saved by 0.1.0. Turn it off or hide the map in F10; privacy mode still hides everything.
- Smoke tests never connect to Discord.

## 0.1.0

- Competitive no longer uncaps the whole browser; on a fast Windows machine that ran worse than Balanced. It raises the browser, GPU and game processes to Above normal on Windows instead. Saved Competitive settings move over.
- The whole-browser uncap is an experimental switch no profile sets. The client tells the game about it as `browserUncapped`.
- "Prefer the discrete GPU" (on by default) replaces the old experimental GPU flags. High priority became Above normal.
- The map cache hashes files off the main thread.
- A signed update notice replaces electron-updater. Nothing is downloaded or installed for you.
- Free unsigned installers for Windows, macOS and Linux, all built from one Mac, and `scripts/release.mjs` for the key, the signed note, checksums and draft releases.

## Before 0.1.0

- The Electron shell, adapted to Bunnyhop, keeping the game's browser input.
- Settings with display and rendering profiles, diagnostics, screenshots and the run vault.
- PB screenshots tied to the visible results screen.
- Discord presence over local IPC, with map artwork, a logo badge, reconnects and privacy controls.
- The hash-checked map cache.
- Safe downloads, including `.bhr` replays, and checked map, server and replay links.
