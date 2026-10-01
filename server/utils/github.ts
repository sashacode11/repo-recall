const API = 'https://api.github.com'
const RAW = 'https://raw.githubusercontent.com'
const MAX_FILES = 8
const MAX_FILE_BYTES = 50_000
const MAX_README_CHARS = 15_000
const MAX_TREE_PATHS = 600

export interface RepoSnapshot {
  owner: string
  repo: string
  description: string | null
  language: string | null
  readme: string
  tree: string[]
  files: { path: string; content: string }[]
}

interface TreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  size?: number
}

export function parseRepoUrl(input: string): { owner: string; repo: string } {
  const trimmed = input.trim()
  // Accept https://github.com/owner/repo(.git)(/anything), github.com/owner/repo, or owner/repo
  const match =
    trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i) ??
    trimmed.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
  if (!match) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Not a GitHub repo URL. Expected something like https://github.com/owner/repo',
    })
  }
  return { owner: match[1]!, repo: match[2]! }
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'repo-recall',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (res.ok) return (await res.json()) as T

  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    const minutes = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60_000)) : null
    throw createError({
      statusCode: 429,
      statusMessage: `GitHub rate limit reached (60 requests/hour without a token). Try again${
        minutes ? ` in about ${minutes} minute${minutes === 1 ? '' : 's'}` : ' later'
      }.`,
    })
  }

  if (res.status === 404) {
    throw createError({ statusCode: 404, statusMessage: `GitHub returned 404 for ${path}` })
  }

  throw createError({
    statusCode: 502,
    statusMessage: `GitHub request failed (${res.status} ${res.statusText}) for ${path}`,
  })
}

function decodeBase64(content: string): string {
  return Buffer.from(content, 'base64').toString('utf8')
}

const SOURCE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|py|go|rs|rb|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|scala|ex|exs|clj|dart|lua|sql|sh)$/i

const SKIP_PATH =
  /(^|\/)(node_modules|dist|build|out|\.output|\.nuxt|\.next|\.svelte-kit|coverage|vendor|target|__pycache__|\.venv|venv|\.git|public|static|assets|fixtures|__snapshots__)\//i

const SKIP_FILE =
  /(\.min\.(js|css)$|\.d\.ts$|\.map$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|\.(png|jpe?g|gif|svg|ico|webp|avif|bmp|pdf|woff2?|ttf|otf|eot|mp[34]|mov|zip|gz|tar)$)/i

// Files that rarely reveal design decisions: tests, demos, generated data, icon/asset components.
const LOW_SIGNAL =
  /(^|\/)(tests?|__tests__|spec|e2e|playground|examples?|demos?|docs|benchmarks?|scripts|constants|locales?|i18n|mocks?|icons?)\/|\.(test|spec|stories)\.|(^|\/)[\w-]*(setup|test-utils|constants)\.[a-z]+$|(^|\/)\.?(eslint|prettier|jest|vitest|babel|postcss|tailwind|commitlint|stylelint)(rc)?(\.config)?\.[a-z]+$|(^|\/)Icon[A-Z]\w*\.(vue|tsx|jsx)$/i

const ENTRY_POINTS = [
  'server.js', 'server.ts', 'main.ts', 'main.js', 'app.vue', 'App.vue', 'App.tsx', 'App.jsx',
  'index.ts', 'index.js', 'app.ts', 'app.js', 'main.py', 'app.py', 'main.go', 'main.rs', 'lib.rs',
  'nuxt.config.ts', 'vite.config.ts',
]

