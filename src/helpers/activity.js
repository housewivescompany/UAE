const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

function emitActivity(profileId, { agentRunId, contactId, eventType, icon, color, title, detail }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO activity_log (id, profile_id, agent_run_id, contact_id, event_type, icon, color, title, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(), profileId,
    agentRunId || null, contactId || null,
    eventType, icon || 'bi-circle', color || 'var(--uae-text-muted)',
    title, detail || null
  );
}

module.exports = { emitActivity };
