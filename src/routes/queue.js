/**
 * Lead Queue Route
 * ─────────────────────────────────────────────────────
 * Dashboard for reviewing discovered leads and generating
 * outreach drafts. "Draft Station" model: AI handles
 * intelligence + drafting, humans handle delivery.
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/connection');
const { getAgentRunner } = require('../agents/runner');

router.use(requireAuth);

/* ── Helpers ────────────────────────────────────────── */

/** Detect outreach platform from contact source / URL */
function detectPlatform(contact) {
  const url = (contact.profile_url || '').toLowerCase();
  const src = (contact.source || '').toLowerCase();
  if (url.includes('reddit.com') || src.includes('reddit'))     return 'reddit';
  if (url.includes('twitter.com') || url.includes('x.com') || src.includes('twitter'))  return 'twitter';
  if (url.includes('facebook.com') || src.includes('facebook')) return 'facebook';
  if (url.includes('linkedin.com') || src.includes('linkedin')) return 'linkedin';
  if (url.includes('nextdoor.com') || src.includes('nextdoor')) return 'nextdoor';
  if (contact.email) return 'email';
  if (contact.phone) return 'sms';
  return 'dm';
}

/** Build research hooks string from contact data */
function buildHooks(contact) {
  const parts = [];
  if (contact.notes) parts.push(contact.notes);
  if (contact.source) parts.push(`Found via: ${contact.source}`);
  if (contact.social_handle) parts.push(`Handle: ${contact.social_handle}`);
  if (contact.issues_care) {
    try {
      const issues = JSON.parse(contact.issues_care);
      if (issues.length) parts.push(`Cares about: ${issues.join(', ')}`);
    } catch { /* skip */ }
  }
  return parts.join('\n') || 'No specific hooks available.';
}

/* ── GET / — Main queue page ───────────────────────── */
router.get('/', (req, res) => {
  const db = getDb();
  const tenantId = req.session.user.tenant_id;
  const profileFilter = req.query.profile || '';
  const statusFilter = req.query.status || '';

  let sql = `
    SELECT c.*, p.name AS profile_name, p.mode AS profile_mode,
           p.industry_context, p.candidate_name, p.candidate_party
    FROM contacts c
    JOIN profiles p ON c.profile_id = p.id
    WHERE p.tenant_id = ?
  `;
  const params = [tenantId];

  if (profileFilter) { sql += ' AND c.profile_id = ?'; params.push(profileFilter); }

  if (statusFilter) {
    sql += ' AND c.lead_status = ?';
    params.push(statusFilter);
  } else {
    sql += " AND c.lead_status IN ('cold','warm','hot')";
  }

  sql += ' ORDER BY c.created_at DESC LIMIT 100';
  const contacts = db.prepare(sql).all(...params);

  // Attach draft info + detected platform to each contact
  for (const c of contacts) {
    c.platform = detectPlatform(c);

    const lastDraft = db.prepare(`
      SELECT ar.id, ar.status, ar.output_data
      FROM agent_runs ar
      WHERE ar.contact_id = ? AND ar.agent_type = 'outreach'
      ORDER BY ar.created_at DESC LIMIT 1
    `).get(c.id);

    if (lastDraft) {
      c.draft_status = lastDraft.status;
      c.draft_run_id = lastDraft.id;
      if (lastDraft.status === 'completed' && lastDraft.output_data) {
        try {
          const out = JSON.parse(lastDraft.output_data);
          c.draft_message = out.message || '';
          c.draft_channel = out.channel || '';
        } catch { /* skip */ }
      }
    } else {
      c.draft_status = 'none';
    }
  }

  const profiles = db.prepare(
    'SELECT id, name, mode FROM profiles WHERE tenant_id = ? AND is_active = 1'
  ).all(tenantId);

  const totalLeads  = contacts.length;
  const withDrafts   = contacts.filter(c => c.draft_status === 'completed').length;
  const needsDrafts  = contacts.filter(c => c.draft_status === 'none').length;

  res.render('queue/index', {
    title: 'Lead Queue — UAE',
    contacts,
    profiles,
    selectedProfile: profileFilter,
    selectedStatus: statusFilter,
    totalLeads,
    withDrafts,
    needsDrafts,
  });
});

