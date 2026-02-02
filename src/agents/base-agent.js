/**
 * Base Agent
 * ─────────────────────────────────────────────────────
 * Shared logic for all agents: logging, DB updates,
 * LLM calls, and scraping.
 */

const { getDb } = require('../db/connection');
const { getLLM } = require('../providers/llm');
const { getScraper } = require('../providers/scraping');

class BaseAgent {
  constructor() {
    this.db = getDb();
    this.llm = getLLM();
    this.scraper = getScraper();
  }

  /**
   * Main entry point — override in subclasses.
   * @param {string} runId
   * @param {object} profile - full profile row
   * @param {object} input - JSON input data
   */
  async execute(runId, profile, input) {
    throw new Error('execute() must be implemented by subclass');
  }

  /** Update the agent run record with results */
  completeRun(runId, outputData, tokensUsed = 0) {
    this.db.prepare(`
      UPDATE agent_runs SET
        status = 'completed',
        output_data = ?,
        tokens_used = ?,
        llm_provider = ?,
        completed_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(outputData), tokensUsed, process.env.LLM_PROVIDER || 'openai', runId);
  }

  /** Fail the run with an error */
  failRun(runId, error) {
    this.db.prepare(`
      UPDATE agent_runs SET
        status = 'failed',
        output_data = ?,
        completed_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify({ error: error.message || error }), runId);
  }

  /** Parse the knowledge base JSON from profile */
  getKnowledgeBase(profile) {
    try { return JSON.parse(profile.knowledge_base || '[]'); }
    catch { return []; }
  }

  /** Build a context string from the knowledge base */
  async buildKnowledgeContext(profile) {
    const kb = this.getKnowledgeBase(profile);
    const chunks = [];

    for (const item of kb) {
      if (item.startsWith('http')) {
        try {
          const { content } = await this.scraper.scrape(item);
          chunks.push(`[Source: ${item}]\n${content.substring(0, 3000)}`);
        } catch {
          chunks.push(`[Source: ${item}] (failed to fetch)`);
        }
      } else {
        chunks.push(item);
      }
    }

    return chunks.join('\n\n---\n\n');
  }

  /** Record a sentiment reading (political mode) */
  recordSentiment(profileId, contactId, issue, score, intentType, rawSignal) {
    const { v4: uuidv4 } = require('uuid');
    this.db.prepare(`
      INSERT INTO sentiment_log (id, profile_id, contact_id, source, issue, sentiment_score, intent_type, raw_signal)
      VALUES (?, ?, ?, 'agent_interaction', ?, ?, ?, ?)
    `).run(uuidv4(), profileId, contactId, issue, score, intentType, rawSignal);
  }
}

module.exports = BaseAgent;
