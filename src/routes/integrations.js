const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/connection');
const { testConnection } = require('../providers/crm/tester');

router.use(requireAuth);

// ── Save integration config ──────────────────────────
router.post('/', (req, res) => {
  const db = getDb();
  const b = req.body;

  // Verify profile belongs to tenant
  const profile = db.prepare('SELECT id FROM profiles WHERE id = ? AND tenant_id = ?')
    .get(b.profile_id, req.session.user.tenant_id);
  if (!profile) {
    req.flash('error', 'Profile not found.');
    return res.redirect('/profiles');
  }

  if (b.integration_id) {
    db.prepare(`
      UPDATE integrations SET
        provider = ?, api_key = ?, api_secret = ?,
        access_token = ?, endpoint_url = ?, extra_config = ?
      WHERE id = ? AND profile_id = ?
    `).run(
      b.provider, b.api_key || null, b.api_secret || null,
      b.access_token || null, b.endpoint_url || null, b.extra_config || null,
      b.integration_id, b.profile_id,
    );
  } else {
    db.prepare(`
      INSERT INTO integrations (id, profile_id, provider, api_key, api_secret, access_token, endpoint_url, extra_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), b.profile_id, b.provider,
      b.api_key || null, b.api_secret || null,
      b.access_token || null, b.endpoint_url || null, b.extra_config || null,
    );
  }

  req.flash('success', `${b.provider} integration saved.`);
  res.redirect(`/profiles/${b.profile_id}/edit`);
});

// ── Test connection ───────────────────────────────────
router.post('/:id/test', async (req, res) => {
  const db = getDb();
  const integration = db.prepare(`
    SELECT i.* FROM integrations i
    JOIN profiles p ON i.profile_id = p.id
    WHERE i.id = ? AND p.tenant_id = ?
  `).get(req.params.id, req.session.user.tenant_id);

  if (!integration) {
    return res.json({ success: false, message: 'Integration not found.' });
  }

  const result = await testConnection(integration);

  db.prepare(`
    UPDATE integrations SET is_verified = ?, last_tested_at = datetime('now')
    WHERE id = ?
  `).run(result.success ? 1 : 0, integration.id);

  res.json(result);
});

// ── Delete integration ────────────────────────────────
router.post('/:id/delete', (req, res) => {
  const db = getDb();
  const integration = db.prepare(`
    SELECT i.profile_id FROM integrations i
    JOIN profiles p ON i.profile_id = p.id
    WHERE i.id = ? AND p.tenant_id = ?
  `).get(req.params.id, req.session.user.tenant_id);

  if (!integration) {
    req.flash('error', 'Integration not found.');
    return res.redirect('/profiles');
  }

  db.prepare('DELETE FROM integrations WHERE id = ?').run(req.params.id);
  req.flash('success', 'Integration removed.');
  res.redirect(`/profiles/${integration.profile_id}/edit`);
});

module.exports = router;
