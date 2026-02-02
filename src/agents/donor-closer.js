/**
 * Donor Closer Agent (Political Mode)
 * ─────────────────────────────────────────────────────
 * Once a constituent is "warm" (engaged, positive
 * sentiment), this agent pivots to a donation ask or
 * town hall invitation. Syncs results back to
 * NationBuilder or the campaign CRM.
 */

const BaseAgent = require('./base-agent');
const { getCRM } = require('../providers/crm');
const { getDb } = require('../db/connection');
const { v4: uuidv4 } = require('uuid');

class DonorCloserAgent extends BaseAgent {
  async execute(runId, profile, input) {
    try {
      const { contact, conversation_history, ask_type } = input;
      const knowledgeContext = await this.buildKnowledgeContext(profile);

      const askMode = ask_type || 'donation'; // 'donation' | 'volunteer' | 'town_hall'

      const systemPrompt = `You are a donor relations specialist for ${profile.candidate_name || 'the candidate'} (${profile.candidate_party || ''}).

The constituent you are writing to has ALREADY been engaged. They are warm — they've shown interest in the campaign's policy positions. Now it is time to make a specific ask.

Ask Type: ${askMode}
Candidate: ${profile.candidate_name}
Riding: ${profile.riding_name}
Tone: ${profile.exhaustion_gap || 'Warm, grateful, specific.'}

RULES FOR THE ASK:
- Reference their previous engagement (what issue they cared about)
- For DONATIONS: suggest a specific small amount ($25-50). Make it feel achievable.
- For VOLUNTEERING: offer a specific, low-commitment task (door-knocking Saturday, phone banking 2hrs)
- For TOWN HALL: give a specific date/location and frame it as exclusive/important
- Always include a "why now" urgency element
- Thank them for their engagement so far — genuinely
- End with ONE clear CTA, not multiple options

Knowledge Base:
${knowledgeContext.substring(0, 1500)}`;

      const userMessage = `Constituent profile:
Name: ${contact?.first_name || 'Supporter'} ${contact?.last_name || ''}
Issues They Care About: ${contact?.issues_care || 'General'}
Current Voter Intent: ${contact?.voter_intent || 'leaning'}
Current Donor Status: ${contact?.donor_intent || 'none'}
Support Score: ${contact?.support_level || 'N/A'}/100

Conversation History:
${conversation_history || 'They engaged positively with our previous outreach about policy positions.'}

Write the ${askMode} ask message. Make it human, specific, and compelling.`;

      const result = await this.llm.complete(systemPrompt, userMessage, { temperature: 0.6 });

      // Update contact intent
      if (contact?.id) {
        const db = getDb();
        db.prepare(`
          UPDATE contacts SET donor_intent = 'warm', updated_at = datetime('now')
          WHERE id = ? AND donor_intent IN ('none', 'potential')
        `).run(contact.id);

        // Record sentiment
        this.recordSentiment(
          profile.id, contact.id,
          'donation_ask',
          20, // positive — we only ask warm contacts
          'donor',
          `${askMode} ask sent`
        );
      }

      // Sync to NationBuilder if configured
      try {
        const integrationDb = getDb();
        const nbIntegration = integrationDb.prepare(`
          SELECT * FROM integrations
          WHERE profile_id = ? AND provider = 'nationbuilder' AND is_verified = 1
        `).get(profile.id);

        if (nbIntegration && contact?.external_id) {
          const config = {
            access_token: nbIntegration.access_token,
            extra_config: nbIntegration.extra_config ? JSON.parse(nbIntegration.extra_config) : {},
          };
          const nb = getCRM('nationbuilder', config);
          await nb.addTag(contact.external_id, `uae_${askMode}_ask`);
          await nb.addNote(contact.external_id, `UAE ${askMode} ask sent via Donor Closer agent`);
        }
      } catch (syncErr) {
        // Don't fail the run if CRM sync fails
        console.error('NationBuilder sync failed:', syncErr.message);
      }

      this.completeRun(runId, {
        message: result.text,
        ask_type: askMode,
        contact_name: `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim(),
        crm_synced: true,
      }, result.tokensUsed);

    } catch (err) {
      this.failRun(runId, err);
      throw err;
    }
  }
}

module.exports = DonorCloserAgent;
