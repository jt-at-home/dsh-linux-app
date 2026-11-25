#!/usr/bin/env node
/**
 * Parent-death watchdog for the dsh host.
 *
 * Electron runs this script (with the resolved Node) and keeps its stdin pipe
 * open. If Electron exits for any reason — including SIGKILL, which runs no
 * handlers — the pipe closes, this process sees stdin end and stops the host, so
 * no orphaned `dsh` keeps listening on a port nobody owns.
 *
 * Usage: node host-supervisor.mjs <command> [args...]
 */
import { spawn } from 'node:child_process'

const [command, ...args] = process.argv.slice(2)
if (command === undefined) {
  console.error('host-supervisor: missing command')
  process.exit(64)
}

const child = spawn(command, args, {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: process.env,
})

let stopping = false
let forceTimer

function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  try {
    child.kill(signal)
  } catch {
    // Already gone.
  }
  forceTimer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }, 4000)
  forceTimer.unref()
}

// stdin is the parent's liveness signal: end means Electron is gone.
process.stdin.on('end', () => stop())
process.stdin.on('close', () => stop())
process.stdin.resume()

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => stop(signal))
}

child.on('error', error => {
  console.error(`host-supervisor: ${error.message}`)
  process.exit(69)
})

child.on('exit', (code, signal) => {
  clearTimeout(forceTimer)
  process.exit(code ?? (signal === null ? 0 : 1))
})
