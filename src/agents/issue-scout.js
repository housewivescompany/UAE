/**
 * Issue Scout Agent (Political Mode)
 * ─────────────────────────────────────────────────────
 * Monitors local community sources (Reddit, Facebook,
 * local news) to identify the "hot" issue in a specific
 * riding this week. Produces issue-ranked intelligence.
 */

const BaseAgent = require('./base-agent');

class IssueScoutAgent extends BaseAgent {
  async execute(runId, profile, input) {
    try {
      const { sources, riding_override } = input;
      const riding = riding_override || profile.riding_name || 'General';
      const policyPillars = profile.policy_pillars || '[]';

      // Step 1: Scrape local sources
      const defaultSources = [
        `${riding} local news this week`,
        `${riding} community concerns 2025`,
        `${profile.candidate_party || ''} ${riding} voter issues`,
      ];
      const queries = sources || defaultSources;
      const scrapedResults = [];

      for (const query of queries) {
        try {
          const results = await this.scraper.search(query, { limit: 5 });
          scrapedResults.push(...results);
        } catch {
          scrapedResults.push({ title: query, snippet: '(search failed)' });
        }
      }

      const scrapedText = scrapedResults
        .map(r => `- ${r.title}: ${r.snippet || ''}`)
        .join('\n');

      // Step 2: Use LLM to rank issues
      const systemPrompt = `You are a political intelligence analyst monitoring the riding of ${riding} for the ${profile.candidate_party || ''} campaign.

Candidate: ${profile.candidate_name || 'N/A'}
Our Policy Pillars: ${policyPillars}
Known Voter Objections: ${profile.policy_objections || '[]'}
Climate/Tone Notes: ${profile.exhaustion_gap || 'None'}

Your job is to:
1. Identify the TOP 5 issues being discussed in this riding RIGHT NOW
2. Rank them by intensity (how much people are talking about it)
3. For each issue, note whether our candidate has a STRONG, MODERATE, or WEAK position
4. Flag any "landmine" issues where engagement could backfire
5. Suggest the #1 issue to lead outreach messaging on this week

Return as JSON:
{
  "top_issues": [{ "issue": "", "intensity": 1-10, "our_position": "strong|moderate|weak", "landmine": false, "talking_point": "" }],
  "recommended_lead_issue": "",
  "riding_mood": "optimistic|frustrated|angry|apathetic|mixed",
  "notes": ""
}`;

      const userMessage = `Here is what we found in public discourse for ${riding} this week:\n\n${scrapedText.substring(0, 4000)}`;

      const result = await this.llm.complete(systemPrompt, userMessage, { temperature: 0.3 });

      this.completeRun(runId, {
        intelligence: result.text,
        riding,
        sourcesScraped: scrapedResults.length,
      }, result.tokensUsed);

    } catch (err) {
      this.failRun(runId, err);
      throw err;
    }
  }
}

module.exports = IssueScoutAgent;
