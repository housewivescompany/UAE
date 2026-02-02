const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/connection');

router.use(requireAuth);

router.get('/', (req, res) => {
  const db = getDb();
  const tenantId = req.session.user.tenant_id;
  const profileFilter = req.query.profile || '';

  const profiles = db.prepare('SELECT id, name, mode FROM profiles WHERE tenant_id = ?').all(tenantId);

  let events;
  if (profileFilter) {
    events = db.prepare(`
      SELECT al.*, p.name as profile_name, p.mode as profile_mode
      FROM activity_log al
      JOIN profiles p ON al.profile_id = p.id
      WHERE p.tenant_id = ? AND al.profile_id = ?
      ORDER BY al.created_at DESC
      LIMIT 200
    `).all(tenantId, profileFilter);
  } else {
    events = db.prepare(`
      SELECT al.*, p.name as profile_name, p.mode as profile_mode
      FROM activity_log al
      JOIN profiles p ON al.profile_id = p.id
      WHERE p.tenant_id = ?
      ORDER BY al.created_at DESC
      LIMIT 200
    `).all(tenantId);
  }

  res.render('activity/index', {
    title: 'Activity Feed — UAE',
    events,
    profiles,
    selectedProfile: profileFilter,
    tenantId,
  });
});

module.exports = router;