export function selectFiles(entries: TreeEntry[]): TreeEntry[] {
  const candidates = entries.filter(
    (e) =>
      e.type === 'blob' &&
      SOURCE_EXT.test(e.path) &&
      !SKIP_PATH.test(e.path) &&
      !SKIP_FILE.test(e.path) &&
      (e.size ?? 0) > 0 &&
      (e.size ?? 0) <= MAX_FILE_BYTES,
  )

  const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  const depth = (p: string) => p.split('/').length

  // Entry points first, in ENTRY_POINTS order, shallowest path wins ties.
  // Tiny files (re-export barrels, one-line handlers) don't say anything about the author's decisions.
  const entryPoints = candidates
    .filter((e) => ENTRY_POINTS.includes(basename(e.path)) && (e.size ?? 0) >= 300 && !LOW_SIGNAL.test(e.path))
    .sort(
      (a, b) =>
        ENTRY_POINTS.indexOf(basename(a.path)) - ENTRY_POINTS.indexOf(basename(b.path)) ||
        depth(a.path) - depth(b.path),
    )
    .slice(0, 3) // leave room for the substantive files

  // Then the largest files, with tests, examples, data tables and icons ranked after real logic.
  const chosen = new Set(entryPoints.map((e) => e.path))
  const bySize = (a: TreeEntry, b: TreeEntry) => (b.size ?? 0) - (a.size ?? 0)
  const rest = candidates.filter((e) => !chosen.has(e.path))
  const primary = rest.filter((e) => !LOW_SIGNAL.test(e.path)).sort(bySize)
  const secondary = rest.filter((e) => LOW_SIGNAL.test(e.path)).sort(bySize)

  return [...entryPoints, ...primary, ...secondary].slice(0, MAX_FILES)
}

export async function fetchRepoSnapshot(owner: string, repo: string): Promise<RepoSnapshot> {
  let meta: { description: string | null; language: string | null; default_branch: string; private: boolean }
  try {
    meta = await gh(`/repos/${owner}/${repo}`)
  } catch (err: any) {
    if (err?.statusCode === 404) {
      throw createError({
        statusCode: 404,
        statusMessage: `Couldn't find ${owner}/${repo}. Check the URL — private repos aren't supported.`,
      })
    }
    throw err
  }

  const [readme, tree] = await Promise.all([
    gh<{ content: string }>(`/repos/${owner}/${repo}/readme`)
      .then((r) => decodeBase64(r.content))
      .catch((err) => {
        if (err?.statusCode === 404) return '' // no README is fine
        throw err
      }),
    gh<{ tree: TreeEntry[]; truncated: boolean }>(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`,
    ).catch((err) => {
      if (err?.statusCode === 404) {
        throw createError({ statusCode: 422, statusMessage: `${owner}/${repo} appears to be empty.` })
      }
      throw err
    }),
  ])

  const selected = selectFiles(tree.tree)
  if (selected.length === 0) {
    throw createError({
      statusCode: 422,
      statusMessage: `No readable source files found in ${owner}/${repo}.`,
    })
  }

  const files = await Promise.all(
    selected.map(async (f) => {
      const path = f.path.split('/').map(encodeURIComponent).join('/')
      // raw.githubusercontent.com doesn't count against the 60/hour API limit; fall back to the API if it fails.
      const raw = await fetch(`${RAW}/${owner}/${repo}/${meta.default_branch.split('/').map(encodeURIComponent).join('/')}/${path}`).catch(() => null)
      if (raw?.ok) return { path: f.path, content: await raw.text() }
      const res = await gh<{ content: string }>(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(meta.default_branch)}`)
      return { path: f.path, content: decodeBase64(res.content) }
    }),
  )

  const treePaths = tree.tree.filter((e) => e.type === 'blob' && !SKIP_PATH.test(e.path)).map((e) => e.path)

  return {
    owner,
    repo,
    description: meta.description,
    language: meta.language,
    readme: readme.slice(0, MAX_README_CHARS),
    tree: treePaths.slice(0, MAX_TREE_PATHS),
    files,
  }
}

export function buildCodeContext(s: RepoSnapshot): string {
  const parts = [
    `# Repository: ${s.owner}/${s.repo}`,
    s.description ? `Description: ${s.description}` : '',
    s.language ? `Primary language: ${s.language}` : '',
    '',
    '## README',
    s.readme || '(no README)',
    '',
    '## File tree',
    s.tree.join('\n'),
    '',
    '## Source files',
    ...s.files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``),
  ]
  return parts.join('\n')
}
