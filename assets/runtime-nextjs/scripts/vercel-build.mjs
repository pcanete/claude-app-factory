import { spawnSync } from "node:child_process";

function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.VERCEL_ENV === "production") {
  console.log("Preparing the production database...");
  run("scripts/apply-migrations.mjs");

  if (process.env.BOOTSTRAP_ADMIN_EMAIL?.trim()) {
    run("scripts/bootstrap-admin.mjs");
  } else {
    console.log("Skipping the first administrator: BOOTSTRAP_ADMIN_EMAIL is not configured.");
  }
}

run("node_modules/next/dist/bin/next", ["build"]);
