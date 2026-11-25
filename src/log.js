import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * App and host logs. Append-only, capped at 1 MiB each (rotated to `<file>.1`),
 * and never allowed to break the app: write failures are swallowed.
 */
const stateDir = process.env.DSH_LINUX_APP_STATE_DIR
  ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'dsh-linux-app')

export const logPaths = {
  dir: stateDir,
  app: join(stateDir, 'app.log'),
  host: join(stateDir, 'host.log'),
}

const MAX_BYTES = 1_000_000
const trackedBytes = new Map()

try {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
} catch {
  // A read-only home must not stop the app from starting.
}

function fileSize(file) {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

function write(file, line) {
  try {
    let size = trackedBytes.get(file) ?? fileSize(file)
    if (size >= MAX_BYTES) {
      try {
        renameSync(file, `${file}.1`)
      } catch {
        // The old file may be gone or unwritable; keep appending.
      }
      size = 0
    }
    const entry = `${new Date().toISOString()} ${line}\n`
    appendFileSync(file, entry)
    trackedBytes.set(file, size + Buffer.byteLength(entry))
  } catch {
    // Logging is diagnostic only.
  }
}

export function log(...parts) {
  const line = parts.map(part => String(part)).join(' ')
  console.log(line)
  write(logPaths.app, line)
}

/** Host stdout/stderr go to their own file so a startup failure stays readable. */
export function hostLog(stream, ...parts) {
  write(logPaths.host, `[${stream}] ${parts.map(part => String(part)).join(' ')}`)
}
