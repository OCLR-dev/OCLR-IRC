export const LANGUAGES = ['system', 'zh-Hans', 'zh-Hant', 'en'] as const
export type LanguagePreference = typeof LANGUAGES[number]
export type AppLocale = Exclude<LanguagePreference, 'system'>
export const CHAT_FONT_SIZES = [10, 12, 14, 16, 18, 20, 22, 24] as const
export type ChatFontSize = typeof CHAT_FONT_SIZES[number]
export interface AppPreferences { closeToBackground: boolean; language: LanguagePreference; restoreIrcLogin: boolean; autoRefreshOclr: boolean; chatFontSize: ChatFontSize }
export interface AppSettings { preferences: AppPreferences; locale: AppLocale; version: string; platform: string; secureStorageAvailable?: boolean }
export const DEFAULT_PREFERENCES: AppPreferences = { closeToBackground: true, language: 'system', restoreIrcLogin: false, autoRefreshOclr: true, chatFontSize: 12 }
export function preferencesInput(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('無效的設定。')
  const data = value as Record<string, unknown>
  const keys = Object.keys(data)
  if (keys.length !== 5 || keys.some(key => !Object.hasOwn(DEFAULT_PREFERENCES, key))
    || typeof data.closeToBackground !== 'boolean' || typeof data.restoreIrcLogin !== 'boolean' || typeof data.autoRefreshOclr !== 'boolean'
    || !LANGUAGES.includes(data.language as LanguagePreference) || !CHAT_FONT_SIZES.includes(data.chatFontSize as ChatFontSize)) throw new Error('無效的設定。')
  return { closeToBackground: data.closeToBackground, language: data.language as LanguagePreference, restoreIrcLogin: data.restoreIrcLogin, autoRefreshOclr: data.autoRefreshOclr, chatFontSize: data.chatFontSize as ChatFontSize }
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