/* ── POST /:contactId/draft — trigger outreach draft ─ */
router.post('/:contactId/draft', async (req, res) => {
  const db = getDb();
  const tenantId = req.session.user.tenant_id;

  const contact = db.prepare(`
    SELECT c.*, p.name AS profile_name, p.mode AS profile_mode
    FROM contacts c
    JOIN profiles p ON c.profile_id = p.id
    WHERE c.id = ? AND p.tenant_id = ?
  `).get(req.params.contactId, tenantId);

  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const profile  = db.prepare('SELECT * FROM profiles WHERE id = ?').get(contact.profile_id);
  const platform = detectPlatform(contact);
  const hooks    = buildHooks(contact);
  const channelMap = {
    reddit: 'dm', twitter: 'dm', facebook: 'dm',
    linkedin: 'dm', nextdoor: 'dm',
    email: 'email', sms: 'sms', dm: 'dm',
  };

  const runId = uuidv4();
  db.prepare(`
    INSERT INTO agent_runs (id, profile_id, contact_id, agent_type, status, input_data, started_at)
    VALUES (?, ?, ?, 'outreach', 'running', ?, datetime('now'))
  `).run(runId, contact.profile_id, contact.id, JSON.stringify({ platform, channel: channelMap[platform] || 'dm' }));

  try {
    const runner = getAgentRunner('outreach');
    runner.execute(runId, profile, {
      contact: {
        first_name: contact.first_name,
        last_name: contact.last_name,
        company: contact.company,
        job_title: contact.job_title,
        social_handle: contact.social_handle,
      },
      research_hooks: hooks,
      channel: channelMap[platform] || 'dm',
      platform,
      tone: profile.mode === 'political'
        ? 'empathetic and community-focused'
        : 'professional but warm',
    }).catch(err => {
      db.prepare("UPDATE agent_runs SET status='failed', output_data=?, completed_at=datetime('now') WHERE id=?")
        .run(JSON.stringify({ error: err.message }), runId);
    });
  } catch (err) {
    db.prepare("UPDATE agent_runs SET status='failed', output_data=?, completed_at=datetime('now') WHERE id=?")
      .run(JSON.stringify({ error: err.message }), runId);
  }

  res.json({ run_id: runId, status: 'running', platform });
});

/* ── GET /poll/:runId — poll for draft completion ──── */
router.get('/poll/:runId', (req, res) => {
  const db = getDb();
  const run = db.prepare(`
    SELECT ar.status, ar.output_data
    FROM agent_runs ar
    JOIN profiles p ON ar.profile_id = p.id
    WHERE ar.id = ? AND p.tenant_id = ?
  `).get(req.params.runId, req.session.user.tenant_id);

  if (!run) return res.status(404).json({ error: 'Run not found' });

  const result = { status: run.status };
  if (run.status === 'completed' && run.output_data) {
    try {
      const out = JSON.parse(run.output_data);
      result.message = out.message || '';
      result.channel = out.channel || '';
    } catch { /* skip */ }
  } else if (run.status === 'failed' && run.output_data) {
    try { result.error = JSON.parse(run.output_data).error || 'Draft failed'; }
    catch { result.error = 'Draft generation failed'; }
  }
  res.json(result);
});

/* ── POST /:contactId/status — update lead status ──── */
router.post('/:contactId/status', (req, res) => {
  const db = getDb();
  const tenantId = req.session.user.tenant_id;
  const { status } = req.body;

  const allowed = ['cold', 'warm', 'hot', 'converted', 'lost'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const contact = db.prepare(`
    SELECT c.id FROM contacts c
    JOIN profiles p ON c.profile_id = p.id
    WHERE c.id = ? AND p.tenant_id = ?
  `).get(req.params.contactId, tenantId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  db.prepare("UPDATE contacts SET lead_status=?, updated_at=datetime('now') WHERE id=?")
    .run(status, req.params.contactId);

  res.json({ ok: true, status });
});

module.exports = router;
