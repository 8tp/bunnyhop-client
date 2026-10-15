# Roadmap

The client only does what a browser tab can't: run with the game closed, reach Discord and other local apps, keep files on disk, encode video natively. Everything else ships with the game on bunnyhop.lol. The order below is a suggestion.

Nothing here may give a player an advantage. Client identity is self-reported, and a ranked run has to mean the same in the client and in a browser.

## Next

- **Notifications with the game closed.** A tray icon with online friends and invites, an optional launch at login, and a notice when a friend comes online, challenges you to a race, or beats your world record. Needs a lightweight connection to the game's friends service from the main process.
- **LiveSplit auto-splitting.** Split on the game's stage and zone triggers through LiveSplit Server. Needs a game hook that reports zone entries.
- **An OBS overlay.** A local server for an OBS browser source with speed, keys, sync and the PB split. It needs a per-install token and a Host-header check so no other site can read it. `status.json` in the vault is the start of it.

## Later

- **Map hot reload for mappers.** Point the client at a folder; when a `.bsp` there is rebuilt, the game reloads it in place and keeps your position. Local maps play unranked.
- **Instant replay.** A rolling hardware-encoded buffer, a key that saves the last 30 seconds, and an optional vertical clip of each PB.
- **A replay vault.** Save every finished run's `.bhr` automatically, so a PB replay never depends on a download.
- **Offline practice.** Cached maps and the physics with no network. Runs count only after the normal server verification once you're back online.
- **A mouse and display check in F10.** Polling rate, a warning for OS pointer acceleration, and the refresh rate the game actually gets.
- **Profile hints in the game.** With Competitive on, the game's Graphics settings could point to Exceed monitor FPS and the low-latency canvas.

## Not planned

- **A native raw-input sidecar.** It would sidestep pointer-lock acceleration problems, but it breaks parity with browser input and the anticheat's counted-yaw design.
- **Anything that changes a run**, including input timing or a frame path a browser player can't use.

## Done

- **0.2.0:** Discord Join, the frame-time benchmark, GPU back-pressure when the whole browser is uncapped, and the redrawn settings window.
- **0.1.x:** Discord presence, the run vault and PB screenshots, the map cache, profiles, and the signed update notice.
