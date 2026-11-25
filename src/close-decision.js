/**
 * What closing the window should do.
 *
 * `close` quits the app, `hide` keeps it in the tray, and `minimize` is the
 * safe fallback when no tray host exists: the window stays in the dock/overview
 * and can always be restored.
 */
export function closeDecision({ closeToTray, hasTray, trayHost }) {
  if (!closeToTray) return 'close'
  if (hasTray && trayHost) return 'hide'
  return 'minimize'
}
