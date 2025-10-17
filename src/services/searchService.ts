import { z } from 'zod';

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export interface SearchConfig {
  provider?: 'bing' | 'duckduckgo' | 'wikipedia';
  bingApiKey?: string;
}

export class SearchService {
  constructor(private readonly config: SearchConfig = {}) {}

  async search(query: string, limit = 5, site?: string): Promise<SearchResult[]> {
    const q = site ? `${query} site:${site}` : query;
    const provider = this.config.provider || (this.config.bingApiKey ? 'bing' : 'duckduckgo');
    try {
      if (provider === 'bing' && this.config.bingApiKey) {
        return await this.searchBing(q, limit);
      }
      const ddg = await this.searchDuckDuckGo(q, limit);
      if (ddg.length) return ddg;
      return await this.searchWikipedia(q, limit);
    } catch {
      return [];
    }
  }

  private async searchBing(query: string, limit: number): Promise<SearchResult[]> {
    const url = new URL('https://api.bing.microsoft.com/v7.0/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 50)));
    const res = await fetch(url.toString(), {
      headers: { 'Ocp-Apim-Subscription-Key': this.config.bingApiKey as string },
    });
    const data = await res.json();
    const items = (data?.webPages?.value ?? []) as any[];
    return items.slice(0, limit).map((it) => ({
      title: String(it.name || ''),
      url: String(it.url || ''),
      snippet: String(it.snippet || ''),
    })).filter((r) => r.title && r.url);
  }

  private async searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_redirect', '1');
    url.searchParams.set('no_html', '1');
    const res = await fetch(url.toString());
    const data = await res.json();
    const topics: any[] = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
    const results: SearchResult[] = [];
    for (const t of topics) {
      if (t.Text && t.FirstURL) {
        results.push({ title: t.Text, url: t.FirstURL, snippet: t.Text });
        if (results.length >= limit) break;
      } else if (Array.isArray(t.Topics)) {
        for (const s of t.Topics) {
          if (s.Text && s.FirstURL) {
            results.push({ title: s.Text, url: s.FirstURL, snippet: s.Text });
            if (results.length >= limit) break;
          }
        }
      }
    }
    return results;
  }

  private async searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('format', 'json');
    const res = await fetch(url.toString());
    const data = await res.json();
    const items: any[] = data?.query?.search ?? [];
    return items.slice(0, limit).map((it) => ({
      title: String(it.title || ''),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(it.title || ''))}`,
      snippet: String(it.snippet || '').replace(/<[^>]+>/g, ''),
    })).filter((r) => r.title && r.url);
  }
}