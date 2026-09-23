import { describe, expect, it } from 'vitest'
import { normalizeReleaseNotes, releaseNotesToHtml } from '../src/lib/utils/formatReleaseNotes'

describe('normalizeReleaseNotes', () => {
  it('joins electron-updater note arrays into markdown', () => {
    expect(normalizeReleaseNotes([
      { version: '2.8.2', note: 'Fix cert install' },
      { version: '2.8.1', note: 'Linux icon' }
    ])).toBe('## 2.8.2\n\nFix cert install\n\n## 2.8.1\n\nLinux icon')
  })

  it('returns an empty string for missing notes', () => {
    expect(normalizeReleaseNotes(null)).toBe('')
    expect(normalizeReleaseNotes(undefined)).toBe('')
  })
})

describe('releaseNotesToHtml', () => {
  it('typesets a GitHub-style markdown release body', () => {
    const html = releaseNotesToHtml(
      'Release v2.8.2\n\n## What\'s Changed\n\n* Fix Local Certificate Installation and detection bug\n* See https://github.com/bsv-blockchain/bsv-desktop/pull/76\n'
    )

    expect(html).toContain('<h2>What\'s Changed</h2>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>Fix Local Certificate Installation and detection bug</li>')
    expect(html).toContain('href="https://github.com/bsv-blockchain/bsv-desktop/pull/76"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('typesets a GitHub body when the heading sits directly above the list', () => {
    const html = releaseNotesToHtml(
      'Release v2.8.2\n\n## What\'s Changed\n* Fix Local Certificate Installation and detection bug\n'
    )

    expect(html).toContain('<p>Release v2.8.2</p>')
    expect(html).toContain('<h2>What\'s Changed</h2>')
    expect(html).toContain('<ul><li>Fix Local Certificate Installation and detection bug</li></ul>')
  })

  it('keeps existing HTML and forces safe link targets', () => {
    const html = releaseNotesToHtml(
      '<p>Read the <a href="https://docs.bsvblockchain.org">docs</a>.</p>'
    )

    expect(html).toContain('href="https://docs.bsvblockchain.org"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('<p>Read the')
  })

  it('renders markdown links and bold', () => {
    const html = releaseNotesToHtml('See [the changelog](https://example.com/notes) for **breaking** changes.')

    expect(html).toContain('<a target="_blank" rel="noopener noreferrer" href="https://example.com/notes">the changelog</a>')
    expect(html).toContain('<strong>breaking</strong>')
  })
})
