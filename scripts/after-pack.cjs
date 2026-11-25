const { chmodSync, existsSync } = require('node:fs')
const { join } = require('node:path')

/**
 * The host supervisor is executed by the system Node, not by Electron, so it
 * must be readable by the desktop user. The deb preserves archive modes: a 0600
 * source file would install root-owned and fail with EACCES.
 */
module.exports = async function afterPack(context) {
  const file = join(context.appOutDir, 'resources', 'app.asar.unpacked', 'src', 'host-supervisor.mjs')
  if (existsSync(file)) chmodSync(file, 0o644)
}
