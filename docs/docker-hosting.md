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

   - The downloaded Compose file follows the published `latest` image by
     default.
   - Set `WHYLOWDPS_HOST_IP` to the host's private IPv4 address.
   - Set `WHYLOWDPS_PORT` to the client-facing port, normally `8000`.
   - Replace `JWT_SECRET` with a unique random value of at least 32 characters.
     Keep it with the deployment and its backups; changing it invalidates
     signed login tokens. `openssl rand -hex 32` can generate a suitable value.
   - Set a separate stable `SESSION_ENCRYPTION_KEY` and set
     `WHYLOWDPS_BOOTSTRAP_ADMIN_BATTLETAG` to the first instance administrator.
   - Leave `WHYLOWDPS_SECURE_COOKIES=false` for the direct LAN HTTP setup.
   - Blizzard application credentials are entered in the app at runtime; they
     are not stored in this environment file.

4. Pull and start the latest release:

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
   trusted LAN and sign in with the bootstrap administrator BattleTag. Add other
   allowed accounts from **Manage Users**.

The SQLite database, synchronized data, caches, saved encrypted credentials,
and downloaded SimC runtime live in the Docker-managed `whylowdps-data` volume.
Do not delete that volume during routine recreation, updates, or rollback.

Multi-user releases use `/data/whylowdps-multi-user.db`. An earlier
`/data/whylowdps.db` is intentionally left untouched as a legacy backup; old
personal records are not imported automatically.

## Configuration reference

The production image is defined directly in `compose.yaml` as
`ghcr.io/josephlteif/whylowdps:latest`. Change that line to an exact version or
digest when pinning a deployment.

| Variable | Purpose |
| --- | --- |
| `WHYLOWDPS_HOST_IP` | Private host address on which Docker publishes the app port. |
| `WHYLOWDPS_PORT` | Client-facing port; defaults to `8000`. |
| `JWT_SECRET` | Required encryption/signing secret; use at least 32 random characters and keep it stable. |
| `SESSION_ENCRYPTION_KEY` | Required encryption key for persistent Battle.net sessions. Keep it stable and backed up. |
| `WHYLOWDPS_BOOTSTRAP_ADMIN_BATTLETAG` | BattleTag allowed to create the first administrator when the user table is empty. |
| `WHYLOWDPS_SECURE_COOKIES` | Use `false` for direct LAN HTTP and `true` only behind trusted HTTPS. |
| `SIMC_CHANNEL` | Companion runtime channel, normally `weekly` or `nightly`. |
| `MAX_CONCURRENT_SIMULATIONS` | Maximum simulations running at the same time. |
| `MAX_JOBS_PER_USER` | Number of unpinned job records retained independently for each user. |

## Updates and rollback

Back up the data volume first, then pull and recreate the service:

```shell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

`docker compose restart app` does not apply a new image or changed environment
values. Publishing a new `latest` image also does not restart an existing
container by itself. Configure Portainer or another Docker manager to poll the
image or receive a registry webhook, then pull and recreate the stack when the
digest changes.

For a command-line deployment, the update operation is:

```shell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

For Portainer or a similar manager, use the Compose image
`ghcr.io/josephlteif/whylowdps:latest` and enable its registry polling or
webhook-based pull-and-redeploy option. A normal running container does not
periodically check the registry on its own.

To roll back, change the `image` line in `compose.yaml` to the exact version
from `docker-image.txt`, for example
`ghcr.io/josephlteif/whylowdps:3.8.0`, or to the listed immutable digest. Pull
and recreate the service again. Preserve `.env.docker`, especially
`JWT_SECRET`, and the `whylowdps-data` volume.

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

This deployment is intentionally single-replica and supports a small trusted
group of users. SQLite owner-scopes simulations, routes, character profiles,
history, and OAuth sessions. Use the administrator page to allow BattleTags,
disable users, assign roles, or revoke sessions. The default per-user history
limit is controlled by `MAX_JOBS_PER_USER`.

On first launch, enter a Blizzard application client ID and secret in the app.
The bootstrap administrator can later add, rename, rotate, or remove credential
profiles from Settings without restarting the container. Secrets are encrypted
at rest and are never returned to browsers; unauthenticated users can only see
profile names and public client IDs and select which profile to use. After the
first user is created, credential changes require an administrator session.

OAuth access tokens are encrypted with `SESSION_ENCRYPTION_KEY` before they are
stored in SQLite, and active sessions survive container restarts. Hosted Light
mode is disabled: every hosted user must sign in and be on the allowlist.

Direct LAN HTTP is not a secure browser context on most phones and browsers, so
secure cookies, service-worker installation, and native PWA installation are not
available. Keep the port restricted to the Windows Private network.

### Optional trusted HTTPS and PWA installation

An installable PWA requires an HTTPS certificate trusted by the browser and
phone. The baseline Compose file does not provide a certificate or reverse
proxy. If the administrator adds a trusted HTTPS proxy:

- Keep the deployment private and limit access to trusted users.
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
