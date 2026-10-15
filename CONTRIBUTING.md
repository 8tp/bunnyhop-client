# Contributing

Setup, scripts and the layout are in [development](docs/development.md). In short: Node.js 22 or newer, `npm ci`, then `npm run verify` and `npm run electron:smoke` before you open a pull request. Anything that touches packaging also needs `npm run electron:pack` and `npm run electron:packaged-smoke`.

In the pull request, say what changes for the player, which checks you ran, and which systems you actually tried it on. Add a screenshot for anything visible. Claims about performance need a measurement and the hardware it ran on; the F10 benchmark is a good start.

Keep changes focused. The client must never change gameplay: input, timing, physics, replays and verification belong to the game. A change to the bridge needs the game project too; keep both sides working without the other.

GitHub Actions is off, so checks run on your machine. Never commit keys, tokens, player data or built installers.

Contributions are under the [MIT license](LICENSE) and the [code of conduct](CODE_OF_CONDUCT.md).
