/**
 * JSON API endpoints used by the dashboard JS and external webhooks.
 */
const router = require('express').Router();
const { getDb } = require('../db/connection');

// ── Profile stats (AJAX) ─────────────────────────────
router.get('/profiles/:id/stats', (req, res) => {
  const db = getDb();
  const pid = req.params.id;

  const contacts = db.prepare('SELECT COUNT(*) as cnt FROM contacts WHERE profile_id = ?').get(pid);
  const runs = db.prepare('SELECT COUNT(*) as cnt FROM agent_runs WHERE profile_id = ?').get(pid);
  const sentiment = db.prepare('SELECT AVG(sentiment_score) as avg FROM sentiment_log WHERE profile_id = ?').get(pid);

  res.json({
    contacts: contacts.cnt,
    agentRuns: runs.cnt,
    avgSentiment: sentiment.avg ? Math.round(sentiment.avg) : null,
  });
});

// ── Sentiment chart data ──────────────────────────────
router.get('/sentiment/:profileId/chart', (req, res) => {
  const db = getDb();
  const data = db.prepare(`
    SELECT
      date(recorded_at) as day,
      issue,
      AVG(sentiment_score) as avg_score,
      COUNT(*) as readings
    FROM sentiment_log
    WHERE profile_id = ?
    GROUP BY day, issue
    ORDER BY day ASC
  `).all(req.params.profileId);

  res.json(data);
});

// ── Agent run status (polling from profile page) ─────
router.get('/agents/runs/:id', (req, res) => {
  const db = getDb();
  const run = db.prepare('SELECT id, status, output_data, tokens_used, completed_at FROM agent_runs WHERE id = ?')
    .get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

// ── Webhook receiver (inbound replies, NationBuilder sync) ──
router.post('/webhook/:provider', (req, res) => {
  // Extensible webhook handler — log and route to appropriate agent
  console.log(`Webhook received from ${req.params.provider}:`, JSON.stringify(req.body).substring(0, 500));
  res.json({ received: true });
});

module.exports = router;
