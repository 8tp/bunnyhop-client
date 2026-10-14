# Changelog

## Unreleased

- Competitive no longer uncaps the whole browser, raises only the main process, or sets extra GPU flags; on a fast Windows machine that ran worse than Balanced. It now raises the browser, GPU, and game processes to Above normal on Windows. Frames past the refresh rate come from the game's Exceed monitor FPS setting. Saved Competitive settings migrate.
- The browser-wide uncap is an experimental switch that no profile sets. The client reports it to the game as `browserUncapped`.
- Added "Prefer the discrete GPU" (on by default) in place of the experimental GPU flag set. High priority became Above normal.
- Content-cache hashing moved off the main process thread.
- Replaced electron-updater with a signed release note: release builds check GitHub for an Ed25519-signed `bunnyhop-update.json` and show a notice. Nothing is downloaded or installed automatically.
- Free unsigned packaging: per-user one-click Windows installer and portable zip, Apple silicon and Intel DMGs, x64 AppImage and `.deb`, all built from one Mac. Added `scripts/release.mjs` (key, signed manifest, checksums, draft release) and removed the inert signing helpers.
- The smoke harness moved to `electron/smoke.mjs` and never runs in a release build.
- Added install instructions, a free release process, and a roadmap.

- Added permanent, hash-verified map and shared-content caching with local reads across restarts.
- Fixed Discord artwork forwarding through the sandbox preload.

- Added Discord map artwork with a Bunnyhop logo badge and privacy-aware logo fallback.

- Adapted the dedicated Electron shell to Bunnyhop and retained browser-native game input.
- Added Bunnyhop settings, display/rendering profiles, local diagnostics, screenshot export, and a bounded run-summary vault.
- Added optional PB screenshots tied to the matching visible result card.
- Added opt-in Bunnyhop Discord Rich Presence with local IPC, reconnect, map visibility, and privacy controls.
- Allowed safe game downloads, including browser-generated `.bhr` replays, and validated map/server/replay deep links.
- Added local native packaging and guarded release-preparation scripts.
- Added repository branding; GitHub Actions is disabled and workflow files are removed.

Package version `0.1.0` has not been published yet. Releases are unsigned by design (docs/releases.md). There are no client latency measurements yet.
