import { Menu } from 'electron'

/**
 * Application menu. It stays hidden for a cleaner window (see config.menuBar),
 * but it is still installed so its accelerators keep working, and the same
 * actions back the popup menu opened by the in-window "⋯" button.
 */
export function installMenu(actions) {
  const zoomIn = [
    { label: 'Zoom In', accelerator: 'CommandOrControl+Plus', click: actions.zoomIn },
    // 'Ctrl+=' is what many keyboards actually send for zoom in.
    { label: 'Zoom In', accelerator: 'CommandOrControl+=', visible: false, acceleratorWorksWhenHidden: true, click: actions.zoomIn },
  ]
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Close Window', accelerator: 'CommandOrControl+W', click: actions.hide },
        { label: 'Restart Host', accelerator: 'CommandOrControl+Shift+R', click: actions.restartHost },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CommandOrControl+Q', click: actions.quit },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CommandOrControl+R', click: actions.reload },
        { label: 'Toggle Developer Tools', accelerator: 'F12', click: actions.toggleDevTools },
        { type: 'separator' },
        ...zoomIn,
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: actions.zoomOut },
        { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: actions.zoomReset },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About DeepSeek Harness', click: actions.about },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Flat menu opened by the in-window button, at the pointer. */
export function createAppMenu(actions) {
  return Menu.buildFromTemplate([
    { label: 'Restart Host', click: actions.restartHost },
    { type: 'separator' },
    { label: 'Reload', click: actions.reload },
    { label: 'Toggle Developer Tools', click: actions.toggleDevTools },
    { type: 'separator' },
    { label: 'Zoom In', click: actions.zoomIn },
    { label: 'Zoom Out', click: actions.zoomOut },
    { label: 'Actual Size', click: actions.zoomReset },
    { type: 'separator' },
    { label: 'About DeepSeek Harness', click: actions.about },
    { type: 'separator' },
    { label: 'Quit', click: actions.quit },
  ])
}
