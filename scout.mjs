#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SUBREDDITS, TOPICS, EXCLUDE, NON_US_MARKET, QUESTION, LIMITS, SCANNER_LINE, USER_AGENT, PRICES,
} from './config.mjs'
import { loadEnv, readReplied, decide } from './commenter.mjs'
import { postComment } from './poster.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(ROOT, 'data')
const DIGESTS = path.join(ROOT, 'digests')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const noAi = args.has('--no-ai')
const autopilot = args.has('--autopilot')
const force = args.has('--force')
const log = line => console.log(`[${new Date().toISOString()}] ${line}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}
function contentToText(escaped) {
  const html = decodeEntities(escaped).replace(/<!--[\s\S]*?-->/g, '')
  return decodeEntities(html
    .replace(/<\/(p|li|h\d|blockquote|pre)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '- ').replace(/<[^>]+>/g, ''))
    .replace(/​/g, '')
    .replace(/\s*submitted by\s+\/u\/\S+[\s\S]*$/i, '')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
}
const tag = (entry, name) => entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? null

function parsePostsFeed(xml) {
  const posts = []
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = (tag(entry, 'id') ?? '').replace(/^t3_/, '').trim()
    const url = decodeEntities(entry.match(/<link href="([^"]+)"/)?.[1] ?? '')
    const subreddit = entry.match(/<category term="([^"]+)"/)?.[1] ?? ''
    const publishedAt = new Date((tag(entry, 'published') ?? tag(entry, 'updated') ?? '').trim())
    if (!/^[a-z0-9]{4,12}$/i.test(id) || !url.startsWith('https://www.reddit.com/') || Number.isNaN(publishedAt.getTime())) continue
    posts.push({ id, subreddit, url, publishedAt, title: decodeEntities(tag(entry, 'title') ?? '').trim(), body: contentToText(tag(entry, 'content') ?? '') })
  }
  return posts
}
function parseCommentsFeed(xml) {
  return xml.split('<entry>').slice(1).filter(e => !/<id>t3_/.test(e))
    .map(e => ({ body: contentToText(tag(e, 'content') ?? '') })).filter(c => c.body)
}

function createReader() {
  let requests = 0
  let nextAllowedAt = 0
  async function get(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (requests >= LIMITS.maxRequests) { log(`request cap reached; skipped ${url}`); return null }
      const wait = nextAllowedAt - Date.now()
      if (wait > 0) await sleep(wait)
      requests++
      let res
      try {
        res = await fetch(url, { method: 'GET', headers: { 'User-Agent': USER_AGENT, Accept: 'application/atom+xml' }, signal: AbortSignal.timeout(30_000) })
      } catch (error) {
        nextAllowedAt = Date.now() + LIMITS.requestGapMs
        log(`fetch failed ${url}: ${error.message}`)
        continue
      }
      const remaining = Number(res.headers.get('x-ratelimit-remaining'))
      const resetS = Number(res.headers.get('x-ratelimit-reset'))
      const retryAfterS = Number(res.headers.get('retry-after'))
      const headerWait = res.headers.has('x-ratelimit-remaining') && remaining < 1 && Number.isFinite(resetS) ? (resetS + 2) * 1000 : 0
      nextAllowedAt = Date.now() + Math.max(LIMITS.requestGapMs, headerWait)
      if (res.status === 429) {
        nextAllowedAt = Date.now() + Math.max(LIMITS.requestGapMs, Number.isFinite(retryAfterS) ? retryAfterS * 1000 : 0, headerWait)
        log(`429 from Reddit; waiting ${Math.round((nextAllowedAt - Date.now()) / 1000)} s`)
        continue
      }
      if (!res.ok) { log(`HTTP ${res.status} ${url}`); return null }
      return await res.text()
    }
    return null
  }
  return {
    get requests() { return requests },
    async newPosts(sub) {
      const xml = await get(`https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss?limit=${LIMITS.perSubredditLimit}`)
      return xml ? parsePostsFeed(xml) : []
    },
    async comments(post) {
      const xml = await get(`https://www.reddit.com/r/${encodeURIComponent(post.subreddit)}/comments/${post.id}/.rss?limit=25`)
      return xml ? parseCommentsFeed(xml) : null
    },
  }
}

