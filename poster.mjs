const REDDIT_API = 'https://oauth.reddit.com'
const REDDIT_TOKEN_API = 'https://www.reddit.com/api/v1/access_token'
const REDDIT_UA = 'script:reddit-scout:0.2 (comment posting)'

export function redditCookie() {
  return (process.env.REDDIT_COOKIE || '').trim().replace(/^bearer\s+/i, '')
}

async function accessToken() {
  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  const username = process.env.REDDIT_USERNAME
  const password = process.env.REDDIT_PASSWORD
  if (clientId && clientSecret && username && password) {
    const res = await fetch(REDDIT_TOKEN_API, {
      method: 'POST',
      headers: { 'User-Agent': REDDIT_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', username, password, client_id: clientId, client_secret: clientSecret, scope: 'identity post comment' }).toString(),
      signal: AbortSignal.timeout(30_000),
    })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.access_token) return json.access_token
  }
  return redditCookie()
}

async function redditFetch(path, { method = 'GET', body, form, token } = {}) {
  const bearer = token || await accessToken()
  const headers = { 'User-Agent': REDDIT_UA, Accept: 'application/json' }
  let payload
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString() }
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(`${REDDIT_API}${path}`, {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(30_000),
  })
  const raw = await res.text().catch(() => '')
  let json = null
  try { json = JSON.parse(raw) } catch { }
  const errors = Array.isArray(json?.json?.errors) ? json.json.errors : []
  const data = json?.json?.data ?? null
  return { ok: res.ok && errors.length === 0, status: res.status, data, errors, detail: json?.json?.message ?? null, raw: raw.slice(0, 300) }
}

export async function postComment({ id, text }) {
  const bearer = await accessToken()
  if (!bearer) return { ok: false, error: 'no Reddit token in .env: set REDDIT_COOKIE or the Reddit app credentials' }
  const created = await redditFetch('/api/comment', { method: 'POST', token: bearer, form: { api_type: 'json', thing_id: `t3_${id}`, text } })
  if (!created.ok) {
    const why = created.errors.map(e => e?.message ?? JSON.stringify(e)).join('; ') || created.detail || 'no detail'
    return { ok: false, error: `Reddit refused the comment (HTTP ${created.status}): ${why}${created.raw ? ` :: ${created.raw}` : ''}` }
  }
  const thing = created.data?.things?.[0]
  const comment = thing?.data ?? thing ?? null
  const commentId = String(comment?.id ?? '')
  if (!/^t1_/.test(commentId)) return { ok: false, error: `Reddit did not answer with a comment: ${JSON.stringify(created.data).slice(0, 300)}` }
  if (comment?.body && String(comment.body).trim() !== String(text ?? '').trim()) {
    return { ok: false, error: `comment body mismatch: expected ${JSON.stringify(String(text).trim())}, got ${JSON.stringify(String(comment.body).trim())}` }
  }
  return { ok: true, commentId, body: comment?.body }
}
