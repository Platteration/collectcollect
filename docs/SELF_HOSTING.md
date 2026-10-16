# Running CollectCollect yourself

CollectCollect is a single-owner collection on your machine or private network. There are six apps (cards, skins, retro games, comics, watches and whisky), and each has a separate database, volume and password. Start with cards; the others are optional.

Run exactly one app process for each data directory. SQLite data, upload snapshots, restore locks and background work belong to that process; do not share a volume between replicas. Keep the database and its data directory on the same filesystem for online restore.

## First installation

Install Docker with Compose support, then from the root of an authorized checkout run the installer for your shell:

```sh
# Linux / macOS / WSL / Git Bash
./scripts/install.sh
```

```powershell
# Windows
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Windows refuses an unsigned script under its default policy ("running scripts is disabled on this system"), and a script downloaded as a zip carries a mark that even `RemoteSigned` refuses. `-ExecutionPolicy Bypass` lifts that for this one run and changes no setting; a policy your organisation sets with Group Policy still wins, and then `install.sh` from Git Bash does the same. In PowerShell 7 write `pwsh` for `powershell`. `install.ps1` has not been run on Windows yet: it is checked only by reading it and by tests of its text, so report anything it gets wrong.

With no arguments it installs the card app. Name the apps you want, or take all six:

```sh
./scripts/install.sh cards skins
./scripts/install.sh --all
```

On Windows the same two are `... -File .\scripts\install.ps1 cards skins` and `... -File .\scripts\install.ps1 -All`. The apps are cards (port 3000), skins (3001), retro-games (3002), comics (3003), watches (3004) and whisky (3005), each reachable from this computer only.

The script:

1. checks that Docker with Compose is installed and its daemon is running, and says which is missing;
2. creates `.env` from `.env.example` when there is none, with a generated 24-character password and a 64-hex secret for **every** app (`APP_PASSWORD` and `APP_SECRET`, then `SKINS_`, `RETRO_GAMES_`, `COMICS_`, `WATCHES_` and `WHISKY_` followed by `APP_PASSWORD` and `APP_SECRET`), whichever you start now, so that an app started later is never open. The file is written to a temporary copy that only you can read (the script says so if the file system keeps no permissions, as Git Bash on Windows does not), checked, and moved into place when whole: an interrupted run leaves no `.env` at all, never one without a password. The passwords of the apps you chose are printed before the build starts, and kept in `.env`; keep that file private and back it up;
3. leaves an existing `.env` exactly as it is, and says for each chosen app whether it asks for a login. An app with no password (an empty value, a commented-out line, a pair of empty quotes) is named, with a line you can paste into `.env`; such an app lets in anyone who can reach it;
4. builds and starts the chosen apps with `docker compose up -d --build`, asks each one's `/api/health` until it answers (each request is held to five seconds, the whole wait to three minutes; `INSTALL_HEALTH_TIMEOUT` in the environment, in seconds, changes that), and prints `http://localhost:3000` and the others.

If the image build fails the script says so, says that `.env` was written, where it is and which variables hold the passwords, and that running it again does not change it.

API-key lines in `.env` are left blank; manual entry, CSV imports, purchases and goals need no API keys. Open the address, sign in with the printed password, then open Settings in the app and run the provider connection tests (guided checks) to verify any providers you configure. The setup checklist links to those steps and can be reopened in Settings.

To do the same steps by hand instead, copy `.env.example` to `.env`, fill in your own secrets, and run `docker compose up -d --build cards`. Compose needs no `.env` at all, but without a password in it an app lets in anyone who can reach it.

The installer has been run here only against stand-ins for Docker and curl, never against a Docker daemon, and only under bash on Linux: the first real install is also its first real test.

For photo identification add `ANTHROPIC_API_KEY` to `.env`; for paid graded prices add `PRICECHARTING_TOKEN`; to fill a slab's grade and PSA's scans from its cert number add `PSA_API_TOKEN`. Apply environment changes with `docker compose up -d --force-recreate cards`. Settings distinguishes configuration from a tested connection. A connection test makes a small provider request; the vision check asks whether the configured model is available without sending a photo.

