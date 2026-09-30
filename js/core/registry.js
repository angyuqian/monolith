// Registries for agents and orchestrator tools. See agents/_template.js for the agent contract.
const agents = new Map();
const tools = new Map();

export const registry = {
  registerAgent(agent) {
    if (!agent?.id) throw new Error('Agent needs an id');
    agents.set(agent.id, agent);
    (agent.tools || []).forEach((t) => registry.registerTool({ ...t, agentId: agent.id }));
  },
  registerTool(tool) {
    tools.set(tool.name, tool);
  },
  agents: () => [...agents.values()],
  // agents with a card in the hub / constellation (hidden: true agents own their UI elsewhere, e.g. voice)
  visibleAgents: () => [...agents.values()].filter((a) => !a.hidden),
  agent: (id) => agents.get(id),
  tools: () => [...tools.values()],
  tool: (name) => tools.get(name),
};
