import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, dialog, ipcMain, session } from 'electron'
import { Host, resolveHostLaunch } from './host.js'
import { AppWindow, APP_PARTITION } from './window.js'
import { loadConfig, saveConfig, configPath } from './config.js'
import { createAppMenu, installMenu } from './menu.js'
import { createTray } from './tray.js'
import { trayHostAvailable } from './tray-host.js'
import { closeDecision } from './close-decision.js'
import { log, logPaths } from './log.js'

const smoke = process.env.DSH_LINUX_APP_SMOKE === '1'
// --hidden starts in the tray; used by the login autostart entry.
const hidden = process.argv.includes('--hidden')
const appIconPath = fileURLToPath(new URL('../assets/icon.png', import.meta.url))
const trayIconPaths = {
  light: fileURLToPath(new URL('../assets/tray-light.png', import.meta.url)),
  dark: fileURLToPath(new URL('../assets/tray-dark.png', import.meta.url)),
}
const ALLOWED_PERMISSIONS = new Set([
  'clipboard-sanitized-write',
  'notifications',
  'media',
  'fullscreen',
  'pointerLock',
])

// Electron derives the Linux WM_CLASS from the product name in package.json
// ("DeepSeek Harness" -> "deepseek-harness"); the .desktop StartupWMClass uses
// that value. app.setName keeps the user-data directory at dsh-linux-app.
app.setName('dsh-linux-app')
if (process.env.DSH_LINUX_APP_USER_DATA) app.setPath('userData', process.env.DSH_LINUX_APP_USER_DATA)
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
if (process.env.DSH_LINUX_APP_NO_SANDBOX === '1') app.commandLine.appendSwitch('no-sandbox')
if (smoke) app.disableHardwareAcceleration()

let config
let host
let appWindow
let appMenu
let tray = null
let quitting = false
let booting = false
let trayRetry = 0

/** One place that stops the host and exits, so no path leaves an orphan child. */
async function shutdown(code) {
  if (quitting) return
  quitting = true
  try {
    await Promise.race([
      host?.stop() ?? Promise.resolve(),
      new Promise(resolve => setTimeout(resolve, 6000)),
    ])
  } catch (error) {
    log('host stop failed:', error.message)
  }
  try {
    appWindow?.flushBounds()
    if (config !== undefined) saveConfig(config)
  } catch (error) {
    log('could not persist window state:', error.message)
  }
  try {
    tray?.dispose()
  } catch {
    // Nothing to clean up.
  }
  app.exit(code)
}

function redact(url) {
  return url.replace(/token=[^&]+/, 'token=<redacted>')
}

async function showError({ title, message, details }) {
  if (appWindow === undefined) {
    log(`fatal: ${title}${details === undefined ? '' : ` (${details})`}`)
    if (smoke) {
      void shutdown(1)
      return
    }
    dialog.showErrorBox(title, `${message}\n\n${details ?? ''}\n\nHost log: ${logPaths.host}`)
    void shutdown(1)
    return
  }
  await appWindow.showError({ title, message, details })
}

async function boot() {
  if (quitting || booting) return
  booting = true
  try {
    await host?.stop()
  } catch (error) {
    log('host stop before restart failed:', error.message)
  }
  host = new Host({
    cwd: config.workingDirectory ?? homedir(),
    // A packaged supervisor must live outside app.asar for the system Node.
    supervisorPath: app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'src', 'host-supervisor.mjs')
      : undefined,
    dshPath: config.dshPath,
    nodePath: config.nodePath,
    timeoutMs: config.hostTimeoutMs,
    onExit: ({ code, signal }) => {
      if (quitting || booting) return
      void showError({
        title: 'DeepSeek Harness stopped',
        message: 'The local dsh host exited unexpectedly. Retry to start a new one.',
        details: `code ${code}, signal ${signal}`,
      })
    },
  })
  try {
    const url = await host.start()
    log(`host ready pid=${host.pid} url=${redact(url)}`)
    // The smoke script reads this to prove the child is gone after exit.
    process.stdout.write(`HOST_PID=${host.pid}\n`)
    await appWindow.loadApp(url)
  } catch (error) {
    log(`boot failed: ${error.message}`)
    await showError({
      title: 'DeepSeek Harness could not start',
      message: 'The local dsh host did not come up. Retry, or check the host log.',
      details: error.message,
    })
  } finally {
    booting = false
  }
}

async function requestRestart() {
  if (quitting || booting) return
  if (smoke) {
    await retry()
    return
  }
  const { response } = await dialog.showMessageBox(appWindow?.win, {
    type: 'question',
    title: 'Restart Host',
    message: 'Restart the local host?',
    detail: 'The dsh host will stop and start again. Any running task will be interrupted.',
    buttons: ['Restart Host', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  })
  if (response === 0) await retry()
}

async function retry() {
  if (quitting) return
  log('retry requested')
  await boot()
}

function appUrl(url) {
  return typeof url === 'string'
    && (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:') || url.startsWith('data:'))
}

function installPermissions() {
  const ses = session.fromPartition(APP_PARTITION)
  ses.setPermissionRequestHandler((contents, permission, callback) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission) && appUrl(contents.getURL())
    log(`permissions: ${permission} for ${contents.getURL()} -> ${allowed}`)
    callback(allowed)
  })
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && appUrl(requestingOrigin ?? ''))
}

