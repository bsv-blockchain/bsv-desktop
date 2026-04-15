import React, { createContext, useContext, useState } from 'react'
import i18n, { STORAGE_KEY, supportedLanguages } from './index'

interface LanguageContextType {
  currentLanguage: string
  setCurrentLanguage: (language: string) => void
  supportedLanguages: string[]
}

const LanguageContext = createContext<LanguageContextType>({
  currentLanguage: 'en',
  setCurrentLanguage: () => {},
  supportedLanguages,
})

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentLanguage, setCurrentLanguageState] = useState(i18n.language)

  const setCurrentLanguage = (language: string) => {
    setCurrentLanguageState(language)
    i18n.changeLanguage(language)
    localStorage.setItem(STORAGE_KEY, language)
  }

  return (
    <LanguageContext.Provider value={{ currentLanguage, setCurrentLanguage, supportedLanguages }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = (): LanguageContextType => useContext(LanguageContext)

export const languageNames: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  zh: '中文',
  hi: 'हिन्दी',
  ar: 'العربية',
  pt: 'Português',
  bn: 'বাংলা',
  ru: 'Русский',
  id: 'Bahasa Indonesia',
  ja: '日本語',
  pl: 'Polski',
}