Each app has its own named volume holding its `/data`: `collectcollect-data` (cards), `collectcollect-skins-data`, `collectcollect-retro-games-data`, `collectcollect-comics-data`, `collectcollect-watches-data` and `collectcollect-whisky-data`. Container replacement preserves them. Do not use `docker compose down -v` when keeping your collection: that removes the volumes. Whatever `.env` says, an app's data directory in a container is its `/data` volume (Compose sets `DATA_DIR`, `SKINS_DATA_DIR`, `RETRO_GAMES_DATA_DIR` and the rest after reading `.env`), so a data directory meant for a shell run cannot move a container's database out of its volume. Start another app with `docker compose up -d --build skins` (or run the installer with its name).

## The six apps

Each app is its own Compose service, with its own port on this machine, its own volume and its own variables. Start one with `docker compose up -d --build <service>` and apply a change to `.env` with `docker compose up -d --force-recreate <service>`.

| Service | Port | Volume | Password | Signing secret |
| --- | --- | --- | --- | --- |
| `cards` | 3000 | `collectcollect-data` | `APP_PASSWORD` | `APP_SECRET` |
| `skins` | 3001 | `collectcollect-skins-data` | `SKINS_APP_PASSWORD` | `SKINS_APP_SECRET` |
| `retro-games` | 3002 | `collectcollect-retro-games-data` | `RETRO_GAMES_APP_PASSWORD` | `RETRO_GAMES_APP_SECRET` |
| `comics` | 3003 | `collectcollect-comics-data` | `COMICS_APP_PASSWORD` | `COMICS_APP_SECRET` |
| `watches` | 3004 | `collectcollect-watches-data` | `WATCHES_APP_PASSWORD` | `WATCHES_APP_SECRET` |
| `whisky` | 3005 | `collectcollect-whisky-data` | `WHISKY_APP_PASSWORD` | `WHISKY_APP_SECRET` |

The install script above writes a password and a secret for all six into a new `.env`. With an `.env` from before it (or one written by hand), check that every app you run has a password (`openssl rand -hex 12` makes one): without one the app is open to anyone who can reach its port, and only cards and skins say so in their log at start (the other four say so on their Settings page). Every app keeps a random signing key, `session-secret`, in its own data directory when no secret is set; `<PREFIX>_APP_SECRET` replaces it. The four others have a password gate only: no sign-in with Google, and signing out clears one browser's cookie rather than ending the session everywhere, so change the password to end them all.

Every service reads the whole `.env`, so a name more than one app reads is one value for all of them: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_MODEL` (cards and the four newer apps), `PRICECHARTING_TOKEN` (cards, retro games and comics), `MARKDOWN_MIRROR` (cards and the four newer apps; skins has `SKINS_MARKDOWN_MIRROR`), and `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, `COOKIE_SECURE`, `APP_BASE_URL` and `ALLOWED_HOSTS`, which all six read. Under Compose every app's `*_DATA_DIR` is pinned to its `/data` volume, whatever `.env` says. A `*_DATABASE_FILE` (`DATABASE_FILE`, `SKINS_DATABASE_FILE`, `RETRO_GAMES_DATABASE_FILE` and so on) is not: set in `.env`, it would still move that app's database out of its volume, so leave those for a shell run. `.env.example` lists every variable by app.

## Remote access

