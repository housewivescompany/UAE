const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/connection');

router.use(requireAuth);

router.get('/', (req, res) => {
  const db = getDb();
  const tenantId = req.session.user.tenant_id;
  const profileId = req.query.profile;
  const status = req.query.status;

  let sql = `
    SELECT c.*, p.name as profile_name, p.mode as profile_mode
    FROM contacts c
    JOIN profiles p ON c.profile_id = p.id
    WHERE p.tenant_id = ?
  `;
  const params = [tenantId];

  if (profileId) { sql += ' AND c.profile_id = ?'; params.push(profileId); }
  if (status) { sql += ' AND (c.lead_status = ? OR c.voter_intent = ? OR c.donor_intent = ?)'; params.push(status, status, status); }

  sql += ' ORDER BY c.updated_at DESC LIMIT 100';

  const contacts = db.prepare(sql).all(...params);
  const profiles = db.prepare('SELECT id, name, mode FROM profiles WHERE tenant_id = ?').all(tenantId);

  res.render('contacts/index', {
    title: 'Contacts — UAE',
    contacts,
    profiles,
    selectedProfile: profileId,
    selectedStatus: status,
  });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const contact = db.prepare(`
    SELECT c.*, p.name as profile_name, p.mode as profile_mode
    FROM contacts c
    JOIN profiles p ON c.profile_id = p.id
    WHERE c.id = ? AND p.tenant_id = ?
  `).get(req.params.id, req.session.user.tenant_id);

  if (!contact) {
    req.flash('error', 'Contact not found.');
    return res.redirect('/contacts');
  }

  const messages = db.prepare(
    'SELECT * FROM messages WHERE contact_id = ? ORDER BY created_at DESC'
  ).all(contact.id);

  const sentiment = db.prepare(
    'SELECT * FROM sentiment_log WHERE contact_id = ? ORDER BY recorded_at DESC LIMIT 20'
  ).all(contact.id);

  res.render('contacts/detail', {
    title: `${contact.first_name} ${contact.last_name} — UAE`,
    contact,
    messages,
    sentiment,
  });
});

module.exports = router;
