// Stand-in for the Supabase command-line tool in the deploy tests. It writes down
// how it was called and reports success, or fails on purpose when FAKE_CLI_FAIL
// names the command (for example "functions").
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_CLI_LOG) {
  appendFileSync(
    process.env.FAKE_CLI_LOG,
    `${JSON.stringify({
      args,
      cwd: process.cwd(),
      hasToken: Boolean(process.env.SUPABASE_ACCESS_TOKEN),
      hasDbPassword: Boolean(process.env.SUPABASE_DB_PASSWORD),
    })}\n`,
  );
}

if (args[0] === "--version") {
  console.log("2.119.0");
} else if (process.env.FAKE_CLI_FAIL && args[0] === process.env.FAKE_CLI_FAIL) {
  console.error(`The stand-in tool failed "${args.join(" ")}" on purpose.`);
  process.exit(1);
} else {
  console.log(`Stand-in tool ran: supabase ${args.join(" ")}`);
}
