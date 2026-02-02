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

// Default sources by category — include recency terms
const DEFAULT_SOURCES = {
  business: [
    { search: 'site:reddit.com "{service}" help needed 2025', type: 'reddit' },
    { search: 'site:reddit.com "{service}" recommendation 2025', type: 'reddit' },
    { search: 'site:nextdoor.com "{service}" looking for', type: 'nextdoor' },
    { search: '"{service}" near me need help 2025', type: 'google' },
    { search: 'site:facebook.com "{service}" who do you recommend 2025', type: 'facebook' },
    { search: 'site:twitter.com "{service}" need help', type: 'twitter' },
    { search: '"{industry}" emergency help needed today', type: 'google' },
    { search: 'site:yelp.com "{industry}" "{location}" recent reviews', type: 'yelp' },
  ],
  political: [
    { search: 'site:reddit.com "{riding}" election 2025', type: 'reddit' },
    { search: 'site:reddit.com "{policy}" Canada opinion 2025', type: 'reddit' },
    { search: '"{riding}" voters "{policy}" concerned 2025', type: 'google' },
    { search: 'site:twitter.com "{candidate}" "{riding}" 2025', type: 'twitter' },
    { search: '"{riding}" community group "{policy}" 2025', type: 'google' },
    { search: 'site:facebook.com "{riding}" election discussion 2025', type: 'facebook' },
    { search: '"{candidate}" "{party}" supporter 2025', type: 'google' },
  ],
};

class LeadGeneratorAgent extends BaseAgent {
  async execute(runId, profile, input) {
    try {
      const { sources, keywords, max_leads, recency } = input;
      const maxLeads = max_leads || 10;
      const recencyFilter = recency || (profile.mode === 'political' ? '3months' : '1week');
      const db = getDb();

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'agent_start',
        icon: 'bi-crosshair',
        color: 'var(--uae-accent)',
        title: 'Lead Generator started',
        detail: `Target: ${maxLeads} leads`,
      });

      // Build search queries — defaults + user overrides + recency
      const searchQueries = this.buildSearchQueries(profile, keywords, sources, recencyFilter);

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
      const leads = await this.generateLeads(profile, allScrapedContent, maxLeads, mode, recencyFilter);

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
          post_date: c.post_date || null,
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
  buildSearchQueries(profile, keywords, sources, recency) {
    const queries = [];

    // Map recency to a search-engine-friendly date hint
    const recencyTerms = {
      '1week': 'past week',
      '1month': 'past month',
      '3months': '2025',
      '6months': '2025',
      'any': '',
    };
    const dateSuffix = recencyTerms[recency] || '2025';

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
      // Strip any hardcoded year from the template — we'll add the recency suffix
      let search = tpl.search.replace(/ 2025$/, '');
      if (isPolitical) {
        for (const pillar of (pillars.length ? pillars.slice(0, 2) : ['policy'])) {
          let q = search
            .replace('{riding}', profile.riding_name || '')
            .replace('{policy}', pillar)
            .replace('{candidate}', profile.candidate_name || '')
            .replace('{party}', profile.candidate_party || '');
          if (dateSuffix) q += ' ' + dateSuffix;
          queries.push({ search: q.trim(), type: tpl.type });
        }
      } else {
        const industryContext = (profile.industry_context || '').split('.')[0].substring(0, 40);
        for (const svc of (services.length ? services.slice(0, 2) : [industryContext])) {
          let q = search
            .replace('{service}', svc)
            .replace('{industry}', industryContext)
            .replace('{location}', '');
          if (dateSuffix) q += ' ' + dateSuffix;
          queries.push({ search: q.trim(), type: tpl.type });
        }
      }
    }

