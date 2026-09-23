import DOMPurify from 'dompurify'

/**
 * Turns whatever electron-updater / GitHub handed us into sanitized HTML
 * suitable for the update dialog.
 *
 * Release notes arrive as markdown, HTML, or an array of { version, note }.
 * Dumping any of those straight into innerHTML is why the dialog looked
 * unpadded and why links kept the browser's blue/purple defaults.
 */

export function normalizeReleaseNotes(raw: unknown): string {
  if (raw == null) return ''

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && typeof (item as { note?: unknown }).note === 'string') {
          const { version, note } = item as { version?: string; note: string }
          return version ? `## ${version}\n\n${note}` : note
        }
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
  }

  return String(raw)
}

function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function markdownToHtml(markdown: string): string {
  const lines = escapeHtml(markdown.replace(/\r\n/g, '\n')).split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }

    if (/^---+$/.test(line.trim())) {
      out.push('<hr />')
      i += 1
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i += 1
      continue
    }

    if (/^[*-]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[*-]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^[*-]\s+/, ''))}</li>`)
        i += 1
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ''))}</li>`)
        i += 1
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    const para: string[] = []
    while (
      i < lines.length
      && lines[i].trim()
      && !/^(#{1,3})\s+/.test(lines[i])
      && !/^[*-]\s+/.test(lines[i])
      && !/^\d+\.\s+/.test(lines[i])
      && !/^---+$/.test(lines[i].trim())
    ) {
      para.push(inline(lines[i]))
      i += 1
    }
    out.push(`<p>${para.join('<br />')}</p>`)
  }

  return out.join('')
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (
      _match,
      label: string,
      href: string
    ) => `<a href="${href}">${label}</a>`)
    .replace(/(^|[^"'>=])(https?:\/\/[^\s<]+)/g, (
      _match,
      prefix: string,
      href: string
    ) => {
      const cleaned = href.replace(/[.,;:)]+$/, '')
      const trailing = href.slice(cleaned.length)
      return `${prefix}<a href="${cleaned}">${cleaned}</a>${trailing}`
    })
}

function addLinkTargets(html: string): string {
  return html.replace(/<a\s+/gi, '<a target="_blank" rel="noopener noreferrer" ')
}

export function releaseNotesToHtml(raw: unknown): string {
  const text = normalizeReleaseNotes(raw).trim()
  if (!text) return ''

  const html = looksLikeHtml(text) ? text : markdownToHtml(text)
  const cleaned = typeof window === 'undefined'
    ? html
    : DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel']
    })
  return addLinkTargets(cleaned)
}
