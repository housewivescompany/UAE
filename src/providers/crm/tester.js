/**
 * Integration connection tester.
 * Called from the dashboard "Test Connection" button.
 */
const { getCRM } = require('./index');

async function testConnection(integration) {
  try {
    const config = {
      api_key: integration.api_key,
      api_secret: integration.api_secret,
      access_token: integration.access_token,
      endpoint_url: integration.endpoint_url,
      extra_config: integration.extra_config ? JSON.parse(integration.extra_config) : {},
    };

    const crm = getCRM(integration.provider, config);
    const result = await crm.testConnection();
    return { success: true, message: result.message };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { testConnection };
