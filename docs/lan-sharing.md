# Desktop LAN sharing

WhyLowDPS can serve the installed Windows desktop app to a phone or tablet on
the same private network. This is an opt-in convenience for a trusted home
network, not an internet-facing hosting mode.

Docker hosting is a separate deployment. To run an independent private web
instance, use [Docker-hosted private WhyLowDPS](docker-hosting.md).

## Requirements

- The latest installed Windows desktop build of WhyLowDPS.
- The PC and phone on the same trusted private Wi-Fi or LAN.
- The Windows network profile set to **Private**.
- Local TCP port `17384` allowed on the Private network if Windows Firewall
  prompts. Do not create a Public-network rule or port-forward this port.

## Enable sharing on the desktop

1. Open **Settings > Simulation** in the desktop app.
2. Find **Share over LAN** and enable **Share this app over LAN**.
3. Select **Restart WhyLowDPS** when the app says a restart is required.
4. Return to **Settings > Simulation > Share over LAN** after the restart.

The desktop backend listens only on the PC while sharing is disabled. Enabling
the setting and restarting makes it listen on the private network, protected by
device pairing.

## Pair a phone or browser

1. On the desktop, select **New pairing link**. A QR code and copyable URL are
   displayed.
2. Within five minutes, scan the QR code with the phone's camera, or copy the
   URL to the phone.
3. If a QR app opens an embedded preview, choose **Open in Safari**, **Open in
   Chrome**, or **Open in Browser** before continuing.
4. In the intended browser, select **Continue to WhyLowDPS**.

The pairing link works once. Opening its landing page does not use the link,
but selecting **Continue to WhyLowDPS** does. The paired browser receives its
own access cookie and the PC's current WhyLowDPS account session.

Keep the desktop app running while using WhyLowDPS from the phone. The phone
will appear as **Connected** while the page is open and **Offline** after the
page closes or becomes unreachable.

## Paired-device access

- Pairing records and valid access survive desktop app restarts.
- Browser access expires after 24 hours and then requires a new link.
- **New link** beside a device restores that existing device's access.
- **Rename** gives the browser a recognizable name.
- **Remove access** immediately revokes the browser. Its next request shows the
  QR pairing screen, and it cannot reconnect until the desktop creates a new
  link.
- Turning off **Share this app over LAN** and restarting returns the backend to
  PC-only access.

Pairing and device-management actions can be started only from the desktop PC.
WhyLowDPS stores a hash of the browser access token rather than the raw token.

## Troubleshooting

### The desktop cannot create a link

Apply the pending restart first. If the app reports that it cannot detect a
private IPv4 address, confirm that the PC is connected to the intended network
and temporarily disconnect VPNs or virtual adapters that may have become the
preferred route.

### The phone cannot open the link

- Confirm that both devices are on the same non-guest network. Guest Wi-Fi or
  access-point isolation can block device-to-device traffic.
- Confirm that the Windows network profile is **Private** and allow WhyLowDPS
  on that profile only.
- Keep WhyLowDPS running on the PC.
- Create a fresh link after changing networks or restarting an older desktop
  build.

### The link expired or access was not approved

Create a fresh link. A link expires after five minutes and is consumed when
**Continue to WhyLowDPS** is selected. Some QR scanners use an embedded browser;
move to Safari or Chrome before selecting Continue so the access cookie is
stored in the browser you plan to use.

### The phone shows "LAN pairing required"

The browser's access expired or was removed. Leave the pairing screen open,
create **New link** for that device on the desktop, and scan the new QR code.

### The phone shows old assets or an old version

Update or reinstall the latest desktop build, restart the app, and generate a
new link. The desktop app serves the frontend bundled with the installed build.

## Development server access

The development flow does not use desktop pairing. From the repository root,
run the backend and LAN frontend in separate terminals:

```powershell
npm run backend:dev
```

```powershell
npm run web:dev:lan
```

Find the PC's private IPv4 address with `ipconfig`, then open
`http://<PC-LAN-IP>:3000` on the phone. The Next.js server is LAN-facing and
proxies API requests to the backend on `127.0.0.1:8000`. If Windows Firewall
prompts, allow Node.js on **Private networks** only.
