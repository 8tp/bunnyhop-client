# Releases

Releases cost nothing: no Apple Developer Program, no Windows code-signing certificate, no paid store. GitHub Actions is off. Every build and check runs on the maintainer's Mac, and only a person publishes.

## How players get it

- **The browser comes first.** bunnyhop.lol is still the zero-install way to play, and nearly every change ships with the website. Keep the client thin so its releases stay rare; each new unsigned Windows file starts its SmartScreen reputation from zero.
- **GitHub Releases** hosts the installers: a per-user Windows installer and a portable zip, DMGs for Apple silicon and Intel, and an AppImage and `.deb` for Linux. The README's [Install](../README.md#install) section covers the one-time Windows and macOS prompts; every release links to it.
- **An update notice, not an updater.** macOS won't let an unsigned app replace itself, and silent updates of unsigned files would be the least trustworthy part of the client. Release builds read `bunnyhop-update.json` from the latest release, check its Ed25519 signature against the key in `electron/update-check.mjs`, and tell the player. A note that's altered, unsigned, or links anywhere but this repository's releases or `bunnyhop.lol/download` is ignored.

## The release key

`npm run release:keygen` made the key pair once, on 2026-10-14. The private key is `~/.config/bunnyhop-client/release-ed25519.pem` (or `BUNNYHOP_RELEASE_KEY`) and is never committed. **Back it up.** Without it no later release can announce itself to installed clients, and a new key only reaches players who reinstall.

## Cut a release

From a clean, reviewed `main`:

```sh
npm version 0.2.0 --no-git-tag-version       # the tag must be vMAJOR.MINOR.PATCH
npm ci && npm run verify && npm run electron:smoke
npm run electron:pack && npm run electron:packaged-smoke
rm -rf dist/electron
CSC_IDENTITY_AUTO_DISCOVERY=false npm run release:build -- --mac --win --linux
npm run release:manifest -- --notes "One line players see in F10"
git commit -am "Release 0.2.0" && git tag v0.2.0 && git push origin main v0.2.0
npm run release:draft                          # a draft: nothing is public yet
```

`release:manifest` signs `bunnyhop-update.json`, writes `SHA256SUMS`, and stops if the shipped public key would reject its own signature. `release:draft` needs the local tag and uploads only the `Bunnyhop-<version>-*` files plus those two. Electron Builder's `latest*.yml` and `.blockmap` files belong to an updater the client doesn't use, so they stay out.

Before publishing, install the Windows build on a Windows PC and the Linux build on Linux. Try sign-in, input, fullscreen, Discord presence and Join, replay downloads, links, the settings restart and PB screenshots against the live site. Then publish the draft on GitHub. Installed clients see only published releases.

A release that needs new game hooks ships after the game deploy that adds them.

## Free channels for later

None of these is set up yet. Each needs only an account and review time.

- **itch.io with butler.** Free hosting with delta updates, installs through the itch app without the browser's download warning, and a bhop game there gets found.
- **Microsoft Store.** Individual developer accounts are free. The Store signs what it distributes, so there's no SmartScreen prompt, and it delivers updates. Check Discord's local IPC and `bunnyhop://` links under MSIX first.
- **Scoop, the AUR, Flathub.** Small manifests pointing at the release files and their checksums.
- **SignPath Foundation.** Free Authenticode signing for open-source projects, but it needs CI builds.
- **bunnyhop.lol/download.** A page that picks the right file for your system and shows the prompts. It's already an allowed update link.

## Rules

- Never commit installers, the private key, user profiles or game source.
- Don't call these builds "signed". The Ed25519 note proves a release came from the maintainer; Windows and macOS don't know that key.
- The client never carries a GitHub token, and a private repository can't be an update feed.
