import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { localizationOptions, translate } from '../../shared/localization'
import type { AppLocale } from '../../shared/preferences'
export const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({ ...localizationOptions('zh-Hant'), react: { useSuspense: false } })
export const tr = (source: string | null | undefined, values?: Record<string, unknown>) => translate(i18n, source, values)
export const uiLocale = (): AppLocale => i18n.language as AppLocale
export async function changeLocale(locale: AppLocale) { await i18n.changeLanguage(locale); document.documentElement.lang = locale }
