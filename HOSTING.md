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

## When something goes wrong

| What you see | Likely cause | Fix |
|---|---|---|
| The Action is red at "Wake the machine" | wrong or deleted `INSTABOX_API_KEY` | create a new key and update the secret |
| The Action is green, but there's no digest that day | the run failed on the machine | read `~/scout-<date>.log` |
| `HTTP 403` from Reddit in the log | Reddit refused the RSS | see the README, "Reddit's rules": switch to the official API |
| `OPENAI_API_KEY is missing` / `401` | the OpenRouter key is missing or revoked | put a valid key in `.env` |
| `no price for <model>` | `MODEL` has no entry in `PRICES` | add it to `config.mjs` |
| `budget left … too small` | the daily cap was reached | wait for tomorrow, or raise `DAILY_BUDGET_USD` |
| The machine is gone from the dashboard | deleted, or the free plan changed | create a new machine, copy the code, recreate `.env`, keep the name `reddit` (or change it in the workflow) |

## Ground rules (unchanged)

- The scout only **reads** Reddit. It never posts, comments, votes or messages, and it has no Reddit login.
- **You post replies yourself**, after reading and editing the draft. Keep the "I built this" disclosure whenever FutuRole is mentioned, and follow each subreddit's self-promotion rules.
