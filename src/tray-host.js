import { execFileSync } from 'node:child_process'

const PING_ARGS = ['--session', '--dest', 'org.kde.StatusNotifierWatcher', '--object-path', '/StatusNotifierWatcher', '--method', 'org.freedesktop.DBus.Peer.Ping']

function run(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 1500 })
    return true
  } catch (error) {
    // Missing tool: the answer is unknown, not "no host".
    if (error.code === 'ENOENT') return undefined
    return false
  }
}

/**
 * Whether the session has a StatusNotifier host (KDE panel, GNOME AppIndicator
 * extension, and so on). Without one, an Electron Tray object exists but nothing
 * draws it, so hiding the window would strand the app.
 *
 * DSH_LINUX_APP_TRAY_HOST=1/0 forces the answer for tests.
 */
export function trayHostAvailable() {
  const override = process.env.DSH_LINUX_APP_TRAY_HOST
  if (override === '1') return true
  if (override === '0') return false

  const gdbus = run('gdbus', ['call', ...PING_ARGS])
  if (gdbus !== undefined) return gdbus

  const dbusSend = run('dbus-send', ['--session', '--print-reply', '--dest=org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.freedesktop.DBus.Peer.Ping'])
  if (dbusSend !== undefined) return dbusSend

  // No D-Bus tool available: assume a tray rather than changing close behavior.
  return true
}
