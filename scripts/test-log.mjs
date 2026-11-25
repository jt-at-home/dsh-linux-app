import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'dsh-linux-app-log-'))
const state = join(dir, 'state')
mkdirSync(state)

try {
  process.env.DSH_LINUX_APP_STATE_DIR = state
  const { log, logPaths } = await import('../src/log.js')

  // A log at the cap is rotated before the next line is appended.
  writeFileSync(logPaths.app, 'x'.repeat(1_000_001))
  log('rotation check')

  assert.ok(existsSync(`${logPaths.app}.1`), 'app.log.1 should exist after rotation')
  assert.equal(statSync(`${logPaths.app}.1`).size, 1_000_001)
  const size = statSync(logPaths.app).size
  assert.ok(size > 0 && size < 1000, `new app.log should be small, got ${size}`)

  console.log('log: PASS')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
