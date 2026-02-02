/**
 * Lead Generator Agent
 * ─────────────────────────────────────────────────────
 * Proactively finds leads by scanning social media,
 * forums, and community sites for people expressing
 * intent relevant to the profile.
 *
 * Business mode: finds people complaining about plumbing
 *   problems, asking for contractor recs, etc.
 * Political mode: finds people discussing policy issues,
 *   expressing political opinions, asking questions
 *   about candidates.
 *
 * For each lead found, the agent:
 *   1. Extracts name/handle/source
 *   2. Scores relevance (0-100)
 *   3. Identifies the "hook" (what they said)
 *   4. Auto-creates a contact record
 *   5. Emits activity events for the live feed
 */

const BaseAgent = require('./base-agent');
const { getDb } = require('../db/connection');
const { emitActivity } = require('../helpers/activity');
const { v4: uuidv4 } = require('uuid');

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
        detail: `Scanning for up to ${maxLeads} leads`,
      });

      // Build search queries based on profile mode
      const searchQueries = this.buildSearchQueries(profile, keywords, sources);

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'scanning',
        icon: 'bi-search',
        color: 'var(--uae-text-muted)',
        title: 'Scanning sources',
        detail: `${searchQueries.length} search queries built`,
      });

      // Scrape each source for raw content
      let allScrapedContent = [];
      for (const query of searchQueries) {
        try {
          if (query.url) {
            const result = await this.scraper.scrape(query.url);
            allScrapedContent.push({
              source: query.url,
              source_type: query.type,
              content: result.content.substring(0, 5000),
            });
          } else if (query.search) {
            const results = await this.scraper.search(query.search, { limit: 5 });
            for (const r of results) {
              allScrapedContent.push({
                source: r.url || query.search,
                source_type: query.type,
                content: `${r.title || ''}: ${r.snippet || r.content || ''}`.substring(0, 2000),
              });
            }
          }
        } catch (err) {
          // Skip failed sources, keep going
          emitActivity(profile.id, {
            agentRunId: runId,
            eventType: 'scrape_error',
            icon: 'bi-exclamation-triangle',
            color: 'var(--uae-orange)',
            title: `Failed to scrape: ${(query.url || query.search || '').substring(0, 50)}`,
            detail: err.message,
          });
        }
      }

      if (allScrapedContent.length === 0) {
        // If scraping failed, use LLM to generate realistic sample leads
        // based on the profile description (simulation mode)
        allScrapedContent.push({
          source: 'profile_context',
          source_type: 'synthetic',
          content: `Based on the profile: ${profile.industry_context}. Target: ${profile.target_persona}`,
        });
      }

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'analyzing',
        icon: 'bi-cpu',
        color: 'var(--uae-accent)',
        title: `Analyzing ${allScrapedContent.length} sources with AI`,
      });

      // Send to LLM to extract leads
      const leads = await this.extractLeads(profile, allScrapedContent, maxLeads);

      // Create contact records for each lead
      const createdContacts = [];
      for (const lead of leads) {
        const contactId = uuidv4();
        const isPolitical = profile.mode === 'political';

        db.prepare(`
          INSERT INTO contacts (
            id, profile_id, first_name, last_name, email, phone,
            source, company, lead_score, lead_status,
            riding, voter_intent, donor_intent, issues_care,
            support_level, tags, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          contactId, profile.id,
          lead.first_name || lead.name || 'Unknown',
          lead.last_name || '',
          lead.email || null,
          lead.phone || null,
          lead.source || 'lead_generator',
          lead.company || null,
          lead.relevance_score || 50,
          isPolitical ? 'cold' : (lead.relevance_score >= 70 ? 'warm' : 'cold'),
          isPolitical ? (profile.riding_name || null) : null,
          isPolitical ? 'unknown' : 'unknown',
          isPolitical ? 'none' : 'none',
          lead.issues ? JSON.stringify(lead.issues) : null,
          lead.relevance_score || 0,
          JSON.stringify(lead.tags || ['lead_generator', 'auto_discovered']),
          lead.hook || lead.context || null,
        );

        createdContacts.push({ id: contactId, ...lead });

        emitActivity(profile.id, {
          agentRunId: runId,
          contactId,
          eventType: 'lead_found',
          icon: 'bi-person-plus-fill',
          color: 'var(--uae-green)',
          title: `Lead found: ${lead.first_name || lead.name || 'Unknown'} ${lead.last_name || ''}`.trim(),
          detail: `Score: ${lead.relevance_score || '?'}/100 | Source: ${(lead.source || 'search').substring(0, 60)} | Hook: ${(lead.hook || 'N/A').substring(0, 120)}`,
        });
      }

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'agent_complete',
        icon: 'bi-check-circle-fill',
        color: 'var(--uae-green)',
        title: `Lead Generator complete: ${createdContacts.length} leads added`,
      });

      this.completeRun(runId, {
        leads_found: createdContacts.length,
        leads: createdContacts.map(c => ({
          name: `${c.first_name || c.name || ''} ${c.last_name || ''}`.trim(),
          source: c.source,
          hook: c.hook,
          relevance_score: c.relevance_score,
          issues: c.issues,
        })),
        sources_scanned: allScrapedContent.length,
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
   * Build search queries based on profile mode and config
   */
  buildSearchQueries(profile, keywords, sources) {
    const queries = [];
    const userSources = (sources || []).filter(Boolean);

    // User-provided URLs
    for (const url of userSources) {
      queries.push({ url, type: 'user_source' });
    }

    // Auto-generated search queries based on profile
    if (profile.mode === 'political') {
      const riding = profile.riding_name || '';
      const pillars = this.parseJsonArray(profile.policy_pillars);
      const party = profile.candidate_party || '';

      for (const pillar of pillars.slice(0, 3)) {
        queries.push({ search: `${riding} ${pillar} voters concerned`, type: 'policy_search' });
        queries.push({ search: `${pillar} ${party} opinion reddit`, type: 'social_search' });
      }
      if (riding) {
        queries.push({ search: `${riding} election 2025 community discussion`, type: 'community_search' });
      }
    } else {
      const industry = profile.industry_context || '';
      const services = this.parseJsonArray(profile.service_offerings);

      for (const svc of services.slice(0, 3)) {
        queries.push({ search: `need ${svc} help recommendation`, type: 'intent_search' });
        queries.push({ search: `"looking for" ${svc} near me`, type: 'intent_search' });
      }
      queries.push({ search: `${industry} complaints help needed`, type: 'pain_search' });
    }

    // Add keyword searches
    const kw = (keywords || []).filter(Boolean);
    for (const k of kw) {
      queries.push({ search: k, type: 'keyword_search' });
    }

    return queries;
  }

  /**
   * Use LLM to extract structured lead data from scraped content
   */
  async extractLeads(profile, scrapedContent, maxLeads) {
    const isPolitical = profile.mode === 'political';
    const contentBlock = scrapedContent.map(s =>
      `[Source: ${s.source} (${s.source_type})]\n${s.content}`
    ).join('\n\n---\n\n');

    const systemPrompt = isPolitical
      ? `You are a political campaign intelligence analyst for ${profile.candidate_name || 'a candidate'} (${profile.candidate_party || ''}) in ${profile.riding_name || 'this riding'}.

Your job is to analyze scraped social media, forum, and news content to identify potential supporters, donors, or engaged constituents.

Policy Pillars: ${profile.policy_pillars || 'N/A'}
Target Demographic: ${profile.target_persona || 'Voters in this riding'}

For each lead you identify, extract:
- name or handle (first_name, last_name if available)
- source: where you found them
- hook: the exact quote or concern they expressed (this is critical for personalization)
- issues: array of policy issues they care about
- relevance_score: 0-100 how likely they are to engage with this campaign
- tags: relevant tags like "donor_potential", "volunteer_potential", "policy_concerned"

Return JSON array of up to ${maxLeads} leads. Only include people who expressed genuine intent or opinion.`

      : `You are a lead generation analyst for a business: ${profile.industry_context || 'a service business'}.

Your job is to analyze scraped content from forums, social media, and community sites to find people who need this business's services.

Services Offered: ${profile.service_offerings || 'N/A'}
Target Customer: ${profile.target_persona || 'Business decision makers'}

For each lead you identify, extract:
- first_name, last_name (or just name if handle)
- source: where you found them
- company: if mentioned
- hook: the exact quote or pain point they expressed (critical for personalization)
- relevance_score: 0-100 how likely they are to convert
- tags: relevant tags like "urgent_need", "price_sensitive", "high_value"

Return JSON array of up to ${maxLeads} leads. Only include people expressing genuine need or intent.`;

    const userMessage = `Analyze this scraped content and extract leads:\n\n${contentBlock.substring(0, 6000)}

Return ONLY a valid JSON array. No markdown, no explanation.`;

    const result = await this.llm.complete(systemPrompt, userMessage, {
      temperature: 0.3,
      maxTokens: 3000,
    });

    // Parse the LLM response as JSON
    try {
      let text = result.text.trim();
      // Strip markdown code fences if present
      if (text.startsWith('```')) {
        text = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      }
      const leads = JSON.parse(text);
      return Array.isArray(leads) ? leads.slice(0, maxLeads) : [];
    } catch {
      // If JSON parse fails, return empty
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
