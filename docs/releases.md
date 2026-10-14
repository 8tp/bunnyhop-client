# Releases

The client repository is [8tp/bunnyhop-client](https://github.com/8tp/bunnyhop-client). Releases cost nothing: no Apple Developer Program, no Windows code-signing certificate, no paid store. GitHub Actions is disabled and no workflow files are installed. Every build and check runs on the maintainer's machine, and only a person publishes.

## How releases reach players

- **The browser comes first.** [bunnyhop.lol](https://bunnyhop.lol) is still the zero-install way to play. The client is an extra, and the game, physics, and nearly every change ship with the website. Keep the shell thin so client releases stay rare. Each new unsigned Windows file starts its SmartScreen reputation from zero.
- **GitHub Releases** hosts the installers: a per-user one-click NSIS installer and a portable zip for Windows x64, DMGs for Apple silicon and Intel Macs, and an AppImage and `.deb` for Linux x64. The README's [Install](../README.md#install) section walks players through the one-time Windows and macOS prompts. Link to it from every release and from the game's download page.
- **Update notices, not an updater.** macOS will not let an unsigned app replace itself, and silent updates over unsigned files would be the least trustworthy part of the client. Instead, a release build reads `bunnyhop-update.json` from the latest GitHub release at launch and every 6 hours. It checks the file's Ed25519 signature against the public key in `electron/update-check.mjs`, then says so in F10 → Client and with one notification, never during a run. Players download the new version themselves. An altered or unsigned note, or one linking anywhere but this repository's releases or `bunnyhop.lol/download`, is ignored.

## The release key

`npm run release:keygen` created the Ed25519 key pair once, on 2026-10-14. The private key is at `~/.config/bunnyhop-client/release-ed25519.pem` (or `BUNNYHOP_RELEASE_KEY`) and is never committed. **Back it up** in a password manager. Without it, no later release can announce itself to installed clients. A replacement key only reaches players who reinstall from a build that ships the new public key.

## Cut a release

From a clean, reviewed `main` on a Mac (Electron Builder makes all three platforms there):

```sh
npm version 0.2.0 --no-git-tag-version       # or edit package.json; the tag must be vMAJOR.MINOR.PATCH
npm ci && npm run verify && npm run electron:smoke
npm run electron:pack && npm run electron:packaged-smoke   # unstamped: the smoke harness is off in release builds
rm -rf dist/electron
CSC_IDENTITY_AUTO_DISCOVERY=false npm run release:build -- --mac --win --linux
npm run release:manifest -- --notes "One line players see in F10"
git commit -am "Release 0.2.0" && git tag v0.2.0 && git push origin main v0.2.0
npm run release:draft                          # uploads to a draft release; nothing is public yet
```

Before publishing the draft, install the Windows build on a real Windows PC and the Linux build on Linux. Test sign-in, input, fullscreen, Discord presence and reconnect, replay import/export, deep links, the settings relaunch, and PB screenshots against the live site. Then publish it on GitHub. Clients see only published releases, through `releases/latest/download/bunnyhop-update.json`.

`release:manifest` signs `bunnyhop-update.json`, writes `SHA256SUMS`, and refuses to finish if the shipped public key would reject its own signature. `release:draft` requires the local tag and uploads only `Bunnyhop-<version>-*` artifacts plus those two files. Electron Builder also writes `latest*.yml` and `.blockmap` files; they belong to its updater, which the client no longer uses, so leave them out.

## Free channels to add later

These need no money, only an account and review time. None is set up yet.

- **itch.io with butler.** Free hosting with delta-patched uploads. The itch app installs and updates the client without the browser's download warning. A bhop game on itch also gets discovered there. Push the unpacked `win-unpacked`, `mac-*` and `linux-unpacked` directories as channels.
- **Microsoft Store.** Individual developer accounts have been free since late 2025 (check the current terms). The Store signs the MSIX it distributes, so Windows shows no SmartScreen prompt, and it delivers updates. Electron Builder has an `appx` target. Before submitting, check Discord's local IPC and `bunnyhop://` links under MSIX. Each update waits for Store certification.
- **Scoop, the AUR, Flathub.** Community package managers for people who prefer them. Each takes a small manifest pointing at the GitHub release files and their checksums.
- **SignPath Foundation.** Free Authenticode signing for open-source projects. It requires builds from a CI service, so it waits for a decision to turn Actions back on.
- **A download page on bunnyhop.lol** that detects the OS, links the right file, and shows the prompts with screenshots. `bunnyhop.lol/download` is already an allowed update link.

## Rules

- Never commit installers, the private key, user profiles, or game source.
- Don't label these builds "signed". The Ed25519 note proves a release came from the maintainer, but Windows and macOS do not know that key.
- A private repository is not an update feed, and the client must never carry a GitHub token.