For a phone on your own Wi-Fi see [Phone access](#phone-access) below; this section is for putting the apps behind an https reverse proxy.

Keep the default localhost bindings. Set a strong password for each app you run (`APP_PASSWORD`, `SKINS_APP_PASSWORD`, `RETRO_GAMES_APP_PASSWORD` and so on, from the table above), or, for cards and skins, sign-in with Google for the accounts you list (README, "Sign in with Google"; it needs the https address in `APP_URL`, normally the one `APP_BASE_URL` names below, and with no password beside it either no `APP_SECRET`, so a random key is kept in the data directory, or a random one of 32 bytes or more), or both, and place an HTTPS reverse proxy in front. Set `TRUST_PROXY=1` only when a proxy in front sets `X-Forwarded-For` and `X-Forwarded-Proto`; appending to them, as nginx and Caddy do, is fine, because the apps read the entry your proxy added, from the right. Behind more than one proxy of your own, set `TRUSTED_PROXY_HOPS` to how many. Set `APP_BASE_URL=https://…` to the address the proxy serves (with its port, if not 443; it is one name that all six apps read, so for apps on different addresses see "Phone access", below) and responses to that address carry HSTS (a year, `includeSubDomains`) even where the proxy does not say the request was secure; every other name the app answers to stays plain http. Set `ALLOWED_HOSTS` to the domain name the proxy serves and have the proxy pass the original `Host` header through: the apps refuse other names, and refuse writes a browser sends from another site. The list replaces the default names rather than adding to them, so add the LAN address or name you still use directly (`ALLOWED_HOSTS=cards.example.com,192.168.1.20`). A browser write's `Origin` must match the scheme the app believes it is served over, so one of `TRUST_PROXY` (with the proxy setting `X-Forwarded-Proto`), `APP_BASE_URL=https://…` or `COOKIE_SECURE=1` has to say the proxy ends TLS, or saving anything from the browser is refused as a cross-site request. `X-Forwarded-Proto` is believed only with `TRUST_PROXY`; `COOKIE_SECURE=1` makes every address https, the LAN one included, so use it only when the proxy is the only way in. The apps do not serve TLS. Each app sets every security header itself, on every response (README, "The website"): have the proxy pass them through and add none of its own: a second content security policy is enforced beside the first and can only take something away, and a second `X-Frame-Options` value can make a browser ignore both. Serve each app on an origin of its own, at the root of its own host name or port, because their service workers, cookies and links each own their origin. This remains one shared collection with no separate user accounts.

## Phone access

Compose publishes the apps on this computer's `127.0.0.1` only, so a phone cannot reach them until you say how. There are three ways: by USB with `adb reverse` (Android), on the same Wi-Fi over plain http (A), or over https through Tailscale Serve (B); A and B can be used together. None changes the advice above for reaching the apps from outside your own network. Start the apps you want to try first (`docker compose up -d --build <service>`, or the installer, as above).

**None of these routes has been tried from a real phone yet.** The ports, bindings and variables below were checked with `docker compose config` and against the apps' own code; the phone side (Chrome on Android, `adb reverse`, Chrome's flags, a tailnet, the firewall prompts) is written from what those tools document, so read it as a recipe to try, and correct it where a phone disagrees.

**Whichever you choose, give every app you open to the network a password first** (the table above: `APP_PASSWORD`, `SKINS_APP_PASSWORD`, `RETRO_GAMES_APP_PASSWORD`, `COMICS_APP_PASSWORD`, `WATCHES_APP_PASSWORD`, `WHISKY_APP_PASSWORD`, each its own). The installer writes all six into a new `.env`. Anyone else on the Wi-Fi can open an unprotected port. Put them in `.env` and run `docker compose up -d --force-recreate <service> …` for the services you run (a bare `docker compose up -d` would start, and build, all six).

**By USB, with `adb reverse` (Android; nothing is published, and nothing that needs a secure context is lost).** With USB debugging on and the phone plugged in, run `adb reverse tcp:3000 tcp:3000` for each app's port (3000 to 3005) and open `http://localhost:3000` in Chrome on the phone. Chrome treats `localhost` as a secure context even over http, so the app can be installed to the home screen, its offline page and service worker are available and Scan can ask for the live camera. The mapping ends when the cable comes out. `adb` is part of Google's Android platform-tools.

Changes to the ports and to the variables below go in a file of their own, `compose.override.yaml`, next to `compose.yaml`: `docker compose` reads it without being told, so `compose.yaml` stays as it was checked out and deleting the override puts everything back. It holds your addresses, and `.gitignore` keeps it out of commits.

### A) The same Wi-Fi, over http

The quick way is the installer:

```sh
./scripts/install.sh --all --lan        # or: ./scripts/install.sh --lan cards whisky
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -All -Lan
```

