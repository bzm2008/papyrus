import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions,
} from 'docx'

export async function exportWordDocument(title: string, html: string, fallbackText: string) {
  const safeTitle = sanitizeFileName(title || 'papyrus-article')
  const sections = html.trim() ? parseHtmlToParagraphs(html) : parsePlainText(fallbackText)
  const paragraphs = sections.length ? sections : parsePlainText(fallbackText || title)

  const wordDocument = new Document({
    creator: 'Papyrus',
    title,
    description: 'Papyrus manuscript export',
    sections: [
      {
        properties: {},
        children: paragraphs.map((paragraph) => new Paragraph(paragraph)),
      },
    ],
  })

  const blob = await Packer.toBlob(wordDocument)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeTitle}.docx`
  link.click()
  URL.revokeObjectURL(url)
}

function parseHtmlToParagraphs(html: string): IParagraphOptions[] {
  const dom = new DOMParser().parseFromString(html, 'text/html')
  const nodes = Array.from(dom.body.children)

  if (!nodes.length) {
    return parsePlainText(dom.body.textContent ?? '')
  }

  return nodes
    .flatMap((node) => nodeToParagraphs(node))
    .filter((paragraph) => paragraph.children?.length || paragraph.text)
}

function nodeToParagraphs(node: Element): IParagraphOptions[] {
  const tagName = node.tagName.toLowerCase()
  const text = normalizeText(node.textContent ?? '')

  if (!text) {
    return []
  }

  if (tagName === 'h1') {
    return [{ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, bold: true })] }]
  }

  if (tagName === 'h2') {
    return [{ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true })] }]
  }

  if (tagName === 'h3') {
    return [{ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text, bold: true })] }]
  }

  if (tagName === 'ul' || tagName === 'ol') {
    return Array.from(node.querySelectorAll('li')).map((item) => ({
      bullet: tagName === 'ul' ? { level: 0 } : undefined,
      numbering: tagName === 'ol' ? { reference: 'default-numbering', level: 0 } : undefined,
      children: [new TextRun(normalizeText(item.textContent ?? ''))],
    }))
  }

  return [{ children: [new TextRun(text)] }]
}

function parsePlainText(text: string): IParagraphOptions[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => normalizeText(paragraph))
    .filter(Boolean)
    .map((paragraph) => ({ children: [new TextRun(paragraph)] }))
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'papyrus-article'
}
