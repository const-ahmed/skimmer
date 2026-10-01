import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleAnalyseRequest } from '@/server/http/analyse-handler'

export const Route = createFileRoute('/api/analyse')({
  server: {
    handlers: {
      POST: ({ request }) => handleAnalyseRequest(request, env),
      GET: () => new Response(null, { status: 405, headers: { Allow: 'POST' } }),
    },
  },
})
