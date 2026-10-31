import i18next, { type i18n as I18n, type InitOptions } from 'i18next'
import { messages } from './locales/messages.ts'
import type { AppLocale } from './preferences.ts'

const resources = Object.fromEntries((['zh-Hant', 'zh-Hans', 'en'] as const).map(locale => [locale, { translation: Object.fromEntries(Object.entries(messages).map(([source, translations]) => [source, locale === 'zh-Hant' ? source : translations[locale]])) }]))
export function localizationOptions(locale: AppLocale): InitOptions { return { resources, lng: locale, fallbackLng: 'zh-Hant', supportedLngs: ['zh-Hant', 'zh-Hans', 'en'], load: 'currentOnly', keySeparator: false, nsSeparator: false, initAsync: false, interpolation: { escapeValue: false } } }
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const patterns = Object.keys(messages).filter(key => /{{v\d+}}/.test(key)).map(key => ({ key, regex: new RegExp('^' + key.split(/{{v\d+}}/).map(escape).join('([\\s\\S]*?)') + '$') }))
/** Only application-authored presentation text. Never apply to chat, names, maps or commands. */
export function translate(i18n: I18n, source: string | null | undefined, values?: Record<string, unknown>): string {
  if (!source) return ''
  if (Object.hasOwn(messages, source)) return String(i18n.t(source, values ?? {}))
  if (source.length <= 4096) for (const { key, regex } of patterns) {
    const match = regex.exec(source)
    if (match) return String(i18n.t(key, Object.fromEntries(match.slice(1).map((value, index) => [`v${index}`, value]))))
  }
  return source
}

const nativeInstances = new Map<AppLocale, I18n>()
export function localize(locale: AppLocale, source: string, values?: Record<string, unknown>) {
  let instance = nativeInstances.get(locale)
  if (!instance) { instance = i18next.createInstance(); void instance.init(localizationOptions(locale)); nativeInstances.set(locale, instance) }
  return translate(instance, source, values)
}
