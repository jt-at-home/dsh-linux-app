import assert from 'node:assert/strict'

const { closeDecision } = await import('../src/close-decision.js')
const { trayHostAvailable } = await import('../src/tray-host.js')

// Quit-on-close keeps working regardless of the tray.
assert.equal(closeDecision({ closeToTray: false, hasTray: true, trayHost: true }), 'close')

// Hide only when a tray object exists and a StatusNotifier host is present.
assert.equal(closeDecision({ closeToTray: true, hasTray: true, trayHost: true }), 'hide')
assert.equal(closeDecision({ closeToTray: true, hasTray: true, trayHost: false }), 'minimize')
assert.equal(closeDecision({ closeToTray: true, hasTray: false, trayHost: false }), 'minimize')

// The tray-host probe is forceable for tests.
process.env.DSH_LINUX_APP_TRAY_HOST = '1'
assert.equal(trayHostAvailable(), true)
process.env.DSH_LINUX_APP_TRAY_HOST = '0'
assert.equal(trayHostAvailable(), false)
delete process.env.DSH_LINUX_APP_TRAY_HOST

console.log('close: PASS')
