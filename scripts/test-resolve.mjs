import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'dsh-linux-app-resolve-'))
process.env.DSH_LINUX_APP_STATE_DIR = join(dir, 'state')
mkdirSync(process.env.DSH_LINUX_APP_STATE_DIR, { recursive: true })

try {
  const { resolveHostLaunch } = await import('../src/host.js')

  // A dsh with a Node beside it must use that Node, even when PATH points at an
  // older distro Node (the desktop-entry situation).
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const dsh = join(bin, 'dsh')
  writeFileSync(dsh, '#!/usr/bin/env node\nconsole.log("fake dsh")\n')
  chmodSync(dsh, 0o755)
  symlinkSync(process.execPath, join(bin, 'node'))
  process.env.PATH = '/usr/bin:/bin'

  const beside = resolveHostLaunch({ dshPath: dsh })
  assert.equal(beside.command, join(bin, 'node'))
  assert.equal(beside.node, join(bin, 'node'))

  // An explicit override still wins.
  const explicit = resolveHostLaunch({ dshPath: dsh, nodePath: process.execPath })
  assert.equal(explicit.command, process.execPath)

  // A dsh that declares a newer Node than the interpreter is a clear error,
  // not a silent exit.
  const pkg = join(dir, 'pkg')
  mkdirSync(join(pkg, 'lib'), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    engines: { node: '>=99.0.0' },
  }))
  const script = join(pkg, 'lib', 'bin.js')
  writeFileSync(script, '#!/usr/bin/env node\n')
  chmodSync(script, 0o755)
  assert.throws(
    () => resolveHostLaunch({ dshPath: script, nodePath: process.execPath }),
    /too old for this dsh/,
  )

  console.log('resolve: PASS')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
