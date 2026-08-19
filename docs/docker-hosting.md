# Docker-hosted private WhyLowDPS

The hosted deployment is a private, single-instance Linux container. It runs
its own Linux SimulationCraft runtime; it does not connect to the Windows
desktop app's SimC process or data directory.

This is a self-hosted private instance, not a shared WhyLowDPS service. The
recommended installation uses the prebuilt release image. Building from source
is only needed for development or contributors.

## Production

1. Use an amd64 Linux host with Docker Engine and Compose.
2. Download `compose.yaml` and `.env.docker.example` from the desired GitHub
   release, or clone the repository for the current configuration.
3. Copy `.env.docker.example` to `.env.docker`, pin `WHYLOWDPS_VERSION` to the
   published release tag, set a strong `JWT_SECRET`, and enter the host's LAN
   address in `WHYLOWDPS_HOST_IP`. Blizzard client credentials are optional.
4. Set `WHYLOWDPS_PORT` to the port clients should use (normally `8000`). The
   app is then available directly at `http://<WHYLOWDPS_HOST_IP>:<WHYLOWDPS_PORT>`.
   Do not configure a hostname, reverse proxy, or explicit OAuth callback: the
   app derives the callback from the address used for the login request.
5. If the host's LAN address changes, update only `WHYLOWDPS_HOST_IP`, recreate
   the service, and update the exact callback shown by the hosted UI in the
   Blizzard developer portal:

   ```text
   http://<WHYLOWDPS_HOST_IP>:<WHYLOWDPS_PORT>/api/auth/bnet/callback
   ```

   The browser must access the same IP and port registered in the portal.
6. Ensure the `weekly` or `nightly` release manifest in the companion
   `whylowdps-simc-runtime` repository contains a `linux-x64` asset. Its
   publisher now builds and validates that CLI runtime from SimulationCraft
   source.
7. Start the stack:

```shell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

The app listens directly on the configured LAN port. The SQLite database,
synchronized data, caches, and downloaded SimC runtime live in the
Docker-managed `whylowdps-data` volume.

To update an existing instance, back up the data volume, change
`WHYLOWDPS_VERSION` to the new release, then run:

```shell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

To roll back, set `WHYLOWDPS_VERSION` back to the previous release and repeat
the same commands. Do not remove the `whylowdps-data` volume during an update.

For local source development, use the separately named local image:

```shell
docker compose --env-file .env.docker -f compose.yaml -f compose.source.yaml up -d --build
```

### Blizzard developer portal setup

Open the [Battle.net Developer Portal](https://community.developer.battle.net/access/clients),
open the client used by this deployment, and add the full callback URL to its
**Redirect URLs** list. The client ID must be the value labeled **Client ID** in
the portal; do not copy the client-management UUID from the portal page URL.
For a LAN deployment, add the exact IP-and-port callback displayed by the
hosted UI. If the machine's LAN address or port changes, update the portal
entry and recreate the Compose service before signing in again.
Changes in the portal may take several minutes to become active.

## Windows development

Use Docker Desktop with its WSL2 Linux engine. Build Linux containers; do not
use Windows containers for this service. Keep the database and SimC runtime in
the named Docker volume rather than a `C:\` bind mount. If testing from a
phone, permit the local Docker port only on the Windows Private network.

The Windows desktop build remains separate and continues to use Tauri,
DPAPI/keyring storage, `simc.exe`, Windows process controls, clipboard, tray,
and desktop update behavior.

## Hosted limitations

This deployment is intentionally single-user and single-replica. The existing
SQLite schema does not owner-scope jobs, routes, or character profiles, so the
service must not be opened to multiple accounts without an ownership migration
and an authenticated-endpoint audit.

Hosted mode accepts Blizzard credentials from the initial synchronization form
or from the optional environment variables. Runtime-entered credentials are
encrypted with `JWT_SECRET` and stored in `/data/.blizzard-credential-secrets.json`;
the secret is never returned to the browser. Container restarts invalidate active
OAuth sessions because access tokens are held in process memory, but saved
credentials remain available.

Hosted mode supports credential-free Light mode for simulations, shared game
data, and simulation results. Account-scoped features such as Battle.net
characters, wishlist, saved profiles, and settings still require authentication
and remain unavailable in Light mode. Public Light mode writes are restricted to
same-origin requests.

Direct LAN HTTP is not a secure browser context on most phones and browsers, so
secure cookies, service-worker installation, and native PWA installation are not
available. Keep the port restricted to the Windows Private network.

## Backups and operations

Run the read-only operational check from the repository root:

```powershell
.\scripts\check-hosted.ps1
```

Create a consistent manual full-volume backup with a short app interruption:

```powershell
.\scripts\backup-hosted.ps1 -Destination 'D:\WhyLowDPSBackups'
```

The command writes a timestamped archive and SHA-256 hash. Do not place the
SQLite volume or backup destination on OneDrive or a network share. Before
trusting a backup, restore it into a disposable Docker volume and start an
isolated app container against that volume.