async function showAbout() {
  let hostDescription = 'dsh: not found'
  try {
    hostDescription = `Host: ${resolveHostLaunch({ dshPath: config.dshPath, nodePath: config.nodePath }).description}`
  } catch (error) {
    hostDescription = `Host: ${error.message}`
  }
  await dialog.showMessageBox({
    type: 'info',
    title: 'About DeepSeek Harness',
    message: `DeepSeek Harness ${app.getVersion()}`,
    detail: [
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
      hostDescription,
      `Config: ${configPath}`,
      `Logs: ${logPaths.dir}`,
    ].join('\n'),
    buttons: ['Close'],
  })
}

function installWindowBehaviour() {
  appWindow.win.on('close', event => {
    if (quitting) return
    const action = closeDecision({
      closeToTray: config.closeToTray,
      hasTray: tray !== null,
      trayHost: trayHostAvailable(),
    })
    if (action === 'close') return
    event.preventDefault()
    appWindow.flushBounds()
    saveConfig(config)
    if (action === 'hide') {
      appWindow.hide()
      log('window: close intercepted (hidden to tray)')
    } else {
      appWindow.minimize()
      log('window: close minimized (no tray host or no tray)')
    }
  })
}

function ensureTray() {
  if (tray !== null || config.tray === false) return tray
  if (!trayHostAvailable()) return null
  tray = createTray({
    iconPaths: trayIconPaths,
    mode: config.trayIcon,
    onOpen: () => appWindow.show(),
    onHide: () => appWindow.hide(),
    onRestart: () => void requestRestart(),
    onQuit: () => void shutdown(0),
  })
  return tray
}

/** A login launch can race the panel: keep the window hidden while retrying. */
function waitForTray() {
  if (quitting || tray !== null) return
  if (trayRetry >= 10) {
    log('app: no tray host after retries; showing the window')
    appWindow.show()
    return
  }
  trayRetry += 1
  setTimeout(() => {
    if (quitting || tray !== null) return
    ensureTray()
    if (tray !== null) log('app: tray became available; staying hidden')
    else waitForTray()
  }, 2000)
}

/** A visible launch may start before the panel; keep trying for a host. */
function probeTray(attempt = 0) {
  if (quitting || tray !== null || config.tray === false) return
  if (attempt >= 30) {
    log('tray: no StatusNotifier host after 60s; close will minimize')
    return
  }
  setTimeout(() => {
    if (quitting || tray !== null) return
    ensureTray()
    if (tray !== null) log('tray: host appeared; icon created')
    else probeTray(attempt + 1)
  }, 2000).unref?.()
}

async function main() {
  app.on('second-instance', () => {
    appWindow?.show()
  })

  app.on('window-all-closed', () => {
    if (quitting) return
    if (config?.closeToTray === true) return
    void shutdown(0)
  })

  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    void shutdown(0)
  })

  await app.whenReady()
  log(`app: starting version=${app.getVersion()} electron=${process.versions.electron} ` +
    `userData=${app.getPath('userData')} smoke=${smoke} hidden=${hidden}`)

  config = loadConfig()
  // Environment overrides win over the config file (handy for tests and for
  // launchers that resolve paths themselves).
  if (process.env.DSH_LINUX_APP_DSH) config.dshPath = process.env.DSH_LINUX_APP_DSH
  if (process.env.DSH_LINUX_APP_NODE) config.nodePath = process.env.DSH_LINUX_APP_NODE
  if (process.env.DSH_LINUX_APP_CWD) config.workingDirectory = process.env.DSH_LINUX_APP_CWD
  installPermissions()

  ipcMain.on('dsh-desktop:ui-config', event => {
    event.returnValue = { appMenuButton: config.appMenuButton }
  })
  ipcMain.on('dsh-desktop:app-menu', event => {
    if (appWindow === undefined || event.sender !== appWindow.win.webContents) return
    log('app: app menu requested')
    if (smoke) console.log('SMOKE: app-menu-ipc=true')
    if (smoke && process.env.DSH_LINUX_APP_SMOKE_MENU !== '1') return
    try {
      appMenu?.popup({ window: appWindow.win })
      log('app: app menu opened')
      if (smoke) console.log('SMOKE: menu-popup=opened')
    } catch (error) {
      log(`app: app menu failed: ${error.message}`)
      if (smoke) console.log('SMOKE: menu-popup=failed')
    }
  })

  const actions = {
    reload: () => appWindow.reload(),
    toggleDevTools: () => appWindow.toggleDevTools(),
    zoomIn: () => appWindow.zoomIn(),
    zoomOut: () => appWindow.zoomOut(),
    zoomReset: () => appWindow.zoomReset(),
    hide: () => appWindow.hide(),
    restartHost: () => void requestRestart(),
    quit: () => void shutdown(0),
    about: () => void showAbout(),
  }

  // The application menu must exist before the window is created: on Linux a
  // menu set afterwards is not reliably attached to an existing window.
  installMenu(actions)
  appMenu = createAppMenu(actions)

  appWindow = new AppWindow({
    config,
    show: !smoke && !hidden,
    iconPath: appIconPath,
    onInternalAction: action => {
      if (action === 'dsh-error://retry') void retry()
      else if (action === 'dsh-error://quit') void shutdown(0)
    },
    onZoomChange: () => saveConfig(config),
    onBoundsChange: () => saveConfig(config),
  })
  installWindowBehaviour()

  ensureTray()
  if (tray === null) probeTray()

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      log(`app: ${signal} received`)
      void shutdown(0)
    })
  }

  await boot()

  if (hidden && !smoke) {
    if (tray !== null) {
      log('app: started hidden (--hidden)')
    } else if (config.tray === false) {
      log('app: --hidden with tray disabled; showing the window')
      appWindow.show()
    } else {
      waitForTray()
    }
  }

  // Diagnostic: exercise the normal (shown) path unattended.
  const autoQuitMs = Number(process.env.DSH_LINUX_APP_AUTOQUIT_MS ?? '0')
  if (!smoke && Number.isFinite(autoQuitMs) && autoQuitMs > 0) {
    setTimeout(() => {
      log(`window: autoquit visible=${appWindow.isVisible()}`)
      void shutdown(0)
    }, autoQuitMs)
  }

  if (smoke) await runSmokeChecks()
}

