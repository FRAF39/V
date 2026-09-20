import { config } from "./config.js";

export function platformStatus() {
  const renderConfigured = Boolean(config.renderApiKey && config.renderOwnerId && config.renderRepo);
  return {
    product: "PRIYO CODEX HOST",
    edition: "Professional",
    authentication: "panel-admin",
    renderConnected: renderConfigured,
    render: renderConfigured ? { repo: config.renderRepo, branch: config.renderBranch, region: config.renderRegion, plan: config.renderPlan } : null,
    note: "Render credentials are never requested in the UI. The panel uses its configured server-side API key."
  };
}
