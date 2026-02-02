/**
 * Agent Runner Factory
 * ─────────────────────────────────────────────────────
 * Returns the correct agent class based on agent_type.
 * Each agent follows the same interface: execute(runId, profile, input)
 */

const ResearcherAgent = require('./researcher');
const OutreachAgent = require('./outreach');
const SecretaryAgent = require('./secretary');
const IssueScoutAgent = require('./issue-scout');
const PersuaderAgent = require('./persuader');
const DonorCloserAgent = require('./donor-closer');

const agents = {
  // Business agents
  researcher: ResearcherAgent,
  outreach: OutreachAgent,
  secretary: SecretaryAgent,

  // Political agents
  issue_scout: IssueScoutAgent,
  persuader: PersuaderAgent,
  donor_closer: DonorCloserAgent,
};

function getAgentRunner(agentType) {
  const Agent = agents[agentType];
  if (!Agent) throw new Error(`Unknown agent type: ${agentType}`);
  return new Agent();
}

module.exports = { getAgentRunner, agents };
