#!/usr/bin/env node
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { loadEnv, listDays, readDay, readReplied, decide, undo } from './commenter.mjs'
import { redditCookie, postComment } from './poster.mjs'

loadEnv()
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const PASSWORD = process.env.DIGEST_PASSWORD || ''
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST)
if (!LOOPBACK && !PASSWORD) {
  console.error(`HOST=${HOST} opens the server to the network: set DIGEST_PASSWORD in .env first.`)
  process.exit(1)
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const age = iso => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`
}

function page(day, digest, replied) {
  const days = listDays()
  const items = digest?.items ?? []
  const open = items.filter(it => !replied[it.id]).length
  const cards = items.map(it => {
    const done = replied[it.id]
    return `
<article class="card${done ? ' done' : ''}" data-id="${esc(it.id)}" data-url="${esc(it.url)}">
  <div class="meta">r/${esc(it.subreddit)} · ${esc(age(it.publishedAt))}${it.mentionsScanner ? ' · <b>links the scanner</b>' : ''}</div>
  <a class="title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
  <details><summary>Post</summary><div class="body">${esc(it.body)}</div></details>
  <div class="why"><i>Why:</i> ${esc(it.why)}</div>
  <textarea rows="9" ${done ? 'disabled' : ''}>${esc(done?.text ?? it.draft)}</textarea>
  <div class="row">
    <button class="approve" ${done ? 'disabled' : ''}>Approve &amp; copy</button>
    <button class="post" ${done ? 'disabled' : ''}>Post to Reddit</button>
    <button class="skip" ${done ? 'disabled' : ''}>Skip</button>
    <span class="status">${done ? `${esc(done.status)} ${esc(done.at.slice(0, 16).replace('T', ' '))} UTC · <a href="#" class="undo">Undo</a>` : ''}</span>
  </div>
</article>`
  }).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reddit scout review</title>
<style>
:root{--bg:#fff;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f8fafc;--accent:#0f766e;--err:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--fg:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--soft:#111a2e;--accent:#2dd4bf;--err:#f87171}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
main{max-width:680px;margin:0 auto;padding:12px 16px 40px}
header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
header h1{font-size:18px;margin:0;flex:1}
select,button,textarea{font:inherit;color:inherit}
select{background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:4px 8px}
.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 14px}
.card.done{opacity:.6}
.meta{font-size:12px;color:var(--muted)}.meta b{color:var(--accent)}
.title{display:block;font-weight:600;color:var(--fg);text-decoration:none;margin:4px 0}
details{font-size:14px;color:var(--muted)}.body{white-space:pre-wrap;margin:6px 0}
.why{font-size:13px;color:var(--muted);margin:6px 0 10px}
textarea{box-sizing:border-box;width:100%;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:10px 12px;resize:vertical}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
button{border:1px solid var(--line);background:var(--soft);border-radius:8px;padding:6px 14px;cursor:pointer}
button.approve{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:600}
button:disabled{opacity:.5;cursor:default}
button.post{background:#047857;border-color:#047857;color:#fff;font-weight:600}
.status{font-size:13px;color:var(--muted)}.status.err{color:var(--err)}.status a{color:var(--accent)}
.note{font-size:13px;color:var(--muted)}
</style></head><body><main>
<header><h1>${open} of ${items.length} to answer</h1>
<select onchange="location.search='?day='+this.value">${days.map(d => `<option${d === day ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select></header>
<p class="note">Edit the reply until it sounds like you. <b>Approve &amp; copy</b> copies it, opens the thread and marks the post answered: paste it in Reddit's comment box and press Reply. Or press <b>Post to Reddit</b>: it sends the comment from your own account (your Reddit cookie in <code>REDDIT_COOKIE</code> in <code>.env</code>) through Reddit's API, verifies it went up, then marks the post answered.</p>
${digest ? cards || '<p>No post in this digest.</p>' : '<p>No digest yet: run <code>node scout.mjs</code> (or <code>--dry-run</code>).</p>'}
</main>
<script>
const DAY = ${JSON.stringify(day ?? '')}
async function call(path, payload) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status)
  return json
}
function copy(textarea) {
  const text = textarea.value
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => false)
  textarea.select()
  const ok = document.execCommand('copy')
  return Promise.resolve(ok)
}
document.addEventListener('click', async e => {
  const card = e.target.closest('.card')
  if (!card) return
  const status = card.querySelector('.status')
  const textarea = card.querySelector('textarea')
  const setStatus = (html, err) => { status.innerHTML = html; status.classList.toggle('err', !!err) }
  const lock = on => card.querySelectorAll('button,textarea').forEach(el => { el.disabled = on })
  if (e.target.matches('.approve')) {
    if (!textarea.value.trim()) return setStatus('The reply is empty.', true)
    const copied = copy(textarea)
    const tab = window.open('', '_blank')
    lock(true)
    try {
      await call('/api/reply', { day: DAY, id: card.dataset.id, action: 'approve', text: textarea.value })
      if (tab) { tab.opener = null; tab.location = card.dataset.url } else window.open(card.dataset.url, '_blank', 'noopener')
      card.classList.add('done')
      setStatus((await copied ? 'Copied. Paste it on Reddit and press Reply.' : 'Approved. Copy the text above by hand.') + ' · <a href="#" class="undo">Undo</a>')
    } catch (err) { if (tab) tab.close(); lock(false); setStatus(err.message, true) }
  } else if (e.target.matches('.post')) {
    if (!textarea.value.trim()) return setStatus('The reply is empty.', true)
    const tab = window.open('', '_blank')
    lock(true)
    try {
      const json = await call('/api/post', { day: DAY, id: card.dataset.id, text: textarea.value })
      if (tab) { tab.opener = null; tab.location = card.dataset.url } else window.open(card.dataset.url, '_blank', 'noopener')
      card.classList.add('done')
      setStatus('Posted on Reddit ✓ · comment ' + json.commentId + ' · <a href="#" class="undo">Undo</a>')
    } catch (err) { if (tab) tab.close(); lock(false); setStatus(err.message, true) }
  } else if (e.target.matches('.skip')) {
    lock(true)
    try { await call('/api/reply', { day: DAY, id: card.dataset.id, action: 'skip' }); card.classList.add('done'); setStatus('Skipped · <a href="#" class="undo">Undo</a>') }
    catch (err) { lock(false); setStatus(err.message, true) }
  } else if (e.target.matches('.undo')) {
    e.preventDefault()
    try { await call('/api/undo', { id: card.dataset.id }); card.classList.remove('done'); lock(false); setStatus('') }
    catch (err) { setStatus(err.message, true) }
  }
})
</script></body></html>`
}

function authorized(req) {
  if (!PASSWORD) return true
  const m = (req.headers.authorization ?? '').match(/^Basic\s+(.+)$/i)
  const given = Buffer.from(m ? Buffer.from(m[1], 'base64').toString().replace(/^[^:]*:/, '') : '')
  const want = Buffer.from(PASSWORD)
  return given.length === want.length && timingSafeEqual(given, want)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => { size += c.length; if (size > 64_000) { reject(new Error('body too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('body is not JSON')) } })
    req.on('error', reject)
  })
}

const send = (res, status, type, body) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' })
  res.end(body)
}
const sendJson = (res, { status, body }) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body))

const server = http.createServer(async (req, res) => {
  try {
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Reddit scout", charset="UTF-8"' })
      return res.end('Password required')
    }
    const url = new URL(req.url, 'http://local')
    if (req.method === 'GET' && url.pathname === '/') {
      const day = url.searchParams.get('day') || listDays()[0] || null
      return send(res, 200, 'text/html; charset=utf-8', page(day, day && readDay(day), readReplied()))
    }
    if (req.method === 'POST' && url.pathname === '/api/post') {
      const origin = req.headers.origin
      if (origin && new URL(origin).host !== req.headers.host) return sendJson(res, { status: 403, body: { error: 'cross-site request' } })
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return sendJson(res, { status: 415, body: { error: 'send JSON' } })
      const payload = await readJson(req).catch(e => ({ __error: e.message }))
      if (payload?.__error || typeof payload !== 'object' || payload === null) return sendJson(res, { status: 400, body: { error: payload?.__error ?? 'bad body' } })
      if (!/^[a-z0-9]{4,12}$/i.test(payload.id ?? '')) return sendJson(res, { status: 400, body: { error: 'bad post id' } })
      const text = typeof payload.text === 'string' ? payload.text.replace(/\r/g, '').trim() : ''
      if (text.length < 2) return sendJson(res, { status: 400, body: { error: 'the reply is empty' } })
      if (text.length > 10_000) return sendJson(res, { status: 400, body: { error: 'Reddit comments stop at 10,000 characters' } })
      const cookie = redditCookie()
      if (!cookie) return sendJson(res, { status: 503, body: { error: 'REDDIT_COOKIE is missing in .env' } })
      const done = readReplied()[payload.id]
      if (done) return sendJson(res, { status: 409, body: { error: `already ${done.status} on ${done.at.slice(0, 10)}`, entry: done } })
      const posted = await postComment({ id: payload.id, text })
      if (!posted.ok) return sendJson(res, { status: 502, body: { error: `Reddit refused the comment: ${posted.error}` } })
      const result = await decide({ day: payload.day, id: payload.id, action: 'post', text })
      if (result.status !== 200) return sendJson(res, { status: result.status, body: result.body })
      return sendJson(res, { status: 200, body: { ok: true, commentId: posted.commentId, entry: result.body.entry } })
    }
    if (req.method === 'POST' && (url.pathname === '/api/reply' || url.pathname === '/api/undo')) {
      const origin = req.headers.origin
      if (origin && new URL(origin).host !== req.headers.host) return sendJson(res, { status: 403, body: { error: 'cross-site request' } })
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return sendJson(res, { status: 415, body: { error: 'send JSON' } })
      const payload = await readJson(req).catch(e => ({ __error: e.message }))
      if (payload?.__error || typeof payload !== 'object' || payload === null) return sendJson(res, { status: 400, body: { error: payload?.__error ?? 'bad body' } })
      return sendJson(res, url.pathname === '/api/reply' ? decide(payload) : undo(payload))
    }
    send(res, 404, 'text/plain; charset=utf-8', 'Not found')
  } catch (error) {
    console.error(error)
    sendJson(res, { status: 500, body: { error: 'server error, see the terminal' } })
  }
})

server.listen(PORT, HOST, () => console.log(`Review server on http://${HOST.includes(':') ? `[${HOST}]` : HOST}:${PORT}${PASSWORD ? ' (password on)' : ''}`))
