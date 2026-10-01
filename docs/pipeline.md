# Analysis pipeline

`analyseRepository(url, deps, { signal, onProgress })` in `src/server/analysis/run.ts` is the whole analysis. It is ordinary application logic: HTTP, SSE and persistence sit outside it.

```
GitHub URL
→ parse and validate owner/repo                       shared/github-url.ts
→ repository metadata, reject non-public              github/snapshot.ts
→ default branch → exact commit SHA
→ recursive tree of that commit (+ truncation fill-in)
→ tsconfig/jsconfig path mappings                     repository/tsconfig-paths.ts
→ UI surface: file-based pages + code-defined routes  user-flow/surface.ts, user-flow/routes.ts
→ Architecture retrieval  ┐ in parallel,              architecture/retrieval.ts, repository/tree.ts
→ User Flow retrieval     ┘ one shared source store   user-flow/retrieval.ts
→ Architecture call       ┐ in parallel               ai/index.ts
→ User Flow call          ┘ (skipped with no UI surface)
→ deterministic validation and repair per view        architecture/validate.ts, user-flow/validate.ts
→ primary source per architecture node                architecture/source.ts
→ at most one narrow model repair per view, only if still structurally invalid
→ AnalysisResult
```

`POST /api/analyse` (`server/http/analyse-handler.ts`) guards the request, then streams `progress` events and a final `result` or `error` over SSE. Streaming is used because two model calls plus ingestion routinely take tens of seconds.

## Immutable commit handling

- The default branch is resolved once to a commit SHA (`GET /repos/{o}/{r}/commits/{branch}` with the `sha` media type).
- The tree is read by that SHA. When GitHub truncates it, folders with nothing listed are read by their own tree SHAs, which are immutable.
- Every file is read from `raw.githubusercontent.com/{o}/{r}/{commitSha}/{path}`, and its bytes must hash to the tree's Git blob SHA (Web Crypto SHA-1/SHA-256). Anything else is rejected as `blob-mismatch`.
- `SourceFile`, evidence scopes and the result all carry the commit SHA. A push during the analysis cannot mix versions.

## Source selection

Every limit is in `analysis/limits.ts`.

1. **Import resolution.** Up to 8 tsconfig/jsconfig files are loaded, chosen by how many JS/TS files each governs (the nearest config to a file governs it, as in TypeScript). Their real `paths`, `baseUrl` and in-repository `extends` resolve aliases such as `@/…` and `src/…`, each file through its own package's config. Unknown imports stay unresolved.
2. **Filtering.** Dependency and cache folders, binary assets, lockfiles and minified files are dropped from the snapshot. Submodules, symlinks and sensitive files (`.env*`, keys, credentials) are recorded as skipped and never read. Tests, examples, docs, fixtures and build output are excluded from architecture ranking.
3. **Ranking.** Name-based scores reward entry points, routes, handlers, services and pipelines. They penalise helpers, logging and scripts. A soft directory and area diversity penalty stops one folder from taking every slot. At most one manifest is included.
4. **First read.** The top excerpt candidates plus the next ranked files.
5. **Second read.** Unread files that the first-round files import most often. This is dependency-informed, which name ranking cannot be.
6. **Excerpt choice.** Files other read files connect through win excerpt slots. Isolated files give theirs up.
7. **Core modules.** Files many others depend on, or large ones, excluding declarations and re-export barrels.
8. **SOURCE INDEX.** An application-generated list of every file read, how it was used, and its static references as `path:line`, plus important unread files.
9. **Representative tree.** The tree listing shares a fixed character budget across repository areas: workspace packages in a monorepo, otherwise top-level folders. Each area's root line is shown first, then space is shared by √(runtime source files), and within an area directories come before leaf files. Docs, tooling and other areas with no runtime source only get what is left. A tree that fits the budget is listed whole.

## Line-aware excerpts and evidence

