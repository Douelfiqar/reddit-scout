// Reddit scout settings. Plain data: edit freely.

/** Subreddits read, newest posts first (without "r/"). SUBREDDITS in .env replaces this list. */
export const SUBREDDITS = [
  'resumes',
  'jobs',
  'careerguidance',
  'cscareerquestions',
  'jobsearchhacks',
  'recruitinghell',
  'GetEmployed',
]

/** Topics the owner can genuinely help with. Each hit adds `weight` to a post's score. */
export const TOPICS = [
  { label: 'no callbacks', weight: 3, pattern: /\b(no|zero|0|few|not (getting|any)|never get(ting)?)\s+(call ?backs?|responses?|replies|interviews?)\b|\bghost(ed|ing)\b|\bcrickets\b/i },
  { label: 'ATS', weight: 3, pattern: /\bATS\b|applicant tracking|ats[- ](friendly|compatible|score|proof)/i },
  { label: 'rejected', weight: 2, pattern: /\breject(ed|ions?)\b|\bauto[- ]?reject|\bwithout (an )?interview\b/i },
  { label: 'tailoring', weight: 3, pattern: /\btailor(ing|ed)?\b|\bcustomi[sz](e|ing) (my )?(resume|cv)\b|\bkeywords?\b|\bjob description\b/i },
  { label: 'cover letter', weight: 3, pattern: /\bcover letters?\b/i },
  { label: 'resume review', weight: 2, pattern: /\b(resume|cv)\b.*\b(review|feedback|critique|advice|help|look at|roast)\b|\b(review|feedback|critique|roast)\b.*\b(resume|cv)\b/i },
  { label: 'applications', weight: 2, pattern: /\b(applied|applications?|apply(ing)?) (to|for)? ?\d{2,}|\b\d{2,}\+? (applications|jobs applied|apps)\b/i },
  { label: 'career change', weight: 1, pattern: /\b(career (change|switch|pivot)|changing careers|transition(ing)? (in)?to)\b/i },
  { label: 'interview prep', weight: 1, pattern: /\b(prepare|prep(ping)?) for (an |my |the )?interview\b|\binterview tips\b/i },
]

/** Posts never answered: hiring ads, mod threads, self-promotion, paid services. */
export const EXCLUDE = /\[(hiring|for hire|meta|mod)\]|\bwe('| a)re hiring\b|\bmegathread\b|\bweekly (thread|discussion)\b|\bdm me\b|\bmy (startup|app|tool|saas)\b|\b(paid|offering) resume (writing|services?)\b/i

/** US-first: a post naming another job market ranks lower (never dropped). */
export const NON_US_MARKET = /\b(india|indian|bangalore|bengaluru|chennai|hyderabad|pune|mumbai|delhi|pakistan|nigeria|philippines|uk|united kingdom|london|australia|germany|berlin|europe|singapore|dubai|uae)\b/i

/** A real question: a question mark, or one of these asks. */
export const QUESTION = /\?|\b(any (advice|tips|ideas)|advice (please|needed|on)|help (me|please|with)|what (am i|should i|can i)|how (do|can|should) i|feedback|thoughts)\b/i

export const LIMITS = {
  maxAgeHours: 24,          // older posts are skipped
  perSubredditLimit: 50,    // newest posts read per subreddit (one request each)
  minBodyChars: 80,         // shortest body worth answering
  finalists: 14,            // best rule-ranked posts whose replies are read and sent to the AI
  maxComments: 10,          // posts with this many replies or more are already served
  digestSize: 10,           // items in the digest
  seenTtlDays: 30,          // a post shown once is not shown again for this long
  bodyCharsForAi: 1200,
  commentCharsForAi: 220,
  requestGapMs: 65_000,     // Reddit's anonymous limit is about 1 request a minute
  maxRequests: 30,          // hard stop on requests to Reddit per run
  maxOutputTokens: 7000,
}

/**
 * The only sentence that ever names the owner's product. Fixed text, true to the page it links
 * (free, no account, compares a resume with a pasted job posting and lists the requirements it does
 * not show). It says who built it, as Reddit's self-promotion rules expect. Added in code to at most
 * one draft in three, only where the AI says it fits.
 */
export const SCANNER_LINE =
  'If it helps, I built a free checker that compares your resume with a specific job posting and lists the requirements your resume does not show yet (no account needed): https://futurole.com/free-ats-scanner'

/** Honest User-Agent, no personal data (Reddit asks for platform:app:version). */
export const USER_AGENT = 'script:reddit-scout:0.1 (read-only daily digest)'

/** OpenAI list prices, $ per million tokens. Add your model here if you change MODEL. */
export const PRICES = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  // OpenRouter names (provider/model), same per-million-token prices as the provider's own.
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
}
