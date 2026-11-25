// Sandboxed preload for the application window. It adds one unobtrusive
// affordance — a small "⋯" button that asks the main process to open the app
// menu — because the native menu bar stays hidden for a cleaner window.
//
// The page itself gets no bridge and no privileged API: only this injected
// button talks to the main process, and only over the two channels below.
const { ipcRenderer } = require('electron')

const HOST_ID = 'dsh-desktop-app-menu'

function addButton() {
  if (document.getElementById(HOST_ID) !== null) return

  let enabled = true
  try {
    const config = ipcRenderer.sendSync('dsh-desktop:ui-config')
    enabled = config?.appMenuButton !== false
  } catch {
    // Keep the button: without it a hidden menu bar leaves no menu at all.
  }
  if (!enabled) return

  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;pointer-events:none;'

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    button {
      pointer-events: auto;
      width: 30px; height: 30px; padding: 0;
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(28, 29, 33, 0.55);
      color: #cfcfd4;
      font: 16px/1 system-ui, sans-serif;
      opacity: 0.45;
      cursor: pointer;
      backdrop-filter: blur(6px);
      transition: opacity 120ms ease, background 120ms ease;
    }
    button:hover, button:focus-visible {
      opacity: 1;
      background: rgba(40, 41, 47, 0.9);
      outline: none;
    }
  `
  const button = document.createElement('button')
  button.type = 'button'
  button.title = 'Application menu'
  button.setAttribute('aria-label', 'Application menu')
  button.textContent = '\u22EF'
  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    ipcRenderer.send('dsh-desktop:app-menu')
  })

  shadow.append(style, button)
  document.body.appendChild(host)
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', addButton)
} else {
  addButton()
}
