/**
 * Translation Coverage Tests
 *
 * 1. Ensures every English key in translations.ts exists in all 9 other
 *    supported languages.
 * 2. Ensures every key referenced via t() in source components (including
 *    interpolated calls like t('key', { count })) exists in the English
 *    section of translations.ts.
 *
 * Run as part of `npm run test` before releases.
 */

import { describe, test, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const TRANSLATIONS_PATH = path.resolve(__dirname, '../src/lib/i18n/translations.ts')
const SRC_LIB_PATH = path.resolve(__dirname, '../src/lib')

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
 * Recursively collect all .tsx and .ts files under a directory.
 */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(full))
    } else if (entry.isFile() && /\.(tsx?|ts)$/.test(entry.name)) {
      results.push(full)
    }
  }
  return results
}

/**
 * Collect every key referenced via t('key') or t('key', {...}) in source files.
 */
function extractUsedKeys(srcDir: string): Map<string, string[]> {
  // key -> list of file paths that use it
  const used = new Map<string, string[]>()
  const keyRe = /\bt\('([a-z][a-z_]+)'[\s,)]/g

  for (const file of collectSourceFiles(srcDir)) {
    const content = fs.readFileSync(file, 'utf-8')
    let m: RegExpExecArray | null
    while ((m = keyRe.exec(content)) !== null) {
      const key = m[1]
      if (!used.has(key)) used.set(key, [])
      used.get(key)!.push(path.relative(process.cwd(), file))
    }
  }
  return used
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

describe('component t() calls exist in English translations', () => {
  const usedKeys = extractUsedKeys(SRC_LIB_PATH)

  test('no t() call references a key missing from translations.ts', () => {
    const missing: string[] = []
    for (const [key, files] of usedKeys) {
      if (!enKeys.has(key)) {
        missing.push(`${key} (used in: ${files[0]})`)
      }
    }
    expect(
      missing,
      `${missing.length} key(s) used in components but missing from translations.ts:\n  ${missing.join('\n  ')}`
    ).toHaveLength(0)
  })
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
