export type InlineCompletionRequest = {
  prefix: string
  suffix: string
  signal?: AbortSignal
}

type OllamaGenerateResponse = {
  response?: string
}

type OpenAICompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
    text?: string
  }>
}

export async function requestInlineCompletion({
  prefix,
  suffix,
  signal,
}: InlineCompletionRequest) {
  const endpoint =
    import.meta.env.VITE_PAPYRUS_AUTOCOMPLETE_ENDPOINT?.trim() ||
    'http://localhost:11434/api/generate'
  const model = import.meta.env.VITE_PAPYRUS_AUTOCOMPLETE_MODEL?.trim() || 'qwen2.5:7b'
  const prompt = buildCompletionPrompt(prefix, suffix)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify(
        endpoint.includes('/chat/completions')
          ? {
              model,
              messages: [
                {
                  role: 'system',
                  content:
                    '你是 Papyrus 的极速散文补全器。只返回光标后的续写文本，不要解释。',
                },
                { role: 'user', content: prompt },
              ],
              max_tokens: 80,
              temperature: 0.35,
              stream: false,
            }
          : {
              model,
              prompt,
              stream: false,
              options: {
                temperature: 0.35,
                num_predict: 80,
              },
            },
      ),
    })

    if (!response.ok) {
      return ''
    }

    const payload = (await response.json().catch(() => ({}))) as
      | OllamaGenerateResponse
      | OpenAICompatibleResponse
    const text = isOllamaResponse(payload)
      ? payload.response
      : payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text

    return cleanCompletion(text || '')
  } catch {
    return ''
  }
}

function isOllamaResponse(
  payload: OllamaGenerateResponse | OpenAICompatibleResponse,
): payload is OllamaGenerateResponse {
  return 'response' in payload
}

function buildCompletionPrompt(prefix: string, suffix: string) {
  return [
    '请根据光标前后的中文散文语境，预测光标后最自然的短句续写。',
    '要求：只输出续写文本；不要重复光标前文本；长度控制在 8 到 60 个中文字符。',
    `光标前：\n${prefix.slice(-1600)}`,
    `光标后：\n${suffix.slice(0, 500)}`,
  ].join('\n\n')
}

function cleanCompletion(text: string) {
  return text
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}
