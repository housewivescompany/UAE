const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/connection');

router.use(requireAuth);

router.get('/', (req, res) => {
  const db = getDb();
  const tenantId = req.session.user.tenant_id;
  const profileId = req.query.profile;

  // Issue-level aggregation
  let issueSql = `
    SELECT sl.issue,
           sl.intent_type,
           AVG(sl.sentiment_score) as avg_score,
           COUNT(*) as readings,
           MAX(sl.recorded_at) as last_reading
    FROM sentiment_log sl
    JOIN profiles p ON sl.profile_id = p.id
    WHERE p.tenant_id = ? AND p.mode = 'political'
  `;
  const issueParams = [tenantId];
  if (profileId) { issueSql += ' AND sl.profile_id = ?'; issueParams.push(profileId); }
  issueSql += ' GROUP BY sl.issue, sl.intent_type ORDER BY readings DESC';

  const issueBreakdown = db.prepare(issueSql).all(...issueParams);

  // Time series (last 30 entries)
  let tsSql = `
    SELECT sl.recorded_at, sl.issue, sl.sentiment_score, sl.intent_type,
           c.first_name, c.last_name
    FROM sentiment_log sl
    JOIN profiles p ON sl.profile_id = p.id
    LEFT JOIN contacts c ON sl.contact_id = c.id
    WHERE p.tenant_id = ? AND p.mode = 'political'
  `;
  const tsParams = [tenantId];
  if (profileId) { tsSql += ' AND sl.profile_id = ?'; tsParams.push(profileId); }
  tsSql += ' ORDER BY sl.recorded_at DESC LIMIT 50';

  const timeline = db.prepare(tsSql).all(...tsParams);

  // Voter vs Donor intent summary
  const intentSummary = db.prepare(`
    SELECT
      c.voter_intent,
      c.donor_intent,
      COUNT(*) as cnt
    FROM contacts c
    JOIN profiles p ON c.profile_id = p.id
    WHERE p.tenant_id = ? AND p.mode = 'political'
    GROUP BY c.voter_intent, c.donor_intent
  `).all(tenantId);

  const polProfiles = db.prepare(
    "SELECT id, name FROM profiles WHERE tenant_id = ? AND mode = 'political'"
  ).all(tenantId);

  res.render('sentiment/index', {
    title: 'Sentiment Tracking — UAE',
    issueBreakdown,
    timeline,
    intentSummary,
    polProfiles,
    selectedProfile: profileId,
  });
});

module.exports = router;
