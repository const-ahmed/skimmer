import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { applyTheme, currentTheme, type Theme } from '@/lib/theme'

export function ThemeToggle() {
  // The real theme is only known in the browser; render as light until mounted.
  const [theme, setTheme] = useState<Theme>('light')
  useEffect(() => setTheme(currentTheme()), [])
  const next: Theme = theme === 'dark' ? 'light' : 'dark'

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      className="shadow-none"
      onClick={() => {
        applyTheme(next)
        setTheme(next)
      }}
    >
      {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  )
}
