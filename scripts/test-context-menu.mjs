import assert from 'node:assert/strict'

const { buildContextMenu } = await import('../src/context-menu.js')

function actions() {
  const calls = []
  const record = name => (...args) => calls.push([name, ...args])
  return {
    calls,
    undo: record('undo'),
    redo: record('redo'),
    cut: record('cut'),
    copy: record('copy'),
    paste: record('paste'),
    selectAll: record('selectAll'),
    copyImage: record('copyImage'),
    openLink: record('openLink'),
    copyLink: record('copyLink'),
  }
}

const labels = template => template.filter(item => item.label !== undefined).map(item => item.label)
const item = (template, label) => template.find(entry => entry.label === label)

// Editable field: full editing menu, disabled flags follow Chromium.
{
  const a = actions()
  const template = buildContextMenu({
    isEditable: true,
    selectionText: '',
    linkURL: '',
    mediaType: 'none',
    editFlags: { canUndo: true, canRedo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
  }, a)
  assert.deepEqual(labels(template), ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select All'])
  assert.equal(item(template, 'Undo').enabled, true)
  assert.equal(item(template, 'Redo').enabled, false)
  assert.equal(item(template, 'Cut').enabled, false)
  assert.equal(item(template, 'Copy').enabled, false)
  assert.equal(item(template, 'Paste').enabled, true)
  item(template, 'Paste').click()
  assert.deepEqual(a.calls, [['paste']])
}

// Selected text in a read-only area: copy is offered and works.
{
  const a = actions()
  const template = buildContextMenu({
    isEditable: false,
    selectionText: 'hello world',
    editFlags: { canCopy: true, canSelectAll: true },
  }, a)
  assert.deepEqual(labels(template), ['Copy', 'Select All'])
  assert.equal(item(template, 'Copy').enabled, true)
  item(template, 'Copy').click()
  assert.deepEqual(a.calls, [['copy']])
}

// No selection in a read-only area: menu still exists, Copy disabled.
{
  const template = buildContextMenu({ isEditable: false, selectionText: '   ' }, actions())
  assert.deepEqual(labels(template), ['Copy', 'Select All'])
  assert.equal(item(template, 'Copy').enabled, false)
}

// Links add open/copy entries with the URL.
{
  const a = actions()
  const template = buildContextMenu({
    isEditable: false,
    selectionText: '',
    linkURL: 'https://example.com/x',
  }, a)
  assert.ok(labels(template).includes('Open Link in Browser'))
  assert.ok(labels(template).includes('Copy Link Address'))
  item(template, 'Open Link in Browser').click()
  item(template, 'Copy Link Address').click()
  assert.deepEqual(a.calls, [['openLink', 'https://example.com/x'], ['copyLink', 'https://example.com/x']])
}

// Images get a Copy Image entry first.
{
  const a = actions()
  const template = buildContextMenu({ isEditable: false, selectionText: '', mediaType: 'image' }, a)
  assert.equal(labels(template)[0], 'Copy Image')
  item(template, 'Copy Image').click()
  assert.deepEqual(a.calls, [['copyImage']])
}

console.log('context-menu: PASS')
