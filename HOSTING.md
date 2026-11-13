# How the scout is hosted and run

The scout runs on a small cloud Linux machine at **InstaBox** (instabox.sh). A **GitHub Action** in this repo wakes that machine once a day and starts the scout. Your PC can be off.

```
GitHub Action (daily, ~15 s)
   │  calls InstaBox's API with the INSTABOX_API_KEY secret
   ▼
InstaBox machine "reddit"  ── wakes up if asleep
   │  runs:  node ~/reddit-scout/scout.mjs   (about 20–25 min)
   │     1. reads 7 subreddits' public RSS feeds, one request a minute
   │     2. keeps up to 14 posts with plain rules, reads their replies
   │     3. one AI call through OpenRouter (openai/gpt-4o-mini) drafts the replies
   ▼
~/reddit-scout/digests/<date>.html   ← the daily list (and an email, if Resend is set up)
```

The machine then goes back to sleep on its own after 30 minutes without activity.

## The pieces

| Piece | Where | What it holds |
|---|---|---|
| Code | this repo, `main` branch | `scout.mjs`, `config.mjs`, the workflow |
| The machine | InstaBox dashboard → **Machines** → `reddit` | a copy of the code in `~/reddit-scout`, plus its `.env` |
| Daily trigger | `.github/workflows/daily-scout.yml` | the schedule, and the API calls that wake the machine |
| GitHub secret | repo → Settings → Secrets → Actions | `INSTABOX_API_KEY` (an `ibk_…` key) |
| AI key | `~/reddit-scout/.env` on the machine | `OPENAI_API_KEY` = your OpenRouter key (`sk-or-…`) |

The `.env` file on the machine (permissions 600, never committed):

```
OPENAI_API_KEY=sk-or-...              # OpenRouter key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
MODEL=openai/gpt-4o-mini              # must have a price in config.mjs PRICES
DAILY_BUDGET_USD=0.05                 # hard cap per day
# RESEND_API_KEY=...  DIGEST_TO=...   # optional: email the digest
REDDIT_COOKIE=...                     # your Reddit session cookie: the review page's "Post to Reddit" button
```

## The machine (InstaBox free plan, as of 12 Nov 2026)

- **Size:** 4 vCPUs, 8 GB RAM, Node 22. `/data` is a 20 GB persistent disk, and your home folder (with `~/reddit-scout`) lives on it, so files survive sleep.
- **It sleeps after 30 minutes idle.** A cron job *inside* the machine would never fire while it sleeps. That's why the wake-up comes from GitHub.
- **Each run of the machine is capped at 2 hours.** The scout needs about 25 minutes.
- Reddit answers this machine's RSS requests (HTTP 200). Many cloud servers get refused, which is why the scout doesn't run directly on GitHub's servers.

## The schedule

`cron: '0 13 * * *'` in the workflow = **13:00 UTC every day**. That's 14:00 in Paris in winter and 15:00 in summer, early morning in the US, when overnight posts are fresh. To change it, edit that line (times are UTC) and push.

**GitHub minutes:** the job only makes two API calls and exits: about 15 seconds, billed as 1 minute a day, so about 30 minutes a month.

## Everyday tasks

**Run it now instead of waiting.** GitHub → this repo → **Actions** → **Daily Reddit scout** → **Run workflow**.

**Read today's list.** In the InstaBox dashboard, open `reddit` → **Filesystem** → `reddit-scout/digests/` and open today's `.html`. Or set up Resend and get it by email. Or ask Claude: "show me today's Reddit digest."

**See what a run did.** Each run logs to `~/scout-<date>.log` on the machine. In the machine's **Terminal**:

```
tail -30 ~/scout-$(date +%F).log
```

**Check the AI spending.** `cat ~/reddit-scout/data/costs.csv` (one line per AI call, in dollars). Your OpenRouter dashboard shows the same.

**Try it without spending anything.** In the Terminal: `cd ~/reddit-scout && node scout.mjs --no-ai` (rules only), or `--dry-run` (one AI call, remembers nothing, sends no email).

## Changing things

