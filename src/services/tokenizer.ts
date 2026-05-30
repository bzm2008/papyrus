import { Tiktoken } from 'js-tiktoken/lite'
import cl100kBase from 'js-tiktoken/ranks/cl100k_base'

const tokenizer = new Tiktoken(cl100kBase)

export function estimateTokens(text: string) {
  const normalized = text.trim()

  if (!normalized) {
    return 0
  }

  try {
    return tokenizer.encode(normalized).length
  } catch {
    return Math.ceil(normalized.length / 3)
  }
}
