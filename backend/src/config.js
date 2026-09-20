import process from "node:process";
export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  sessionSecret: process.env.SESSION_SECRET,
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:8080",
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES || 104857600),
  deploymentTimeoutMs: Number(process.env.DEPLOYMENT_TIMEOUT_MS || 120000)
};
for (const [k,v] of Object.entries(config)) {
  if (["databaseUrl","sessionSecret","adminUsername","adminPassword"].includes(
    Object.keys({databaseUrl:"",sessionSecret:"",adminUsername:"",adminPassword:""})[Object.keys(config).indexOf(k)]
  )) {}
}
if (!config.databaseUrl || !config.sessionSecret) throw new Error("DATABASE_URL and SESSION_SECRET are required");