**Subreddits, topics, limits, the product sentence.** Edit `config.mjs` (see the README's "What to edit" table).

**The model.** Set `MODEL=` in the machine's `.env` to any OpenRouter model name (`provider/model`). Add its per-million-token prices to `PRICES` in `config.mjs` first, or the scout refuses to call it, so the daily cap stays true.

**Putting a code change on the machine.** The machine holds a *copy* of the code, not a git clone (the repo is private and the machine has no GitHub login). After pushing a change here, either:
- ask Claude to "update the scout on the InstaBox machine", or
- copy the changed file by hand: dashboard → `reddit` → **Filesystem**, upload it into `reddit-scout/`.

Never overwrite the machine's `.env` or its `data/` folder: they hold your key, the posts already shown and the cost log.

**Rotating a key.**
- OpenRouter: in the machine's Terminal,
  `sed -i 's|^OPENAI_API_KEY=.*|OPENAI_API_KEY=NEW_KEY|' ~/reddit-scout/.env`
- InstaBox: create a new key in the dashboard (or `npx instabox@latest keys create --name scout`), paste it into the GitHub secret `INSTABOX_API_KEY`, then delete the old key.

## The review page (server.mjs)

**On InstaBox it cannot stay online.** The machine suspends itself after 30 minutes without activity (`autoSuspendAfterSeconds: 1800`), each run is capped (`maxRunMinutes: 480`), and it has no public port, so nothing outside the machine can open the page. A process manager doesn't change that: when the machine sleeps, every process on it stops. Use the HTML digest there, as today.

**Review on your own computer instead: `npm run review`.** One command does the round trip:

1. wakes the machine and pulls its `digests/*.json` (new days, plus the newest again) and `data/replied.json` into this folder. Decisions already here that were never sent are kept.
2. starts `server.mjs` here, on 127.0.0.1 only, and opens http://127.0.0.1:8787 in your browser.
3. when you press **Ctrl+C**, wakes the machine again if it fell asleep and writes your `data/replied.json` to `~/reddit-scout/data/`, so the next scout run skips every post you approved or skipped.

It needs `INSTABOX_API_KEY` in your local `.env`: the same `ibk_…` key as the GitHub secret, or a new one from the dashboard. `INSTABOX_MACHINE` changes the machine name (default `reddit`). It goes through InstaBox's API, like the GitHub Action, so no CLI, `scp` or SSH is needed.

If sending fails (no network, expired key), your decisions stay in the local file: `npm run review:push` sends them later. Only that file goes up; the machine's `.env`, `seen.json` and cost log are never touched.

### On an always-on VPS (systemd)

For a server that never sleeps, `deploy/` holds three systemd units that replace both the GitHub Action and cron:

| File | What it does |
|---|---|
| `deploy/reddit-scout-server.service` | runs `server.mjs` permanently; restarts it 5 s after a crash and starts it at boot |
| `deploy/reddit-scout.service` | one scout run (`scout.mjs`), up to 2 h |
| `deploy/reddit-scout.timer` | starts that run every day at 13:00 UTC, or at boot if the server was off then |

Both run as an ordinary user (`scout` in the files) with a read-only system. They can write only to `data/` (and the scout also to `digests/`), so they share `data/replied.json`. Install, once, as root:

```
# 1. The code in /home/scout/reddit-scout, with its .env (copy .env.example). Edit User= and the paths in deploy/*.service if yours differ.
mkdir -p /home/scout/reddit-scout/data /home/scout/reddit-scout/digests
# 2. Node 20+ in /usr/bin or /usr/local/bin (systemd does not see an nvm install; then put its full path in ExecStart=).
cp /home/scout/reddit-scout/deploy/reddit-scout*.service /home/scout/reddit-scout/deploy/reddit-scout.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now reddit-scout-server.service reddit-scout.timer
```

Check them:

```
systemctl status reddit-scout-server     # should say active (running)
systemctl list-timers reddit-scout.timer # next run time
journalctl -u reddit-scout -n 50         # the last scout run's log
journalctl -u reddit-scout-server -f     # the page's log, live
systemctl start reddit-scout             # run the scout now
```

**Reaching the page.** By default the server listens on `127.0.0.1:8787`, the VPS only. The safest way to open it from your laptop is an SSH tunnel: `ssh -L 8787:127.0.0.1:8787 scout@your-vps`, then http://127.0.0.1:8787. To open it to the internet instead, set `HOST=0.0.0.0` and `DIGEST_PASSWORD` in `.env` (the server refuses to start without the password), open the port in the firewall, and put HTTPS in front (Caddy or nginx), since Basic auth over plain HTTP sends the password in the clear. After changing `.env`: `systemctl restart reddit-scout-server`.

**After a code change:** copy the files, then `systemctl restart reddit-scout-server`. The scout picks up changes on its next run.

Before moving the scout itself to a VPS, check that Reddit answers that server's RSS requests: `node scout.mjs --no-ai` should log posts per subreddit, not `HTTP 403` (see "The machine" above).

## When something goes wrong

| What you see | Likely cause | Fix |
|---|---|---|
| The Action is red at "Wake the machine" | wrong or deleted `INSTABOX_API_KEY` | create a new key and update the secret |
| The Action is green, but there's no digest that day | the run failed on the machine | read `~/scout-<date>.log` |
| The review page does not open | InstaBox: use `npm run review` on your computer. VPS: the service is down or the port is closed | `systemctl status reddit-scout-server`, `journalctl -u reddit-scout-server -n 30`, and the tunnel or firewall |
| `HTTP 403` from Reddit in the log | Reddit refused the RSS | see the README, "Reddit's rules": switch to the official API |
| `OPENAI_API_KEY is missing` / `401` | the OpenRouter key is missing or revoked | put a valid key in `.env` |
| `no price for <model>` | `MODEL` has no entry in `PRICES` | add it to `config.mjs` |
| `budget left … too small` | the daily cap was reached | wait for tomorrow, or raise `DAILY_BUDGET_USD` |
| The machine is gone from the dashboard | deleted, or the free plan changed | create a new machine, copy the code, recreate `.env`, keep the name `reddit` (or change it in the workflow) |

## Ground rules (unchanged)

- The scout only **reads** Reddit. It never posts, comments, votes or messages, and it has no Reddit login. The only posting is the review page's **Post to Reddit** button, run by you on your own account (your cookie in `REDDIT_COOKIE`), through Reddit's API.
- **You post replies yourself**, after reading and editing the draft. The review page either copies the text, opens the thread and records your decision (**Approve & copy**), or sends the comment straight from your account (**Post to Reddit**). Keep the "I built this" disclosure whenever FutuRole is mentioned, and follow each subreddit's self-promotion rules.
