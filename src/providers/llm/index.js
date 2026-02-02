/**
 * LLM Provider Abstraction
 * ─────────────────────────────────────────────────────
 * Swap between OpenAI, Anthropic, or any future provider
 * by changing LLM_PROVIDER in .env. The rest of the
 * codebase calls getLLM().complete() and never cares
 * which model is behind it.
 */

class BaseLLM {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {object} opts - { temperature, maxTokens }
   * @returns {Promise<{ text: string, tokensUsed: number }>}
   */
  async complete(systemPrompt, userMessage, opts = {}) {
    throw new Error('complete() not implemented');
  }
}

class OpenAIProvider extends BaseLLM {
  async complete(systemPrompt, userMessage, opts = {}) {
    // Dynamic import so the app doesn't crash if openai isn't installed
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model || 'gpt-4o',
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens || 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    return {
      text: data.choices[0].message.content,
      tokensUsed: data.usage?.total_tokens || 0,
    };
  }
}

class AnthropicProvider extends BaseLLM {
  async complete(systemPrompt, userMessage, opts = {}) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model || 'claude-sonnet-4-20250514',
        max_tokens: opts.maxTokens || 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    return {
      text: data.content[0].text,
      tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  }
}

const providers = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
};

function getLLM(providerOverride) {
  const name = providerOverride || process.env.LLM_PROVIDER || 'openai';
  const Provider = providers[name];
  if (!Provider) throw new Error(`Unknown LLM provider: ${name}`);
  return new Provider();
}

module.exports = { getLLM, BaseLLM, providers };