function rankPost(post, now) {
  const ageHours = (now - post.publishedAt) / 3_600_000
  if (ageHours < 0 || ageHours > LIMITS.maxAgeHours) return null
  const text = `${post.title}\n${post.body}`
  if (EXCLUDE.test(text) || post.body.length < LIMITS.minBodyChars || !QUESTION.test(text)) return null
  const topics = TOPICS.filter(t => t.pattern.test(text))
  if (topics.length === 0) return null
  const nonUs = NON_US_MARKET.test(text)
  let score = topics.reduce((s, t) => s + t.weight, 0)
  if (post.title.includes('?')) score += 1
  if (ageHours < 8) score += 1
  if (post.body.length > 3000) score -= 1
  if (nonUs) score -= 3
  return { ...post, score, topics: topics.map(t => t.label), ageHours, nonUs }
}

function pickFinalists(posts, seen, now) {
  const out = []
  const ids = new Set()
  const titles = new Set()
  const ranked = posts.map(p => rankPost(p, now)).filter(p => p && !seen[p.id])
    .sort((a, b) => b.score - a.score || a.ageHours - b.ageHours)
  for (const p of ranked) {
    const titleKey = p.title.toLowerCase().replace(/\W+/g, ' ').trim()
    if (ids.has(p.id) || titles.has(titleKey)) continue
    ids.add(p.id); titles.add(titleKey); out.push(p)
    if (out.length >= LIMITS.finalists) break
  }
  return out
}

const SYSTEM = `You help a job seeker who answers Reddit questions from their own account. For each post, decide whether it is worth answering and, if it is, draft the reply they will post by hand.

Keep a post (keep=true) when it asks something about the job search (getting interviews, resumes, ATS, tailoring to a job, cover letters, rejections, follow-ups, gaps, career moves) and a short, practical answer would help, unless the comments shown already give that answer. Most posts given to you passed a filter: expect to keep most of them. Skip only rants with no question, requests for a referral or a job, posts outside the job search, and posts already answered well.

The reply:
- Answers this person's actual question first, using the details they gave (their field, years, what they tried). Any field, not only tech.
- 50 to 120 words, plain English, the way a helpful person types on Reddit: short sentences, no headings, no bold, no em dashes, at most 4 short bullet lines.
- Concrete steps they can do today. No marketing tone, no "Great question", no sign-off.
- Never invent numbers or studies (no "75% of resumes are rejected by ATS": most ATS do not auto-reject on a score; recruiters search and filter). Say "often" or "in my experience", not a statistic.
- Never mention any product, site, tool or link. Never say you are an AI.

why: one short sentence on why this post is worth the owner's time.
scannerFits: true only when the person is applying to specific postings and is unsure whether their resume matches them (ATS, keywords, tailoring, no callbacks). False for career choice, interviews, cover-letter wording, offers, workplace issues.

Answer as JSON matching the schema, one item per post id given.`

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['id', 'keep', 'why', 'draft', 'scannerFits'],
    properties: { id: { type: 'string' }, keep: { type: 'boolean' }, why: { type: 'string' }, draft: { type: 'string' }, scannerFits: { type: 'boolean' } },
  } } },
}

const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n).trimEnd()}…`)

function buildUserPrompt(finalists) {
  return finalists.map(p => {
    const c = p.comments
    const comments = c === null ? 'Comments: unknown' : c.length === 0 ? 'Comments: none yet'
      : `Comments (${c.length}):\n${c.slice(0, 2).map(x => `  - ${clip(x.body.replace(/\s+/g, ' '), LIMITS.commentCharsForAi)}`).join('\n')}`
    return `### id: ${p.id}\nSubreddit: r/${p.subreddit}\nTitle: ${p.title}\nPost:\n${clip(p.body, LIMITS.bodyCharsForAi)}\n${comments}`
  }).join('\n\n')
}

