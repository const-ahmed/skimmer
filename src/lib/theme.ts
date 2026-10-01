export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'skimmer-theme'

/**
 * Runs in <head> before first paint so a returning user who chose dark never
 * sees a light flash. Light is the default; the OS preference is not followed.
 */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')document.documentElement.classList.add('dark')}catch(e){}`

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
}
