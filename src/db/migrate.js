/**
 * UAE Database Migration
 * ─────────────────────────────────────────────────────────────────
 * Multi-tenant schema supporting both Business ("Niche Profiles")
 * and Political ("Riding / Demographic Profiles") modes.
 *
 * Design principles:
 *  - One `profiles` table with a `mode` discriminator (business | political)
 *  - JSON columns for flexible, niche-specific data that varies per mode
 *  - Dedicated tables for leads/contacts, agent runs, sentiment, integrations
 *  - Full audit trail on every agent interaction
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const path = require('path');
const Database = require('better-sqlite3');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', '..');
const DB_PATH = path.join(DB_DIR, 'uae.db');

function migrate() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`

    /* ================================================================
       TENANTS — top-level account (your agency OR a client)
       ================================================================ */
    CREATE TABLE IF NOT EXISTS tenants (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      slug          TEXT NOT NULL UNIQUE,
      owner_email   TEXT NOT NULL,
      mode          TEXT NOT NULL DEFAULT 'agency'
                      CHECK (mode IN ('agency', 'client')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ================================================================
       USERS — dashboard login, scoped to a tenant
       ================================================================ */
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name  TEXT,
      role          TEXT NOT NULL DEFAULT 'member'
                      CHECK (role IN ('owner', 'admin', 'member')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ================================================================
       PROFILES — the universal "Niche / Riding" configuration
       ================================================================ */
    CREATE TABLE IF NOT EXISTS profiles (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      mode            TEXT NOT NULL DEFAULT 'business'
                        CHECK (mode IN ('business', 'political')),
      is_active       INTEGER NOT NULL DEFAULT 1,

      /* ── Shared fields ─────────────────────────────────────────── */
      industry_context  TEXT,           -- who & what (business) OR party/candidate context (political)
      target_persona    TEXT,           -- ideal customer OR ideal voter/donor demographic
      knowledge_base    TEXT,           -- JSON array of URLs / text blocks the agents draw from

      /* ── Business-specific (NULL when mode=political) ──────────── */
      price_objections  TEXT,           -- JSON array of common objections
      service_offerings TEXT,           -- JSON array of services/products

      /* ── Political-specific (NULL when mode=business) ──────────── */
      riding_name       TEXT,           -- e.g. "Ottawa Centre"
      riding_code       TEXT,           -- e.g. "35075"
      geographic_focus  TEXT,           -- JSON: province, city, postal codes
      policy_pillars    TEXT,           -- JSON array of key policy hooks
      policy_objections TEXT,           -- JSON array: carbon tax, housing, healthcare etc.
      candidate_name    TEXT,
      candidate_party   TEXT,
      voting_record_url TEXT,
      exhaustion_gap    TEXT,           -- notes on current political climate / tone guidance

      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON profiles(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_mode   ON profiles(mode);

    /* ================================================================
       INTEGRATION KEYS — per-profile API credentials
       ================================================================ */
    CREATE TABLE IF NOT EXISTS integrations (
      id              TEXT PRIMARY KEY,
      profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      provider        TEXT NOT NULL
                        CHECK (provider IN (
                          'constant_contact','beehiiv','nationbuilder',
                          'wordpress','mailchimp','custom_webhook'
                        )),
      api_key         TEXT,
      api_secret      TEXT,
      access_token    TEXT,
      refresh_token   TEXT,
      endpoint_url    TEXT,             -- webhook URL or base URL
      extra_config    TEXT,             -- JSON for provider-specific settings
      is_verified     INTEGER NOT NULL DEFAULT 0,
      last_tested_at  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_integrations_profile ON integrations(profile_id);

    /* ================================================================
       CONTACTS — leads (business) or constituents (political)
       ================================================================ */
    CREATE TABLE IF NOT EXISTS contacts (
      id              TEXT PRIMARY KEY,
      profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      external_id     TEXT,             -- NationBuilder ID, CRM ID, etc.

      first_name      TEXT,
      last_name       TEXT,
      email           TEXT,
      phone           TEXT,
      source          TEXT,             -- where we found them

      /* ── Business fields ───────────────────────────────────────── */
      company         TEXT,
      job_title       TEXT,
      lead_score      INTEGER DEFAULT 0,
      lead_status     TEXT DEFAULT 'cold'
                        CHECK (lead_status IN ('cold','warm','hot','converted','lost')),

      /* ── Political fields ──────────────────────────────────────── */
      riding          TEXT,
      voter_intent    TEXT DEFAULT 'unknown'
                        CHECK (voter_intent IN ('unknown','leaning','committed','opposed')),
      donor_intent    TEXT DEFAULT 'none'
                        CHECK (donor_intent IN ('none','potential','warm','donated')),
      issues_care     TEXT,             -- JSON array of issues they care about
      support_level   INTEGER DEFAULT 0, -- 0-100 sentiment score

      tags            TEXT,             -- JSON array
      notes           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_profile ON contacts(profile_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_email   ON contacts(email);
    CREATE INDEX IF NOT EXISTS idx_contacts_status  ON contacts(lead_status);
    CREATE INDEX IF NOT EXISTS idx_contacts_voter   ON contacts(voter_intent);
    CREATE INDEX IF NOT EXISTS idx_contacts_donor   ON contacts(donor_intent);

    /* ================================================================
       AGENT RUNS — audit log of every agent execution
       ================================================================ */
    CREATE TABLE IF NOT EXISTS agent_runs (
      id              TEXT PRIMARY KEY,
      profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      contact_id      TEXT REFERENCES contacts(id) ON DELETE SET NULL,
      agent_type      TEXT NOT NULL
                        CHECK (agent_type IN (
                          'researcher','outreach','secretary',
                          'issue_scout','persuader','donor_closer'
                        )),
      status          TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','completed','failed')),
      input_data      TEXT,             -- JSON
      output_data     TEXT,             -- JSON
      llm_provider    TEXT,             -- which LLM was used
      tokens_used     INTEGER DEFAULT 0,
      cost_cents      INTEGER DEFAULT 0,
      started_at      TEXT,
      completed_at    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_profile ON agent_runs(profile_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_type    ON agent_runs(agent_type);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status  ON agent_runs(status);

    /* ================================================================
       SENTIMENT LOG — political sentiment tracking over time
       ================================================================ */
    CREATE TABLE IF NOT EXISTS sentiment_log (
      id              TEXT PRIMARY KEY,
      profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      contact_id      TEXT REFERENCES contacts(id) ON DELETE SET NULL,
      source          TEXT,             -- 'agent_interaction', 'social_monitor', 'survey'
      issue           TEXT,             -- which policy issue
      sentiment_score INTEGER,          -- -100 to +100
      intent_type     TEXT              -- 'voter' or 'donor'
                        CHECK (intent_type IN ('voter', 'donor')),
      raw_signal      TEXT,             -- the actual text/data that produced this reading
      recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sentiment_profile ON sentiment_log(profile_id);
    CREATE INDEX IF NOT EXISTS idx_sentiment_issue   ON sentiment_log(issue);
    CREATE INDEX IF NOT EXISTS idx_sentiment_date    ON sentiment_log(recorded_at);

    /* ================================================================
       MESSAGES — every outbound/inbound message the agents handle
       ================================================================ */
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      agent_run_id    TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      direction       TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
      channel         TEXT NOT NULL CHECK (channel IN ('email','sms','dm','webhook')),
      subject         TEXT,
      body            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','delivered','opened','replied','bounced')),
      sent_at         TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
    CREATE INDEX IF NOT EXISTS idx_messages_run     ON messages(agent_run_id);

  `);

  console.log('Migration complete → uae.db');
  db.close();
}

migrate();
