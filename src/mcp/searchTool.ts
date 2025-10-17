import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { SearchService } from '../services/searchService';

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
      const { query, limit, site } = args;
      const results = await searchService.search(query, limit, site);
      return { ok: true, results };
    } catch (err) {
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