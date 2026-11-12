# Reddit scout

Once a day, a short list (up to 10) of fresh Reddit posts where a job seeker asks something you can genuinely help with: no callbacks, ATS, tailoring, cover letters, rejections. Each post comes with a drafted reply. You read the post, make the draft yours and **post it by hand** from your own account.

- **Read-only.** It only GETs Reddit's public RSS feeds. It never posts, comments, votes or sends messages, and it has no Reddit login.
- **Cheap.** Plain rules filter first, then one AI call a day (about $0.005 on gpt-5.6-luna), with a hard daily cap (`DAILY_BUDGET_USD`, default $0.05). Every call is logged in `data/costs.csv`.
- **No product push.** The drafts never name a product. The only mention is one fixed, honest sentence about the free ATS checker (it says you built it). Code adds it to at most 1 draft in 3, only where the AI says it fits.
- **Review page.** `node server.mjs` shows the digest with each draft in an editable box. **Approve & copy** copies your reply, opens the thread, and records the post in `data/replied.json` so it never comes back. You paste and press Reply yourself.
- **No dependencies.** Node 20 or newer, nothing to install.

## Setup (5 minutes)

1. Install Node 20 or newer.
2. `copy .env.example .env` (Windows) or `cp .env.example .env`, then fill in:
   - `OPENAI_API_KEY`: from https://platform.openai.com/api-keys, or an OpenRouter key (`sk-or-…`) with `OPENAI_BASE_URL=https://openrouter.ai/api/v1` and an OpenRouter `MODEL` such as `openai/gpt-4o-mini`
   - Email (optional, free): make a https://resend.com account, create an API key and set `RESEND_API_KEY`. Set `DIGEST_TO` to the address you signed up with. Without your own domain, Resend's test sender only delivers to that address.
3. Try it:
   - `node scout.mjs --no-ai`: rules only, free. Prints the posts that would go to the AI.
   - `node scout.mjs --dry-run`: one AI call. Prints the digest and saves `digests/<date>-dry-run.html`. Sends no email and remembers nothing.
   - `node scout.mjs`: the real run. Saves `digests/<date>.html`, emails it if Resend is set up, and remembers the posts so they never come back.

A run takes **about 20 minutes**. Reddit lets an anonymous reader make about one request a minute (`x-ratelimit-remaining: 0` after a single call), so the script waits 65 s between requests: 7 subreddits plus up to 14 comment pages.

## Run it every day

**How it runs today:** on an InstaBox cloud machine, woken daily by a GitHub Action in this repo. **See [HOSTING.md](HOSTING.md)** for how that works and how to operate it. The options below are for running it on your own computer or server instead.

**Windows (Task Scheduler).** Run this once in a terminal, replacing the path with this folder's path:

```
schtasks /Create /TN "Reddit scout" /SC DAILY /ST 14:00 /TR "\"C:\path\to\reddit-scout\run-daily.cmd\""
```

At 14:00 Paris time it is 8:00 in New York, when overnight US posts are fresh. The PC must be on. In Task Scheduler → the task → Settings, tick "Run task as soon as possible after a scheduled start is missed". The output goes to `scout.log`.

**A Linux server (cron).** `30 12 * * * cd /path/to/reddit-scout && /usr/bin/node scout.mjs >> scout.log 2>&1`

Running the scout directly on GitHub Actions or other cloud runners is untested (the Action in this repo only wakes the InstaBox machine). Reddit often refuses data-centre addresses: its `.json` endpoints already answer 403 to servers, while its RSS answered 200 from both a VPS and a home connection on 12 Nov 2026.

## Review and reply

```
node server.mjs
```

Open http://127.0.0.1:8787. It shows the newest digest (pick another day in the menu) with every post's draft in a text box.

- **Approve & copy**: copies the text as you edited it, opens the thread in a new tab and records the post as answered. Paste it in Reddit's comment box and press Reply.
- **Skip**: records the post so the scout never shows it again.
- **Undo**: clears a decision made by mistake.

The page never posts to Reddit: it has no Reddit login. Replies go out from your own browser session, typed or pasted by you. A post can be approved only once (`data/replied.json`), and the scout leaves out every post in that file.

On a VPS, set `HOST=0.0.0.0` and `DIGEST_PASSWORD` in `.env` (the server refuses to start on the network without it), and prefer HTTPS in front of it.

## What to edit

`config.mjs` holds everything as plain data:

| Setting | What it controls |
|---|---|
| `SUBREDDITS` | which subreddits are read (or set `SUBREDDITS=` in `.env`) |
| `TOPICS`, `EXCLUDE`, `QUESTION` | what counts as a post worth answering |
| `NON_US_MARKET` | posts about other job markets rank lower |
| `LIMITS` | age (24 h), reply count (fewer than 10), digest size (10), pacing |
| `SCANNER_LINE` | the one product sentence |
| `PRICES` | used for the cost cap |

The AI instructions are `SYSTEM` in `scout.mjs`.

## How a post is picked

1. Posted under 24 h ago, body at least 80 characters, asks a question, matches a topic, nothing excluded.
2. Ranked by topic weight, plus a bonus for a question in the title and for being under 8 h old. Posts about non-US markets rank lower.
3. The best 14 not already shown in the last 30 days are kept. For each, the script reads the replies: posts with 10 or more are dropped, and the AI sees the first two replies so it can skip posts that are already answered well.
4. One AI call keeps the ones worth answering and drafts the replies. Code then removes any sentence with a link or a product name, keeps 10, and adds the scanner line to at most ⌊n/3⌋.

## Reddit's rules

- It reads Reddit's public RSS feeds at under 30 requests a day, one at a time, with an honest User-Agent (`script:reddit-scout:0.1`) and no personal data. It stores only post ids, for 30 days.
- Replies are posted by a person, by hand: the review page copies the text and opens the thread, nothing more. Many subreddits ban self-promotion or limit it (a common rule of thumb: at most 1 in 10 of your posts about your own product). Read each subreddit's rules, and keep the disclosure in the scanner line.
- If Reddit ever refuses the RSS (`HTTP 403` in `scout.log`), the allowed route is the official API. Register a "script" app at https://www.reddit.com/prefs/apps (you get a client id and a secret; no password is needed for read-only app access) and read through OAuth under Reddit's Data API terms. That would need a small change to `createReader()`.

## Files

| File | Holds |
|---|---|
| `scout.mjs` | the scout |
| `server.mjs` | the review page (`node server.mjs`) |
| `commenter.mjs` | `data/replied.json` and the review actions |
| `review.mjs` | `npm run review`: pull from InstaBox, review here, send decisions back (HOSTING.md) |
| `config.mjs` | the lists and limits |
| `.env` | your keys (never committed) |
| `data/seen.json` | posts already shown (30 days) |
| `data/costs.csv` | every AI call: tokens and dollars |
| `data/replied.json` | posts approved or skipped in the review page |
| `digests/` | one HTML digest per day (open it anywhere) and its `.json` twin for the review page |