function cleanDraft(draft) {
  return draft.replace(/\r/g, '').split('\n')
    .map(line => line.split(/(?<=[.!?])\s+/).filter(s => !/https?:\/\/|www\.|\bfuturole\b|\.com\b/i.test(s)).join(' ').replace(/\*\*/g, '').replace(/(?<!\d)\s*[—–]\s*(?!\d)/g, ', '))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1400)
}

function costUsd(model, inputTokens, outputTokens) {
  const p = PRICES[model]
  return p ? (inputTokens * p.input + outputTokens * p.output) / 1e6 : null
}

function assembleDigest(finalists, parsed) {
  if (!Array.isArray(parsed?.items)) return []
  const byId = new Map(finalists.map(p => [p.id, p]))
  const used = new Set()
  const kept = []
  for (const item of parsed.items) {
    const post = typeof item?.id === 'string' ? byId.get(item.id.trim()) : undefined
    if (!post || used.has(post.id) || item.keep !== true) continue
    const draft = cleanDraft(typeof item.draft === 'string' ? item.draft : '')
    if (draft.length < 80) continue
    used.add(post.id)
    kept.push({ post, why: clip(String(item.why ?? '').trim(), 240), draft, scannerFits: item.scannerFits === true })
  }
  kept.sort((a, b) => finalists.indexOf(a.post) - finalists.indexOf(b.post))
  const top = kept.slice(0, LIMITS.digestSize)
  let scannerLeft = Math.floor(top.length / 3)
  return top.map(k => {
    const mentionsScanner = k.scannerFits && scannerLeft > 0
    if (mentionsScanner) scannerLeft--
    return { ...k, draft: mentionsScanner ? `${k.draft}\n\n${SCANNER_LINE}` : k.draft, mentionsScanner }
  })
}

async function draftReplies(finalists, budgetLeftUsd) {
  const model = process.env.MODEL || 'gpt-5.6-luna'
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing in .env')
  if (!PRICES[model]) throw new Error(`no price for ${model} in config.mjs PRICES: add it so the daily cap can hold`)
  let list = finalists
  const worst = l => costUsd(model, Math.ceil((SYSTEM.length + buildUserPrompt(l).length) / 3.5), LIMITS.maxOutputTokens)
  while (list.length > 0 && worst(list) > budgetLeftUsd) list = list.slice(0, -1)
  if (list.length === 0) { log(`budget left $${budgetLeftUsd.toFixed(4)} is too small for one call; no AI call`); return { items: [], cost: 0, model } }

  const reasoning = /^(gpt-5|o\d)/.test(model)
  const body = {
    model,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUserPrompt(list) }],
    response_format: { type: 'json_schema', json_schema: { name: 'reddit_scout', strict: true, schema: SCHEMA } },
    ...(reasoning ? { max_completion_tokens: LIMITS.maxOutputTokens, reasoning_effort: 'low' } : { max_tokens: LIMITS.maxOutputTokens, temperature: 0.6 }),
  }
  const res = await fetch(`${(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${json?.error?.message ?? 'no detail'}`)
  const usage = json.usage ?? {}
  const cost = costUsd(model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
  let parsed = null
  try { parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '') } catch { }
  return { items: assembleDigest(list, parsed), cost, model, usage }
}

