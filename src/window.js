import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, clipboard, screen, session, shell } from 'electron'
import { log, logPaths } from './log.js'
import { errorPageUrl } from './error-page.js'
import { buildContextMenu } from './context-menu.js'

export const APP_PARTITION = 'persist:dsh-app'
const SHOW_WATCHDOG_MS = 30_000
const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function isHttp(url) {
  return url.startsWith('http://') || url.startsWith('https://')
}

/** Cookies are keyed by host, not port: a stale dsh-auth-* from an earlier
 * random port would otherwise be sent to the new one. */
async function clearAuthCookies(ses, origin) {
  try {
    const cookies = await ses.cookies.get({ url: origin })
    for (const cookie of cookies) {
      if (cookie.name.startsWith('dsh-auth-')) {
        await ses.cookies.remove(origin, cookie.name)
        log(`window: cleared stale cookie ${cookie.name}`)
      }
    }
  } catch (error) {
    log('window: could not inspect cookies:', error.message)
  }
}

function clampZoom(zoom) {
  return Math.min(3, Math.max(0.5, zoom))
}

/** Keep at least 100x100 px of the window on some display, or let the WM place it. */
function restoredBounds(config) {
  const { width, height, x, y } = config.window
  if (Number.isInteger(x) && Number.isInteger(y)) {
    const visible = screen.getAllDisplays().some(display => {
      const area = display.workArea
      const overlapWidth = Math.min(x + width, area.x + area.width) - Math.max(x, area.x)
      const overlapHeight = Math.min(y + height, area.y + area.height) - Math.max(y, area.y)
      return overlapWidth >= 100 && overlapHeight >= 100
    })
    if (visible) return { x, y, width, height }
    log('window: saved position is off-screen; letting the window manager place it')
  }
  return { width, height }
}

/** The one application window: the DSH UI and, on failure, the local error page. */
export class AppWindow {
  #onInternalAction
  #onZoomChange
  #onBoundsChange
  #config
  #show
  #appOrigin
  #persistTimer

