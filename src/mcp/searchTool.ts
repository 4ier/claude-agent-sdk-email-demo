import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { SearchService } from '../services/searchService';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

export const searchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional().default(5),
  site: z.string().optional(),
});

export function searchHandler(searchService: SearchService) {
  return async (
    args: z.infer<typeof searchInputSchema>,
    _extra: unknown,
  ): Promise<{ ok: boolean; results?: unknown; error?: unknown }> => {
    try {
      log.info({ mcp_tool: 'web_search', stage: 'start', args }, 'MCP tool start');
      const { query, limit, site } = args;
      const results = await searchService.search(query, limit, site);
      const count = Array.isArray(results) ? results.length : undefined;
      log.info({ mcp_tool: 'web_search', stage: 'success', count }, 'MCP tool success');
      return { ok: true, results };
    } catch (err) {
      const error = err instanceof Error ? { message: err.message, stack: err.stack } : { err };
      log.error({ mcp_tool: 'web_search', stage: 'error', error }, 'MCP tool error');
      return { ok: false, error: err };
    }
  };
}

export function createSearchTool(searchService: SearchService) {
  return tool(
    'web_search',
    'Search the web and return top results',
    searchInputSchema.shape,
    searchHandler(searchService),
  );
}