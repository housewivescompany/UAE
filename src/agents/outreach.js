/**
 * Outreach Agent (Business Mode)
 * ─────────────────────────────────────────────────────
 * Uses the Niche Profile to craft custom messages that
 * sound like a human expert. Takes research hooks and
 * generates personalized outreach.
 */

const BaseAgent = require('./base-agent');

class OutreachAgent extends BaseAgent {
  async execute(runId, profile, input) {
    try {
      const { contact, research_hooks, channel, tone } = input;
      const knowledgeContext = await this.buildKnowledgeContext(profile);

      const systemPrompt = `You are an expert outreach specialist for a ${profile.industry_context || 'business'} company.
You write messages that sound like they come from a knowledgeable human, never like a bot or mass email.

RULES:
- Never use generic openers like "I hope this finds you well"
- Lead with a specific observation about the prospect
- Reference their actual situation, not hypothetical scenarios
- Keep it under 150 words for email, under 50 words for DM/SMS
- End with a soft CTA (question, not a hard sell)
- Match the tone: ${tone || 'professional but warm'}

Company Context: ${profile.industry_context}
Our Services: ${profile.service_offerings || 'N/A'}
Common Objections to Pre-empt: ${profile.price_objections || 'N/A'}

Knowledge Base:
${knowledgeContext.substring(0, 2000)}`;

      const userMessage = `Write a ${channel || 'email'} outreach message for:
Name: ${contact?.first_name || 'there'} ${contact?.last_name || ''}
Company: ${contact?.company || 'their company'}
Title: ${contact?.job_title || 'N/A'}

Research Hooks:
${research_hooks || 'No specific hooks available — use industry-level personalization.'}

Generate the message only. No explanations.`;

      const result = await this.llm.complete(systemPrompt, userMessage, { temperature: 0.7 });

      this.completeRun(runId, {
        message: result.text,
        channel: channel || 'email',
        contact_name: `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim(),
      }, result.tokensUsed);

    } catch (err) {
      this.failRun(runId, err);
      throw err;
    }
  }
}

module.exports = OutreachAgent;
