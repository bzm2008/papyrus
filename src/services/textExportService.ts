export function exportTextDocument(title: string, text: string) {
  const safeTitle = sanitizeFileName(title || 'papyrus-article')
  const normalized = normalizeText(title, text)
  const blob = new Blob([normalized], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = `${safeTitle}.txt`
  link.click()
  URL.revokeObjectURL(url)
}

function normalizeText(title: string, text: string) {
  const body = text.replace(/\r\n/g, '\n').trim()
  const heading = title.trim()

  if (!heading) {
    return `${body}\n`
  }

  if (body.startsWith(heading)) {
    return `${body}\n`
  }

  return `${heading}\n\n${body}\n`
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'papyrus-article'
}
