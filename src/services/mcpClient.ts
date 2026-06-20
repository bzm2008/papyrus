import { invoke } from '@tauri-apps/api/core'
import { useAppStore, type McpServerConfig } from '../stores/useAppStore'

export type McpSearchResult = {
  source: string
  excerpt: string
}

export async function searchExternalKnowledge(query: string): Promise<McpSearchResult[]> {
  const enabledServers = useAppStore.getState().mcpServers.filter((server) => server.enabled)
  const httpServers = enabledServers.filter((server) => server.transport === 'http' && server.endpoint.trim())
  const stdioServers = enabledServers.filter((server) => server.transport === 'stdio')

  try {
    const results = await invoke<string[]>('mcp_search', {
      query,
      servers: httpServers.map(toMcpInvokeConfig),
    })

    const mapped = results.map((excerpt, index) => ({
      source: httpServers[index]?.name || (index === 0 ? 'Papyrus MCP' : `MCP Source ${index + 1}`),
      excerpt,
    }))

    if (stdioServers.length) {
      mapped.push({
        source: 'MCP stdio pending',
        excerpt: `${stdioServers.length} stdio MCP server(s) are saved, but the stdio runtime adapter is not available yet.`,
      })
    }

    return mapped.length ? mapped : fallbackResults(enabledServers)
  } catch (error) {
    return [
      ...fallbackResults(enabledServers),
      {
        source: 'MCP error',
        excerpt: error instanceof Error ? error.message : 'MCP search failed.',
      },
    ]
  }
}

export async function testMcpServer(server: McpServerConfig) {
  if (server.transport === 'stdio') {
    return {
      ok: false,
      status: 'unsupported' as const,
      message: 'stdio MCP servers can be saved, but stdio runtime support is not available yet.',
    }
  }

  if (!server.endpoint.trim()) {
    return { ok: false, status: 'error' as const, message: 'HTTP MCP endpoint is required.' }
  }

  try {
    const results = await invoke<string[]>('mcp_search', {
      query: 'papyrus connectivity check',
      servers: [toMcpInvokeConfig(server)],
    })

    return {
      ok: true,
      status: 'ok' as const,
      message: results[0] || 'MCP connection passed.',
    }
  } catch (error) {
    return {
      ok: false,
      status: 'error' as const,
      message: error instanceof Error ? error.message : '\u004d\u0043\u0050 \u6d4b\u8bd5\u5931\u8d25\u3002',
    }
  }
}

export function shouldUseExternalKnowledge(prompt: string) {
  return /@|\u8d44\u6599|\u6765\u6e90|\u51fa\u5904|\u68c0\u7d22|\u77e5\u8bc6\u5e93|Obsidian|Notion|\u8bbe\u5b9a|\u4eba\u7269|\u4e8b\u5b9e/.test(prompt)
}
function toMcpInvokeConfig(server: McpServerConfig) {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    endpoint: server.endpoint,
    headers: parseKeyValueText(server.headersText),
  }
}

function fallbackResults(servers: McpServerConfig[]): McpSearchResult[] {
  if (!servers.length) {
    return [
      {
        source: 'MCP fallback',
        excerpt: 'No MCP servers are enabled. Secretary mode will continue without external MCP context.',
      },
    ]
  }

  return [
    {
      source: 'MCP fallback',
      excerpt: `${servers.length} MCP server(s) are configured, but no external context was returned.`,
    },
  ]
}

function parseKeyValueText(value: string) {
  return Object.fromEntries(
    value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.includes('=') ? '=' : ':'
        const index = line.indexOf(separator)

        if (index < 0) {
          return [line, '']
        }

        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      })
      .filter(([key]) => key),
  )
}
