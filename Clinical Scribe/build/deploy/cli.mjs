// Runs the Supabase command-line tool from the tool folder, where it finds the
// supabase/ folder with the migrations, functions and config.toml.
import { spawn } from "node:child_process";
import { DeployError } from "./output.mjs";

function command(settings, args) {
  // Automated tests use a stand-in tool written in JavaScript.
  if (/\.m?js$/.test(settings.cli)) return [process.execPath, [settings.cli, ...args]];
  return [settings.cli, args];
}

/** Runs the tool and resolves with what it printed. Its output is also shown live. */
export function runCli(settings, args, label, { quiet = false } = {}) {
  const env = {
    ...process.env,
    SUPABASE_ACCESS_TOKEN: settings.accessToken,
    SUPABASE_DB_PASSWORD: settings.dbPassword,
  };
  const [file, fullArgs] = command(settings, args);
  return new Promise((resolve, reject) => {
    let output = "";
    // Nothing is ever typed into the tool, so it can never wait for an answer.
    const child = spawn(file, fullArgs, { cwd: settings.root, env, stdio: ["ignore", "pipe", "pipe"] });
    const keep = (stream, target) => {
      stream.on("data", (chunk) => {
        output += chunk;
        if (!quiet) target.write(chunk);
      });
    };
    keep(child.stdout, process.stdout);
    keep(child.stderr, process.stderr);
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new DeployError("The Supabase command-line tool was not found. Install it (https://supabase.com/docs/guides/local-development/cli/getting-started) and run the deploy again."));
      } else {
        reject(new DeployError(`${label} could not start: ${error.message}`));
      }
    });
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new DeployError(`${label} did not finish. The messages above say why.`));
    });
  });
}

// "2.119.0" from the tool's version output, or null.
export function parseCliVersion(text) {
  const match = String(text ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}