const SEEN_FILE = path.join(DATA, 'seen.json')
const COST_FILE = path.join(DATA, 'costs.csv')
function readSeen(now) {
  try {
    const all = JSON.parse(readFileSync(SEEN_FILE, 'utf8'))
    const cutoff = now - LIMITS.seenTtlDays * 86_400_000
    return Object.fromEntries(Object.entries(all).filter(([, day]) => new Date(day).getTime() >= cutoff))
  } catch { return {} }
}
function spentToday(day) {
  if (!existsSync(COST_FILE)) return 0
  return readFileSync(COST_FILE, 'utf8').split(/\r?\n/).filter(l => l.startsWith(day))
    .reduce((s, l) => s + (Number(l.split(',')[4]) || 0), 0)
}
function recordCost(day, model, usage, cost, items) {
  if (!existsSync(COST_FILE)) writeFileSync(COST_FILE, 'date,time,model,input_tokens+output_tokens,cost_usd,items\n')
  appendFileSync(COST_FILE, `${day},${new Date().toISOString().slice(11, 19)},${model},${(usage?.prompt_tokens ?? 0)}+${(usage?.completion_tokens ?? 0)},${(cost ?? 0).toFixed(6)},${items}\n`)
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function buildDigest(items, { day, scanned, cost }) {
  const subject = `Reddit scout: ${items.length} ${items.length === 1 ? 'post' : 'posts'} to answer (${day})`
  const age = h => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : `${Math.round(h)} h ago`)
  const replies = c => (c === null ? 'replies unknown' : c.length === 0 ? 'no replies yet' : `${c.length}${c.length >= 25 ? '+' : ''} ${c.length === 1 ? 'reply' : 'replies'}`)
  const cards = items.map((it, i) => `
<div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin:0 0 14px">
  <div style="font-size:12px;color:#64748b;margin-bottom:4px">${i + 1}. r/${esc(it.post.subreddit)} · ${age(it.post.ageHours)} · ${replies(it.post.comments)}${it.mentionsScanner ? ' · <b style="color:#0f766e">links the scanner</b>' : ''}</div>
  <a href="${esc(it.post.url)}" style="font-size:16px;font-weight:600;color:#0f172a;text-decoration:none;line-height:1.35">${esc(it.post.title)}</a>
  <div style="font-size:13px;color:#475569;margin:6px 0 10px"><i>Why:</i> ${esc(it.why)}</div>
  <div style="font-size:14px;line-height:1.5;color:#0f172a;background:#f8fafc;border-radius:8px;padding:10px 12px;white-space:pre-wrap">${esc(it.draft)}</div>
  <div style="margin-top:10px"><a href="${esc(it.post.url)}" style="font-size:14px;color:#0f766e">Open the post →</a></div>
</div>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#fff"><div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:12px">
<p style="font-size:14px;color:#334155;margin:0 0 14px">${items.length} fresh posts picked from ${scanned} read. Read each post before answering, make the draft sound like you, and post it by hand. The scanner line already says you built it; keep that in (Reddit's self-promotion rules).</p>
${cards || '<p>No post worth answering today.</p>'}
<p style="font-size:12px;color:#94a3b8">Read-only: nothing was posted, voted or sent on Reddit. AI cost of this digest: ${cost == null ? 'not measured' : `$${cost.toFixed(4)}`}.</p>
</div></body></html>`
  return { subject, html }
}

async function sendEmail({ subject, html }) {
  const key = process.env.RESEND_API_KEY
  const to = process.env.DIGEST_TO
  if (!key || !to) { log('no RESEND_API_KEY / DIGEST_TO in .env: digest saved as a file only'); return false }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.DIGEST_FROM || 'Reddit scout <onboarding@resend.dev>', to: [to], subject, html }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) { log(`email failed: HTTP ${res.status} ${await res.text().catch(() => '')}`); return false }
  return true
}