  constructor({ config, show = true, iconPath, onInternalAction, onZoomChange, onBoundsChange }) {
    this.#config = config
    this.#show = show
    this.#onInternalAction = onInternalAction
    this.#onZoomChange = onZoomChange
    this.#onBoundsChange = onBoundsChange
    this.#appOrigin = undefined

    this.win = new BrowserWindow({
      ...restoredBounds(config),
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'DeepSeek Harness',
      icon: iconPath,
      backgroundColor: '#1b1c1f',
      autoHideMenuBar: config.menuBar === 'auto',
      webPreferences: {
        // Adds the in-window app-menu button; exposes no page API.
        preload: fileURLToPath(new URL('./preload-app.cjs', import.meta.url)),
        partition: APP_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    })
    if (config.menuBar === 'hidden') this.win.setMenuBarVisibility(false)
    log(`window: bounds=${JSON.stringify(this.win.getBounds())} maximized=${config.window.maximized}`)

    // Registering this after loadURL() would miss the event, because it fires
    // during the load: the window would stay hidden forever.
    this.win.once('ready-to-show', () => {
      log('window: ready-to-show')
      if (!this.#show || this.win.isDestroyed()) return
      if (this.#config.window.maximized) this.win.maximize()
      this.win.show()
    })

    // Persist geometry, debounced: move/resize fire continuously while dragging.
    const scheduleBounds = () => this.#schedulePersist()
    this.win.on('move', scheduleBounds)
    this.win.on('resize', scheduleBounds)
    this.win.on('maximize', () => {
      this.#config.window.maximized = true
      this.#onBoundsChange?.()
    })
    this.win.on('unmaximize', () => {
      this.#config.window.maximized = false
      this.#schedulePersist()
    })

    // Anything that is not this local app belongs in the user's real browser.
    this.win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (isHttp(target) && !target.startsWith(this.#appOrigin ?? '')) void shell.openExternal(target)
      return { action: 'deny' }
    })

    this.win.webContents.on('will-navigate', (event, target) => {
      if (target.startsWith('dsh-error://')) {
        event.preventDefault()
        this.#onInternalAction?.(target)
        return
      }
      let targetOrigin
      try {
        targetOrigin = new URL(target).origin
      } catch {
        event.preventDefault()
        return
      }
      if (this.#appOrigin !== undefined && targetOrigin !== this.#appOrigin) {
        event.preventDefault()
        if (isHttp(target)) void shell.openExternal(target)
      }
    })

    // Electron ships no default context menu; build one from Chromium's params.
    this.win.webContents.on('context-menu', (_event, params) => {
      const template = buildContextMenu(params, {
        undo: () => this.win.webContents.undo(),
        redo: () => this.win.webContents.redo(),
        cut: () => this.win.webContents.cut(),
        copy: () => this.win.webContents.copy(),
        paste: () => this.win.webContents.paste(),
        selectAll: () => this.win.webContents.selectAll(),
        copyImage: () => this.win.webContents.copyImageAt(params.x, params.y),
        openLink: url => shell.openExternal(url),
        copyLink: url => clipboard.writeText(url),
      })
      log(`context-menu: editable=${params.isEditable === true} items=${template.length}`)
      if (process.env.DSH_LINUX_APP_SMOKE === '1') {
        const labels = template.filter(item => item.label !== undefined).map(item => item.label).join('|')
        console.log(`SMOKE: context-menu items=${template.length} labels=${labels}`)
        return
      }
      if (template.length === 0) return
      Menu.buildFromTemplate(template).popup({ window: this.win })
    })

    this.win.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
      // -3 is ERR_ABORTED, emitted for ordinary redirects.
      if (isMainFrame && code !== -3) log(`window: failed to load ${failedUrl} (${code} ${description})`)
    })

    this.win.webContents.on('did-finish-load', () => {
      this.applyZoom()
      log(`window: loaded visible=${this.win.isVisible()}`)
    })
  }

  async loadApp(url) {
    this.#appOrigin = new URL(url).origin
    await clearAuthCookies(session.fromPartition(APP_PARTITION), this.#appOrigin)
    log(`window: loading ${url.replace(/token=[^&]+/, 'token=<redacted>')}`)
    await this.#load(url)
  }

  async showError({ title, message, details }) {
    log(`window: showing error page "${title}"`)
    await this.#load(errorPageUrl({ title, message, details, logPath: logPaths.host }))
  }

  async #load(url) {
    // A page that never paints (stuck plugin, broken renderer) must not leave an
    // invisible app running: show the window anyway so the user can see and quit.
    const watchdog = setTimeout(() => {
      if (this.#show && !this.win.isDestroyed() && !this.win.isVisible()) {
        log('window: showing after load watchdog')
        this.win.show()
      }
    }, SHOW_WATCHDOG_MS)
    try {
      await this.win.loadURL(url)
    } finally {
      clearTimeout(watchdog)
    }
    if (this.#show && !this.win.isDestroyed() && !this.win.isVisible()) {
      log('window: showing after load (ready-to-show was missed)')
      this.win.show()
    }
  }

  #schedulePersist() {
    clearTimeout(this.#persistTimer)
    this.#persistTimer = setTimeout(() => this.flushBounds(), 500)
  }

  /** Write the current geometry into the config object (caller saves it). */
  flushBounds() {
    clearTimeout(this.#persistTimer)
    if (this.win.isDestroyed()) return
    const maximized = this.win.isMaximized()
    this.#config.window.maximized = maximized
    if (!maximized) {
      const bounds = this.win.getBounds()
      if (bounds.width > 0 && bounds.height > 0) {
        this.#config.window.x = bounds.x
        this.#config.window.y = bounds.y
        this.#config.window.width = bounds.width
        this.#config.window.height = bounds.height
      }
    }
    this.#onBoundsChange?.()
  }

  applyZoom() {
    if (this.win.isDestroyed()) return
    this.win.webContents.setZoomFactor(this.#config.zoom)
  }

  setZoom(zoom) {
    const next = clampZoom(zoom)
    this.#config.zoom = next
    this.applyZoom()
    this.#onZoomChange?.(next)
    log(`window: zoom=${next}`)
  }

  zoomIn() {
    const next = ZOOM_LEVELS.find(level => level > this.#config.zoom + 0.001) ?? ZOOM_LEVELS.at(-1)
    this.setZoom(next)
  }

  zoomOut() {
    const next = [...ZOOM_LEVELS].reverse().find(level => level < this.#config.zoom - 0.001) ?? ZOOM_LEVELS[0]
    this.setZoom(next)
  }

  zoomReset() {
    this.setZoom(1)
  }

  reload() {
    if (!this.win.isDestroyed()) this.win.webContents.reload()
  }

  toggleDevTools() {
    if (!this.win.isDestroyed()) this.win.webContents.toggleDevTools()
  }

  show() {
    if (this.win.isDestroyed()) return
    if (this.win.isMinimized()) this.win.restore()
    this.win.show()
    this.win.focus()
  }

  hide() {
    if (!this.win.isDestroyed()) this.win.hide()
  }

  isVisible() {
    return !this.win.isDestroyed() && this.win.isVisible()
  }

  close() {
    if (!this.win.isDestroyed()) this.win.close()
  }
}
