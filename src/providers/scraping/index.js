/**
 * Scraping Provider Abstraction
 * ─────────────────────────────────────────────────────
 * Swap between Firecrawl, Browserbase, or a basic
 * fetch fallback by changing SCRAPE_PROVIDER in .env.
 */

class BaseScraper {
  /**
   * @param {string} url
   * @param {object} opts
   * @returns {Promise<{ content: string, metadata: object }>}
   */
  async scrape(url, opts = {}) {
    throw new Error('scrape() not implemented');
  }

  /**
   * @param {string} query
   * @param {object} opts
   * @returns {Promise<Array<{ url: string, title: string, snippet: string }>>}
   */
  async search(query, opts = {}) {
    throw new Error('search() not implemented');
  }
}

class FirecrawlProvider extends BaseScraper {
  async scrape(url, opts = {}) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ['markdown'] }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Firecrawl scrape HTTP ${response.status}: ${text.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Firecrawl scrape failed');

    return {
      content: data.data?.markdown || data.data?.content || '',
      metadata: data.data?.metadata || {},
    };
  }

  async search(query, opts = {}) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');

    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, limit: opts.limit || 10 }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Firecrawl search HTTP ${response.status}: ${text.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data.success && data.error) throw new Error(`Firecrawl search: ${data.error}`);

    // Normalize Firecrawl response fields to the standard interface
    // Firecrawl returns: { url, title, description, markdown }
    // We normalize to: { url, title, snippet, content }
    const results = data.data || [];
    return results.map(r => ({
      url: r.url || '',
      title: r.title || '',
      snippet: r.description || r.snippet || '',
      content: r.markdown || r.content || r.description || '',
    }));
  }
}

class BrowserbaseProvider extends BaseScraper {
  async scrape(url, opts = {}) {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    if (!apiKey) throw new Error('BROWSERBASE_API_KEY not set');

    // Browserbase session-based scraping
    const response = await fetch('https://www.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bb-api-key': apiKey,
      },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();
    return {
      content: data.content || '',
      metadata: data.metadata || {},
    };
  }

  async search(query, opts = {}) {
    // Browserbase doesn't have native search — fall back to scraping a search engine
    throw new Error('Browserbase search not implemented — use Firecrawl for search');
  }
}

class BasicFetchProvider extends BaseScraper {
  async scrape(url) {
    const response = await fetch(url);
    const html = await response.text();
    // Very basic HTML-to-text stripping
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                     .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim();
    return { content: text.substring(0, 10000), metadata: { url } };
  }

  async search() {
    throw new Error('Basic fetch provider does not support search');
  }
}

const providers = {
  firecrawl: FirecrawlProvider,
  browserbase: BrowserbaseProvider,
  basic: BasicFetchProvider,
};

function getScraper(providerOverride) {
  const name = providerOverride || process.env.SCRAPE_PROVIDER || 'basic';
  const Provider = providers[name];
  if (!Provider) throw new Error(`Unknown scrape provider: ${name}`);
  return new Provider();
}

module.exports = { getScraper, BaseScraper, providers };
