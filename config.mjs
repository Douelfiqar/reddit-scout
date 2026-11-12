export const SUBREDDITS = [
  'resumes',
  'jobs',
  'careerguidance',
  'cscareerquestions',
  'jobsearchhacks',
  'recruitinghell',
  'GetEmployed',
]

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

export const EXCLUDE = /\[(hiring|for hire|meta|mod)\]|\bwe('| a)re hiring\b|\bmegathread\b|\bweekly (thread|discussion)\b|\bdm me\b|\bmy (startup|app|tool|saas)\b|\b(paid|offering) resume (writing|services?)\b/i

export const NON_US_MARKET = /\b(india|indian|bangalore|bengaluru|chennai|hyderabad|pune|mumbai|delhi|pakistan|nigeria|philippines|uk|united kingdom|london|australia|germany|berlin|europe|singapore|dubai|uae)\b/i

export const QUESTION = /\?|\b(any (advice|tips|ideas)|advice (please|needed|on)|help (me|please|with)|what (am i|should i|can i)|how (do|can|should) i|feedback|thoughts)\b/i

export const LIMITS = {
  maxAgeHours: 24,
  perSubredditLimit: 50,
  minBodyChars: 80,
  finalists: 14,
  maxComments: 10,
  digestSize: 10,
  seenTtlDays: 30,
  bodyCharsForAi: 1200,
  commentCharsForAi: 220,
  requestGapMs: 65_000,
  maxRequests: 30,
  maxOutputTokens: 7000,
}

export const SCANNER_LINE =
  'If it helps, I built a free checker that compares your resume with a specific job posting and lists the requirements your resume does not show yet (no account needed): https://futurole.com/free-ats-scanner'

export const USER_AGENT = 'script:reddit-scout:0.1 (read-only daily digest)'

export const PRICES = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
}
