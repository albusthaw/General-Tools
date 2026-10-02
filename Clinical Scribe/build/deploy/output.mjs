// Progress output for whoever runs the deploy, in a terminal or on GitHub Actions.
// Nothing secret is ever passed to these functions except mask(), which tells
// GitHub to hide a value if it ever appears in the log.
import { appendFileSync } from "node:fs";

const onGitHub = process.env.GITHUB_ACTIONS === "true";
let groupOpen = false;

export class DeployError extends Error {}

// Removes anything that looks like a key or token from text that came back from a
// service, before it is shown.
export function scrub(text) {
  return String(text ?? "")
    .replace(/sb_(secret|publishable|temp)_[A-Za-z0-9_-]+/g, "[key]")
    .replace(/sbp_[A-Za-z0-9_]+/g, "[token]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[key]")
    .slice(0, 400);
}

export function mask(value) {
  if (onGitHub && typeof value === "string" && value.length > 0) {
    process.stdout.write(`::add-mask::${value}\n`);
  }
}

export function section(title) {
  endSection();
  if (onGitHub) {
    process.stdout.write(`::group::${title}\n`);
    groupOpen = true;
  } else {
    process.stdout.write(`\n== ${title}\n`);
  }
}

export function endSection() {
  if (groupOpen) process.stdout.write("::endgroup::\n");
  groupOpen = false;
}

export function info(text) {
  process.stdout.write(`   ${text}\n`);
}

export function done(text) {
  process.stdout.write(`   ✓ ${text}\n`);
}

// Workflow commands are one line, so line breaks are written in their escaped form.
const oneLine = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

export function warn(text) {
  if (onGitHub) process.stdout.write(`::warning::${oneLine(text)}\n`);
  else process.stdout.write(`   ! ${text}\n`);
}

// Closes any open group first, so the message is never hidden inside one.
export function failure(text) {
  endSection();
  if (onGitHub) process.stdout.write(`::error::${oneLine(text)}\n`);
  else process.stderr.write(`\n✗ ${text}\n`);
}

// Values for later workflow steps (never secrets).
export function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${String(value).replace(/[\r\n]/g, " ")}\n`);
}

// The short report shown on the workflow run page, or printed at the end.
export function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${lines.join("\n")}\n`);
  process.stdout.write(`\n${lines.join("\n").replace(/^#+ /gm, "").replace(/\*\*/g, "")}\n`);
}
