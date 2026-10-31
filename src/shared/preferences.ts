export const LANGUAGES = ['system', 'zh-Hans', 'zh-Hant', 'en'] as const
export type LanguagePreference = typeof LANGUAGES[number]
export type AppLocale = Exclude<LanguagePreference, 'system'>
export interface AppPreferences { closeToBackground: boolean; language: LanguagePreference }
export interface AppSettings { preferences: AppPreferences; locale: AppLocale; version: string; platform: string }
export const DEFAULT_PREFERENCES: AppPreferences = { closeToBackground: true, language: 'system' }
export function preferencesInput(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('無效的設定。')
  const data = value as Record<string, unknown>
  if (Object.keys(data).length !== 2 || Object.keys(data).some(key => key !== 'closeToBackground' && key !== 'language') || typeof data.closeToBackground !== 'boolean' || !LANGUAGES.includes(data.language as LanguagePreference)) throw new Error('無效的設定。')
  return { closeToBackground: data.closeToBackground, language: data.language as LanguagePreference }
}
export function resolveLocale(language: LanguagePreference, systemLanguages: readonly string[]): AppLocale {
  if (language !== 'system') return language
  for (const tag of systemLanguages) {
    try {
      const locale = new Intl.Locale(tag.replaceAll('_', '-'))
      if (locale.language === 'zh') return locale.maximize().script === 'Hant' ? 'zh-Hant' : 'zh-Hans'
      if (locale.language === 'en') return 'en'
    } catch { /* Ignore invalid OS locale identifiers. */ }
  }
  return 'en'
}
