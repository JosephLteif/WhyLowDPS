# Docker-hosted private WhyLowDPS

The hosted deployment is a private, single-instance Linux container. It runs
its own Linux SimulationCraft runtime; it does not connect to the Windows
desktop app's SimC process or data directory.

This is a self-hosted private instance, not a shared WhyLowDPS service. The
recommended installation uses the prebuilt release image. Building from source
is only needed for development or contributors.

Desktop **Share over LAN** is a different mode: it exposes the running Windows
app on port `17384` and requires QR pairing. Docker creates an independent web
instance on the configured host and does not use desktop pairing.

## Production requirements

- An amd64 Linux host, or Docker Desktop using its WSL2 Linux engine.
- Docker Engine with the Compose plugin (`docker compose version`).
- A stable private IPv4 address or DHCP reservation for the host.
- The selected TCP port allowed only from the trusted private network.
- A current WhyLowDPS release with a published `linux-x64` SimulationCraft
  runtime on the selected `SIMC_CHANNEL`.

Arm64 hosts are not currently supported because the companion runtime is
published for `linux-x64`.

## First installation

1. Download `compose.yaml` and `.env.docker.example` from the same WhyLowDPS
   GitHub release. A repository clone can be used for source development.
2. Put both files in a dedicated directory and create the private environment
   file:

   ```shell
   cp .env.docker.example .env.docker
   ```

3. Edit `.env.docker`:

   - Keep `WHYLOWDPS_VERSION` pinned to the version from the release asset.
   - Set `WHYLOWDPS_HOST_IP` to the host's private IPv4 address.
   - Set `WHYLOWDPS_PORT` to the client-facing port, normally `8000`.
   - Replace `JWT_SECRET` with a unique random value of at least 32 characters.
     Keep it with the deployment and its backups; changing it makes stored
     hosted credentials unreadable. `openssl rand -hex 32` can generate a
     suitable value.
   - Leave `WHYLOWDPS_SECURE_COOKIES=false` for the direct LAN HTTP setup.
   - Optionally set Blizzard credentials now, or enter them in the hosted app.

4. Pull and start the pinned release:

   ```shell
   docker compose --env-file .env.docker pull
   docker compose --env-file .env.docker up -d
   ```

   Always include `--env-file .env.docker`. This prevents unrelated values in
   a repository `.env` file from being used for the hosted deployment.

5. Confirm that the container is healthy:

   ```shell
   docker compose --env-file .env.docker ps
   docker compose --env-file .env.docker logs --tail=100 app
   curl --fail http://<WHYLOWDPS_HOST_IP>:<WHYLOWDPS_PORT>/health
   ```

6. Open `http://<WHYLOWDPS_HOST_IP>:<WHYLOWDPS_PORT>` from a browser on the
   trusted LAN. Continue in Light mode, or configure Battle.net using the exact
   callback shown by the app.

The SQLite database, synchronized data, caches, saved encrypted credentials,
and downloaded SimC runtime live in the Docker-managed `whylowdps-data` volume.
Do not delete that volume during routine recreation, updates, or rollback.

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `WHYLOWDPS_VERSION` | Container image tag. Pin a released version for predictable upgrades and rollback. |
| `WHYLOWDPS_HOST_IP` | Private host address on which Docker publishes the app port. |
| `WHYLOWDPS_PORT` | Client-facing port; defaults to `8000`. |
| `JWT_SECRET` | Required encryption/signing secret; use at least 32 random characters and keep it stable. |
| `WHYLOWDPS_SECURE_COOKIES` | Use `false` for direct LAN HTTP and `true` only behind trusted HTTPS. |
| `BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` | Optional server-configured Battle.net client. Runtime entry is also supported. |
| `SIMC_CHANNEL` | Companion runtime channel, normally `weekly` or `nightly`. |
| `MAX_CONCURRENT_SIMULATIONS` | Maximum simulations running at the same time. |
| `MAX_JOBS` | Number of job records retained by the hosted service. |

## Updates and rollback

Back up the data volume first. Change `WHYLOWDPS_VERSION` to the new release,
then recreate the service:

```shell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

`docker compose restart app` does not apply a new image or changed environment
values. To roll back, restore the previous `WHYLOWDPS_VERSION` and repeat the
commands above. Preserve `.env.docker`, especially `JWT_SECRET`, and the
`whylowdps-data` volume.

## Build the hosted image from source

Contributors can use the source override, which gives the local image a
separate name from release images:

```shell
docker compose --env-file .env.docker -f compose.yaml -f compose.source.yaml up -d --build
```

Run the same command after source changes; restarting an existing container
does not rebuild it.

## Blizzard developer portal setup

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

### Optional trusted HTTPS and PWA installation

An installable PWA requires an HTTPS certificate trusted by the browser and
phone. The baseline Compose file does not provide a certificate or reverse
proxy. If the administrator adds a trusted HTTPS proxy:

- Keep the deployment private and single-user.
- Set `WHYLOWDPS_SECURE_COOKIES=true` and recreate the service.
- Preserve the browser-facing hostname and HTTPS scheme in the forwarded
  request.
- Register the exact `https://<HOSTNAME>/api/auth/bnet/callback` URL in the
  Battle.net Developer Portal.
- Trust the issuing certificate authority on every client if using an internal
  CA. An untrusted or self-signed certificate does not provide a browser secure
  context for native installation.

## Backups and operations

The repository includes PowerShell helpers for operators working from a clone.
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
