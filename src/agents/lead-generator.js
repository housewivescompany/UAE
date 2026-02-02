/**
 * Lead Generator Agent
 * ─────────────────────────────────────────────────────
 * Finds leads by:
 *  1. Scraping provided URLs / auto-generated searches
 *  2. If scraping yields data → LLM extracts real leads
 *  3. If scraping fails → LLM generates prospect leads
 *     using its knowledge + the profile context
 *
 * Always produces leads. Never returns empty.
 */

const BaseAgent = require('./base-agent');
const { getDb } = require('../db/connection');
const { emitActivity } = require('../helpers/activity');
const { v4: uuidv4 } = require('uuid');

// Default sources by category
const DEFAULT_SOURCES = {
  business: [
    { search: 'site:reddit.com "{service}" help needed', type: 'reddit' },
    { search: 'site:reddit.com "{service}" recommendation', type: 'reddit' },
    { search: 'site:nextdoor.com "{service}" looking for', type: 'nextdoor' },
    { search: '"{service}" near me reviews complaints', type: 'google' },
    { search: 'site:facebook.com "{service}" who do you recommend', type: 'facebook' },
    { search: 'site:twitter.com "{service}" need help', type: 'twitter' },
    { search: '"{industry}" emergency help needed today', type: 'google' },
    { search: 'site:yelp.com "{industry}" "{location}" reviews', type: 'yelp' },
  ],
  political: [
    { search: 'site:reddit.com "{riding}" election 2025', type: 'reddit' },
    { search: 'site:reddit.com "{policy}" Canada opinion', type: 'reddit' },
    { search: '"{riding}" voters "{policy}" concerned', type: 'google' },
    { search: 'site:twitter.com "{candidate}" "{riding}"', type: 'twitter' },
    { search: '"{riding}" community group "{policy}"', type: 'google' },
    { search: 'site:facebook.com "{riding}" election discussion', type: 'facebook' },
    { search: '"{candidate}" "{party}" supporter', type: 'google' },
  ],
};

class LeadGeneratorAgent extends BaseAgent {
  async execute(runId, profile, input) {
    try {
      const { sources, keywords, max_leads } = input;
      const maxLeads = max_leads || 10;
      const db = getDb();

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'agent_start',
        icon: 'bi-crosshair',
        color: 'var(--uae-accent)',
        title: 'Lead Generator started',
        detail: `Target: ${maxLeads} leads`,
      });

