# Roadmap

These are features only a desktop client can offer: a browser tab cannot keep running with the game closed, open local sockets or servers, watch files, reach Discord's local IPC, or encode video natively. None is built yet, and the order is a suggestion.

One rule shapes everything here: client features are social, convenience, and creator tools. They never touch input, physics, or anything else that makes a client run differ from a browser run. Client identity is self-reported, and ranked play has to mean the same thing everywhere.

## Next

- **Discord Join.** Friends press Join on your Discord profile and land in your server, private lobby, or `!race` duel. This uses the join-secret flow over the IPC connection the client already holds. It must be opt-in per lobby or limited to public servers: today no room identifier or join secret is ever sent, and private lobbies must stay private by default. Check whether Discord shows custom buttons alongside a join secret; it may allow only one.
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

These pieces live in the game, not the client, and ship with a website release:

- **GPU back-pressure under the browser uncap.** The client now reports `browserUncapped` in its public settings. When it is true, the game's `requestAnimationFrame` loop should wait on the same `GpuFence` its own uncapped loop uses, so at most one frame is queued (`frame-loop.ts`).
- **Frame-time benchmark.** A 30-second capture in F10 that reports frame times (p50, p99, max) for the current settings, so profiles are compared with numbers rather than feel. The game has to report frame timings to the bridge; production builds expose no render hook.
- **Profile-aware hints.** When the client runs Competitive, the game's Graphics settings could point to Exceed monitor FPS and the low-latency canvas.

## Not planned

- **A native raw-input sidecar.** It would end pointer-lock acceleration problems, but it breaks parity with browser input and the counted-yaw anticheat design. The client keeps the game's browser input.
- **Any client-only gameplay advantage**, including input timing or a frame path ranked browser players cannot use.