`--lan` (`-Lan` on Windows) writes `compose.override.yaml`, which publishes exactly the apps you chose on every network interface instead of on localhost, and prints `http://<this computer's address>:<port>` for each; open those on the phone. It refuses to publish an app that has no password, and it does not touch a `compose.override.yaml` it did not write. If Docker Compose is older than 2.24 it cannot read the file (`!override`), says so, and removes it. To undo it, run the installer again without `--lan`, which removes the file it wrote, or delete the file and run `docker compose up -d --force-recreate <app>`; an app that is already running keeps the ports it was started with until it is started again. The installer warns when `ALLOWED_HOSTS` or `COOKIE_SECURE` in `.env` would turn the phone away (step 4 below).

By hand, binding only the Wi-Fi address rather than every interface:

1. Find this computer's address on the Wi-Fi: `ipconfig` on Windows (the IPv4 Address of the Wi-Fi adapter), `ipconfig getifaddr en0` on macOS (`en1` on some Macs), `hostname -I` on Linux. Give it a fixed address in the router (a DHCP reservation), or it will change. The phone has to be on the same network, not a guest network that keeps devices apart.
2. Publish the ports on that address. `ports: !override` replaces the list in `compose.yaml`; without `!override` Compose adds to it and `127.0.0.1` stays published beside the new one. List the services you want to reach (the tag needs Compose 2.24 or later: `docker compose version`):

   ```yaml
   services:
     cards:
       ports: !override
         - "192.168.1.20:3000:3000"
     skins:
       ports: !override
         - "192.168.1.20:3001:3000"
     retro-games:
       ports: !override
         - "192.168.1.20:3002:3000"
     comics:
       ports: !override
         - "192.168.1.20:3003:3000"
     watches:
       ports: !override
         - "192.168.1.20:3004:3000"
     whisky:
       ports: !override
         - "192.168.1.20:3005:3000"
   ```

   Binding to the address, not to every interface (`"3000:3000"`), keeps the ports off the computer's other networks, a VPN or a second adapter, and that matters on Linux, where Docker opens published ports through its own firewall rules, which a `ufw` rule does not filter by default.
3. Run `docker compose up -d <service> …` for the services you run (it recreates those whose ports changed). On Windows and macOS the first connection from another device may bring up the system firewall asking whether Docker may accept incoming connections: allow it for private networks. If you dismissed it, allow inbound TCP 3000-3005 for Docker in the firewall's settings.
4. On the phone open `http://192.168.1.20:3000` (cards), `:3001` (skins), `:3002` (retro games), `:3003` (comics), `:3004` (watches) and `:3005` (whisky), and sign in with that app's password. An address is allowed by default, so nothing else needs configuring; if you have set `ALLOWED_HOSTS`, the address has to be in it. Leave `TRUST_PROXY`, `APP_BASE_URL` and `COOKIE_SECURE` unset for this: there is no proxy, the pages are http, and `COOKIE_SECURE=1` would make every app refuse a write from an http address.
5. To undo it, delete `compose.override.yaml` and run `docker compose up -d <service> …` again.

What does not work at an `http://` address other than `localhost`, because a browser gives these to secure pages only:

- **Installing to the home screen and the offline page.** The service worker is registered only where the browser offers one, so the apps are ordinary browser tabs here (Chrome offers *Add to Home screen* as a shortcut that opens in a tab), and a phone without a connection shows the browser's own error, not the app's.
- **The live camera in cards' Scan.** `getUserMedia` needs a secure page, so *Use camera* says the live camera needs https; Scan's *Choose photos* works, and so does every Add page's photo picker.
- **Sign-in with Google (cards and skins).** Google returns only to the https address in `APP_URL` and its state cookie is `Secure`, so at an http address the password is the way in.

