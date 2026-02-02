/**
 * CRM / Integration Provider Abstraction
 * ─────────────────────────────────────────────────────
 * Each integration provider (Constant Contact, Beehiiv,
 * NationBuilder, WordPress) is a class that exposes a
 * standard interface for push/pull contacts and tags.
 */

class BaseCRM {
  constructor(config = {}) {
    this.config = config;
  }

  async testConnection() { throw new Error('testConnection() not implemented'); }
  async pushContact(contact) { throw new Error('pushContact() not implemented'); }
  async pullContacts(opts) { throw new Error('pullContacts() not implemented'); }
  async addTag(contactId, tag) { throw new Error('addTag() not implemented'); }
  async addNote(contactId, note) { throw new Error('addNote() not implemented'); }
}

class ConstantContactProvider extends BaseCRM {
  async testConnection() {
    const res = await fetch('https://api.cc.email/v3/account/summary', {
      headers: { 'Authorization': `Bearer ${this.config.access_token}` },
    });
    if (!res.ok) throw new Error(`Constant Contact: ${res.status}`);
    return { success: true, message: 'Connected to Constant Contact' };
  }

  async pushContact(contact) {
    const res = await fetch('https://api.cc.email/v3/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.access_token}`,
      },
      body: JSON.stringify({
        email_address: { address: contact.email },
        first_name: contact.first_name,
        last_name: contact.last_name,
      }),
    });
    return res.json();
  }

  async pullContacts(opts = {}) {
    const res = await fetch(`https://api.cc.email/v3/contacts?limit=${opts.limit || 50}`, {
      headers: { 'Authorization': `Bearer ${this.config.access_token}` },
    });
    return res.json();
  }
}

class BeehiivProvider extends BaseCRM {
  get baseUrl() {
    return `https://api.beehiiv.com/v2/publications/${this.config.extra_config?.publication_id || process.env.BEEHIIV_PUBLICATION_ID}`;
  }

  async testConnection() {
    const res = await fetch(this.baseUrl, {
      headers: { 'Authorization': `Bearer ${this.config.api_key}` },
    });
    if (!res.ok) throw new Error(`Beehiiv: ${res.status}`);
    return { success: true, message: 'Connected to Beehiiv' };
  }

  async pushContact(contact) {
    const res = await fetch(`${this.baseUrl}/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.api_key}`,
      },
      body: JSON.stringify({ email: contact.email }),
    });
    return res.json();
  }
}

class NationBuilderProvider extends BaseCRM {
  get baseUrl() {
    const slug = this.config.extra_config?.slug || process.env.NATIONBUILDER_SLUG;
    return `https://${slug}.nationbuilder.com/api/v2`;
  }

  get headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.access_token || process.env.NATIONBUILDER_API_TOKEN}`,
    };
  }

  async testConnection() {
    const res = await fetch(`${this.baseUrl}/people?page[size]=1`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`NationBuilder: ${res.status}`);
    return { success: true, message: 'Connected to NationBuilder' };
  }

  async pushContact(contact) {
    const res = await fetch(`${this.baseUrl}/people`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        data: {
          type: 'people',
          attributes: {
            first_name: contact.first_name,
            last_name: contact.last_name,
            email: contact.email,
          },
        },
      }),
    });
    return res.json();
  }

  async pullContacts(opts = {}) {
    const res = await fetch(`${this.baseUrl}/people?page[size]=${opts.limit || 50}`, {
      headers: this.headers,
    });
    return res.json();
  }

  async addTag(contactId, tag) {
    const res = await fetch(`${this.baseUrl}/people/${contactId}/taggings`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        data: { type: 'taggings', attributes: { tag } },
      }),
    });
    return res.json();
  }

  async addNote(contactId, note) {
    const res = await fetch(`${this.baseUrl}/people/${contactId}/contact_notes`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        data: {
          type: 'contact_notes',
          attributes: { content: note },
        },
      }),
    });
    return res.json();
  }
}

class WordPressWebhookProvider extends BaseCRM {
  async testConnection() {
    const res = await fetch(this.config.endpoint_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });
    if (!res.ok) throw new Error(`WordPress Webhook: ${res.status}`);
    return { success: true, message: 'Webhook endpoint responded' };
  }

  async pushContact(contact) {
    const res = await fetch(this.config.endpoint_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contact),
    });
    return res.json();
  }
}

const providers = {
  constant_contact: ConstantContactProvider,
  beehiiv: BeehiivProvider,
  nationbuilder: NationBuilderProvider,
  wordpress: WordPressWebhookProvider,
  custom_webhook: WordPressWebhookProvider,
};

function getCRM(providerName, config = {}) {
  const Provider = providers[providerName];
  if (!Provider) throw new Error(`Unknown CRM provider: ${providerName}`);
  return new Provider(config);
}

module.exports = { getCRM, BaseCRM, providers };
