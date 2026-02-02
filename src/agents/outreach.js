/**
 * Outreach Agent
 * ─────────────────────────────────────────────────────
 * Generates platform-aware outreach messages for both
 * Business and Political modes.  Takes research hooks,
 * detected platform, and contact info to craft a
 * personalized message ready for human review & send.
 */

const BaseAgent = require('./base-agent');

/** Platform-specific formatting rules injected into the prompt */
const PLATFORM_RULES = {
  reddit:   'Write a Reddit reply or DM. Casual Reddit tone. Keep under 100 words. No emojis. Reference their specific post.',
  twitter:  'Write a Twitter/X DM. Keep under 280 characters. Concise and punchy.',
  facebook: 'Write a short Facebook message. Friendly community tone. Keep under 100 words.',
  linkedin: 'Write a LinkedIn message. Professional but human. Keep under 150 words.',
  nextdoor: 'Write a Nextdoor reply. Neighborly, local-community tone. Keep under 100 words.',
  email:    'Write a short email. Start with "Subject: ..." on line 1, then the body. Keep body under 150 words.',
  sms:      'Write an SMS. Keep under 160 characters. Casual and direct.',
  dm:       'Write a short direct message. Keep under 100 words.',
};

class OutreachAgent extends BaseAgent {
  async execute(runId, profile, input) {
    try {
      const { contact, research_hooks, channel, tone, platform } = input;
      const knowledgeContext = await this.buildKnowledgeContext(profile);
      const isPolitical = profile.mode === 'political';
      const platformRule = PLATFORM_RULES[platform] || PLATFORM_RULES.dm;

      /* ── Build system prompt based on mode ─────── */
      let systemPrompt;

      if (isPolitical) {
        systemPrompt = `You are a community engagement specialist for ${profile.candidate_name || 'a political candidate'} (${profile.candidate_party || 'party'}).
You write messages that sound like they come from a real volunteer or campaign worker, not a bot or mass message.

RULES:
- Sound like a genuine person who cares about the community
- Reference the constituent's specific concern or interest
- Connect their concern to relevant policy positions naturally
- Never sound like a mass-produced campaign message
- Be empathetic first, political second
- ${platformRule}
- Match the tone: ${tone || 'empathetic and community-focused'}

Campaign Context: ${profile.industry_context || ''}
Key Policy Positions: ${profile.policy_pillars || 'N/A'}
Candidate: ${profile.candidate_name || 'N/A'} (${profile.candidate_party || ''})
Tone Guidance: ${profile.exhaustion_gap || 'Warm, genuine, non-partisan-sounding'}

Knowledge Base:
${knowledgeContext.substring(0, 2000)}`;
      } else {
        systemPrompt = `You are an expert outreach specialist for a ${profile.industry_context || 'business'} company.
You write messages that sound like they come from a knowledgeable human, never like a bot or mass email.

RULES:
- Never use generic openers like "I hope this finds you well"
- Lead with a specific observation about the prospect's situation
- Reference their actual situation, not hypothetical scenarios
- End with a soft CTA (question, not a hard sell)
- ${platformRule}
- Match the tone: ${tone || 'professional but warm'}

Company Context: ${profile.industry_context}
Our Services: ${profile.service_offerings || 'N/A'}
Common Objections to Pre-empt: ${profile.price_objections || 'N/A'}

Knowledge Base:
${knowledgeContext.substring(0, 2000)}`;
      }

      /* ── Build user message ────────────────────── */
      const contactName = contact?.first_name || contact?.social_handle || 'there';
      const userMessage = `Write a ${platform || channel || 'direct'} message for:
Name: ${contactName} ${contact?.last_name || ''}
${contact?.social_handle ? 'Handle: ' + contact.social_handle : ''}
${contact?.company ? 'Company: ' + contact.company : ''}
${contact?.job_title ? 'Title: ' + contact.job_title : ''}

Research Hooks:
${research_hooks || 'No specific hooks available — use industry-level personalization.'}

Generate the message only. No explanations or meta-commentary.`;

      const result = await this.llm.complete(systemPrompt, userMessage, { temperature: 0.7 });

      this.completeRun(runId, {
        message: result.text,
        channel: channel || 'dm',
        platform: platform || 'unknown',
        contact_name: `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim()
                       || contact?.social_handle || '',
      }, result.tokensUsed);

    } catch (err) {
      this.failRun(runId, err);
      throw err;
    }
  }
}

module.exports = OutreachAgent;