Everything else works: the pages, adding, importing, prices, reports, backups. The password and everything else cross the Wi-Fi unencrypted: use this at home for a test, not on a shared or public network. For a test on one phone only, Chrome's `chrome://flags/#unsafely-treat-insecure-origin-as-secure` can be given `http://<this computer's address>:3000`; enable it and relaunch Chrome, and that one address is treated as secure on that phone. It is a browser setting, not a way to serve other people. The sign-in limiter counts every phone as one client (without `TRUST_PROXY` the apps do not read `X-Forwarded-For`), so eight wrong passwords within a minute, from any device, make the app refuse every sign-in until that minute is up.

### B) Tailscale Serve, over https

This gives each app an https address on your tailnet with a real certificate, so the three limits of plain http above do not apply, and nothing is published beyond `127.0.0.1`: Tailscale Serve runs on this computer, ends TLS and passes the request on to the app. Use `serve`, never `funnel`, which would put a single-owner collection on the public internet.

1. Install Tailscale on this computer and on the phone, signed in to the same tailnet. In the admin console's DNS settings turn on MagicDNS and HTTPS certificates. This computer's name is `<machine>.<tailnet>.ts.net`; the rest of this section uses `pc.tail1234.ts.net`.
2. Serve one https port for each app, to its port on `127.0.0.1` (the ports below are only a choice; use any unused ones):

   ```sh
   tailscale serve --bg --https=8443 http://127.0.0.1:3000   # cards
   tailscale serve --bg --https=8444 http://127.0.0.1:3001   # skins
   tailscale serve --bg --https=8445 http://127.0.0.1:3002   # retro games
   tailscale serve --bg --https=8446 http://127.0.0.1:3003   # comics
   tailscale serve --bg --https=8447 http://127.0.0.1:3004   # watches
   tailscale serve --bg --https=8448 http://127.0.0.1:3005   # whisky
   tailscale serve status
   ```

   The flag spelling is Tailscale's and has changed between versions: `tailscale serve --help` on yours has the current one.
3. Tell each app its own address. `APP_BASE_URL`, `ALLOWED_HOSTS` and `COOKIE_SECURE` are each one name that all six apps read from the one `.env`, so a single value cannot describe six different https ports; `environment:` in the override is per service and wins over `.env`:

   ```yaml
   services:
     cards:
       environment:
         APP_BASE_URL: https://pc.tail1234.ts.net:8443
         ALLOWED_HOSTS: pc.tail1234.ts.net,192.168.1.20,localhost
     skins:
       environment:
         APP_BASE_URL: https://pc.tail1234.ts.net:8444
         ALLOWED_HOSTS: pc.tail1234.ts.net,192.168.1.20,localhost
     retro-games:
       environment:
         APP_BASE_URL: https://pc.tail1234.ts.net:8445
         ALLOWED_HOSTS: pc.tail1234.ts.net,192.168.1.20,localhost
     comics:
       environment:
         APP_BASE_URL: https://pc.tail1234.ts.net:8446
         ALLOWED_HOSTS: pc.tail1234.ts.net,192.168.1.20,localhost
     watches:
       environment:
         APP_BASE_URL: https://pc.tail1234.ts.net:8447
         ALLOWED_HOSTS: pc.tail1234.ts.net,192.168.1.20,localhost
     whisky:
       environment:
         APP_BASE_URL: https://pc.tail1234.ts.net:8448
         ALLOWED_HOSTS: pc.tail1234.ts.net,192.168.1.20,localhost
   ```

   `APP_BASE_URL` is the name and port exactly as they arrive in the `Host` header. A request sent to it is treated as https: its responses carry HSTS and `upgrade-insecure-requests`, and a browser write must carry an `https://` `Origin`. Every other name the app answers to stays plain http. `ALLOWED_HOSTS` replaces the default names (any address, single-label and `.local`/`.lan` names) with the ones it lists, so it must name the `ts.net` name and every other way you still reach the apps: the address from A, and `localhost` if you open them on this computer. It matches names, not ports, so the same list serves all six. This is the same list for every service, so it can equally go in `.env`.
4. Run `docker compose up -d --force-recreate <service> …` for the services you run, then on the phone open `https://pc.tail1234.ts.net:8443` (cards), `:8444`, and so on, and sign in.

Check it from this computer with `curl -si https://pc.tail1234.ts.net:8443/api/health` (every app has the route): a `200` with a `Strict-Transport-Security` header means the app received the `ts.net` name and port in `Host` and took the request for https, which is what the variables above rely on.

Leave `TRUST_PROXY` unset here. With it the apps believe the `X-Forwarded-For` and `X-Forwarded-Proto` that arrive, which is safe only when Serve is the one thing that can reach the port; if A is in use as well, a phone on the Wi-Fi could send its own and claim to be https or another address. `COOKIE_SECURE=1` marks the session cookie `Secure` but also tells every app that every address is https, `localhost` and the Wi-Fi address included, which then refuse a plain-http write; set it only if the apps are reached through Serve alone. Without either, the cookie is not marked `Secure`, which matters little while nothing answers on plain http at that name.

