const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/connection');
const { getAgentRunner } = require('../agents/runner');

router.use(requireAuth);

// ── Agent overview ────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const tenantId = req.session.user.tenant_id;

  const runs = db.prepare(`
    SELECT ar.*, p.name as profile_name, p.mode as profile_mode,
           c.first_name, c.last_name, c.email as contact_email
    FROM agent_runs ar
    JOIN profiles p ON ar.profile_id = p.id
    LEFT JOIN contacts c ON ar.contact_id = c.id
    WHERE p.tenant_id = ?
    ORDER BY ar.created_at DESC
    LIMIT 50
  `).all(tenantId);

  const profiles = db.prepare('SELECT id, name, mode FROM profiles WHERE tenant_id = ? AND is_active = 1').all(tenantId);

  const stats = db.prepare(`
    SELECT agent_type, status, COUNT(*) as cnt
    FROM agent_runs ar
    JOIN profiles p ON ar.profile_id = p.id
    WHERE p.tenant_id = ?
    GROUP BY agent_type, status
  `).all(tenantId);

  res.render('agents/index', {
    title: 'Agents — UAE',
    runs,
    profiles,
    stats,
  });
});

// ── Trigger an agent run (handles both form POST and JSON) ──
router.post('/run', async (req, res) => {
  const db = getDb();
  const isJson = req.headers['accept']?.includes('application/json') ||
                 req.headers['content-type']?.includes('application/json');
  const { profile_id, agent_type, contact_id, input_data } = req.body;

  // Verify ownership
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ? AND tenant_id = ?')
    .get(profile_id, req.session.user.tenant_id);
  if (!profile) {
    if (isJson) return res.json({ error: 'Profile not found.' });
    req.flash('error', 'Profile not found.');
    return res.redirect('/agents');
  }

  const runId = uuidv4();
  db.prepare(`
    INSERT INTO agent_runs (id, profile_id, contact_id, agent_type, status, input_data, started_at)
    VALUES (?, ?, ?, ?, 'running', ?, datetime('now'))
  `).run(runId, profile_id, contact_id || null, agent_type, input_data || '{}');

  // Fire and forget — agent runs asynchronously
  try {
    const runner = getAgentRunner(agent_type);
    runner.execute(runId, profile, input_data ? JSON.parse(input_data) : {})
      .catch(err => {
        db.prepare("UPDATE agent_runs SET status = 'failed', output_data = ?, completed_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify({ error: err.message }), runId);
      });
  } catch (err) {
    db.prepare("UPDATE agent_runs SET status = 'failed', output_data = ?, completed_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify({ error: err.message }), runId);
  }

  if (isJson) {
    return res.json({ run_id: runId, status: 'running' });
  }

  req.flash('success', `Agent "${agent_type}" started.`);
  res.redirect('/agents');
});

// ── View run detail ───────────────────────────────────
router.get('/runs/:id', (req, res) => {
  const db = getDb();
  const run = db.prepare(`
    SELECT ar.*, p.name as profile_name
    FROM agent_runs ar
    JOIN profiles p ON ar.profile_id = p.id
    WHERE ar.id = ? AND p.tenant_id = ?
  `).get(req.params.id, req.session.user.tenant_id);

  if (!run) {
    req.flash('error', 'Run not found.');
    return res.redirect('/agents');
  }

  res.render('agents/detail', { title: `Run ${run.id.substring(0, 8)} — UAE`, run });
});

module.exports = router;
