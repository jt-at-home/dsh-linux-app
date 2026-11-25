import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from './log.js'

const configDir = process.env.DSH_LINUX_APP_CONFIG_DIR
  ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'dsh-linux-app')

export const configPath = join(configDir, 'config.json')

/** Defaults are also the documented contract for a hand-written config file. */
export const DEFAULTS = Object.freeze({
  version: 2,
  window: Object.freeze({ width: 1280, height: 860, x: null, y: null, maximized: false }),
  zoom: 1,
  closeToTray: true,
  confirmQuit: true,
  tray: true,
  menuBar: 'hidden',
  appMenuButton: true,
  trayIcon: 'auto',
  dshPath: null,
  nodePath: null,
  workingDirectory: null,
  hostTimeoutMs: 120_000,
})

function number(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function nullableString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Validate a parsed document. Unknown top-level keys are preserved so a newer
 * config survives a downgrade, but only known keys are interpreted.
 */
export function normalizeConfig(raw) {
  const source = typeof raw === 'object' && raw !== null ? raw : {}
  // Version 1 (unversioned) files could only carry the menu bar visible because
  // that was the old default; the settled default is hidden.
  const legacyMenuBar = source.version === undefined && source.menuBar === 'visible'
  const window = typeof source.window === 'object' && source.window !== null ? source.window : {}
  return {
    ...source,
    version: DEFAULTS.version,
    window: {
      width: number(window.width, DEFAULTS.window.width, 600, 10_000),
      height: number(window.height, DEFAULTS.window.height, 400, 10_000),
      x: Number.isInteger(window.x) ? window.x : null,
      y: Number.isInteger(window.y) ? window.y : null,
      maximized: boolean(window.maximized, DEFAULTS.window.maximized),
    },
    zoom: number(source.zoom, DEFAULTS.zoom, 0.5, 3),
    closeToTray: boolean(source.closeToTray, DEFAULTS.closeToTray),
    confirmQuit: boolean(source.confirmQuit, DEFAULTS.confirmQuit),
    tray: boolean(source.tray, DEFAULTS.tray),
    menuBar: legacyMenuBar
      ? 'hidden'
      : ['visible', 'auto', 'hidden'].includes(source.menuBar) ? source.menuBar : DEFAULTS.menuBar,
    appMenuButton: boolean(source.appMenuButton, DEFAULTS.appMenuButton),
    trayIcon: ['auto', 'light', 'dark'].includes(source.trayIcon) ? source.trayIcon : DEFAULTS.trayIcon,
    dshPath: nullableString(source.dshPath),
    nodePath: nullableString(source.nodePath),
    workingDirectory: nullableString(source.workingDirectory),
    hostTimeoutMs: number(source.hostTimeoutMs, DEFAULTS.hostTimeoutMs, 10_000, 600_000),
  }
}

function readConfigFile() {
  if (!existsSync(configPath)) return { missing: true }
  try {
    return { data: JSON.parse(readFileSync(configPath, 'utf8')) }
  } catch (error) {
    log(`config: ${configPath} is not valid JSON (${error.message}); using defaults`)
    return { invalid: true }
  }
}

/**
 * Load the config, creating it with defaults on first run. A malformed file is
 * left untouched: it is reported and defaults are used for this launch.
 */
export function loadConfig() {
  const result = readConfigFile()
  const config = normalizeConfig(result.data ?? {})
  if (result.data !== undefined && typeof result.data.version !== 'number') {
    log(`config: migrating ${configPath} to version ${DEFAULTS.version}`)
  }
  // A malformed file is left untouched so the user can fix it; only a missing
  // file is created with defaults.
  if (result.missing === true) {
    try {
      writeConfigFile(config)
      log(`config: created ${configPath}`)
    } catch (error) {
      log(`config: could not create ${configPath}: ${error.message}`)
    }
  }
  return config
}

/** Atomic-ish save: write a sibling temp file, then rename over the target. */
export function writeConfigFile(config) {
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const temp = `${configPath}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, configPath)
}

export function saveConfig(config) {
  try {
    writeConfigFile(config)
  } catch (error) {
    log(`config: could not save ${configPath}: ${error.message}`)
  }
}
