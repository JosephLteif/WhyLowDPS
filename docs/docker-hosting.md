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
3. Point DNS for the chosen public domain at the host. For a private LAN test,
   use a hostname derived from the machine's current LAN address instead of
   copying an IP from this document.
4. Copy `.env.docker.example` to `.env.docker`, pin `WHYLOWDPS_VERSION` to the
   release version, and set the domain and a strong `JWT_SECRET`. Blizzard
   client credentials are optional.
5. Set `WHYLOWDPS_DOMAIN`, `WEB_ORIGIN`, and `BLIZZARD_REDIRECT_URI` from the
   same origin. For a LAN host whose address may change, derive the values
   again whenever the address changes:

   ```powershell
   $lanIp = Get-NetIPAddress -AddressFamily IPv4 |
     Where-Object {
       $_.InterfaceAlias -eq 'Wi-Fi' -and
       $_.IPAddress -notlike '127.*' -and
       $_.IPAddress -notlike '169.254.*'
     } |
     Select-Object -First 1 -ExpandProperty IPAddress
   $hostName = "$($lanIp.Replace('.', '-')).nip.io"
   $origin = "http://$hostName" # Use https when trusted TLS is configured.

   "WHYLOWDPS_DOMAIN=$origin"
   "WEB_ORIGIN=$origin"
   "BLIZZARD_REDIRECT_URI=$origin/api/auth/bnet/callback"
   ```

   For HTTPS, use the bare `$hostName` for `WHYLOWDPS_DOMAIN` and the HTTPS
   origin for the other two values. For a local HTTP test, keep the `http://`
   prefix in `WHYLOWDPS_DOMAIN` so Caddy does not redirect to an untrusted
   internal certificate. Register the exact callback URL in the Blizzard
   developer portal. The hosted UI also displays these values under the
   credential form:

   - **Redirect URLs:** `<WEB_ORIGIN>/api/auth/bnet/callback`
   - **Allowed Domain / Service URL (if shown):** `<host-name>` only, without
     `http://` or `https://`, a trailing slash, or the callback path.

   Never use a stale LAN IP from an older setup. The hostname and scheme in
   the portal must match the current `WEB_ORIGIN` and callback exactly.
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
For a LAN deployment, use the current values generated from `.env.docker`: the
redirect URL is `BLIZZARD_REDIRECT_URI`, and the allowed domain is the hostname
from `WEB_ORIGIN` without its scheme. If the machine's LAN address changes,
regenerate those values, update the portal entry, and recreate the Compose
services before signing in again.
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

## Backups and operations

Back up `/data/whylowdps.db` and important synchronized data from the named
volume. Monitor `/health`, container logs, free volume space, data-sync status,
and simulation concurrency. Do not place the SQLite volume on OneDrive or a
network share.
