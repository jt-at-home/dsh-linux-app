import { execFileSync, spawn } from 'node:child_process'
import { accessSync, constants, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostLog, log } from './log.js'

const STARTUP_LINE = /dsh web:\s+(https?:\/\/\S+)/
const TOKEN_FALLBACK = /(https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/?\?token=[A-Za-z0-9_-]+)/
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function isExecutable(path) {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** nvm installs, newest first; GUI launches often have none of these on PATH. */
function nvmBinDirs() {
  const root = join(homedir(), '.nvm', 'versions', 'node')
  try {
    return readdirSync(root)
      .sort()
      .reverse()
      .map(version => join(root, version, 'bin'))
  } catch {
    return []
  }
}

function searchDirs() {
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  return [
    ...pathDirs,
    ...nvmBinDirs(),
    join(homedir(), '.local', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
}

function findExecutable(name) {
  for (const dir of searchDirs()) {
    const candidate = join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

/** True when the file is a JS launcher we can hand to `node` explicitly. */
function isNodeScript(path) {
  try {
    const head = readFileSync(path, { encoding: 'utf8', flag: 'r' }).slice(0, 200)
    return head.startsWith('#!') && /\bnode\b/.test(head.split('\n', 1)[0])
  } catch {
    return false
  }
}

/**
 * The Node that ships beside this dsh (an nvm install puts `dsh` and `node` in
 * the same bin directory). Preferring it keeps `dsh` and its interpreter on the
 * same version instead of pairing a distro Node with an nvm-installed dsh.
 */
function nodeBeside(dshPath) {
  const candidate = join(dirname(dshPath), 'node')
  return isExecutable(candidate) ? candidate : undefined
}

/** Minimum Node major declared by the dsh package, when it declares one. */
function requiredNodeMajor(scriptPath) {
  let dir = dirname(scriptPath)
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (manifest.name === '@deepseek-ai/dsh' && typeof manifest.engines?.node === 'string') {
        const match = /\d+/.exec(manifest.engines.node)
        return match === null ? undefined : Number(match[0])
      }
    } catch {
      // Not a package directory; keep walking up.
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

function nodeMajor(nodePath) {
  try {
    const output = execFileSync(nodePath, ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim()
    return Number.parseInt(output, 10)
  } catch {
    return undefined
  }
}

/**
 * Decide how to launch the harness. `node` is resolved explicitly because a GUI
 * launch does not read shell startup files, so the `#!/usr/bin/env node` in the
 * dsh launcher may otherwise fail to find an interpreter.
 */
export function resolveHostLaunch({ dshPath, nodePath } = {}) {
  const dsh = dshPath ?? findExecutable('dsh')
  if (dsh === undefined) {
    throw new Error('dsh not found: install it (npm i -g @deepseek-ai/dsh) or set DSH_LINUX_APP_DSH')
  }
  // Prefer the interpreter beside dsh: a desktop launch has a distro `node`
  // (often 18) on PATH and no nvm bin, so resolving `node` independently pairs
  // an incompatible interpreter with the nvm-installed dsh, which then exits
  // silently.
  const node = nodePath ?? nodeBeside(dsh) ?? findExecutable('node')
  if (node !== undefined && isNodeScript(dsh)) {
    const script = realpathSync(dsh)
    const required = requiredNodeMajor(script)
    const actual = required === undefined ? undefined : nodeMajor(node)
    if (required !== undefined && actual !== undefined && actual < required) {
      throw new Error(
        `Node ${actual} at ${node} is too old for this dsh (needs Node >= ${required}); ` +
        'set DSH_LINUX_APP_NODE or nodePath in the config to a matching Node',
      )
    }
    return {
      command: node,
      args: [script],
      description: `${node} ${script}`,
      node,
      dsh,
    }
  }
  if (node === undefined && isNodeScript(dsh)) {
    // Last resort: the shebang may still resolve node on this system.
    return { command: dsh, args: [], description: dsh, node, dsh }
  }
  return { command: dsh, args: [], description: dsh, node, dsh }
}

function loopbackUrl(candidate) {
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return LOOPBACK_HOSTS.has(url.hostname) ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * The `dsh web` host this app owns: spawn, wait for its tokenized URL, and stop
 * it on quit. One instance per application process.
 */
export class Host {
  #child
  #stopPromise
  #url

  constructor({ cwd = homedir(), profile = 'web', port = 0, timeoutMs = 120_000, dshPath, nodePath, supervisorPath, onExit } = {}) {
    this.cwd = cwd
    this.profile = profile
    this.port = port
    this.timeoutMs = timeoutMs
    this.dshPath = dshPath
    this.nodePath = nodePath
    this.supervisorPath = supervisorPath
    this.onExit = onExit
    this.#url = undefined
    this.stopping = false
  }

  get url() {
    return this.#url
  }

  get pid() {
    return this.#child?.pid
  }

  get running() {
    return this.#child !== undefined && this.#child.exitCode === null && this.#child.signalCode === null
  }

  async start() {
    const launch = resolveHostLaunch({ dshPath: this.dshPath, nodePath: this.nodePath })
    const hostArgs = [...launch.args, '--profile', this.profile, '--port', String(this.port), '--no-open']
    // Run the host under a small supervisor: its stdin pipe closes when this
    // process dies, which lets it stop the host even after SIGKILL of Electron.
    // Packaged builds unpack this file: an external Node cannot read app.asar.
    const supervisorPath = this.supervisorPath ?? fileURLToPath(new URL('./host-supervisor.mjs', import.meta.url))
    const supervised = launch.node !== undefined
    const command = supervised ? launch.node : launch.command
    const args = supervised ? [supervisorPath, launch.command, ...hostArgs] : hostArgs
    const env = { ...process.env }
    // Make the child's own tooling robust to a GUI-launched PATH.
    const pathEntries = [dirname(launch.command), dirname(launch.dsh), env.PATH ?? ''].filter(Boolean)
    env.PATH = pathEntries.join(delimiter)
    log(`host: launching ${launch.description} --profile ${this.profile} --port ${this.port} --no-open` +
      `${supervised ? ' (supervised)' : ''}`)

    const child = spawn(command, args, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // The supervisor exits after the host does; a write to its closed stdin is
    // expected and must not crash the app.
    child.stdin.on('error', () => {})
    this.#child = child

    // Last-resort cleanup for a normal process exit (Electron can exit without
    // running the app's quit path, for example on a signal).
    const killOnExit = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }
    process.once('exit', killOnExit)
    child.once('exit', () => process.off('exit', killOnExit))

    const url = await new Promise((resolve, reject) => {
      let settled = false
      let stdoutBuffer = ''
      let stderrTail = []

      const finish = (value, error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // The stdout/stderr listeners deliberately stay attached: the host keeps
        // logging for its whole life, and an unread pipe would eventually block
        // it once the 64 KiB buffer fills.
        child.off('exit', onEarlyExit)
        child.off('error', onError)
        if (error) reject(error)
        else resolve(value)
      }

      const timer = setTimeout(() => {
        finish(undefined, new Error(`dsh did not report a URL within ${this.timeoutMs / 1000}s; last stderr: ${stderrTail.slice(-5).join(' | ')}`))
      }, this.timeoutMs)

      const onStdout = (chunk) => {
        stdoutBuffer += chunk.toString()
        let newline
        while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
          const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '')
          stdoutBuffer = stdoutBuffer.slice(newline + 1)
          if (line === '') continue
          hostLog('out', line)
          if (settled) continue
          const startup = STARTUP_LINE.exec(line)
          const fallback = startup ? undefined : TOKEN_FALLBACK.exec(line)
          const url = startup ? loopbackUrl(startup[1]) : fallback ? loopbackUrl(fallback[1]) : undefined
          if (url !== undefined) finish(url.toString())
        }
      }

      const onStderr = (chunk) => {
        for (const line of chunk.toString().split('\n')) {
          if (line === '') continue
          hostLog('err', line)
          if (!settled) stderrTail = [...stderrTail.slice(-19), line]
        }
      }

      const onEarlyExit = (code, signal) => {
        const stderr = stderrTail.length === 0 ? 'no output on stderr' : `last stderr: ${stderrTail.slice(-5).join(' | ')}`
        finish(undefined, new Error(
          `dsh exited before reporting a URL (code ${code}, signal ${signal}); ran: ${command} ${args.join(' ')}; ${stderr}`,
        ))
      }

      const onError = (error) => finish(undefined, new Error(`could not start ${launch.command}: ${error.message}`))

      child.stdout.on('data', onStdout)
      child.stderr.on('data', onStderr)
      child.on('exit', onEarlyExit)
      child.on('error', onError)
    })

    this.#url = url
    child.once('exit', (code, signal) => {
      this.#url = undefined
      if (this.stopping) {
        hostLog('app', `host stopped (code ${code}, signal ${signal})`)
        return
      }
      hostLog('app', `host exited unexpectedly (code ${code}, signal ${signal})`)
      this.onExit?.({ code, signal })
    })
    return url
  }

  async stop() {
    if (this.#stopPromise !== undefined) return this.#stopPromise
    const child = this.#child
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
    this.stopping = true
    this.#stopPromise = new Promise(resolve => {
      const force = setTimeout(() => {
        hostLog('app', 'host did not stop within 5s; sending SIGKILL')
        try {
          child.kill('SIGKILL')
        } catch {
          // Already gone.
        }
      }, 5000)
      child.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
      try {
        child.kill('SIGTERM')
      } catch {
        clearTimeout(force)
        resolve()
      }
    })
    return this.#stopPromise
  }
}
