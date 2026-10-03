// Personal templates are made with the template helper, used for notes and
// deleted. Admins make templates for everyone or for themselves.
import { expect, test } from "@playwright/test";
import { ADMIN, go, record, signIn, signOut, USER } from "./helpers.mjs";

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

  // It can be deleted although a note was written with it; the note stays.
  await go(page, "/templates");
  await page.locator(".template-card", { hasText: "Clerking note" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Delete" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Delete template" }).click();
  await expect(page.locator(".toast", { hasText: "The template has been deleted." })).toBeVisible();
  await expect(page.locator(".template-card", { hasText: "Clerking note" })).toHaveCount(0);
  await go(page, "/history");
  await page.getByRole("link", { name: /Clerking test/ }).click();
  await expect(page.locator(".note-card .heading-line").first()).toHaveText("Presenting complaint:");
});

async function draftWithHelper(page, { name, scope }) {
  await page.getByRole("button", { name: "Create template" }).first().click();
  const dialog = page.locator("dialog[open]");
  const choice = dialog.getByRole("group", { name: "Who can use this template?" });
  await expect(choice.getByRole("button", { name: "Everyone in the clinic" })).toHaveAttribute("aria-pressed", "true");
  if (scope === "personal") await choice.getByRole("button", { name: "Only me" }).click();
  await dialog.getByLabel("Describe the note you want").fill("Ward round note: progress, examination, results and plan.");
  await dialog.getByRole("button", { name: "Create template" }).click();
  await expect(dialog.getByLabel("Template", { exact: true })).not.toHaveValue("", { timeout: 60_000 });
  await expect(dialog.getByRole("group", { name: "Who can use this template?" }).getByRole("button", { name: scope === "personal" ? "Only me" : "Everyone in the clinic" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Template name").fill(name);
  await dialog.getByRole("button", { name: "Save template" }).click();
  await expect(dialog).toHaveCount(0);
}

test("admins make templates for everyone or only for themselves, and share their own later", async ({ page }) => {
  await signIn(page, ADMIN);
  await go(page, "/templates");
  const shared = page.locator("section", { has: page.getByRole("heading", { name: "Shared templates" }) });
  const mine = page.locator("section", { has: page.getByRole("heading", { name: "Your templates" }) });

  await draftWithHelper(page, { name: "Ward round (everyone)", scope: "shared" });
  await expect(shared.locator(".template-card", { hasText: "Ward round (everyone)" })).toBeVisible();
  await draftWithHelper(page, { name: "Ward round (mine)", scope: "personal" });
  await expect(mine.locator(".template-card", { hasText: "Ward round (mine)" })).toBeVisible();

  // A shared template: admins can make it the default, archive it or edit it.
  await shared.locator(".template-card", { hasText: "Ward round (everyone)" }).click();
  const view = page.locator("dialog[open]");
  for (const action of ["Archive", "Make default", "Edit"]) await expect(view.getByRole("button", { name: action })).toBeVisible();
  await view.getByRole("button", { name: "Archive" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Archive" }).click();
  await expect(shared.locator(".template-card", { hasText: "Ward round (everyone)" })).toHaveCount(0);

  // Their own template: share it with everyone.
  await mine.locator(".template-card", { hasText: "Ward round (mine)" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Share with everyone" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Share template" }).click();
  await expect(shared.locator(".template-card", { hasText: "Ward round (mine)" })).toBeVisible();
  await expect(mine.locator(".template-card", { hasText: "Ward round (mine)" })).toHaveCount(0);
  await signOut(page);

  // Everyone sees it; people who are not admins can only read shared templates.
  await signIn(page, USER);
  await go(page, "/templates");
  await shared.locator(".template-card", { hasText: "Ward round (mine)" }).click();
  const readOnly = page.locator("dialog[open]");
  await expect(readOnly.getByRole("button", { name: "Close" })).toHaveCount(2, { message: "the close icon and the Close button" });
  for (const action of ["Archive", "Make default", "Edit", "Delete"]) await expect(readOnly.getByRole("button", { name: action, exact: true })).toHaveCount(0);
});
