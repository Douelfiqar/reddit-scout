// Replies: the store of posts already answered (data/replied.json) and the review actions the
// digest server calls. Nothing here talks to Reddit: you post each reply yourself, from your own
// logged-in browser, after approving it. The scout reads the same store so an answered thread
// never comes back.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const DATA = path.join(ROOT, 'data')
export const DIGESTS = path.join(ROOT, 'digests')
const REPLIED_FILE = path.join(DATA, 'replied.json')
const POST_ID = /^[a-z0-9]{4,12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}(-dry-run)?$/

/** .env loader shared by the scout and the server: KEY=value lines, real environment variables win. */
export function loadEnv() {
  const file = path.join(ROOT, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || line.trimStart().startsWith('#')) continue
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

/** { postId: { status: 'approved' | 'skipped', at, day, subreddit, title, url, text? } } */
export function readReplied() {
  try { return JSON.parse(readFileSync(REPLIED_FILE, 'utf8')) } catch { return {} }
}

function writeReplied(all) {
  mkdirSync(DATA, { recursive: true })
  const tmp = `${REPLIED_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(all, null, 1))
  renameSync(tmp, REPLIED_FILE) // whole file or nothing, even if the process dies mid-write
}

/** Days with a review file (digests/<day>.json), newest first. */
export function listDays() {
  if (!existsSync(DIGESTS)) return []
  return readdirSync(DIGESTS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
    .filter(d => DAY.test(d)).sort().reverse()
}

export function readDay(day) {
  if (!DAY.test(day ?? '')) return null
  try { return JSON.parse(readFileSync(path.join(DIGESTS, `${day}.json`), 'utf8')) } catch { return null }
}

/**
 * One review decision from the page. `approve` records the post as answered and hands back the
 * thread's address so the page can open it for you to paste and submit; `skip` hides it for good.
 * Returns { status, body } for the HTTP reply.
 */
export function decide({ day, id, action, text }) {
  if (!['approve', 'skip'].includes(action)) return { status: 400, body: { error: 'action must be approve or skip' } }
  if (!POST_ID.test(id ?? '')) return { status: 400, body: { error: 'bad post id' } }
  const digest = readDay(day)
  const item = digest?.items?.find(it => it.id === id)
  if (!item) return { status: 404, body: { error: `post ${id} is not in the ${day} digest` } }
  const all = readReplied()
  const done = all[id]
  if (done) return { status: 409, body: { error: `already ${done.status} on ${done.at.slice(0, 10)}`, entry: done } }
  const reply = typeof text === 'string' ? text.replace(/\r/g, '').trim() : ''
  if (action === 'approve' && reply.length < 2) return { status: 400, body: { error: 'the reply is empty' } }
  if (reply.length > 10_000) return { status: 400, body: { error: 'Reddit comments stop at 10,000 characters' } }

  const entry = {
    status: action === 'approve' ? 'approved' : 'skipped',
    at: new Date().toISOString(),
    day, subreddit: item.subreddit, title: item.title, url: item.url,
    ...(action === 'approve' ? { text: reply } : {}),
  }
  all[id] = entry
  writeReplied(all)
  return { status: 200, body: { ok: true, entry } }
}

/** Undo a decision made by mistake (the page's Undo link). */
export function undo({ id }) {
  const all = readReplied()
  if (!all[id]) return { status: 404, body: { error: 'nothing to undo' } }
  delete all[id]
  writeReplied(all)
  return { status: 200, body: { ok: true } }
}
