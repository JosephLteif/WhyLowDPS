# SimHammer

SimulationCraft made simple. Run simulations from your browser or self-host your own instance.

**[Try the Demo](https://simhammer.com)** · **[Documentation](docs/)**

---

<p align="center">
  <img src="docs/images/quick-sim.png" alt="Quick Sim" width="32%">
  <img src="docs/images/top-gear.png" alt="Top Gear" width="32%">
  <img src="docs/images/drop-finder.png" alt="Drop Finder" width="32%">
</p>

## Sim Types

| | Description |
|---|---|
| **Quick Sim** | DPS, ability breakdown, and stat weights |
| **Top Gear** | Find the best gear combination from your bags and vault |
| **Drop Finder** | Sim raid and dungeon loot to find upgrades |
| **Crest Upgrades** | Find the best Dawncrest upgrade path within your budget |

## Quick Start (Self-Host with Docker)

```bash
docker run -p 8000:8000 \
  -v simhammer-data:/app/resources/data \
  -v simhammer-data-full:/app/resources/data_full \
  -v simhammer-simc:/app/resources/simc \
  -v simhammer-db:/app/db \
  ghcr.io/sortbek/simcraft:latest
```

Visit **http://localhost:8000** — single container, batteries included.

## Documentation

| | |
|---|---|
| **[Architecture](docs/architecture.md)** | System design, storage, deployment modes |
| **[Development](docs/development.md)** | Local setup, web development, building |
| **[Self-Hosting](docs/self-hosting.md)** | Docker, PostgreSQL, VPS deploy, environment variables |
| **[Contributing](CONTRIBUTING.md)** | Code style, PRs, CI pipeline |

## License

Private repository. All rights reserved.
