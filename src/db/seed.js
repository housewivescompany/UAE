/**
 * Seeds the database with a demo tenant, user, and sample profiles
 * for both business and political modes.
 */
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getDb } = require('./connection');

// Ensure tables exist first
require('./migrate');

function seed() {
  const db = getDb();

  const tenantId = uuidv4();
  const userId = uuidv4();
  const bizProfileId = uuidv4();
  const polProfileId = uuidv4();

  // ── Tenant ──────────────────────────────────────────
  db.prepare(`
    INSERT OR IGNORE INTO tenants (id, name, slug, owner_email, mode)
    VALUES (?, ?, ?, ?, ?)
  `).run(tenantId, 'HousewivesCompany Agency', 'housewives-agency', 'admin@housewivescompany.com', 'agency');

  // ── User ────────────────────────────────────────────
  const hash = bcrypt.hashSync('demo1234', 10);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, tenant_id, email, password_hash, display_name, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, tenantId, 'admin@housewivescompany.com', hash, 'Admin', 'owner');

  // ── Business Profile ────────────────────────────────
  db.prepare(`
    INSERT OR IGNORE INTO profiles (
      id, tenant_id, name, mode,
      industry_context, target_persona, knowledge_base,
      price_objections, service_offerings
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bizProfileId, tenantId, 'Premium Plumbing Leads', 'business',
    'Residential and commercial plumbing services in the Greater Toronto Area. Focus on emergency repairs and bathroom renovations.',
    'Homeowners aged 35-65 with household income >$80k who have owned their home for 5+ years. They search Google for "plumber near me" and value reliability over price.',
    JSON.stringify([
      'https://example.com/plumbing-faq',
      'Common plumbing issues include leaky faucets, clogged drains, water heater problems, and pipe bursts.'
    ]),
    JSON.stringify(['Too expensive', 'I can DIY', 'Already have a plumber', 'Not urgent right now']),
    JSON.stringify(['Emergency Repairs', '24/7 Service', 'Bathroom Renovation', 'Water Heater Install'])
  );

  // ── Political Profile ───────────────────────────────
  db.prepare(`
    INSERT OR IGNORE INTO profiles (
      id, tenant_id, name, mode,
      industry_context, target_persona, knowledge_base,
      riding_name, riding_code, geographic_focus,
      policy_pillars, policy_objections,
      candidate_name, candidate_party, exhaustion_gap
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    polProfileId, tenantId, 'Ottawa Centre - Federal 2025', 'political',
    'Federal Liberal campaign in Ottawa Centre riding. Focus on urban professionals and young families concerned about housing and climate action.',
    'Urban professionals aged 25-45, renters and first-time buyers frustrated with housing costs. Likely voted Liberal or NDP in 2021. Active on social media, reads CBC and local Ottawa Citizen.',
    JSON.stringify([
      'https://liberal.ca/platform',
      'Key housing plan: $40B housing accelerator fund, first-time buyer incentive, foreign buyer ban extension.',
      'Climate: Net-zero by 2050, carbon pricing with rebates, clean electricity standard.'
    ]),
    'Ottawa Centre', '35075',
    JSON.stringify({ province: 'Ontario', city: 'Ottawa', postal_prefixes: ['K1N', 'K1P', 'K1R', 'K1S', 'K1Y', 'K1Z'] }),
    JSON.stringify(['Housing Affordability', 'Climate Action', 'Healthcare Wait Times', 'Cost of Living']),
    JSON.stringify(['Carbon tax increases grocery bills', 'Housing plan is too slow', 'Healthcare is provincial not federal']),
    'Mark Carney', 'Liberal',
    'Voter fatigue is high after 9 years of Liberal government. Messaging must acknowledge frustration while pivoting to fresh leadership narrative. Avoid defensive tone—lead with concrete deliverables.'
  );

  console.log('Seed complete');
  console.log(`  Login: admin@housewivescompany.com / demo1234`);
}

seed();
