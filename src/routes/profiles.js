const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/connection');

router.use(requireAuth);

// ── List all profiles ─────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const profiles = db.prepare(
    'SELECT * FROM profiles WHERE tenant_id = ? ORDER BY created_at DESC'
  ).all(req.session.user.tenant_id);

  res.render('profiles/index', {
    title: 'Profiles — UAE',
    profiles,
    bizProfiles: profiles.filter(p => p.mode === 'business'),
    polProfiles: profiles.filter(p => p.mode === 'political'),
  });
});

// ── New profile form ──────────────────────────────────
router.get('/new', (req, res) => {
  const mode = req.query.mode || 'business';
  res.render('profiles/form', {
    title: `New ${mode === 'political' ? 'Riding' : 'Niche'} Profile — UAE`,
    profile: { mode },
    isNew: true,
  });
});

// ── Edit profile form ─────────────────────────────────
router.get('/:id/edit', (req, res) => {
  const db = getDb();
  const profile = db.prepare(
    'SELECT * FROM profiles WHERE id = ? AND tenant_id = ?'
  ).get(req.params.id, req.session.user.tenant_id);

  if (!profile) {
    req.flash('error', 'Profile not found.');
    return res.redirect('/profiles');
  }

  const integrations = db.prepare(
    'SELECT * FROM integrations WHERE profile_id = ?'
  ).all(profile.id);

  res.render('profiles/form', {
    title: `Edit ${profile.name} — UAE`,
    profile,
    integrations,
    isNew: false,
  });
});

// ── Create / Update profile ───────────────────────────
router.post('/', (req, res) => {
  const db = getDb();
  const b = req.body;
  const tenantId = req.session.user.tenant_id;
  const isNew = !b.id;
  const id = b.id || uuidv4();

  // Normalize JSON array fields
  const toJsonArray = (val) => {
    if (!val) return '[]';
    if (Array.isArray(val)) return JSON.stringify(val);
    return JSON.stringify(val.split('\n').map(s => s.trim()).filter(Boolean));
  };

  if (isNew) {
    db.prepare(`
      INSERT INTO profiles (
        id, tenant_id, name, mode, is_active,
        industry_context, target_persona, knowledge_base,
        price_objections, service_offerings,
        riding_name, riding_code, geographic_focus,
        policy_pillars, policy_objections,
        candidate_name, candidate_party, voting_record_url, exhaustion_gap
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, b.name, b.mode, b.is_active ? 1 : 0,
      b.industry_context, b.target_persona, toJsonArray(b.knowledge_base),
      toJsonArray(b.price_objections), toJsonArray(b.service_offerings),
      b.riding_name || null, b.riding_code || null, b.geographic_focus || null,
      toJsonArray(b.policy_pillars), toJsonArray(b.policy_objections),
      b.candidate_name || null, b.candidate_party || null,
      b.voting_record_url || null, b.exhaustion_gap || null,
    );
    req.flash('success', 'Profile created.');
  } else {
    db.prepare(`
      UPDATE profiles SET
        name = ?, mode = ?, is_active = ?,
        industry_context = ?, target_persona = ?, knowledge_base = ?,
        price_objections = ?, service_offerings = ?,
        riding_name = ?, riding_code = ?, geographic_focus = ?,
        policy_pillars = ?, policy_objections = ?,
        candidate_name = ?, candidate_party = ?,
        voting_record_url = ?, exhaustion_gap = ?,
        updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `).run(
      b.name, b.mode, b.is_active ? 1 : 0,
      b.industry_context, b.target_persona, toJsonArray(b.knowledge_base),
      toJsonArray(b.price_objections), toJsonArray(b.service_offerings),
      b.riding_name || null, b.riding_code || null, b.geographic_focus || null,
      toJsonArray(b.policy_pillars), toJsonArray(b.policy_objections),
      b.candidate_name || null, b.candidate_party || null,
      b.voting_record_url || null, b.exhaustion_gap || null,
      id, tenantId,
    );
    req.flash('success', 'Profile updated.');
  }

  res.redirect(`/profiles/${id}/edit`);
});

// ── Delete profile ────────────────────────────────────
router.post('/:id/delete', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM profiles WHERE id = ? AND tenant_id = ?')
    .run(req.params.id, req.session.user.tenant_id);
  req.flash('success', 'Profile deleted.');
  res.redirect('/profiles');
});

module.exports = router;