- Every line sent to the model is rendered as `N | text` with its real line number. Gaps are stated explicitly (`[lines 9-39 not shown]`), and complete files are numbered from line 1. Lines over 400 characters are cut for display only; their numbers are unchanged.
- The exact line ranges shown per file are recorded in an `EvidenceScope`.
- The model returns evidence only as `{ path, startLine, endLine, symbol }`. Links are built by the application: `https://github.com/{owner}/{repo}/blob/{commitSha}/{path}#L{start}-L{end}` (`shared/evidence-links.ts`).
- Evidence is accepted only if all of these hold:
  - the path is a normalised relative path, not a URL and not escaping the root;
  - the path exists in the snapshot;
  - the file was shown to *that* analysis;
  - the lines are integers with `1 ≤ start ≤ end ≤ lineCount`;
  - **every cited line was shown to the model.**
- A range that reaches into unshown lines is rejected, never clamped or split.
- A `symbol` is kept only if it appears in the cited lines.
- Static-reference evidence is derived without the model. Each file belongs to the node with the most specific `primaryPath` containing it, so a broad directory node never claims files of a nested node. When a file owned by an edge's `from` node imports a file owned by its `to` node, the import line is attached with `origin: "static-reference"`.
- Validation proves provenance, not truth. A valid range shows where a claim came from, not that the claim is correct.

## Architecture output

The prompt is product-first: the model records the product's major capabilities before choosing components, treats README and tree as architecture evidence, folds hooks, helpers and other sampled implementation details into the subsystem they belong to, and attaches evidence last. Groups describe product subsystems; nodes may point at a file or a directory.

Each node carries:
- `label` and a one-sentence `summary`, for compact displays;
- `explanation`: about 3–4 plain sentences on what the component is, its role in the product and how it relates to the parts around it (conceptual, not a code walkthrough);
- `support`: `cited` (shown source lines), `documented` (README only) or `structural` (known from the tree and paths, no line evidence);
- `evidence`: validated source coordinates;
- `source`: one primary source target chosen by the application, with a commit-pinned GitHub link (`blob/` for files, `tree/` for directories).

`source` is chosen in this order (`architecture/source.ts`), a file always preferred to a directory:
1. the first cited range in a shown source file that the node owns;
2. the first file the node owns that the analysis read;
3. `primaryPath`, when it is a file;
4. the best-ranked source file the node owns inside its directory (architecture path ranking);
5. the first cited range elsewhere (e.g. a root manifest line);
6. the directory itself;
7. none, for external actors and services or a node with no path.

Edge `support`:
- `cited`: the model cited shown source lines.
- `static-reference`: an import at an exact line.
- `documented`: README only.
- `inferred`: no evidence; a renderer should mark it as unverified.

## Architecture vs User Flow

| | Architecture | User Flow |
|---|---|---|
| Question | What are the parts and how do they relate? | What does a person do and experience? |
| Retrieval | Repository-wide ranking, dependency-informed second read | Pages and routes → first-level child components → only the endpoints they visibly call |
| Output | Capabilities, groups, nodes (summary, explanation, primary source), edges with support level | Flows of human steps (`navigate`, `view`, `input`, `action`, `feedback`, `result`) |
| No surface | n/a | No model call; `status: "no-user-facing-surface"` |

User Flow is not derived from the Architecture graph. Its retrieval reads UI files that Architecture ranking usually skips. Endpoint URLs found in source (`fetch("/api/x")`, form actions) are matched to repository route files by string; they are never requested.

### Finding pages

- **File-based routers:** Next.js, SvelteKit, TanStack Router, React Router/Remix, Nuxt, Astro, Expo Router; plus `pages/`, `views/` and `screens/` folders in UI projects (hooks, components and helpers inside them excluded), server-rendered templates and a static `index.html`.
- **Code-defined routes** (`user-flow/routes.ts`), only in packages that depend on React Router, Vue Router or Angular Router: `<Route path=… element=…>`, route objects (`path` with `element`, `component`, `Component`, `loadComponent`) and lazy imports are matched as strings in router files. Each route's page is resolved through the file's imports; wrappers (`…Layout`, `…Loader`, `…Routes`, `fallback=` props) are skipped. A path that is a constant (`AppPath.Home`) is looked up in the file defining it; anything unresolvable stays `null`.

