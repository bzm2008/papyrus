import { invoke } from '@tauri-apps/api/core'

export type McpSearchResult = {
  source: string
  excerpt: string
}

export async function searchExternalKnowledge(query: string): Promise<McpSearchResult[]> {
  try {
    const results = await invoke<string[]>('mcp_search', { query })

    return results.map((excerpt, index) => ({
      source: index === 0 ? 'Obsidian MCP / Notion MCP 预留' : `MCP Source ${index + 1}`,
      excerpt,
    }))
  } catch {
    return [
      {
        source: 'MCP 预留通道',
        excerpt: '当前运行在浏览器预览或尚未连接外部 MCP Server，已跳过外部知识库检索。',
      },
    ]
  }
}

export function shouldUseExternalKnowledge(prompt: string) {
  return /@|资料|来源|出处|检索|知识库|Obsidian|Notion|设定|人物|事实/.test(prompt)
}
