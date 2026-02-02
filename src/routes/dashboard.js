const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/connection');

router.use(requireAuth);

router.get('/', (req, res) => {
  const db = getDb();
  const tenantId = req.session.user.tenant_id;

  const profiles = db.prepare('SELECT * FROM profiles WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
  const profileCount = profiles.length;
  const bizProfiles = profiles.filter(p => p.mode === 'business');
  const polProfiles = profiles.filter(p => p.mode === 'political');

  const contactCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM contacts c
    JOIN profiles p ON c.profile_id = p.id
    WHERE p.tenant_id = ?
  `).get(tenantId).cnt;

  const agentRunStats = db.prepare(`
    SELECT
      agent_type,
      status,
      COUNT(*) as cnt
    FROM agent_runs ar
    JOIN profiles p ON ar.profile_id = p.id
    WHERE p.tenant_id = ?
    GROUP BY agent_type, status
  `).all(tenantId);

  const recentRuns = db.prepare(`
    SELECT ar.*, p.name as profile_name
    FROM agent_runs ar
    JOIN profiles p ON ar.profile_id = p.id
    WHERE p.tenant_id = ?
    ORDER BY ar.created_at DESC
    LIMIT 10
  `).all(tenantId);

  // Sentiment summary for political profiles
  const sentimentSummary = db.prepare(`
    SELECT
      sl.issue,
      AVG(sl.sentiment_score) as avg_score,
      COUNT(*) as readings
    FROM sentiment_log sl
    JOIN profiles p ON sl.profile_id = p.id
    WHERE p.tenant_id = ? AND p.mode = 'political'
    GROUP BY sl.issue
    ORDER BY readings DESC
    LIMIT 10
  `).all(tenantId);

  res.render('dashboard/index', {
    title: 'Dashboard — UAE',
    profiles,
    bizProfiles,
    polProfiles,
    profileCount,
    contactCount,
    agentRunStats,
    recentRuns,
    sentimentSummary,
    tenantMode: req.session.tenant.mode,
  });
});

module.exports = router;