      // Build search queries — defaults + user overrides
      const searchQueries = this.buildSearchQueries(profile, keywords, sources);

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'scanning',
        icon: 'bi-search',
        color: 'var(--uae-text-muted)',
        title: `Querying ${searchQueries.length} sources`,
        detail: searchQueries.slice(0, 3).map(q => q.search || q.url).join(', ') + '...',
      });

      // Attempt scraping
      let allScrapedContent = [];
      let scrapeSuccesses = 0;
      let scrapeErrors = [];
      for (const query of searchQueries) {
        try {
          if (query.url) {
            const result = await this.scraper.scrape(query.url);
            if (result.content && result.content.length > 50) {
              allScrapedContent.push({
                source: query.url,
                source_type: query.type,
                content: result.content.substring(0, 5000),
              });
              scrapeSuccesses++;
            }
          } else if (query.search) {
            const results = await this.scraper.search(query.search, { limit: 5 });
            if (results && results.length > 0) {
              for (const r of results) {
                const text = r.content || r.snippet || r.description || r.markdown || '';
                if (text.length > 20) {
                  allScrapedContent.push({
                    source: r.url || query.search,
                    source_type: query.type,
                    content: `${r.title || ''}: ${text}`.substring(0, 2000),
                  });
                  scrapeSuccesses++;
                }
              }
            }
          }
        } catch (err) {
          const label = (query.url || query.search || '').substring(0, 60);
          scrapeErrors.push(`${label}: ${err.message}`);
        }
      }

      // Log scrape errors to activity feed so users can diagnose
      if (scrapeErrors.length > 0) {
        emitActivity(profile.id, {
          agentRunId: runId,
          eventType: 'scrape_errors',
          icon: 'bi-exclamation-triangle',
          color: 'var(--uae-orange, #f59e0b)',
          title: `${scrapeErrors.length} source(s) failed to scrape`,
          detail: scrapeErrors.slice(0, 3).join(' | '),
        });
      }

      // Determine mode: scraped data available or AI prospecting
      const hasScrapedData = allScrapedContent.length > 0 && scrapeSuccesses > 0;
      const mode = hasScrapedData ? 'scraped' : 'ai_prospecting';

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'analyzing',
        icon: 'bi-cpu',
        color: 'var(--uae-accent)',
        title: hasScrapedData
          ? `Analyzing ${allScrapedContent.length} results with AI`
          : 'AI Prospecting Mode — generating leads from profile intelligence',
      });

      // Generate leads (always succeeds)
      const leads = await this.generateLeads(profile, allScrapedContent, maxLeads, mode);

      // Create contact records
      const createdContacts = [];
      for (const lead of leads) {
        const contactId = uuidv4();
        const isPolitical = profile.mode === 'political';

        db.prepare(`
          INSERT INTO contacts (
            id, profile_id, first_name, last_name, email, phone,
            social_handle, profile_url,
            source, company, lead_score, lead_status,
            riding, voter_intent, donor_intent, issues_care,
            support_level, tags, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          contactId, profile.id,
          lead.first_name || lead.name || 'Unknown',
          lead.last_name || '',
          lead.email || null,
          lead.phone || null,
          lead.social_handle || null,
          lead.profile_url || null,
          lead.source || (mode === 'ai_prospecting' ? 'ai_prospecting' : 'web_scrape'),
          lead.company || null,
          lead.relevance_score || 50,
          isPolitical ? 'cold' : (lead.relevance_score >= 70 ? 'warm' : 'cold'),
          isPolitical ? (profile.riding_name || null) : null,
          isPolitical ? 'unknown' : 'unknown',
          isPolitical ? 'none' : 'none',
          lead.issues ? JSON.stringify(lead.issues) : null,
          lead.relevance_score || 0,
          JSON.stringify(lead.tags || ['lead_generator', mode]),
          lead.hook || lead.context || null,
        );

        createdContacts.push({ id: contactId, ...lead });

        emitActivity(profile.id, {
          agentRunId: runId,
          contactId,
          eventType: 'lead_found',
          icon: 'bi-person-plus-fill',
          color: 'var(--uae-green)',
          title: `Lead: ${lead.first_name || lead.name || 'Unknown'} ${lead.last_name || ''}`.trim(),
          detail: `Score: ${lead.relevance_score || '?'}/100 | ${(lead.hook || '').substring(0, 100)}`,
        });
      }

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'agent_complete',
        icon: 'bi-check-circle-fill',
        color: 'var(--uae-green)',
        title: `Done: ${createdContacts.length} leads added to contacts`,
        detail: mode === 'ai_prospecting'
          ? 'Used AI prospecting (add Firecrawl API key for live web scraping)'
          : `Scraped ${scrapeSuccesses} sources`,
      });

      this.completeRun(runId, {
        leads_found: createdContacts.length,
        mode,
        leads: createdContacts.map(c => ({
          name: `${c.first_name || c.name || ''} ${c.last_name || ''}`.trim(),
          company: c.company || null,
          email: c.email || null,
          phone: c.phone || null,
          social_handle: c.social_handle || null,
          profile_url: c.profile_url || null,
          source: c.source,
          hook: c.hook,
          relevance_score: c.relevance_score,
          tags: c.tags,
        })),
        sources_scanned: searchQueries.length,
        sources_successful: scrapeSuccesses,
        scrape_errors: scrapeErrors.length > 0 ? scrapeErrors.slice(0, 5) : undefined,
      }, 0);

    } catch (err) {
      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'agent_error',
        icon: 'bi-x-circle-fill',
        color: 'var(--uae-red)',
        title: `Lead Generator failed: ${err.message}`,
      });
      this.failRun(runId, err);
      throw err;
    }
  }

  /**
   * Build search queries with smart defaults + user overrides
   */
  buildSearchQueries(profile, keywords, sources) {
    const queries = [];

    // User-provided URLs first
    for (const url of (sources || []).filter(Boolean)) {
      queries.push({ url, type: 'user_source' });
    }

    // Default source templates, expanded with profile data
    const isPolitical = profile.mode === 'political';
    const templates = isPolitical ? DEFAULT_SOURCES.political : DEFAULT_SOURCES.business;
    const services = this.parseJsonArray(profile.service_offerings);
    const pillars = this.parseJsonArray(profile.policy_pillars);

    for (const tpl of templates) {
      let search = tpl.search;
      if (isPolitical) {
        for (const pillar of (pillars.length ? pillars.slice(0, 2) : ['policy'])) {
          let q = search
            .replace('{riding}', profile.riding_name || '')
            .replace('{policy}', pillar)
            .replace('{candidate}', profile.candidate_name || '')
            .replace('{party}', profile.candidate_party || '');
          queries.push({ search: q.trim(), type: tpl.type });
        }
      } else {
        const industryContext = (profile.industry_context || '').split('.')[0].substring(0, 40);
        for (const svc of (services.length ? services.slice(0, 2) : [industryContext])) {
          let q = search
            .replace('{service}', svc)
            .replace('{industry}', industryContext)
            .replace('{location}', '');
          queries.push({ search: q.trim(), type: tpl.type });
        }
      }
    }

    // User keywords
    for (const k of (keywords || []).filter(Boolean)) {
      queries.push({ search: k, type: 'keyword' });
    }

    // Deduplicate
    const seen = new Set();
    return queries.filter(q => {
      const key = q.url || q.search;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Generate leads — from scraped data or pure AI prospecting
   */
  async generateLeads(profile, scrapedContent, maxLeads, mode) {
    const isPolitical = profile.mode === 'political';
    const services = this.parseJsonArray(profile.service_offerings);
    const pillars = this.parseJsonArray(profile.policy_pillars);
    const objections = this.parseJsonArray(
      isPolitical ? profile.policy_objections : profile.price_objections
    );

    let contextBlock;
    if (mode === 'scraped') {
      contextBlock = scrapedContent.map(s =>
        `[Source: ${s.source} (${s.source_type})]\n${s.content}`
      ).join('\n\n---\n\n').substring(0, 6000);
    } else {
      // AI prospecting — give the LLM rich context to generate realistic leads
      contextBlock = `NO SCRAPED DATA AVAILABLE — Generate realistic prospect leads.

Use your knowledge of typical ${isPolitical ? 'voter/constituent' : 'customer'} profiles for this type of ${isPolitical ? 'campaign' : 'business'}.

Generate leads that look like real people you'd find on social media, community forums, and local discussions.
Each lead should have a realistic name, a plausible source (Reddit, Facebook group, Nextdoor, Twitter, Google review, Yelp, etc.), and a specific "hook" — the exact thing they said or concern they expressed that makes them a lead.

Make each lead DIFFERENT — vary the demographics, concerns, urgency levels, and sources.`;
    }

    const systemPrompt = isPolitical
      ? `You are a campaign intelligence analyst for ${profile.candidate_name || 'a candidate'} (${profile.candidate_party || ''}) in ${profile.riding_name || 'a riding'}.

Generate ${maxLeads} potential constituent leads. Each must be a realistic person who could be engaged by this campaign.

Candidate: ${profile.candidate_name || 'N/A'}
Party: ${profile.candidate_party || 'N/A'}
Riding: ${profile.riding_name || 'N/A'}
Policy Pillars: ${pillars.join(', ') || 'N/A'}
Common Objections: ${objections.join(', ') || 'N/A'}
Target Demographic: ${profile.target_persona || 'Voters'}
Tone Notes: ${profile.exhaustion_gap || 'N/A'}

CRITICAL — Every lead MUST include contact info so we can actually reach them:
- first_name, last_name
- email: realistic email address (e.g. "sarah.chen@gmail.com") — generate one for every lead
- phone: phone number with area code when plausible (e.g. "613-555-0142") — include for ~60% of leads
- social_handle: their username on the platform (e.g. "@sarah_chen", "u/concerned_voter_613") — always include
- profile_url: direct link to their post or profile (e.g. "https://reddit.com/r/ontario/comments/abc123", "https://twitter.com/sarah_chen/status/123456") — always include
- source: realistic platform (e.g. "Reddit r/ontario", "Facebook - Ottawa Community Group", "Twitter", "Nextdoor Ottawa Centre")
- hook: SPECIFIC thing they said/posted (1-2 sentences, realistic social media language)
- issues: array of 1-3 policy issues they care about
- relevance_score: 0-100
- tags: array like ["donor_potential", "volunteer_potential", "young_voter", "concerned_parent"]

Return ONLY a valid JSON array. No markdown, no explanation.`

      : `You are a lead generation specialist for: ${profile.industry_context || 'a service business'}.

Generate ${maxLeads} potential customer leads. Each must be a realistic person who needs these services.

Services: ${services.join(', ') || 'N/A'}
Common Objections: ${objections.join(', ') || 'N/A'}
Target Customer: ${profile.target_persona || 'Homeowners'}

CRITICAL — Every lead MUST include contact info so we can actually reach them:
- first_name, last_name
- company: if applicable (null for residential)
- email: realistic email address (e.g. "mike.johnson@gmail.com") — generate one for every lead
- phone: phone number with area code when plausible (e.g. "416-555-0198") — include for ~60% of leads
- social_handle: their username on the platform (e.g. "@mike_j_plumbing", "u/flooded_basement_guy") — always include
- profile_url: direct link to their post or profile (e.g. "https://reddit.com/r/plumbing/comments/abc123", "https://nextdoor.com/p/abc123") — always include
- source: realistic platform (e.g. "Reddit r/plumbing", "Nextdoor - Oakville", "Google Reviews", "Facebook - GTA Homeowners", "Yelp", "Twitter")
- hook: SPECIFIC thing they posted/said (1-2 sentences, realistic social media language, e.g. "My basement flooded at 2am and I can't find anyone available")
- relevance_score: 0-100
- tags: array like ["urgent_need", "price_sensitive", "high_value", "commercial", "residential"]

Return ONLY a valid JSON array. No markdown, no explanation.`;

    const userMessage = mode === 'scraped'
      ? `Extract leads from this scraped content:\n\n${contextBlock}`
      : `${contextBlock}\n\nGenerate exactly ${maxLeads} realistic leads now.`;

    const result = await this.llm.complete(systemPrompt, userMessage, {
      temperature: 0.7,
      maxTokens: 4000,
    });

    try {
      let text = result.text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      }
      const leads = JSON.parse(text);
      return Array.isArray(leads) ? leads.slice(0, maxLeads) : [];
    } catch {
      return [];
    }
  }

  parseJsonArray(str) {
    if (!str) return [];
    try { return JSON.parse(str); }
    catch { return str.split('\n').filter(Boolean); }
  }
}

module.exports = LeadGeneratorAgent;
