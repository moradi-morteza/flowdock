export type ThemeId = 'midnight' | 'graphite' | 'ocean' | 'oled' | 'light'
export type AccentId = 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose'
export type FontId = 'segoe' | 'vazir' | 'tahoma' | 'mono'

export interface AppearanceSettings {
  theme: ThemeId
  accent: AccentId
  font: FontId
  fontSize: number
  glass: boolean
  motion: boolean
}

export const themePresets: Array<{ id: ThemeId; label: string; panel: string; surface: string }> = [
  { id: 'midnight', label: 'Midnight', panel: '11 14 20', surface: '18 23 33' },
  { id: 'graphite', label: 'Graphite', panel: '22 22 25', surface: '31 31 35' },
  { id: 'ocean', label: 'Deep ocean', panel: '6 18 25', surface: '10 31 41' },
  { id: 'oled', label: 'OLED', panel: '0 0 0', surface: '13 13 15' },
  { id: 'light', label: 'Light', panel: '226 232 240', surface: '255 255 255' }
]

export const accentPresets: Array<{ id: AccentId; label: string; rgb: string; secondary: string; hex: string }> = [
  { id: 'cyan', label: 'Cyan', rgb: '34 211 238', secondary: '99 102 241', hex: '#22d3ee' },
  { id: 'violet', label: 'Violet', rgb: '167 139 250', secondary: '236 72 153', hex: '#a78bfa' },
  { id: 'emerald', label: 'Emerald', rgb: '52 211 153', secondary: '20 184 166', hex: '#34d399' },
  { id: 'amber', label: 'Amber', rgb: '251 191 36', secondary: '249 115 22', hex: '#fbbf24' },
  { id: 'rose', label: 'Rose', rgb: '251 113 133', secondary: '168 85 247', hex: '#fb7185' }
]

export const fontPresets: Array<{ id: FontId; label: string; stack: string }> = [
  { id: 'segoe', label: 'Segoe UI', stack: '"Segoe UI Variable", "Segoe UI", sans-serif' },
  { id: 'vazir', label: 'Vazirmatn', stack: '"Vazirmatn Variable", "Vazirmatn", Tahoma, sans-serif' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, "Segoe UI", sans-serif' },
  { id: 'mono', label: 'Consolas', stack: 'Consolas, "Cascadia Mono", monospace' }
]

export const defaultAppearance: AppearanceSettings = {
  theme: 'midnight',
  accent: 'cyan',
  font: 'segoe',
  fontSize: 100,
  glass: true,
  motion: true
}

const STORAGE_KEY = 'flowdock:appearance:v1'

export function loadAppearance(): AppearanceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Partial<AppearanceSettings>
    return {
      ...defaultAppearance,
      ...saved,
      fontSize: Math.max(85, Math.min(120, Number(saved.fontSize) || defaultAppearance.fontSize))
    }
  } catch {
    return defaultAppearance
  }
}

export function applyAppearance(settings: AppearanceSettings): void {
  const root = document.documentElement
  const theme = themePresets.find((item) => item.id === settings.theme) ?? themePresets[0]
  const accent = accentPresets.find((item) => item.id === settings.accent) ?? accentPresets[0]
  const font = fontPresets.find((item) => item.id === settings.font) ?? fontPresets[0]
  root.style.setProperty('--panel-bg', theme.panel)
  root.style.setProperty('--surface-bg', theme.surface)
  root.style.setProperty('--accent', accent.rgb)
  root.style.setProperty('--accent-2', accent.secondary)
  root.style.setProperty('--app-font', font.stack)
  root.style.setProperty('--font-scale', String(settings.fontSize / 100))
  root.style.setProperty('--panel-opacity', settings.glass ? '0.94' : '1')
  root.style.setProperty('--ring-track', settings.theme === 'light' ? '15 23 42 / 0.12' : '255 255 255 / 0.06')
  root.dataset.motion = settings.motion ? 'on' : 'off'
  root.dataset.theme = settings.theme
  root.style.colorScheme = settings.theme === 'light' ? 'light' : 'dark'
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