If something is wrong, the message says which of these it is:

- *"This server does not answer to that host name. Set ALLOWED_HOSTS to add it."* (403): the name in the address bar is not in `ALLOWED_HOSTS` for that app.
- *"Cross-site request refused."* on signing in or saving: the browser sent an `https://` `Origin` and the app took the page for http. `APP_BASE_URL` is missing for that service, names another port (one value in `.env` is right for one app only), or the `Host` that reached the app was not the `ts.net` name and port.
- An `http://` address on the `ts.net` name stops opening once a browser has seen the https one: the apps send HSTS (a year, `includeSubDomains`), and a browser then upgrades every port of that name. Use the computer's IP address for plain http, which HSTS does not cover.

Over https the camera in Scan works, the apps can be installed from the browser's menu (all six), and the offline page appears when the phone has no connection. Each app must stay on its own origin (its own port or host name): a service worker's scope is an origin. Sign-in with Google also needs `APP_URL` set to the same https address, and Google has to accept it as a redirect address; this has not been tried with a `ts.net` name.

Tailscale itself was not reachable from where this section was written: the `tailscale serve` syntax, that Serve accepts ports such as 8443-8448, that it passes the original `Host` through, and the admin-console switches named above are from Tailscale's documentation as remembered, not checked. The `curl` check above tests exactly what the apps need, so run it first.

## Backup, update and recovery

1. Download a full backup from Settings before updating; keep it outside the Docker volume. It includes the database and photos, with goals in the database.
2. Check out the intended version, read [release notes](CHANGELOG.md), and run `docker compose up -d --build cards` (or the service you run). Schema additions apply when the database opens. Check `/api/health`, open a card and goal, and verify your history.
3. For recovery, stop the app and preserve a copy of the current volume first. Run the previous version with a separate volume and restore the matching pre-update backup. Do not point an older version at a database migrated by a newer version.
4. Settings retains the collection replaced during a restore, allowing undo. Follow its size guidance for archives too large for a browser upload; unpack only with the app stopped.
5. If a start logs that an interrupted restore left two copies in place, both are still on disk: the pairs are in `<database>.restore-conflicts.json` beside the database and on Settings. Compare each pair, move the copy you do not want out of the data directory, and either delete the record or let the next restore or put-back clear it. If the app refuses to start because two copies of the database itself exist, the message names both paths and the dated folder holding the pre-restore collection; put the copy you want at the database path, move the other away, and delete the restore journal before starting again. `/api/health` reports `database: false` for as long as the database cannot be opened.

Markdown downloads include readable card files and `goals/goal-<id>.md` files. Each goal includes its wishlist and a JSON record for repeatable restoration. Photos are included only in the full backup. Unknown goal files are preserved when rewriting, so a surviving copy can be read back into a fresh database.

## Release status

Public image publication is disabled. `bash scripts/release-candidate.sh <version>` validates a candidate on your own machine: it runs the whole gate, builds a local cards image, checks goal persistence over a container restart on a throwaway volume, and writes an image archive, the candidate Compose file and these instructions to `release/`. It contacts no registry and publishes nothing. The project is MIT-licensed (`LICENSE`); explicit publication enablement remains a separate release step, and this guide does not assume a public image exists.

To test an artifact, load its image with `docker load -i collectcollect-cards-<version>.tar.gz`, then run `docker compose --env-file candidate.env -f compose.candidate.yaml up -d`. It uses the separate `collectcollect-candidate-data` volume. Stop your normal app first if it uses port 3000. Restore a copy of your backup into the candidate when checking upgrades; keep the original backup unchanged.

The display font is bundled for reproducible builds without Google Fonts access. Its upstream OFL license is included with the font, separate from the project's own MIT licence.

Before publication, require passing checks for the exact release commit: lint, types, unit tests, every browser suite, Docker startup/shutdown, restart persistence, and restoration of a previous-version backup. Only then create versioned images.
