/**
 * Persuader Agent (Political Mode)
 * ─────────────────────────────────────────────────────
 * The political outreach agent. Doesn't just ask for
 * money — it leads with the constituent's concerns,
 * references specific policy positions, and offers
 * value (summaries, town hall invites) before any ask.
 */

const BaseAgent = require('./base-agent');

class PersuaderAgent extends BaseAgent {
  async execute(runId, profile, input) {
    try {
      const { contact, issue, channel, issue_scout_data } = input;
      const knowledgeContext = await this.buildKnowledgeContext(profile);

      const systemPrompt = `You are a constituent engagement specialist for ${profile.candidate_name || 'the candidate'} (${profile.candidate_party || ''}) in ${profile.riding_name || 'this riding'}.

CRITICAL RULES:
- You are NOT a telemarketer. You are a knowledgeable political aide.
- Lead with THEIR concern, not your ask.
- Reference specific policy details from the knowledge base.
- Offer something of VALUE: a policy summary, town hall invite, or direct answer.
- The first message should NEVER ask for money. Build trust first.
- Match the tone to the current political climate: ${profile.exhaustion_gap || 'Be empathetic and direct.'}
- If voter fatigue is high, acknowledge it. Don't be dismissive.

Candidate Platform:
${knowledgeContext.substring(0, 2000)}

Policy Pillars: ${profile.policy_pillars || '[]'}
Known Objections We Must Handle: ${profile.policy_objections || '[]'}

Current Issue Intelligence:
${issue_scout_data || 'No current intelligence available.'}`;

      const userMessage = `Write a ${channel || 'email'} message for this constituent:

Name: ${contact?.first_name || 'Constituent'}
Riding: ${contact?.riding || profile.riding_name || 'N/A'}
Issue They Care About: ${issue || 'General engagement'}
Their Current Stance: ${contact?.voter_intent || 'unknown'}
Previous Donor: ${contact?.donor_intent === 'donated' ? 'Yes' : 'No'}
Issues They Follow: ${contact?.issues_care || 'Unknown'}

Write ONLY the message. Make it feel like a personal note from a real campaign volunteer who genuinely cares.`;

      const result = await this.llm.complete(systemPrompt, userMessage, { temperature: 0.7 });

      // Record sentiment signal
      if (contact?.id) {
        this.recordSentiment(
          profile.id, contact.id,
          issue || 'general',
          0, // neutral starting point — will be updated by response
          'voter',
          `Outreach sent re: ${issue || 'general engagement'}`
        );
      }

      this.completeRun(runId, {
        message: result.text,
        channel: channel || 'email',
        issue_targeted: issue,
        contact_name: `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim(),
      }, result.tokensUsed);

    } catch (err) {
      this.failRun(runId, err);
      throw err;
    }
  }
}

module.exports = PersuaderAgent;
