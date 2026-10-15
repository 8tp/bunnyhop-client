# Roadmap

These are features only a desktop client can offer: a browser tab cannot keep running with the game closed, open local sockets or servers, watch files, reach Discord's local IPC, or encode video natively. The order is a suggestion.

One rule shapes everything here: client features are social, convenience, and creator tools. They never touch input, physics, or anything else that makes a client run differ from a browser run. Client identity is self-reported, and ranked play has to mean the same thing everywhere.

## Built, waiting for a game release

- **Discord Join.** Friends press Join on your Discord profile and land in your server. Public servers are joinable by default (F10 → Discord → Friends can join); private lobbies only with Include private lobbies on, and never in privacy mode. The activity carries a party (a hash of the room id, so a lobby's invite code never shows) and a join secret (`bh1:s:<server>` or `bh1:l:<code>`); Discord takes a secret or buttons, not both, so Play Bunnyhop is dropped while joinable. The friend's client receives ACTIVITY_JOIN, checks the secret (`joinTarget`) and opens `?server=<id>` or `?lobby=<code>`. Packaged builds register `discord-<application id>://` so Discord can start a closed client. If Discord refuses the subscription or the secret, presence carries on without Join. Needs the game's `room` in presence and its map-less `?server=<id>` link (game branch `desktop-hooks`).
- **GPU back-pressure under the browser uncap.** With Uncap the whole browser on, the game's `requestAnimationFrame` path waits on the same `GpuFence` as its uncapped loop (`frame-loop.ts` `gateRaf`), so at most one frame is queued.
- **Frame-time benchmark.** F10 → Performance → Benchmark asks the game for 30 seconds of play on the current map and keeps the last 20 results (`vault/benchmarks.json`) with the launch settings and display, so profiles are compared with numbers rather than feel.

## Next

- **Tray and notifications with the game closed.** "Friend came online", "you were challenged to a race", "your WR on a map was beaten · watch the replay". An optional launch-at-login with a small tray menu of online friends and invites. This needs the friends backend (the Social Durable Object and its bell) and a lightweight connection from the main process.
- **LiveSplit auto-splitting.** Connect to LiveSplit Server and split on the game's stage and zone triggers. It needs a game hook that reports zone entries to the client bridge.
- **A local OBS overlay.** A `127.0.0.1` server that serves speed, keys, sync, and the PB split as an OBS browser source. It needs a per-install token and a Host-header check, so other sites cannot reach it (DNS rebinding). `status.json` in the vault is the start of it.

## Later

- **Map hot reload for mappers.** Point the client at a folder. When a `.bsp` there is recompiled, the game reloads it in place and keeps your position. Local maps play unranked only.
- **Instant replay and automatic PB clips.** A rolling hardware-encoded buffer (NVENC, VideoToolbox, AMF, QSV), a hotkey that saves the last 30 seconds to disk, and an optional vertical short exported on a PB in the same style as the clip campaign. Needs a bundled encoder.
- **Replay vault.** Save every completed run's `.bhr` to disk automatically, so a PB replay never depends on a download dialog or browser storage. It extends the run vault.
- **Offline practice.** Cached maps and the WASM physics, no network. Runs are queued and count only after the normal server replay verification once online. Unverified times never reach leaderboards.
- **Mouse and display check in F10.** Measured polling rate, a warning for OS pointer acceleration (the 2026-10-11 raw-lock bug), and the refresh rate the game is actually getting.

## Needs a game release

- **Profile-aware hints.** When the client runs Competitive, the game's Graphics settings could point to Exceed monitor FPS and the low-latency canvas.

## Not planned

- **A native raw-input sidecar.** It would end pointer-lock acceleration problems, but it breaks parity with browser input and the counted-yaw anticheat design. The client keeps the game's browser input.
- **Any client-only gameplay advantage**, including input timing or a frame path ranked browser players cannot use.
