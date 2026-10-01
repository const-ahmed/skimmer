# Skimmer

Skimmer explains how a public GitHub repository is put together. Paste a repository URL and it reads the code at the latest commit of the default branch, then shows two views:

- **Architecture:** the product's main components, grouped, with the relationships between them as a diagram. Select a component for a plain-language explanation and a link to its most relevant source file.
- **User Flows:** what a person using the analysed application does, step by step, with links to the source behind each step.

Every source link points at the exact commit that was analysed.

## Stack

- TanStack Start, React and TypeScript
- Tailwind CSS v4 and shadcn/ui
- React Flow with ELK for the Architecture diagram
- Cloudflare Workers
- Anthropic Claude (Opus 5.5) through Cloudflare AI Gateway for the analysis
- Zod for structured model output and validation

## Requirements

- Node.js 22 or later
- A GitHub token with read access to public repositories
- A Cloudflare account with an AI Gateway that has an Anthropic API key stored in it
- A Cloudflare Turnstile widget for the site's hostname

## Environment variables

Create a `.env` file in the project root (it is git-ignored). The Cloudflare tooling loads it for local development.

| Name | Purpose |
|---|---|
| `GITHUB_API_TOKEN` | GitHub API access. A fine-grained token with public-repository read access is enough. |
| `CF_AIG_TOKEN` | Authentication token for the AI Gateway. |
| `TURNSTILE_SECRET` | Turnstile secret key, used to verify each analysis request. |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile site key. Public, and read at build time. |

The account ID and gateway name are set in `wrangler.jsonc`. When deploying, set the first three as Worker secrets with `wrangler secret put`, and `VITE_TURNSTILE_SITE_KEY` as a build variable.

## Run locally

```sh
npm install
npm run dev
```

The app runs at http://localhost:3000.

## Build

```sh
npm run typecheck
npm run build
npm run check:worker   # build, then wrangler deploy --dry-run
```

## Notes and limitations

- Public repositories only. Each analysis reads a bounded selection of source files, so very large repositories are summarised from their most relevant parts.
- An analysis typically takes from several seconds to a couple of minutes.
- Results are not stored. Each analysis is fresh and can be exported as JSON from the result page.
- Each analysis needs a Turnstile check and is rate-limited per IP address. Configure a rate limit on the AI Gateway as well, as a global spending guard.
- Deploying requires the Cloudflare Workers Paid plan, because one analysis makes more than 50 subrequests.

## Licence and attribution

Third-party code and its licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