async function main() {
  loadEnv()
  mkdirSync(DATA, { recursive: true })
  mkdirSync(DIGESTS, { recursive: true })
  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  const digestFile = path.join(DIGESTS, `${day}.html`)
  if (!dryRun && !noAi && !force && existsSync(digestFile)) { log(`today's digest exists (${digestFile}); nothing done`); return }

  const subs = (process.env.SUBREDDITS?.trim() ? process.env.SUBREDDITS.split(',') : SUBREDDITS)
    .map(s => s.trim().replace(/^\/?r\//i, '')).filter(s => /^[A-Za-z0-9_]{2,21}$/.test(s))
  const reader = createReader()
  const posts = []
  for (const sub of subs) {
    const got = await reader.newPosts(sub)
    log(`r/${sub}: ${got.length} posts`)
    posts.push(...got)
  }
  const seen = readSeen(now)
  const ranked = pickFinalists(posts, { ...readReplied(), ...seen }, now)
  log(`${posts.length} read, ${ranked.length} finalists after the rules`)

  const finalists = []
  for (const post of ranked) {
    const comments = await reader.comments(post)
    if (comments && comments.length >= LIMITS.maxComments) { log(`skip ${post.id}: ${comments.length} replies already`); continue }
    finalists.push({ ...post, comments })
  }
  log(`${finalists.length} finalists after reply counts (${reader.requests} requests to Reddit)`)

  if (noAi) {
    for (const p of finalists) console.log(`- [${p.score}] r/${p.subreddit} ${Math.round(p.ageHours)}h ${p.comments?.length ?? '?'} replies · ${p.topics.join(', ')} · ${p.title}\n  ${p.url}`)
    return
  }
  if (finalists.length === 0) { log('no finalist today'); return }

  const cap = Number(process.env.DAILY_BUDGET_USD || 0.05)
  const budgetLeft = cap - spentToday(day)
  const { items, cost, model, usage } = await draftReplies(finalists, budgetLeft)
  if (usage) recordCost(day, model, usage, cost, items.length)
  log(`${items.length} drafts from ${model}, cost ${cost == null ? 'unknown' : `$${cost.toFixed(4)}`} (cap $${cap}/day), ${items.filter(i => i.mentionsScanner).length} with the scanner line`)
  if (items.length === 0) return

  if (autopilot && !dryRun) {
    for (const it of items) {
      const posted = await postComment({ id: it.post.id, text: it.draft })
      if (!posted.ok) { log(`autopilot: could not post r/${it.post.subreddit} ${it.post.id}: ${posted.error}`); continue }
      const result = await decide({ day, id: it.post.id, action: 'post', text: it.draft })
      if (result.status === 200) log(`autopilot: posted comment ${posted.commentId} on ${it.post.id}`)
      else log(`autopilot: decide failed (${result.status}) for ${it.post.id}`)
    }
    return
  }

  const digest = buildDigest(items, { day, scanned: posts.length, cost })
  const review = {
    day: dryRun ? `${day}-dry-run` : day, scanned: posts.length, cost, items: items.map(it => ({
      id: it.post.id, subreddit: it.post.subreddit, url: it.post.url, title: it.post.title,
      body: clip(it.post.body, 2000), publishedAt: it.post.publishedAt.toISOString(),
      why: it.why, draft: it.draft, mentionsScanner: it.mentionsScanner,
    })),
  }
  writeFileSync(path.join(DIGESTS, `${review.day}.json`), JSON.stringify(review, null, 1))
  if (dryRun) {
    console.log(`\n${digest.subject}\n`)
    for (const it of items) console.log(`## r/${it.post.subreddit} · ${Math.round(it.post.ageHours)} h · ${it.post.comments?.length ?? '?'} replies\n${it.post.title}\n${it.post.url}\nWhy: ${it.why}\n---\n${it.draft}\n`)
    writeFileSync(path.join(DIGESTS, `${day}-dry-run.html`), digest.html)
    return
  }
  writeFileSync(digestFile, digest.html)
  log(`digest saved: ${digestFile}`)
  if (await sendEmail(digest)) log(`digest emailed to ${process.env.DIGEST_TO}`)
  for (const it of items) seen[it.post.id] = day
  writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 1))
}

main().catch(error => { log(`failed: ${error.stack ?? error.message}`); process.exitCode = 1 })
