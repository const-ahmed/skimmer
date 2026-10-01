import { useEffect, useRef } from 'react'
import { currentTheme } from '@/lib/theme'
import { loadTurnstile } from '@/lib/turnstile'

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

// Tokens are single-use, so each attempt mounts a fresh widget. It stays invisible unless Turnstile needs a click.
export function TurnstileCheck({ onToken, onError }: { onToken: (token: string) => void; onError: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const handlers = useRef({ onToken, onError })
  handlers.current = { onToken, onError }

  useEffect(() => {
    if (!SITE_KEY) {
      handlers.current.onError('Verification is not configured for this site.')
      return
    }
    let widgetId: string | null = null
    let active = true
    loadTurnstile().then(
      (turnstile) => {
        if (!active || !container.current) return
        widgetId = turnstile.render(container.current, {
          sitekey: SITE_KEY,
          theme: currentTheme(),
          size: 'flexible',
          appearance: 'interaction-only',
          callback: (token) => handlers.current.onToken(token),
          'error-callback': () => handlers.current.onError('The verification check failed. Please try again.'),
          'expired-callback': () => handlers.current.onError('The verification check expired. Please try again.'),
          'timeout-callback': () => handlers.current.onError('The verification check timed out. Please try again.'),
        })
      },
      () => active && handlers.current.onError('The verification check could not load. Check your connection and try again.'),
    )
    return () => {
      active = false
      if (widgetId) window.turnstile?.remove(widgetId)
    }
  }, [])

  return <div ref={container} />
}
