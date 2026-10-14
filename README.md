<p align="center">
  <img src="assets/readme-banner.svg" alt="Bunnyhop Desktop — Find your flow" width="100%">
</p>

<p align="center">
  <a href="https://bunnyhop.lol"><strong>Play Bunnyhop ↗</strong></a> &nbsp; · &nbsp;
  <a href="#run-from-source">Get started</a> &nbsp; · &nbsp;
  <a href="docs/releases.md">Build locally</a> &nbsp; · &nbsp;
  <a href="https://github.com/8tp/bunnyhop-client/issues">Report a bug</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-44-ffb432?style=flat-square&amp;labelColor=181b21" alt="Electron 44">
  <img src="https://img.shields.io/badge/macOS_·_Windows_·_Linux-desktop-ffb432?style=flat-square&amp;labelColor=181b21" alt="Targets macOS, Windows and Linux">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-ffb432?style=flat-square&amp;labelColor=181b21" alt="MIT license"></a>
</p>

# Bunnyhop Client

A dedicated desktop home for [bunnyhop.lol](https://bunnyhop.lol). Keep your game in its own window, share your activity on Discord, and keep a local record of your runs.

**This repository contains only the Electron client.** The game loads from the live website. Game source, maps, physics, server code, and the website integration worktree are maintained separately and are not included here. The client preserves the game's browser input and replay behavior; there is no native input sidecar.

| Make it yours | Keep your best | Stay connected |
| --- | --- | --- |
| Display profiles, fullscreen, and native settings | Local run history, screenshots, and optional PB captures | Opt-in Discord Rich Presence and Bunnyhop deep links |

> **Preview** · Releases are free, unsigned builds published on [GitHub Releases](https://github.com/8tp/bunnyhop-client/releases). The game itself always plays in any browser at [bunnyhop.lol](https://bunnyhop.lol); the client adds a dedicated window, Discord presence, and a local run vault. GitHub Actions is disabled; builds and checks run locally.

## Install

Download the file for your system from the [latest release](https://github.com/8tp/bunnyhop-client/releases/latest). The builds are not signed with a paid certificate, so Windows and macOS ask once before the first launch of each version. `SHA256SUMS` in the release lists every file's checksum.

**Windows 10/11** · `Bunnyhop-<version>-win-x64-setup.exe` installs for your account only, with no administrator prompt. If “Windows protected your PC” appears, choose **More info**, then **Run anyway**. `…-win-x64.zip` is a portable copy: extract it and run `Bunnyhop.exe`. Windows 11 with Smart App Control turned on blocks unsigned apps entirely; play in the browser instead.

**macOS 13 or newer** · Open `Bunnyhop-<version>-mac-arm64.dmg` (Apple silicon) or `…-mac-x64.dmg` (Intel) and drag Bunnyhop to Applications. The first launch is refused. Open **System Settings → Privacy & Security**, scroll to the Bunnyhop message, choose **Open Anyway**, and confirm. After an update, macOS may ask once for “Bunnyhop Safe Storage” access; choose **Always Allow**.

**Linux** · `chmod +x Bunnyhop-<version>-linux-x86_64.AppImage` and run it, or install the `.deb` with `sudo apt install ./Bunnyhop-<version>-linux-amd64.deb`.

The client tells you when a new version is out (F10 → Client, plus one notification outside runs); download it the same way. It never downloads or installs anything by itself.

## Run from source

Use Node.js 22 or newer and npm on macOS, Windows, or Linux:

```sh
npm ci
npm run verify
npm start
```

Electron needs a graphical desktop. Linux additionally needs the normal Electron runtime libraries. The client loads the live website; native integration requires the corresponding web hooks to be deployed. Without those hooks, the game still runs, but presence and completed-run archives will not receive game state.

On macOS, every unsigned build has a new ad hoc signature, so a rebuilt or updated app may trigger a “Bunnyhop Safe Storage” login-keychain prompt. Automated smoke launchers use disposable profiles and a mock keychain; they never need your login password. Normal app launches retain secure credential storage.

## Features

- F10 opens client settings; `npm start -- --settings` opens them at launch.
- F9 saves a screenshot through a file dialog. F11 toggles fullscreen outside kiosk mode.
- Competitive, balanced, compatibility, and custom profiles control fullscreen/kiosk/windowed mode, display selection, the discrete-GPU preference, GPU backend, device scaling, and Windows process priority. Balanced is the default. Competitive raises the browser, GPU, and game processes to Above normal on Windows.
- No profile uncaps the browser. Frames past the refresh rate come from the game's own Graphics settings (Exceed monitor FPS and the low-latency canvas), which pace them on the GPU. A browser-wide uncap (`--disable-frame-rate-limit --disable-gpu-vsync`) remains as an experimental switch; it also uncaps the page and compositor with nothing holding frames back, and ran worse than Balanced on a fast Windows machine. Settings saved by an older Competitive profile move to the current one.
- Settings include local diagnostics and JSON support-report export. Diagnostics describe the detected environment, not measured input latency.
- The local run vault stores bounded completed-run summaries. Optional PB screenshots wait for a matching result-card signal from the game and are cancelled when the result is left.
- Opt-in Discord Rich Presence connects to Discord desktop over local IPC, retries when Discord starts late or restarts, and uses Bunnyhop application ID `1556467060916224040`. Map display has its own switch. Public map thumbnails appear with a small Bunnyhop logo badge; menus, missing or unsupported thumbnails, and hidden maps use the logo alone. Privacy mode disables presence; no room identifier, join secret, or arbitrary renderer URL is sent. Artwork is limited to the public Bunnyhop logo and validated first-party thumbnail paths. The button points to `https://bunnyhop.lol`.
- Game-generated `.bhr` replay, image, JSON, text, CSV, and video downloads use a save dialog. Replay import/export stays in the game's browser UI; `.bhr` has no OS file association.
- Packaged builds register `bunnyhop://` links for maps, servers, and replays.

Client settings live in `Bunnyhop/client-settings.json` under Application Support on macOS or AppData/Roaming on Windows, and in `~/.config/bunnyhop/client-settings.json` on Linux (respecting `XDG_CONFIG_HOME`). The sibling `vault` directory holds summaries, captures, support reports, and `status.json`, a small local activity file. F10 can open that directory. Vault data stays on this machine; game accounts and run submissions retain the website's normal network behavior.

Rendering and display changes show a relaunch prompt. CLI options such as `--windowed`, `--fullscreen`, `--kiosk`, `--uncap`, `--no-uncap`, `--discrete-gpu`, and `--no-discrete-gpu` apply to that launch without being saved.

## Permanent content cache

Maps you load and their downloaded shared textures, models, and sounds are saved under `content-cache` in the Electron user-data directory (`~/Library/Application Support/Bunnyhop` on macOS). Matching SHA-256 content is read from disk on later loads, including after a restart. Changed map hashes get fresh entries; shared files are stored once. The map index and mutable content manifests still use normal network/cache behavior. This does not enable fully offline play.

Caching requires the matching website hooks. It happens only as content is requested, with no bulk downloads or automatic eviction. Files above 512 MiB are not persisted, and writes stop when they would leave less than 512 MiB free. Cache failures fall back to normal downloads; corrupt entries are discarded. To reclaim space, quit the client and delete its `content-cache` directory. Cached files are verified before saving and reading.

## Deep links

Packaged installations support these forms:

```text
bunnyhop://map/bhop_example
bunnyhop://server/public-room-id
bunnyhop://replay/run-id
bunnyhop://open?url=https%3A%2F%2Fbunnyhop.lol%2F
```

Identifiers are validated. The `open` form accepts only a Bunnyhop HTTPS origin. Opening a link navigates the main game window and can interrupt a run. Protocol registration depends on the OS and installation format; source runs do not register it.

## Build and verify

```sh
npm run check                 # JavaScript syntax and source checks
npm test                      # Node tests, including fake Discord IPC
npm run electron:smoke        # Sandboxed window/preload fixture smoke
npm run electron:pack         # Unpacked native application
npm run electron:packaged-smoke
npm run electron:dist         # Native installer/archive formats
```

Build output is in `dist/electron`. Development builds do not check for new versions. Release builds (`npm run release:build`) carry a release stamp: they check a signed release note and never run the smoke harness. Electron Builder makes the macOS, Windows, and Linux packages from one Mac. The release process is in [releases](docs/releases.md); planned features are in the [roadmap](docs/roadmap.md). There are no GitHub workflows or automatic publications.

## Contribute or report an issue

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Include the OS, client version, reproduction steps, and a reviewed F10 support report for bugs. Remove personal data before sharing reports or screenshots.

The client is [MIT licensed](LICENSE), retaining the original Aeperion attribution. See [CHANGELOG.md](CHANGELOG.md) for this adaptation's scope.