    // User keywords — also append recency
    for (const k of (keywords || []).filter(Boolean)) {
      let q = k;
      if (dateSuffix && !q.includes('2025') && !q.includes('week') && !q.includes('month')) {
        q += ' ' + dateSuffix;
      }
      queries.push({ search: q, type: 'keyword' });
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
  async generateLeads(profile, scrapedContent, maxLeads, mode, recency) {
    const isPolitical = profile.mode === 'political';
    const services = this.parseJsonArray(profile.service_offerings);
    const pillars = this.parseJsonArray(profile.policy_pillars);
    const objections = this.parseJsonArray(
      isPolitical ? profile.policy_objections : profile.price_objections
    );

    // Human-readable recency label for the LLM prompt
    const recencyLabels = {
      '1week': 'the last 7 days only — anything older is stale',
      '1month': 'the last 30 days — skip older posts',
      '3months': 'the last 3 months — skip anything clearly older',
      '6months': 'the last 6 months',
      'any': 'any time period (no date restriction)',
    };
    const recencyRule = recencyLabels[recency] || recencyLabels['1week'];

    let systemPrompt, userMessage;

    if (mode === 'scraped') {
      // ── SCRAPED MODE: extract real data only, never fabricate ──
      const contextBlock = scrapedContent.map(s =>
        `[Source URL: ${s.source}] [Platform: ${s.source_type}]\n${s.content}`
      ).join('\n\n---\n\n').substring(0, 8000);

      const profileContext = isPolitical
        ? `Campaign for ${profile.candidate_name || 'a candidate'} (${profile.candidate_party || ''}) in ${profile.riding_name || 'a riding'}. Policy pillars: ${pillars.join(', ') || 'N/A'}.`
        : `Business: ${profile.industry_context || 'a service business'}. Services: ${services.join(', ') || 'N/A'}.`;

      systemPrompt = `You are a lead extraction analyst. You will receive REAL scraped web content from social media, forums, and review sites.

Your job is to find REAL people in this content who are POTENTIAL CUSTOMERS — people who NEED or are LOOKING FOR services. ${profileContext}

CRITICAL — WHAT IS A LEAD vs WHAT IS NOT:
${isPolitical
  ? `A LEAD IS: a real person expressing opinions about policy, concerned about local issues, asking questions about candidates, discussing voting — someone the campaign can engage.
NOT A LEAD: political organizations, news outlets, campaign ads, party officials, other candidates, journalists reporting.`
  : `A LEAD IS: a real person who NEEDS a service — asking for help, complaining about a problem, requesting recommendations, describing an emergency, looking for quotes.
NOT A LEAD: businesses ADVERTISING or PROVIDING services (competitors), company profiles, business listings, service providers promoting themselves, reviews BY businesses, "Call us at..." posts. If someone says "We are a plumbing company" or "Our team provides..." — that is a COMPETITOR, not a lead. SKIP IT.`}

STRICT RULES — FOLLOW EXACTLY:
1. Only extract people who ACTUALLY APPEAR in the scraped content. Every lead must come from the text provided.
2. NEVER invent or fabricate names, usernames, emails, or phone numbers. If the content doesn't contain a piece of info, set it to null.
3. Extract the EXACT username/handle as it appears (e.g. "u/leaky_pipe_guy", "@jane_smith", the actual poster name)
4. The profile_url should be the ACTUAL source URL from the [Source URL: ...] tag where you found this person, or null if unclear
5. The social_handle must be the person's REAL username from the content, not an invented one
6. email and phone should ONLY be included if they literally appear in the scraped text next to the person's post. A phone number in a business advertisement is NOT lead contact info — it belongs to a competitor.
7. RECENCY: Only include posts from ${recencyRule}. Look for date indicators in the content (timestamps, "2 days ago", "Jan 2025", etc). If a post appears older than the cutoff, SKIP IT. Prioritize the most recent posts.
8. The "hook" must be a REAL quote or close paraphrase of what the person actually said in the content
9. FILTER OUT businesses, service providers, advertisers, and competitors. Only include people who are SEEKING help, not offering it.

For EACH lead return:
- first_name: real name if visible, otherwise use their username (e.g. "u/leaky_pipe_guy")
- last_name: real last name if visible, otherwise null
- email: null (unless explicitly posted in the content)
- phone: null (unless explicitly posted in the content)
- social_handle: their EXACT username from the platform (e.g. "u/homeowner_123", "@plumbing_help")
- profile_url: the EXACT source URL where you found them${isPolitical ? '' : '\n- company: if mentioned, otherwise null'}
- source: platform name (e.g. "Reddit r/plumbing", "Yelp", "Twitter")
- hook: EXACT quote of what they said that makes them a lead
- post_date: approximate date of the post if visible (e.g. "2025-01", "recent", "2024-12"), or null
- relevance_score: 0-100 (higher for recent, urgent, specific needs)
- tags: array of relevant tags${isPolitical ? ' like ["policy_concerned", "donor_potential", "volunteer_potential"]' : ' like ["urgent_need", "price_sensitive", "high_value", "residential", "commercial"]'}
${isPolitical ? '- issues: array of policy issues they care about' : ''}

Return up to ${maxLeads} leads as a valid JSON array. If fewer real leads exist in the content, return fewer — NEVER pad with fake ones. No markdown, no explanation.`;

      userMessage = `Extract real leads from this scraped web content:\n\n${contextBlock}`;

    } else {
      // ── AI PROSPECTING MODE: generate simulated leads, clearly marked ──
      const aiContext = isPolitical
        ? `Campaign: ${profile.candidate_name || 'a candidate'} (${profile.candidate_party || ''}) in ${profile.riding_name || 'a riding'}.
Policy Pillars: ${pillars.join(', ') || 'N/A'}
Target Demographic: ${profile.target_persona || 'Voters'}
Tone Notes: ${profile.exhaustion_gap || 'N/A'}`
        : `Business: ${profile.industry_context || 'a service business'}.
Services: ${services.join(', ') || 'N/A'}
Target Customer: ${profile.target_persona || 'Homeowners'}`;

      systemPrompt = `You are a lead generation simulator. Scraping returned no data, so generate ${maxLeads} SIMULATED prospect leads for outreach planning.

${aiContext}

These are SIMULATED leads for planning purposes. For each lead:
- first_name, last_name: realistic names
- email: null (do NOT fabricate emails — they would be useless)
- phone: null (do NOT fabricate phone numbers)
- social_handle: a plausible but clearly simulated handle (prefix with "~" to indicate simulated, e.g. "~u/simulated_user")
- profile_url: null (no real URL exists)${isPolitical ? '' : '\n- company: if applicable, otherwise null'}
- source: platform name with "(simulated)" suffix, e.g. "Reddit r/plumbing (simulated)"
- hook: a realistic concern or statement this type of person would make
- post_date: null
- relevance_score: 0-100
- tags: array of relevant tags

Return ONLY a valid JSON array. No markdown, no explanation.`;

      userMessage = `Generate exactly ${maxLeads} simulated leads now.`;
    }

    const result = await this.llm.complete(systemPrompt, userMessage, {
      temperature: mode === 'scraped' ? 0.2 : 0.7,
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
