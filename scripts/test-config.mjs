import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'dsh-linux-app-config-'))
process.env.DSH_LINUX_APP_CONFIG_DIR = dir
process.env.DSH_LINUX_APP_STATE_DIR = join(dir, 'state')

const { loadConfig, saveConfig, configPath, DEFAULTS } = await import('../src/config.js')

try {
  // First run creates the file with defaults.
  const created = loadConfig()
  assert.ok(existsSync(configPath), 'config.json should be created on first run')
  assert.equal(created.window.width, DEFAULTS.window.width)
  assert.equal(created.zoom, 1)
  assert.equal(created.closeToTray, true)
  assert.equal(created.window.x, null)
  assert.equal(created.window.maximized, false)
  assert.equal(created.menuBar, 'hidden')
  assert.equal(created.appMenuButton, true)
  assert.equal(created.trayIcon, 'auto')
  assert.equal(created.version, 2)

  // Saved zoom and bounds survive a reload.
  const saved = loadConfig()
  saveConfig({
    ...saved,
    zoom: 1.5,
    window: { x: 42, y: 43, width: 1000, height: 700, maximized: true },
  })
  const reloaded = loadConfig()
  assert.equal(reloaded.zoom, 1.5)
  assert.deepEqual(reloaded.window, { x: 42, y: 43, width: 1000, height: 700, maximized: true })

  // Invalid values fall back to defaults instead of being trusted.
  writeFileSync(configPath, JSON.stringify({
    zoom: 99,
    window: { width: 'wide', x: 'left', y: 3.5, maximized: 'yes' },
    closeToTray: 'yes',
  }))
  const normalized = loadConfig()
  assert.equal(normalized.zoom, DEFAULTS.zoom)
  assert.equal(normalized.window.width, DEFAULTS.window.width)
  assert.equal(normalized.window.x, null)
  assert.equal(normalized.window.y, null)
  assert.equal(normalized.window.maximized, false)
  assert.equal(normalized.closeToTray, DEFAULTS.closeToTray)
  assert.equal(normalized.menuBar, DEFAULTS.menuBar)

  // Malformed JSON is reported and left untouched.
  const malformed = '{ not json'
  writeFileSync(configPath, malformed)
  assert.equal(loadConfig().zoom, DEFAULTS.zoom)
  assert.equal(readFileSync(configPath, 'utf8'), malformed)

  // Unversioned files with the old default menuBar are migrated to hidden.
  writeFileSync(configPath, JSON.stringify({ menuBar: 'visible' }))
  assert.equal(loadConfig().menuBar, 'hidden')
  writeFileSync(configPath, JSON.stringify({ version: 2, menuBar: 'visible' }))
  assert.equal(loadConfig().menuBar, 'visible')

  // Unknown keys survive normalization.
  writeFileSync(configPath, JSON.stringify({ zoom: 1.1, futureSetting: true }))
  const preserved = loadConfig()
  assert.equal(preserved.zoom, 1.1)
  assert.equal(preserved.futureSetting, true)

  console.log('config: PASS')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
