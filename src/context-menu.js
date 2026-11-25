/**
 * Build the native context menu for one `webContents` `context-menu` event.
 *
 * Pure (no Electron imports) so it can be unit-tested: `params` is Electron's
 * ContextMenuParams, `actions` supplies the side effects. Chromium's editFlags
 * decide what is enabled, so the menu never offers an action the page cannot do.
 */
export function buildContextMenu(params = {}, actions = {}) {
  const editFlags = params.editFlags ?? {}
  const editable = params.isEditable === true
  const selection = typeof params.selectionText === 'string' ? params.selectionText.trim() : ''
  const hasSelection = selection !== ''
  const items = []

  const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
  const canUndo = flag(editFlags.canUndo, editable)
  const canRedo = flag(editFlags.canRedo, editable)
  const canCut = flag(editFlags.canCut, editable && hasSelection)
  const canCopy = flag(editFlags.canCopy, hasSelection)
  const canPaste = flag(editFlags.canPaste, editable)
  const canSelectAll = flag(editFlags.canSelectAll, true)

  if (params.mediaType === 'image') {
    items.push({ label: 'Copy Image', click: () => actions.copyImage?.() })
  }

  if (editable) {
    if (items.length > 0) items.push({ type: 'separator' })
    items.push(
      { label: 'Undo', enabled: canUndo, click: () => actions.undo?.() },
      { label: 'Redo', enabled: canRedo, click: () => actions.redo?.() },
      { type: 'separator' },
      { label: 'Cut', enabled: canCut, click: () => actions.cut?.() },
      { label: 'Copy', enabled: canCopy, click: () => actions.copy?.() },
      { label: 'Paste', enabled: canPaste, click: () => actions.paste?.() },
      { type: 'separator' },
      { label: 'Select All', enabled: canSelectAll, click: () => actions.selectAll?.() },
    )
  } else {
    if (items.length > 0) items.push({ type: 'separator' })
    items.push(
      { label: 'Copy', enabled: canCopy, click: () => actions.copy?.() },
      { label: 'Select All', enabled: canSelectAll, click: () => actions.selectAll?.() },
    )
  }

  if (typeof params.linkURL === 'string' && params.linkURL !== '') {
    items.push(
      { type: 'separator' },
      { label: 'Open Link in Browser', click: () => actions.openLink?.(params.linkURL) },
      { label: 'Copy Link Address', click: () => actions.copyLink?.(params.linkURL) },
    )
  }

  return items
}
