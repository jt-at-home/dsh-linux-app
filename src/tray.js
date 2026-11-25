import { Menu, Tray, nativeImage, nativeTheme } from 'electron'
import { log } from './log.js'

/**
 * Status-notifier tray with a theme-aware icon: a white mark for dark panels and
 * a near-black one for light panels. Linux desktops without a tray host throw or
 * silently never show the item; the app must keep working, with a second launch
 * as the way back to the window.
 */
export function createTray({ iconPaths, mode = 'auto', onOpen, onHide, onRestart, onQuit }) {
  const iconFor = () => {
    if (mode === 'light') return iconPaths.light
    if (mode === 'dark') return iconPaths.dark
    return nativeTheme.shouldUseDarkColors ? iconPaths.light : iconPaths.dark
  }

  try {
    const image = nativeImage.createFromPath(iconFor())
    if (image.isEmpty()) throw new Error(`empty image at ${iconFor()}`)
    const tray = new Tray(image)
    tray.setToolTip('DeepSeek Harness')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open DeepSeek Harness', click: onOpen },
      { label: 'Hide Window', click: onHide },
      { label: 'Restart Host', click: onRestart },
      { type: 'separator' },
      { label: 'Quit DeepSeek Harness', click: onQuit },
    ]))
    tray.on('click', onOpen)

    const followTheme = () => {
      try {
        if (!tray.isDestroyed()) tray.setImage(nativeImage.createFromPath(iconFor()))
      } catch (error) {
        log(`tray: could not update icon: ${error.message}`)
      }
    }
    nativeTheme.on('updated', followTheme)
    log(`tray: created from ${iconFor()} (mode ${mode})`)

    return {
      tray,
      dispose() {
        nativeTheme.off('updated', followTheme)
        tray.destroy()
      },
    }
  } catch (error) {
    log(`tray: unavailable (${error.message}); a second launch still restores the window`)
    return null
  }
}
