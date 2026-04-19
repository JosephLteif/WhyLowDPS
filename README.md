# WhyLowDps

SimulationCraft made simple. Run simulations from your browser or run the standalone desktop app.

**[Try the Demo](https://whylowdps.com)** · **[Documentation](CONTRIBUTING.md)**

---

<p align="center">
  <img src="images/quick-sim.png" alt="Quick Sim" width="32%">
  <img src="images/top-gear.png" alt="Top Gear" width="32%">
  <img src="images/drop-finder.png" alt="Drop Finder" width="32%">
</p>

## Sim Types

| | Description |
|---|---|
| **Quick Sim** | DPS, ability breakdown, and stat weights |
| **Top Gear** | Find the best gear combination from your bags and vault |
| **Drop Finder** | Sim raid and dungeon loot to find upgrades |
| **Crest Upgrades** | Find the best Dawncrest upgrade path within your budget |

## Development & Architecture

Please see **[CONTRIBUTING.md](CONTRIBUTING.md)** for architecture details, local setup, and PR guidelines.

## Desktop App Update Release Flow

Use this flow whenever you want users to receive an in-app update prompt.

1. Update the app version in `VERSION` (must be higher than the currently released app version).
2. Sync that version into all build configs:

```bash
npm run sync:version
```

3. Commit and push your changes.
4. Create and push a Git tag matching the version:

```bash
git tag v$(cat VERSION)
git push origin v$(cat VERSION)
```

5. Wait for `.github/workflows/release.yml` to finish.
6. Confirm the GitHub release contains updater artifacts (`latest.json` and Windows installer artifacts).

Notes:
- The desktop updater checks: `https://github.com/JosephLteif/simcraft/releases/latest/download/latest.json`
- If you publish a release without incrementing `VERSION`, in-app updates may not trigger.

## License

Private repository. All rights reserved.
