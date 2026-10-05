// Shared steps for the browser tests.
import { expect } from "@playwright/test";

export { ADMIN, USER } from "./seed.mjs";

// Collects console errors and failed requests so a test can assert there were none.
export function watchProblems(page) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    const url = response.url();
    // Expected refusals (a wrong password on purpose, the worker without its secret) are not problems.
    if (response.status() >= 400 && !/token\?grant_type=password/.test(url)) problems.push(`${response.status()} ${url}`);
  });
  return problems;
}

export async function signIn(page, who) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".shell")).toBeVisible();
}

export async function go(page, path) {
  await page.goto(`/#${path}`);
  await expect(page.locator(".content-inner h1").first()).toBeVisible();
}

export async function expectNoSideScroll(page) {
  const wider = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wider, "the page should not scroll sideways").toBeLessThanOrEqual(1);
}

export async function signOut(page) {
  const isPhone = (page.viewportSize()?.width ?? 1440) < 1024;
  if (isPhone) await page.locator(".topbar").getByRole("button", { name: "Account" }).click();
  else await page.locator(".sidebar").getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.locator(".login-card")).toBeVisible();
}

// Records for about `seconds`, with a pause in the middle, then finishes. With
// mode "voice" it records a Voice Note on the Voice Note tab.
export async function record(page, { seconds = 7, label = "", template = null, mode = "scribe" } = {}) {
  await go(page, mode === "voice" ? "/voice" : "/scribe");
  if (template) await page.getByLabel("Note template").selectOption({ label: template });
  if (label) await page.getByLabel("Label (optional)").fill(label);
  await page.getByRole("button", { name: mode === "voice" ? "Start voice note" : "Start recording" }).click();
  await expect(page.locator(".live-status")).toHaveText(/Recording/);
  await page.waitForTimeout(Math.round((seconds * 1000) / 2));
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator(".live-status")).toHaveText(/Paused/);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator(".live-status")).toHaveText(/Recording/);
  await page.waitForTimeout(Math.round((seconds * 1000) / 2));
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".progress-card")).toBeVisible();
}
