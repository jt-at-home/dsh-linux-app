# dsh-linux-app

[![ci](https://github.com/jt-at-home/dsh-linux-app/actions/workflows/ci.yml/badge.svg)](https://github.com/jt-at-home/dsh-linux-app/actions/workflows/ci.yml)

A dedicated Linux desktop app for the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. An
Electron shell starts its own `dsh web` host, shows the UI in a real application
window, and owns the host's lifetime — so the harness behaves like an app rather
than another browser tab.

> **Unofficial community project.** Not affiliated with or endorsed by DeepSeek.
> "DeepSeek Harness" and the DeepSeek name and marks belong to DeepSeek. The
> whale icon is derived from the DSH web frontend artwork.

## Why?

DeepSeek ships the Harness as a local web app and an official desktop shell for
Windows and macOS; there is no Linux build of that desktop app. The community
alternatives we looked at take the heavier route: they port the official
packaging pipeline or fork the harness, bundling a Node/pnpm/Python runtime and
carrying a large patch set that must be rebased for every upstream release.

This project deliberately takes the lighter path: an Electron shell around the
**unmodified `dsh web` host**. It adds only what makes the harness feel like an
app — a real window, tray, hide-on-close, remembered geometry, native menus and
a crash-safe host lifecycle — while leaving the harness itself alone. Profiles,
plugins, sessions, credentials and configuration stay in `~/.dsh`, exactly as
with the CLI or a browser; harness updates come from updating `dsh`, not from
this app, and no harness source is patched.

The trade-off is explicit: the packages do not bundle a runtime, so Node and
`dsh` (plus `pnpm` for plugins) must already be installed. In exchange the app
stays small — a single Electron shell you can read end to end — instead of a
hundreds-of-megabytes runtime copy with a fork to maintain.

## Features

- Dedicated window with tray; closing hides to the tray when the desktop
  provides one, and minimizes otherwise so it can always be restored
- Owns the host: starts `dsh web --profile web --port 0 --no-open`, reads the
  tokenized URL from stdout, and stops the host on quit
- Crash-safe supervision: if the app dies — even via SIGKILL — the host is
  stopped, so no orphan keeps listening on a port
- Native right-click menu: Undo/Redo, Cut/Copy/Paste, Select All, Copy Image,
  Open Link in Browser, Copy Link Address
- Compact app menu behind the **⋯** button: Restart Host, Reload, DevTools,
  Zoom, About, Quit
- Remembers window geometry and zoom; hidden login start with `--hidden`
- In-window error page with Retry when the host fails to start
- Logs rotate at 1 MiB
- AppImage and deb packaging

## Prerequisites (both formats)

The app is only the desktop shell: it does **not** bundle Node, `dsh` or `pnpm`.
Install these first, as the same user that will run the app.

### 1. Node.js 24

Current `dsh` requires Node **24.9 or newer**. Distribution repositories —
including Zorin's — ship Node 18, which is too old and produces
`Node 18 … is too old for this dsh`.

**nvm (recommended; per-user, no sudo for Node):**

```bash
sudo apt update && sudo apt install -y curl git
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash
# open a new terminal so nvm is loaded, then:
nvm install 24
nvm alias default 24
node -v          # must print v24.x
```

**NodeSource (system-wide):**

```bash
sudo apt update && sudo apt install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v          # must print v24.x
```

If `node -v` still prints v18, an older Node comes first on `PATH`. Ensure nvm
is loaded (`command -v node` should point inside `~/.nvm/...`), or remove the
distribution package if nothing else depends on it (`sudo apt remove nodejs`).

**Never use `sudo` with nvm.** `sudo npm` runs a different (system) Node and npm,
installs outside your nvm prefix, and leaves root-owned files. If npm reports
`EACCES`, you are not in an nvm shell: open a new terminal or run `nvm use 24`,
then check `command -v npm` points into `~/.nvm/...`.

NodeSource installs Node and npm system-wide under `/usr`, so its global npm
installs **do** need `sudo` (or a user prefix — see below).

### 2. dsh

```bash
npm install -g @deepseek-ai/dsh@latest
dsh --version
```

npm 11+ blocks lifecycle scripts by default and will warn that `node-pty`,
`koffi` and similar packages were not prepared. Re-run with the exact
`--allow-scripts=…` command npm prints (for 0.2.2-rc.5:
`--allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,protobufjs`),
or set it once with `npm config set allow-scripts=… --location=user`. Without
that, native pieces such as the terminal can be missing.

Then confirm the app will find the same pair:

```bash
command -v node   # ~/.nvm/.../bin/node, or /usr/bin/node
command -v dsh    # ideally the matching prefix
node -v           # v24.x
dsh --version
npm prefix -g     # the prefix both live under
```

If npm refuses with an engine error, you are still on Node 18 — go back to step 1.

**Prefer no sudo?** Keep global installs in your home directory instead of
`/usr`:

```bash
npm config set prefix "$HOME/.local"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
npm install -g @deepseek-ai/dsh
command -v dsh    # ~/.local/bin/dsh
```

The app searches `~/.local/bin` as well, so this works from the desktop too;
the Node it runs is the `node` on the app's `PATH`.

**Already installed with sudo?** It can still work — the app uses whatever
`dsh` it resolves and checks the Node version. To see what it will choose:

```bash
command -v dsh
npm prefix -g
tail -5 ~/.local/state/dsh-linux-app/app.log   # "host: launching …"
```

If `dsh` lives under a root-owned prefix but resolves to Node 24, it is fine;
updates will need `sudo` too. To move to a user prefix, remove the system copy
first (`sudo npm rm -g @deepseek-ai/dsh`) and reinstall as above.

### 3. pnpm (only for plugins)

```bash
npm install -g pnpm@12
pnpm --version
```

The app runs `dsh` with the Node in the same npm prefix, so install both with
the same tool and user. A desktop launch does not read shell profiles; the app
resolves `dsh` and its Node explicitly.

## Install: AppImage

1. Complete the [prerequisites](#prerequisites-both-formats) above.
2. Download `DeepSeek-Harness-<version>-x86_64.AppImage` and `SHA256SUMS` from
   [Releases](https://github.com/jt-at-home/dsh-linux-app/releases), then verify
   the download:
   ```bash
   sha256sum -c --ignore-missing SHA256SUMS
   ```
   `--ignore-missing` verifies whichever release assets you downloaded; the
   checksum file lists every asset.
3. Make it executable:
   ```bash
   chmod +x DeepSeek-Harness-<version>-x86_64.AppImage
   ```
4. Install FUSE 2, which AppImages need to mount themselves:
   - Zorin 17 / Ubuntu 22.04: `sudo apt install libfuse2`
   - Zorin 18 / Ubuntu 24.04+: `sudo apt install libfuse2t64`

   Without root, extract instead:
   ```bash
   APPIMAGE_EXTRACT_AND_RUN=1 ./DeepSeek-Harness-<version>-x86_64.AppImage
   ```
5. Run it:
   ```bash
   ./DeepSeek-Harness-<version>-x86_64.AppImage
   ```
6. The AppImage does not install a menu entry by itself. Launch it from the
   file manager or pin it to your dock/taskbar after the first run. Login start
   is described [below](#enable-login-start).

The build is unsigned, so your desktop may show an "untrusted application"
prompt on first launch.

## Install: deb

1. Complete the [prerequisites](#prerequisites-both-formats) above.
2. Download `dsh-linux-app_<version>_amd64.deb` and `SHA256SUMS`, verify with
   `sha256sum -c --ignore-missing SHA256SUMS`, then install:
   ```bash
   sudo apt install ./dsh-linux-app_<version>_amd64.deb
   ```
   `apt` resolves the GUI libraries; Node, `dsh` and `pnpm` are still required
   from the prerequisites and are not bundled.
3. The package installs:
   - `/opt/DeepSeek Harness/` — application and Electron runtime
   - `/usr/bin/dsh-linux-app` — command (via update-alternatives)
   - a **DeepSeek Harness** entry in the application menu
4. Launch it from the menu, or run `dsh-linux-app`.
5. Uninstall with `sudo apt remove dsh-linux-app`. Your data in `~/.dsh` and
   `~/.config/dsh-linux-app` is left untouched.

## Enable login start

Both formats can start hidden in the tray. Create
`~/.config/autostart/dsh-linux-app.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=DeepSeek Harness
Exec=/usr/bin/dsh-linux-app --hidden
Icon=dsh-linux-app
StartupWMClass=deepseek-harness
Terminal=false
X-GNOME-Autostart-enabled=true
```

For an AppImage, replace `Exec` with the AppImage path followed by `--hidden`.
GNOME (Zorin) needs the `gnome-shell-extension-appindicator` extension for the
tray; without a tray the hidden start falls back to showing the window after
about ten seconds, so the app cannot become unreachable.

## Run from source

Install the [prerequisites](#prerequisites-both-formats) first.

```bash
npm install
npm start          # real ~/.dsh, real window
npm test           # full suite; needs a display, dsh and ImageMagick

npm run install:desktop    # launcher in ~/.local/bin + menu entry
npm run install:autostart  # start hidden in the tray at login
```

`--hidden` starts the app in the tray without showing the window. If no tray host
appears, it retries for about ten seconds while the panel starts and then shows
the window so the app cannot become unreachable.

## Plugins and pnpm

Plugin installs and updates are the one feature that needs software beyond `dsh`
+ Node. The Plugin Market and `dsh plugin` operate on the web profile
(`~/.dsh/profiles/web`) and call `pnpm` directly. The app does not bundle pnpm.

Install pnpm with `npm install -g pnpm@12` (step 3 of the
[prerequisites](#prerequisites-both-formats)); pnpm 12 is the supported line.
Verify the setup with:

```bash
pnpm --version                                  # 12.x
pnpm -C ~/.dsh/profiles/web list --depth 0      # lists profile dependencies
```

### "pnpm needs to be set up" / "A pnpm executable already exists"

A corepack shim counts as an existing executable but fails `pnpm --version` when
it cannot download pnpm (for example an HTTP 429 from the registry). Since the
shim occupies the name, `npm i -g pnpm` refuses to overwrite it. Either:

```bash
# activate the shim already there
corepack prepare pnpm@latest --activate

# or replace the shim with a real global install
npm i -g pnpm@12 --force
```

Then reload the UI (`Ctrl+R`) or use **⋯ → Restart Host** — the setup check is
cached per host process.

### Plugin updates vs harness updates

- **Plugins:** the Plugin Market / `dsh plugin` installs through pnpm into
  `~/.dsh/profiles/web`. Reload the UI afterwards; some plugins need a host
  restart.
- **Harness (`dsh`):** `npm i -g @deepseek-ai/dsh@latest`, then
  **⋯ → Restart Host**.
- The two are independent: updating `dsh` does not update plugins, and plugin
  updates do not change `dsh`.

## Configuration

Created on first run at `~/.config/dsh-linux-app/config.json` (or under
`$XDG_CONFIG_HOME`). An invalid file is reported and left untouched while
defaults are used.

| Key | Default | Meaning |
|---|---|---|
| `window.width` / `window.height` | `1280` / `860` | Initial window size (600×400 floor) |
| `window.x` / `window.y` | `null` | Saved position; ignored if off-screen |
| `window.maximized` | `false` | Restore maximized |
| `menuBar` | `hidden` | `hidden`, `auto` (Alt reveals) or `visible` |
| `appMenuButton` | `true` | The in-window **⋯** app-menu button |
| `trayIcon` | `auto` | `auto`, `light` or `dark` tray variant |
| `zoom` | `1` | UI zoom factor, 0.5–3 |
| `closeToTray` | `true` | Hide to tray when available, otherwise minimize (never quits) |
| `confirmQuit` | `true` | Ask before quitting, warning that running work will stop |
| `tray` | `true` | Create the tray icon when the desktop supports one |
| `dshPath` / `nodePath` | `null` | Explicit launchers; otherwise auto-resolved |
| `workingDirectory` | `null` | Host working directory; defaults to `$HOME` |
| `hostTimeoutMs` | `120000` | Startup deadline before the error page appears |

Environment overrides: `DSH_LINUX_APP_DSH`, `DSH_LINUX_APP_NODE`,
`DSH_LINUX_APP_CWD`, `DSH_LINUX_APP_CONFIG_DIR`, `DSH_LINUX_APP_STATE_DIR`,
`DSH_LINUX_APP_USER_DATA`, `DSH_LINUX_APP_NO_SANDBOX`.

## Troubleshooting

- **Nothing appears on `npm start`.** The app starts the host first; check
  `~/.local/state/dsh-linux-app/app.log` for `window: loaded visible=…` and
  `host: launching …`. A host failure opens the in-window error page with Retry.
- **`Node X is too old for this dsh`.** You are on Node 18 (the distro package).
  Install Node 24 as described in
  [Prerequisites](#prerequisites-both-formats); if several Node installations
  coexist, pin `dshPath`/`nodePath` to the matching pair.
- **`npm install -g` asks for sudo / `EACCES`.** With nvm this must not happen;
  the shell is using a system npm. Open a new terminal or `nvm use 24` and check
  `command -v npm`. With NodeSource, `sudo` is expected (or set a user prefix as
  described in the prerequisites).
- **`dsh: command not found` after installing it.** The shell cannot see the
  npm global bin directory — load nvm (`command -v node`) or check
  `npm prefix -g`.
- **AppImage: `error loading libfuse.so.2`.** Install `libfuse2` (Zorin 17 /
  Ubuntu 22.04) or `libfuse2t64` (Zorin 18 / Ubuntu 24.04), or run with
  `APPIMAGE_EXTRACT_AND_RUN=1`.
- **No tray icon.** GNOME needs the `gnome-shell-extension-appindicator`
  extension. The app only hides to the tray when a StatusNotifier host is
  present; without one, closing **minimizes** the window (dock/overview) instead,
  and a second launch focuses it. It also retries tray creation for the first
  minute, so an icon can appear once the panel finishes starting.
- **A second launch does nothing.** The single-instance lock focused the existing
  window; check `pgrep -af dsh-linux-app`.
- **No tray icon after relaunching.** An older instance is probably still running
  and simply got focused — closing the window hides or minimizes, it does not
  quit. Quit it fully from the tray or **⋯ → Quit**, confirm `pgrep -af
  dsh-linux-app` is empty, then relaunch. A run started with
  `DSH_LINUX_APP_TRAY_HOST=0` never creates a tray by design.
- **Plugin Market says "pnpm needs to be set up"** — see
  [Plugins and pnpm](#plugins-and-pnpm).
- **`crypto/nss_util.cc … NSS error code`** is Chromium complaining about
  `~/.pki/nssdb`; the UI is loaded over loopback HTTP, so it only affects
  renderer TLS.
- **Logs:** `app.log` / `host.log` under `~/.local/state/dsh-linux-app`; the
  previous megabyte is kept as `.1`.

## Build packages

```bash
npm run package:dir    # unpacked app in dist/linux-unpacked (fast)
npm run package        # AppImage + deb in dist/
npm run smoke:packaged # run the newest build with an isolated home
```

`electron-builder` needs Node 22+ to build. Artifacts are ~120 MB (AppImage) and
~95 MB (deb) because Chromium travels with the app.

## Icons

The mark is the whale from the DSH web frontend (`assets/whale.svg`), drawn on a
transparent background — no square plate:

![Icons: blue app whale on dark, white tray whale on dark, near-black tray whale on light](docs/icon-preview.png)

| File | Use |
|---|---|
| `assets/icon.png` | App/window/desktop icon, 1024×1024, DeepSeek blue `#4D6BFE`, transparent |
| `assets/tray-light.png` | Tray on dark panels, white, 64×64 |
| `assets/tray-dark.png` | Tray on light panels, near-black `#1B1C1F`, 64×64 |

The tray follows `nativeTheme` and swaps between the two variants live; override
with `trayIcon: "light"` or `"dark"` (or `"auto"`, the default). Regenerate
everything from the SVG with:

```bash
npm run make-icons   # requires ImageMagick
```

## Project layout

| Path | Purpose |
|---|---|
| `src/bootstrap.js` | Lifecycle: single instance, host start/retry, window, menu/tray wiring, quit |
| `src/host.js` | Resolves `dsh`/`node`, spawns the host, parses the URL, stops it |
| `src/host-supervisor.mjs` | Parent-death watchdog for the host (stdin pipe) |
| `src/window.js` | Window, partition, cookie cleanup, navigation guards, zoom, error page |
| `src/context-menu.js` | Editing/selection/link/image context menu (pure template builder) |
| `src/config.js` | `config.json` load/normalize/save |
| `src/menu.js` | Application menu and accelerators |
| `src/tray.js` | Tray icon and menu (degrades gracefully without a tray host) |
| `src/preload-app.cjs` | Sandboxed preload that injects the **⋯** app-menu button |
| `src/error-page.js` | Local failure document with Retry/Quit |
| `src/log.js` | App and host logs under the state directory |
| `bin/dsh-linux-app` | Launcher used by the `.desktop` entry |
| `assets/` | Generated icons and their SVG sources |
| `scripts/` | Installers, icon generation, smoke and unit tests |

## Non-goals

- Bundled Node/pnpm/Python runtime and `workspace-dependencies`
- Auto-update, `dsh-app://`, `dsh://` protocol handler
- The reserved `profiles/desktop` profile, frameless/glass chrome
- Replacing the official Desktop on Windows/macOS

## License

MIT — see [LICENSE](LICENSE). The whale artwork is derived from the DeepSeek
Harness web frontend; see the attribution note at the top of this file.
