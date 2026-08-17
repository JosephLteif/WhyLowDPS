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
3. Point DNS for the chosen domain at the host.
4. Copy `.env.docker.example` to `.env.docker`, pin `WHYLOWDPS_VERSION` to the
   release version, and set the domain and a strong `JWT_SECRET`. Blizzard
   client credentials are optional.
5. Register the exact callback URL in the Blizzard developer portal. The hosted
   UI also displays these values under the credential form:

   - **Redirect URLs:** `https://<host-name>/api/auth/bnet/callback`
   - **Allowed Domain / Service URL (if shown):** `<host-name>` only, without
     `https://`, a trailing slash, or the callback path.

   For the current LAN example, use:
   `https://192-168-100-125.nip.io/api/auth/bnet/callback` and
   `192-168-100-125.nip.io`. Use the hostname and scheme that your own host
   actually serves; the redirect must match exactly.
6. Ensure the `weekly` or `nightly` release manifest in the companion
   `whylowdps-simc-runtime` repository contains a `linux-x64` asset. Its
   publisher now builds and validates that CLI runtime from SimulationCraft
   source.
7. Start the stack:

```shell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

Caddy terminates HTTPS and proxies the same origin to the WhyLowDPS app. The
SQLite database, synchronized data, caches, and downloaded SimC runtime live
in the Docker-managed `whylowdps-data` volume.

To update an existing instance, back up the data volume, change
`WHYLOWDPS_VERSION` to the new release, then run:

```shell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

To roll back, set `WHYLOWDPS_VERSION` back to the previous release and repeat
the same commands. Do not remove the `whylowdps-data` volume during an update.

For local source development, use:

```shell
docker compose --env-file .env.docker -f compose.yaml -f compose.source.yaml up -d --build
```

### Blizzard developer portal setup

Open the [Battle.net Developer Portal](https://community.developer.battle.net/access/clients),
open the client used by this deployment, and add the full callback URL to its
**Redirect URLs** list. The client ID must be the value labeled **Client ID** in
the portal; do not copy the client-management UUID from the portal page URL.
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

Hosted mode does not offer credential-free Light mode because hosted simulation
and result endpoints require an authenticated Battle.net session. Light mode
remains available in the Windows desktop app.

## Backups and operations

Back up `/data/whylowdps.db` and important synchronized data from the named
volume. Monitor `/health`, container logs, free volume space, data-sync status,
and simulation concurrency. Do not place the SQLite volume on OneDrive or a
network share.
