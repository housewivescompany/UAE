/**
 * Secretary Agent (Business Mode)
 * ─────────────────────────────────────────────────────
 * Monitors replies and uses the Knowledge Base to
 * answer questions and book appointments. Handles
 * objections using the profile's objection data.
 */

const BaseAgent = require('./base-agent');

class SecretaryAgent extends BaseAgent {
  async execute(runId, profile, input) {
    try {
      const { inbound_message, contact, conversation_history } = input;
      const knowledgeContext = await this.buildKnowledgeContext(profile);

      const systemPrompt = `You are an AI secretary for a ${profile.industry_context || 'business'} company.
Your job is to respond to inbound messages from prospects naturally and helpfully.

CAPABILITIES:
- Answer questions about our services using ONLY the knowledge base below
- Handle objections gracefully (see common objections list)
- When someone is ready, suggest booking a call or appointment
- If you don't know something, say "Let me check with the team and get back to you"

TONE: Helpful, professional, knowledgeable. Like a great executive assistant.

Services: ${profile.service_offerings || 'N/A'}
Common Objections & Responses: ${profile.price_objections || 'N/A'}
Target Customer: ${profile.target_persona || 'N/A'}

Knowledge Base:
${knowledgeContext.substring(0, 3000)}`;

      const history = conversation_history || '';
      const userMessage = `Previous conversation:
${history}

New inbound message from ${contact?.first_name || 'prospect'}:
"${inbound_message}"

Classify the intent (question / objection / ready_to_book / unsubscribe / other) and write the reply.
Format as JSON: { "intent": "...", "reply": "...", "should_escalate": false, "booking_ready": false }`;

      const result = await this.llm.complete(systemPrompt, userMessage, { temperature: 0.4 });

      this.completeRun(runId, {
        analysis: result.text,
        inbound_message,
      }, result.tokensUsed);

    } catch (err) {
      this.failRun(runId, err);
      throw err;
    }
  }
}

module.exports = SecretaryAgent;
