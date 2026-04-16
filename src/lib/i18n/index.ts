import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources, supportedLanguages } from './translations'

const STORAGE_KEY = 'bsv-desktop-language'

function detectLanguage(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && supportedLanguages.includes(stored)) {
    return stored
  }
  const browserLang = navigator.language?.split('-')[0]
  if (browserLang && supportedLanguages.includes(browserLang)) {
    return browserLang
  }
  return 'en'
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  })

export { STORAGE_KEY, supportedLanguages }
export default i18n
