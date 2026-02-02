/**
 * Researcher Agent (Business Mode)
 * ─────────────────────────────────────────────────────
 * Scrapes and synthesizes lead data to find "hooks"
 * for personalization. Takes a company/person URL or
 * name and returns structured research.
 */

const BaseAgent = require('./base-agent');
const { emitActivity } = require('../helpers/activity');

class ResearcherAgent extends BaseAgent {
  async execute(runId, profile, input) {
    try {
      const { target_url, target_name, target_company } = input;

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'agent_start',
        icon: 'bi-search',
        color: 'var(--uae-accent)',
        title: `Researcher started: ${target_name || target_company || target_url || 'prospect'}`,
      });

      // Step 1: Scrape the target
      let scrapedContent = '';
      if (target_url) {
        emitActivity(profile.id, {
          agentRunId: runId,
          eventType: 'scraping',
          icon: 'bi-globe',
          color: 'var(--uae-text-muted)',
          title: `Scraping: ${target_url.substring(0, 60)}`,
        });
        const result = await this.scraper.scrape(target_url);
        scrapedContent = result.content;
      } else if (target_name || target_company) {
        const query = `${target_name || ''} ${target_company || ''} ${profile.industry_context || ''}`.trim();
        emitActivity(profile.id, {
          agentRunId: runId,
          eventType: 'searching',
          icon: 'bi-search',
          color: 'var(--uae-text-muted)',
          title: `Searching: "${query.substring(0, 50)}"`,
        });
        const results = await this.scraper.search(query, { limit: 5 });
        scrapedContent = results.map(r => `${r.title}: ${r.snippet}`).join('\n');
      }

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'analyzing',
        icon: 'bi-cpu',
        color: 'var(--uae-accent)',
        title: 'Analyzing with AI for personalization hooks',
      });

      // Step 2: Use LLM to synthesize hooks
      const systemPrompt = `You are a research analyst for a ${profile.industry_context || 'business'} company.
Your job is to find personalization "hooks" — specific details about a prospect that can be used to craft a highly relevant outreach message.

Target Persona: ${profile.target_persona || 'Business decision maker'}
Services We Offer: ${profile.service_offerings || 'N/A'}

Return your analysis as JSON with these fields:
- hooks: array of 3-5 specific personalization angles
- pain_points: array of likely pain points based on research
- recommended_approach: a 2-sentence strategy for first contact
- confidence: 0-100 score on data quality`;

      const userMessage = `Research this prospect and find personalization hooks:
Name: ${target_name || 'Unknown'}
Company: ${target_company || 'Unknown'}
URL: ${target_url || 'None'}

Scraped Data:
${scrapedContent.substring(0, 4000)}`;

      const result = await this.llm.complete(systemPrompt, userMessage, { temperature: 0.3 });

      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'agent_complete',
        icon: 'bi-check-circle-fill',
        color: 'var(--uae-green)',
        title: `Research complete: ${target_name || target_company || 'prospect'}`,
        detail: `${result.tokensUsed} tokens used`,
      });

      this.completeRun(runId, {
        research: result.text,
        sources: target_url ? [target_url] : [],
        scrapedLength: scrapedContent.length,
      }, result.tokensUsed);

    } catch (err) {
      emitActivity(profile.id, {
        agentRunId: runId,
        eventType: 'agent_error',
        icon: 'bi-x-circle-fill',
        color: 'var(--uae-red)',
        title: `Researcher failed: ${err.message}`,
      });
      this.failRun(runId, err);
      throw err;
    }
  }
}

module.exports = ResearcherAgent;
