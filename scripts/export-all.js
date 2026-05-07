// export-all.js
// Runs every Wild Apricot exporter in sequence. Failures in one step do not
// stop the others. Final summary lists what worked and what didn't.

const { spawn } = require("child_process");
const path = require("path");

const STEPS = [
  { name: "config", file: "export-config.js" },
  { name: "events", file: "export-events.js" },
  { name: "registrations", file: "export-registrations.js" },
  { name: "contacts", file: "export-contacts.js" },
  { name: "invoices", file: "export-invoices.js" },
  { name: "payments", file: "export-payments.js" },
  { name: "donations", file: "export-donations.js" },
  { name: "audit-log", file: "export-audit-log.js" },
  { name: "files", file: "export-files.js" },
];

function runStep(step) {
  return new Promise((resolve) => {
    console.log(`\n========== ${step.name.toUpperCase()} ==========`);
    const child = spawn("node", [path.join(__dirname, step.file)], { stdio: "inherit" });
    child.on("exit", (code) => resolve({ ...step, exitCode: code }));
    child.on("error", (err) => {
      console.error(`Failed to start ${step.file}: ${err.message}`);
      resolve({ ...step, exitCode: 1 });
    });
  });
}

async function main() {
  const results = [];
  for (const step of STEPS) {
    results.push(await runStep(step));
  }

  console.log("\n========== SUMMARY ==========");
  for (const r of results) {
    const status = r.exitCode === 0 ? "OK   " : "FAIL ";
    console.log(`${status} ${r.name}`);
  }
  const failed = results.filter((r) => r.exitCode !== 0);
  if (failed.length) process.exit(1);
}

main();
