# Repo Recall

Practice for technical interviews, scored strictly enough to tell you what you actually know.

Repo Recall has two ways in:

- **Job prep** (main flow): paste a job description, study the topics it calls for, then take a timed mock interview on the same ground.
- **Repo**: paste a public GitHub repo you wrote and get questions about the specific decisions in your own code, answered from memory.

All answers are scored 1–5 by Gemini against a strict rubric. An answer that uses the right keywords but never explains how anything works scores 2, not 4.

## Job prep

1. **Paste a job description.** The app pulls out the role, seniority and skills, then builds a study plan of 4–7 topics. Each topic quotes the line from the posting it comes from, explains why the role needs it, lists what an interviewer is likely to probe, and has 3–5 practice questions.
2. **Study.** Look things up as much as you like. Every answer gets a score, feedback that teaches, the points you missed, and a model answer.
3. **Mock interview.** 10 new questions on the same topics, one at a time, with a timer (2 minutes for easy, 3 for medium, 4 for hard). No feedback until the end. Leaving the tab is recorded.
4. **Results.** Study score vs interview score, overall and per topic.

The gap between the two scores is the point:

| Study | Interview | What it means |
|---|---|---|
| Low | Low | You don't know it yet. Go back to the material. |
| High | Low | You know it but can't recall it under pressure. Practise answering out loud, from memory. |
| High | High | Solid. |

Both stages use the same scoring rubric, so the scores are comparable. Study mode only changes the tone of the feedback.

Results are saved in your browser (localStorage), and an in-progress session survives a page reload.

## Repo practice

Paste a public GitHub repo URL. The app reads the README, the file tree and up to 8 key source files (entry points first, then the largest files; tests, examples, generated data and lock files are ranked last or skipped). Gemini writes 10 questions about decisions visible in that code, not framework trivia. Each answer is scored against the real source, with harsh feedback and a model answer after every question.

## Answering by voice

In browsers that support the Web Speech API (Chrome, Edge), a **Speak** button transcribes into the answer box. Elsewhere the button is hidden and typing works the same.

## Setup

Requires Node.js 20+ and pnpm.

```bash
pnpm install
```

Create a `.env` file in the project root with a [Gemini API key](https://aistudio.google.com/apikey):

```
GEMINI_API_KEY=your-key-here
```

The key is only read on the server. All Gemini calls go through the app's server routes and the key is never sent to the browser.

Run the dev server at http://localhost:3000:

```bash
pnpm dev
```

Production build:

```bash
pnpm build
node .output/server/index.mjs
```

### Gemini quota

The Gemini free tier allows only **20 requests per day** for `gemini-2.5-flash` (and about 5 per minute). A full job-prep session uses around 37: one to build the study plan, one per study answer, one for the mock questions and one per mock answer. On the free tier you'll run out partway through. The app shows a clear message when that happens, and unscored mock answers can be retried from the results page. Enabling billing on the API key removes the limit; Flash is inexpensive.

### GitHub rate limit

The repo flow uses the unauthenticated GitHub API (60 requests per hour). File contents come from `raw.githubusercontent.com`, which doesn't count against that limit, so analysing a repo costs about 3 requests.

## API

All routes are `POST` with a JSON body.

| Route | Body | Returns |
|---|---|---|
| `/api/job-analyze` | `{ jobDescription }` | Role, seniority, skills, focus areas and the study plan |
| `/api/mock-questions` | `{ studyPlan, roleTitle?, seniority? }` | 10 new interview questions on the same topics |
| `/api/analyze` | `{ repoUrl }` | Repo name, 10 questions, and the code context used for scoring |
| `/api/score` | `{ question, expectedPoints, answer, codeContext \| jobContext, mode? }` | `{ score, missing, feedback, modelAnswer }` |

`mode` is `"interview"` (default) or `"study"`. Errors come back with a readable `statusMessage`.

## Project structure

```
app/
  pages/          index (job prep), study, mock, results, repo
  components/     AnswerBox (textarea + voice), ScoreCard, StudyQuestion
  composables/    useJobSession: session state, stats, background scoring
  plugins/        persists the session to localStorage
server/
  api/            the four routes above
  utils/          github.ts (repo fetching and file selection), gemini.ts
shared/types/     request and response types used by both sides
```

## Stack

Nuxt 4, TypeScript, Tailwind CSS and the Gemini API (`gemini-2.5-flash`). There is no database: session state lives in the browser.
