# How the client works

The client is a small Electron shell around [bunnyhop.lol](https://bunnyhop.lol). It loads the live site in a sandboxed window and adds a few things a browser tab can't do: pick a display and GPU, talk to Discord, keep files on disk, and open `bunnyhop://` links.

One rule shapes all of it: **the client never changes gameplay.** Input, physics, replays and run verification are the browser game's own. A run in the client counts exactly like a run in the browser.

## Settings

Press <kbd>F10</kbd> anywhere to open the settings window. Every change saves at once. Changes to the window or rendering show a restart bar; restart from there when you're ready.

### Profiles

A profile sets the window and rendering options together. Change any of them by hand and the profile becomes Custom.

| | Balanced | Competitive | Compatibility |
| --- | --- | --- | --- |
| Window | Fullscreen | Fullscreen | Windowed |
| Highest-refresh display | Yes | Yes | No |
| Discrete GPU | Yes | Yes | No |
| Process priority (Windows) | Normal | Above normal | Normal |

Balanced is the default. Competitive raises the browser, GPU and game processes to Above normal on Windows, which keeps background apps from taking their time.

No profile uncaps the frame rate. To draw past your refresh rate, turn on **Exceed monitor FPS** in the game's own Graphics settings, which paces frames on the GPU.

### Other options

- **Display.** Primary, highest refresh, or a specific monitor.
- **GPU backend.** Automatic, Direct3D 11 (Windows), Vulkan or OpenGL. Leave it on Automatic unless the game fails to start or stutters.
- **Force 100% scale.** Renders at 1:1 whatever the system's display scale is.
- **Uncap the whole browser.** Experimental. It lifts the frame limit for the menus and compositor as well, and often feels worse than Exceed monitor FPS. While it's on, the game waits for the GPU before drawing each frame, so frames can't pile up.

### Launch options

These apply to one launch and are never saved:

```text
--windowed  --fullscreen  --kiosk
--uncap  --no-uncap
--discrete-gpu  --no-discrete-gpu
--settings      open the settings window at launch
```

## Discord

The client shows what you're doing on your Discord profile: the map, whether you're in a run, paused or watching a replay, and how long you've been at it. It talks to the Discord desktop app over its local connection and reconnects if Discord starts late or restarts.

- **Map name and artwork** can be turned off; then your status just says Bunnyhop.
- **Friends can join.** On a public server, your profile gets a Join button. A friend who presses it lands on the same server in their own client. If their client is closed, Discord can start it.
- **Include private lobbies** extends Join to your private lobbies. It's off by default, because anyone who can see your status could then get in. The lobby's invite code never appears in your status.
- **Privacy mode** hides all Discord activity, whatever the other switches say.

Your status never carries anything else from the game: no account details, no chat, no links other than bunnyhop.lol and its map thumbnails.

## Run vault

Every finished run is saved on your computer as a small summary: the map, style, time, whether it was a personal best, and whether the server verified it. The settings window lists the most recent ones.

- **Screenshot personal bests** saves a picture of the results screen whenever you set a PB.
- <kbd>F9</kbd> saves a picture of the game window wherever you choose.
- Replays stay in the game. Download them from the replay viewer as usual.

The vault keeps at most 5,000 summaries and 1 GB of screenshots, removing the oldest first.

## Benchmark

**F10 → Performance → Benchmark → Start** measures 30 seconds of play on the map you're on. Menus, pauses and replays don't count. The result shows the average FPS, the median and 99th-percentile frame times, and the number of hitches (frames more than twice as slow as the median), next to the profile, resolution and refresh rate it ran with.

Run it after each change you want to compare. The last 20 results are kept.

## Map cache

Maps and their shared textures, models and sounds are kept on disk after the first download, so later loads, even after a restart, read them from there. Every file is checked against its SHA-256 hash when it's saved and again when it's read; a damaged file is thrown away and downloaded again.

The cache fills only with what you play. It skips files over 512 MB and stops writing when the disk would have less than 512 MB free. To clear it, quit the client and delete the `content-cache` folder.

## Links

Installed copies open these links:

```text
bunnyhop://map/bhop_example
bunnyhop://server/public-room-id
bunnyhop://replay/run-id
bunnyhop://open?url=https%3A%2F%2Fbunnyhop.lol%2F
```

Every link is checked first, and `open` only accepts a bunnyhop.lol address. Opening a link takes the game window to it, which ends a run in progress.

## Downloads

Replays (`.bhr`), images, videos and settings exports the game offers to download open a save dialog, so you choose where every file goes. Executables and other unknown file types are refused.

## Updates

Release builds check GitHub for a new version at launch and every 6 hours. The release note is signed; one that doesn't match the client's key is ignored. A new version shows in F10 → Client and as one notification, never during a run. You download and install it yourself.

## Files on disk

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Settings | `%APPDATA%\Bunnyhop\client-settings.json` | `~/Library/Application Support/Bunnyhop/client-settings.json` | `~/.config/bunnyhop/client-settings.json` |
| Vault | `%APPDATA%\Bunnyhop\vault` | `~/Library/Application Support/Bunnyhop/vault` | `~/.config/bunnyhop/vault` |
| Map cache | `%APPDATA%\Bunnyhop\content-cache` | `~/Library/Application Support/Bunnyhop/content-cache` | `~/.config/Bunnyhop/content-cache` |

On Linux, `XDG_CONFIG_HOME` replaces `~/.config` for the settings and vault.

The vault holds run summaries (`runs/`), PB screenshots (`captures/`), support reports (`reports/`), benchmark results (`benchmarks.json`) and `status.json`, a small file with what you're doing right now. F10 → Run vault → Open folder takes you there. None of it leaves your computer; your account and runs go to bunnyhop.lol exactly as they do in the browser.

## Support reports

F10 → Client → Diagnostics shows the client version, displays, GPU and the settings this launch runs with. Export saves the same as a file to attach to a bug report. It holds no account details. It describes your setup; it doesn't measure input latency.
