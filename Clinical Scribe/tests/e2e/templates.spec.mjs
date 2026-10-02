// Personal templates are made with the template helper and then used for notes.
import { expect, test } from "@playwright/test";
import { go, record, signIn, USER } from "./helpers.mjs";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop size");
});

test("create a template with the helper, change it, save it and use it", async ({ page }) => {
  await signIn(page, USER);
  await go(page, "/templates");
  await page.getByRole("button", { name: "Create template" }).first().click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Describe the note you want").fill("Medical clerking note: presenting complaint, HOPI, past history, drugs and allergies, impression and plan.");
  await dialog.getByRole("button", { name: "Create template" }).click();
  await expect(dialog.getByLabel("Template", { exact: true })).toHaveValue(/Presenting complaint:/, { timeout: 60_000 });

  await dialog.getByLabel("Ask for changes").fill("Add a social history section.");
  await dialog.getByRole("button", { name: "Update template" }).click();
  await expect(dialog.getByLabel("Template", { exact: true })).toHaveValue(/Social history:/, { timeout: 60_000 });
  await dialog.getByLabel("Template name").fill("Clerking note");
  await dialog.getByRole("button", { name: "Save template" }).click();
  await expect(page.locator(".template-card", { hasText: "Clerking note" })).toBeVisible();

  await record(page, { seconds: 4, label: "Clerking test", template: "Clerking note" });
  await expect(page.getByRole("heading", { name: "Your note is ready" })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".note-card .heading-line").first()).toHaveText("Presenting complaint:");
  await expect(page.locator(".note-card")).toContainText("Social history:");
});
