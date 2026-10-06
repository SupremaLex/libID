// Start the notary, Bridge and CCDP; with --app, also the ceremony app. No
// OAuth mocks and no chain.
//
// LIBID_STACK_LOGS names a file that takes every child's output, the
// containers' logs included, as it is written; without it they share ours.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { APP_ORIGIN, BRIDGE, NOTARY } from './local.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const cache = join(root, '.cache')
const project = `libid-ceremony-live-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`
const composeArgs = ['compose', '-p', project, '-f', join(root, 'compose.yaml')]

// Docker publishes on 127.0.0.1; the browser reaches Bridge as localhost.
const BRIDGE_ON_HOST = BRIDGE.replace('localhost', '127.0.0.1')
/** CCDP's static server, published beside Bridge (compose.yaml). */
const CCDP = 'http://127.0.0.1:4683'

const logs = process.env.LIBID_STACK_LOGS
/** Where children write: the LIBID_STACK_LOGS file, or our own output. */
const childOutput = logs
  ? (() => {
      const fd = openSync(logs, 'w')
      return ['ignore', fd, fd] as ['ignore', number, number]
    })()
  : 'inherit'

/** Aborted once the stack stops: waits end and running commands are terminated. */
const stopping = new AbortController()
const { signal } = stopping

/** Run a command to completion; reject on a nonzero exit or once the stack stops. */
function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: childOutput, signal })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args[0]} exited with ${code}`)),
    )
  })
}

/** Poll `check` until it holds; reject on the deadline or once the stack stops. */
async function until(what: string, check: () => Promise<boolean>, seconds = 120) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    try {
      if (await check()) return
    } catch {
      /* not up yet */
    }
    await delay(500, undefined, { signal })
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/** Whether `url` answers 200 within a second. */
async function answers(url: string, init: RequestInit = {}): Promise<boolean> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(1000) })
  await response.body?.cancel()
  return response.status === 200
}

/** Whether something on this host accepts connections on `port`. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Refuse to start over another stack: with a port this project publishes
 * already taken, the readiness check could pass against that stack and the
 * tests would run against it.
 */
async function portsFree() {
  const ports = [NOTARY, BRIDGE, CCDP].map((url) => Number(new URL(url).port))
  const open = await Promise.all(ports.map(listening))
  const taken = ports.filter((_, index) => open[index])
  if (taken.length)
    throw new Error(
      `Already in use on 127.0.0.1: port ${taken.join(', ')}. Stop the stack holding it (see docker ps).`,
    )
}

/** This checkout's stack lock: the pid of the stack.ts that owns the Compose project. */
const lock = join(cache, 'stack.pid')

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Own this checkout's Compose project, or refuse: a second stack.ts would
 * tear down the first one's containers. A lock whose process is gone is stale.
 */
function takeLock() {
  mkdirSync(cache, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
      process.on('exit', releaseLock)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const owner = Number(readFileSync(lock, 'utf8'))
    if (owner && alive(owner))
      throw new Error(`stack.ts (pid ${owner}) already runs this checkout's stack. Stop it first.`)
    rmSync(lock, { force: true })
  }
  throw new Error(`Could not take ${lock}`)
}

function releaseLock() {
  try {
    if (readFileSync(lock, 'utf8') === String(process.pid)) rmSync(lock)
  } catch {
    /* already gone */
  }
}

/** Report `error` and exit before the stack has started. */
function fail(error: unknown): never {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

// ─── Main ───────────────────────────────────────────────────────

try {
  takeLock()
} catch (error) {
  fail(error)
}
// CCDP builds while Docker clears a stack this checkout left behind, so every
// run starts fresh; a port still taken then belongs to another stack. The
// images come down before anything is timed.
const ccdp = run('pnpm', [
  '--filter',
  '@libid/ceremony',
  'build:ccdp-artifacts',
  '--out-dir',
  join(cache, 'ccdp'),
])
ccdp.catch(() => {})
try {
  await Promise.all([
    run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans']),
    run('docker', [...composeArgs, 'pull', '--quiet']),
  ])
} catch {
  fail(
    'Could not run Docker Compose or pull its images. Install Docker with Compose and start its engine.',
  )
}
try {
  await ccdp
  await portsFree()
} catch (error) {
  fail(error)
}

let frontend: ViteDevServer | undefined
/** Stop what this process started: the frontend, then its own Compose project. */
function stop(code: number) {
  if (signal.aborted) return
  stopping.abort()
  process.exitCode = code
  void frontend?.close()
  if (compose.pid) {
    try {
      process.kill(-compose.pid, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  const down = spawn('docker', [...composeArgs, 'down', '--volumes'], { stdio: childOutput })
  down.on('error', () => console.error('Could not stop the stack containers. Check Docker.'))
  down.on('close', (code) => {
    if (code !== 0) process.exitCode = 1
  })
}
process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))
const compose = spawn('docker', [...composeArgs, 'up', '--abort-on-container-failure'], {
  stdio: childOutput,
  detached: true,
})
compose.on('error', () => {
  console.error('Could not start Docker Compose. Install Docker with Compose and start its engine.')
  stop(1)
})
compose.on('exit', (code) => stop(code || 1))

try {
  await until('Bridge', () =>
    answers(`${BRIDGE_ON_HOST}/api/v1/ceremony/config`, {
      headers: { Origin: APP_ORIGIN },
      redirect: 'error',
    }),
  )
  signal.throwIfAborted()
  console.info(`Stack ready: Bridge ${BRIDGE}, notary ${NOTARY}`)
  if (process.argv.includes('--app')) {
    frontend = await createViteServer({ configFile: join(root, 'vite.config.ts') })
    if (signal.aborted) await frontend.close()
    else {
      await frontend.listen()
      frontend.printUrls()
    }
  }
} catch (error) {
  if (!signal.aborted) {
    console.error(error instanceof Error ? error.message : error)
    stop(1)
  }
}
