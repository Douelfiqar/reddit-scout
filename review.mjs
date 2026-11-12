#!/usr/bin/env node
// Review the InstaBox machine's digests on this computer:
//
//   npm run review      (or: node review.mjs)
//
//   1. wakes the machine, pulls its digests/*.json and data/replied.json into this folder
//   2. starts server.mjs here and opens http://127.0.0.1:8787 in your browser
//   3. when you stop it (Ctrl+C), sends data/replied.json back so the next scout run skips
//      every post you approved or skipped
//
// Uses InstaBox's API, the same way the daily GitHub Action does: INSTABOX_API_KEY in .env
// (or the environment). INSTABOX_MACHINE picks the machine (default: reddit).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { loadEnv, ROOT, DATA, DIGESTS, readReplied } from './commenter.mjs'

loadEnv()
const API = 'https://api.instabox.sh/mcp'
const KEY = process.env.INSTABOX_API_KEY
const MACHINE = process.env.INSTABOX_MACHINE || 'reddit'
const REMOTE_DIR = process.env.INSTABOX_DIR || 'reddit-scout' // in the machine's home folder
let remoteRoot = null // absolute: the file API takes no relative path
const REPLIED = path.join(DATA, 'replied.json')
const PORT = Number(process.env.PORT || 8787)
const log = line => console.log(`[review] ${line}`)

// ── InstaBox API (JSON-RPC tools/call; answers JSON or server-sent events) ──────────────────
let rpcId = 0
async function tool(name, args, timeoutMs = 180_000) {
  const id = ++rpcId
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`InstaBox ${name}: HTTP ${res.status} ${text.slice(0, 200)}`)
  const messages = /^\s*[{[]/.test(text) ? [JSON.parse(text)]
    : text.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => { try { return JSON.parse(l.slice(5)) } catch { return null } }).filter(Boolean)
  const msg = messages.find(m => m.id === id) ?? messages.at(-1)
  if (!msg) throw new Error(`InstaBox ${name}: empty answer`)
  if (msg.error) throw new Error(`InstaBox ${name}: ${msg.error.message ?? JSON.stringify(msg.error)}`)
  const result = msg.result ?? {}
  const body = (result.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n')
  if (result.isError) throw new Error(`InstaBox ${name}: ${body.slice(0, 300) || 'failed'}`)
  if (result.structuredContent) return result.structuredContent
  try { return JSON.parse(body) } catch { return { text: body } }
}

/** Wakes the machine (no harm if it is awake) and learns where the scout lives on it. */
async function wake() {
  await tool('resume_machine', { machine: MACHINE, wait_seconds: 120 })
  if (!remoteRoot) {
    const r = await tool('exec', { machine: MACHINE, cmd: `cd ~/${REMOTE_DIR} && pwd`, timeout_seconds: 30 })
    remoteRoot = String(r.stdout ?? '').trim()
    if (!remoteRoot.startsWith('/')) throw new Error(`no ~/${REMOTE_DIR} folder on "${MACHINE}" (${String(r.stderr ?? '').trim() || 'not found'})`)
  }
}

async function readRemote(file) {
  const r = await tool('read_file', { machine: MACHINE, path: `${remoteRoot}/${file}`, max_bytes: 1_048_576 })
  const content = r.content ?? r.text
  if (typeof content !== 'string') throw new Error(`InstaBox read_file ${file}: unexpected answer`)
  return r.encoding === 'base64' ? Buffer.from(content, 'base64').toString('utf8') : content
}

/** File names in a remote folder matching a pattern; [] when there are none. */
async function listRemote(dir, glob) {
  const r = await tool('exec', { machine: MACHINE, cmd: `cd '${remoteRoot}/${dir}' 2>/dev/null && ls -1 ${glob} 2>/dev/null || true`, timeout_seconds: 30 })
  return String(r.stdout ?? r.text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

/** Whole file or nothing: written next to the target, then renamed over it. */
function writeAtomic(file, content) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, content)
  renameSync(`${file}.tmp`, file)
}

// ── 1. Pull ──────────────────────────────────────────────────────────────────────────────────
async function pull() {
  log(`waking the InstaBox machine "${MACHINE}"...`)
  await wake()

  const names = (await listRemote('digests', '*.json')).filter(n => /^\d{4}-\d{2}-\d{2}(-dry-run)?\.json$/.test(n)).sort()
  // New days, plus the newest one again (a run with --force can rewrite it).
  const wanted = names.filter((n, i) => i === names.length - 1 || !existsSync(path.join(DIGESTS, n)))
  for (const n of wanted) writeAtomic(path.join(DIGESTS, n), await readRemote(`digests/${n}`))
  log(`${names.length} digest(s) on the machine, ${wanted.length} pulled${names.length ? ` (newest: ${names.at(-1).slice(0, -5)})` : ''}`)

  // replied.json: decisions on the machine plus any made here and never sent back.
  let remote = {}
  if ((await listRemote('data', 'replied.json')).length) {
    try { remote = JSON.parse(await readRemote('data/replied.json')) } catch (e) { throw new Error(`the machine's data/replied.json is not valid JSON (${e.message}); fix it before reviewing`) }
  }
  const merged = { ...readReplied(), ...remote }
  writeAtomic(REPLIED, JSON.stringify(merged, null, 1))
  log(`${Object.keys(merged).length} post(s) already decided`)
}

// ── 3. Push ──────────────────────────────────────────────────────────────────────────────────
async function push() {
  if (!existsSync(REPLIED)) { log('no data/replied.json here: nothing to send'); return }
  const content = readFileSync(REPLIED, 'utf8')
  JSON.parse(content) // never send a broken file
  log('sending data/replied.json to the machine...')
  await wake() // it may have fallen asleep while you were reviewing
  await tool('write_file', { machine: MACHINE, path: `${remoteRoot}/data/replied.json`, content, parents: true })
  log(`sent: ${Object.keys(JSON.parse(content)).length} decided post(s) on "${MACHINE}"; the next scout run skips them`)
}

// ── 2. Serve ─────────────────────────────────────────────────────────────────────────────────
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => log(`open ${url} in your browser`)).unref()
}

function serve() {
  return new Promise(resolve => {
    // Local review only: never on the network, whatever HOST says in .env.
    const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] })
    let opened = false
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk)
      if (!opened && String(chunk).includes('Review server on')) {
        opened = true
        const url = `http://127.0.0.1:${PORT}`
        if (!process.argv.includes('--no-open')) openBrowser(url)
        log(`review at ${url}. Press Ctrl+C here when you are done: your decisions are then sent back.`)
      }
    })
    // Ctrl+C reaches the server too (same console); stay alive to send the file once it stops.
    const onSignal = () => { if (child.exitCode === null) child.kill('SIGINT') }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
    child.on('exit', code => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      log(`server stopped${code ? ` (exit ${code})` : ''}`)
      resolve()
    })
  })
}

async function main() {
  if (!KEY) throw new Error('INSTABOX_API_KEY is missing in .env (InstaBox dashboard → API keys; the same key as the GitHub secret works)')
  await pull()
  await serve()
  try {
    await push()
  } catch (error) {
    log(`could not send data/replied.json: ${error.message}`)
    log('your decisions are safe here; run "npm run review:push" to send them later')
    process.exitCode = 1
  }
}

if (process.argv.includes('--push')) {
  if (!KEY) { console.error('INSTABOX_API_KEY is missing in .env'); process.exit(1) }
  push().catch(e => { log(`failed: ${e.message}`); process.exitCode = 1 })
} else {
  main().catch(e => { log(`failed: ${e.message}`); process.exitCode = 1 })
}