### Choosing pages

Pages are picked by score while spreading them across product areas (the first folder under the nearest `pages`/`views`/`screens`/`routes`/`app`/`modules` directory): each page already taken from an area lowers the next one from it. Sign-in, sign-up, onboarding, invitation, verification and password pages are capped at a quarter of the page slots and otherwise only fill slots nothing else can use. Pages rendered by code routes rank ahead of unrouted component files.

## Model calls

Normal lifecycle: one Architecture call, plus one User Flow call when a UI surface exists. The two run in parallel. A repair call happens only when output is still structurally invalid after deterministic repair (conflicting duplicate ids, mostly dangling edges, limits exceeded, invalid JSON). The repair is given only the previous output, the issues and the allowed paths, never repository source. There are no retries and no latency-triggered duplicates, so the worst case is four calls.

Calls go through Cloudflare AI Gateway (`ai/claude.ts`). The Anthropic key is stored in the gateway, and the Worker sends only `cf-aig-authorization`. Token usage for every call is returned in `diagnostics.modelCalls` and logged as `ai.call`, so cost can be measured.

## Abuse and safety controls

- **Request:** same-origin (`Origin` + `Sec-Fetch-Site`), JSON only, 2 KB body limit, strict schema, per-IP Workers rate limit (3 per minute per location).
- **Global cap:** configure a rate limit on the AI Gateway itself. It is global, unlike the per-location Workers limiter.
- **Bounds:** file size, README size, total bytes read, file counts, prompt character budgets, per-request GitHub timeouts, a source-read deadline, a model timeout and an overall analysis deadline.
- **Network:** only application-built GitHub URLs and the gateway URL are fetched. Redirects are never followed.
- **Hostile content:**
  - Repository content is wrapped and line-prefixed, so it cannot forge prompt blocks. Paths containing `<` or `>` are dropped.
  - Prompts state that repository text is data.
  - URLs in model prose are stripped.
  - Upstream error bodies never reach clients.

## Known limitations

- Static references are regex-based imports and type names. Dynamic imports built at runtime, HTTP calls between services, events, DI containers and configuration wiring are not detected.
- `package.json` `imports` (`#/…`) and path aliases from bundler configs other than tsconfig/jsconfig are not resolved. Only 8 tsconfig/jsconfig files are loaded, so small packages in very large monorepos may keep unresolved aliases.
- Dependency-following favours the most-imported files, which in some codebases are types and entities, and it does not reach every capability module. Such modules usually appear as `structural` nodes with inferred edges.
- A node's primary source from rule 2 is a file of that component the analysis happened to read, not necessarily its most central file.
- User Flow surface detection covers the file-based routers and code-route patterns above. Native mobile and desktop apps, and routers declared in other ways, return no User Flows. Screens that only delegate to child components carry little interaction signal and can lose their slot to form-heavy screens in the same area. Marketing sites that preview the product can contribute pages.
- Excerpt selection is heuristic. A relevant line can be left out, and evidence can only cite what was shown.
- The Workers rate limiter is per location and approximate.
- Limits have not been benchmarked.
- Very large trees are bounded by GitHub's truncation and the fill-in limit.

## Adding persistence later

`analyseRepository` needs nothing stored and returns a self-contained `AnalysisResult` keyed by `(owner, repo, commitSha)`. A cache or database can wrap it without changing it:

1. Resolve the commit SHA (cheap).
2. Look up an existing result for that SHA.
3. Otherwise call `analyseRepository` and store the result.

Source bodies are never part of the result, so nothing repository-authored beyond model output and paths would be stored.

## Third-party code

See `THIRD_PARTY_NOTICES.md`.
