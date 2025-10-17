import { z } from 'zod';
import * as cheerio from 'cheerio';

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export interface SearchConfig {
  provider?: 'bing' | 'duckduckgo' | 'wikipedia' | 'baidu';
  bingApiKey?: string;
}

export class SearchService {
  constructor(private readonly config: SearchConfig = {}) {}

  async search(query: string, limit = 5, site?: string): Promise<SearchResult[]> {
    const q = site ? `${query} site:${site}` : query;
    const provider = this.config.provider || (this.config.bingApiKey ? 'bing' : 'duckduckgo');
    try {
      if (provider === 'baidu') {
        const bd = await this.searchBaidu(q, limit);
        if (bd.length) return bd;
        // fallback to DDG then Wikipedia if Baidu fails
        const ddg = await this.searchDuckDuckGo(q, limit);
        if (ddg.length) return ddg;
        return await this.searchWikipedia(q, limit);
      }
      if (provider === 'bing' && this.config.bingApiKey) {
        return await this.searchBing(q, limit);
      }
      const ddg = await this.searchDuckDuckGo(q, limit);
      if (ddg.length) return ddg;
      // prefer Baidu as a domestic-friendly fallback when DDG returns empty
      const bd = await this.searchBaidu(q, limit);
      if (bd.length) return bd;
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

  private async searchBaidu(query: string, limit: number): Promise<SearchResult[]> {
    const url = new URL('https://www.baidu.com/s');
    url.searchParams.set('wd', query);
    // rn 控制返回条数（并非总是严格），尽量贴近 limit
    url.searchParams.set('rn', String(Math.min(Math.max(limit, 1), 50)));
    const res = await fetch(url.toString(), {
      headers: {
        // 提供常见浏览器 UA，减少反爬拦截几率
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    // Baidu 的结构可能变动，尽量宽松选择器
    $('div.result, div.c-container').each((i, el) => {
      if (results.length >= limit) return false as any;
      const a = $(el).find('h3 a').first();
      const href = (a.attr('href') || '').trim();
      const title = a.text().trim();
      const snippet = $(el).find('div.c-abstract, div.content-right_abstract, div.caption-text, div.summary').first().text().trim();
      if (title && href && /^https?:\/\//.test(href)) {
        results.push({ title, url: href, snippet });
      }
    });
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