async function runSmokeChecks() {
  try {
    if (process.env.DSH_LINUX_APP_SMOKE_ERROR === '1') {
      const heading = await appWindow.win.webContents.executeJavaScript(
        "document.querySelector('h1')?.textContent ?? ''",
      )
      const hasRetry = await appWindow.win.webContents.executeJavaScript(
        "Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href')).includes('dsh-error://retry')",
      )
      console.log(`SMOKE: error-page heading=${JSON.stringify(heading)} retry=${hasRetry}`)
      await shutdown(0)
      return
    }
    if (process.env.DSH_LINUX_APP_SMOKE_SHOW === '1') {
      appWindow.show()
      await new Promise(resolve => setTimeout(resolve, 400))
      console.log(`SMOKE: visible=${appWindow.isVisible()}`)
    }
    if (process.env.DSH_LINUX_APP_CAPTURE) {
      if (!appWindow.isVisible()) appWindow.show()
      await new Promise(resolve => setTimeout(resolve, 1200))
      const image = await appWindow.win.webContents.capturePage()
      writeFileSync(process.env.DSH_LINUX_APP_CAPTURE, image.toPNG())
      console.log(`SMOKE: screenshot=${process.env.DSH_LINUX_APP_CAPTURE}`)
    }

    const contents = appWindow.win.webContents
    const title = await contents.executeJavaScript('document.title')
    const ready = await contents.executeJavaScript('document.readyState')
    const rootChildren = await contents.executeJavaScript("document.getElementById('root')?.childElementCount ?? 0")
    console.log(`SMOKE: page loaded title=${JSON.stringify(title)} readyState=${ready} rootChildren=${rootChildren}`)

    console.log(`SMOKE: menubar=${appWindow.win.isMenuBarVisible()}`)
    const hasButton = await contents.executeJavaScript("!!document.getElementById('dsh-desktop-app-menu')")
    console.log(`SMOKE: app-button=${hasButton}`)
    if (hasButton) {
      await contents.executeJavaScript(
        "document.getElementById('dsh-desktop-app-menu')?.shadowRoot?.querySelector('button')?.click()",
      )
      await new Promise(resolve => setTimeout(resolve, 400))
      if (process.env.DSH_LINUX_APP_SMOKE_MENU === '1') {
        appMenu?.closePopup(appWindow.win)
        console.log('SMOKE: menu-closed')
      }
    }

    // Exercise the context-menu wiring with Chromium-shaped params.
    contents.emit('context-menu', {}, {
      isEditable: true,
      selectionText: '',
      linkURL: '',
      mediaType: 'none',
      x: 10,
      y: 10,
      editFlags: { canUndo: true, canRedo: false, canCut: false, canCopy: false, canPaste: true, canDelete: false, canSelectAll: true },
    })
    console.log('SMOKE: context-menu-emitted')

    appWindow.setZoom(1.25)
    console.log(`SMOKE: zoom=${config.zoom}`)

    appWindow.win.setBounds({ x: 120, y: 140, width: 1000, height: 700 })
    await new Promise(resolve => setTimeout(resolve, 700))
    console.log(`SMOKE: bounds=${JSON.stringify(appWindow.win.getBounds())}`)

    if (config.closeToTray) {
      appWindow.close()
      await new Promise(resolve => setTimeout(resolve, 300))
      console.log(`SMOKE: hidden-to-tray=${!appWindow.isVisible()}`)
    }

    await shutdown(0)
  } catch (error) {
    log(`smoke: ${error.stack ?? error}`)
    await shutdown(1)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void main().catch(error => {
    log(`fatal: ${error.stack ?? error}`)
    void shutdown(1)
  })
}
