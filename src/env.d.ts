// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
declare namespace Cloudflare {
  interface Env {
    GITHUB_API_TOKEN?: string
    CF_AIG_TOKEN?: string
  }
}
