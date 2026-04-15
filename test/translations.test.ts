/**
 * Translation Coverage Tests
 *
 * Ensures every English key in translations.ts exists in all 9 other
 * supported languages. Run as part of `npm run test` before releases.
 */

import { describe, test, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const TRANSLATIONS_PATH = path.resolve(__dirname, '../src/lib/i18n/translations.ts')

const SUPPORTED_LANGUAGES = ['es', 'fr', 'pt', 'zh', 'hi', 'bn', 'ar', 'ru', 'id']

/**
 * Parse all key-value pairs from a single language section of translations.ts.
 * Handles both single-quoted and double-quoted string values.
 */
function extractKeys(section: string): Set<string> {
  const keys = new Set<string>()
  // Match lines of the form:    some_key: 'value', or    some_key: "value",
  const singleQuote = /^\s{4}(\w+): '(?:[^'\\]|\\.)*',?\s*$/gm
  const doubleQuote = /^\s{4}(\w+): "(?:[^"\\]|\\.)*",?\s*$/gm
  for (const re of [singleQuote, doubleQuote]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(section)) !== null) {
      keys.add(m[1])
    }
  }
  return keys
}

/**
 * Split translations.ts into per-language sections.
 * Returns a map of language code → raw section text.
 */
function parseSections(source: string): Map<string, string> {
  const sections = new Map<string, string>()

  // Find every "const <lang> = {" declaration
  const sectionStarts = [...source.matchAll(/\nconst ([a-z]{2}) = \{/g)]

  for (let i = 0; i < sectionStarts.length; i++) {
    const match = sectionStarts[i]
    const lang = match[1]
    const start = match.index! + 1 // skip the leading \n
    const end =
      i + 1 < sectionStarts.length
        ? sectionStarts[i + 1].index! + 1
        : source.indexOf('\nconst supportedLanguages')

    sections.set(lang, source.slice(start, end))
  }

  return sections
}

// ── Load and parse translations.ts once ──────────────────────────────────────

const source = fs.readFileSync(TRANSLATIONS_PATH, 'utf-8')
const sections = parseSections(source)

const enKeys = extractKeys(sections.get('en') ?? '')

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('translations.ts structure', () => {
  test('English section is non-empty', () => {
    expect(enKeys.size).toBeGreaterThan(0)
  })

  test('all supported languages have a section', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(sections.has(lang), `Missing section for language: ${lang}`).toBe(true)
    }
  })
})

describe('translation coverage', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    test(`${lang} contains every English key`, () => {
      const langKeys = extractKeys(sections.get(lang) ?? '')

      const missing = [...enKeys].filter((k) => !langKeys.has(k))

      expect(
        missing,
        `${lang} is missing ${missing.length} key(s):\n  ${missing.join('\n  ')}`
      ).toHaveLength(0)
    })
  }
})

describe('translation completeness', () => {
  test('no language has keys that do not exist in English (stale keys)', () => {
    const stale: string[] = []

    for (const lang of SUPPORTED_LANGUAGES) {
      const langKeys = extractKeys(sections.get(lang) ?? '')
      for (const key of langKeys) {
        if (!enKeys.has(key)) {
          stale.push(`${lang}.${key}`)
        }
      }
    }

    expect(
      stale,
      `Found ${stale.length} stale key(s) not present in English:\n  ${stale.join('\n  ')}`
    ).toHaveLength(0)
  })
})
