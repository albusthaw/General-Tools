// Voice Note: one person dictating. It records like Clinical Scribe, uses its own
// templates (the Template Type), has its own History tab and shows its type on the
// admin pages. Only one recording runs at a time.
import { expect, test } from "@playwright/test";
import { ADMIN, expectNoSideScroll, go, record, signIn, USER, watchProblems } from "./helpers.mjs";

const optionsOf = (select) => select.locator("option").allTextContents();

test("record a Voice Note and get a Dictated note, in its own History tab", async ({ page }, testInfo) => {
  const problems = watchProblems(page);
  const label = `Dictated letter ${testInfo.project.name}`;
  await signIn(page, USER);

  // The pair of cards tells the two ways to record apart and switches between them.
  await go(page, "/scribe");
  const cards = page.locator(".mode-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Two or more people talking, like a consultation");
  await expect(cards.nth(1)).toContainText("Just you, dictating a note or a letter");
  await expect(cards.nth(0)).toHaveAttribute("aria-current", "page");
  await cards.nth(1).click();
  await expect(page.locator(".content-inner h1").first()).toHaveText("Voice Note");
  await expect(page.locator(".mode-card.is-voice")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".mode-hint")).toContainText("Speak as you would to a colleague.");
  await expect(page.getByRole("heading", { name: "New voice note" })).toBeVisible();

  // Only Voice Note templates, with Dictated note as the default.
  const choices = await optionsOf(page.getByLabel("Note template"));
  expect(choices).toContain("Dictated note (default)");
  expect(choices.some((name) => name.startsWith("SOAP note"))).toBe(false);
  await expectNoSideScroll(page);

  await record(page, { seconds: 4, label, mode: "voice" });
  await expect(page.getByRole("heading", { name: "Your note is ready" })).toBeVisible({ timeout: 120_000 });
  const note = page.locator(".note-card").first();
  await expect(note).toContainText("Dictated note");
  await expect(note.locator(".heading-line").first()).toHaveText("Summary:");
  await expect(note).toContainText("Blood pressure review.");
  await page.getByRole("button", { name: "Show transcript" }).click();
  await expect(page.locator(".transcript-body")).toContainText("Blood pressure review full stop");
  await expect(page.locator(".transcript-body")).not.toContainText("Speaker");
  await expect(page.getByRole("button", { name: "New voice note" })).toBeVisible();
  await expectNoSideScroll(page);

  // The record shows its type, and Write another note offers only Voice Note templates.
  await page.getByRole("link", { name: "Open in History" }).click();
  await expect(page.locator(".content-inner h1")).toHaveText(label);
  await expect(page.locator(".detail-meta .chip.mode-voice")).toHaveText("Voice Note");
  const another = await optionsOf(page.getByLabel("Template", { exact: true }));
  expect(another).toContain("Dictated note (default)");
  expect(another.some((name) => name.startsWith("SOAP note"))).toBe(false);

  // Back leads to the Voice Note tab of History, which finds it; the other tab does not.
  await page.locator(".back-link").click();
  await expect(page).toHaveURL(/#\/history\/voice$/);
  await expect(page.locator(".history-tab.is-voice")).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Search voice notes").fill(label);
  await expect(page.locator(".history-list .list-row")).toHaveCount(1);
  await expect(page.locator(".search-count")).toHaveText("1 voice note found");
  await expect(page.locator(".history-list .row-icon.is-voice")).toHaveCount(1);
  await page.locator(".history-tab", { hasText: "Clinical Scribe" }).click();
  await expect(page).toHaveURL(/#\/history$/);
  await page.getByLabel("Search recordings").fill(label);
  await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();
  // Each tab keeps its own search.
  await page.locator(".history-tab", { hasText: "Voice Note" }).click();
  await expect(page.getByLabel("Search voice notes")).toHaveValue(label);
  await expectNoSideScroll(page);
  expect(problems).toEqual([]);
});

test.describe("at desktop size", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop size");
  });

  test("the side menu lists both ways to record and lights the open tab", async ({ page }) => {
    await signIn(page, USER);
    const menu = page.locator(".sidebar .nav");
    await expect(menu.locator(".nav-item")).toHaveText(["Clinical Scribe", "Voice Note", "Templates", "History", "Phone apps"]);
    for (const [path, lit] of [["/voice", "Voice Note"], ["/scribe", "Clinical Scribe"], ["/history/voice", "History"], ["/templates", "Templates"]]) {
      await go(page, path);
      await expect(menu.locator('.nav-item[aria-current="page"]')).toHaveText(lit);
    }
    // The side menu replaces the tabs at the top on wide screens.
    await expect(page.locator(".module-tabs")).toBeHidden();
  });

  test("one recording at a time: the other tab leads back to the recording going on", async ({ page }) => {
    const problems = watchProblems(page);
    await signIn(page, USER);
    await go(page, "/voice");
    await page.getByRole("button", { name: "Start voice note" }).click();
    await expect(page.locator(".live-status")).toHaveText(/Recording/);
    await expect(page.locator(".live-meta .chip.mode-voice")).toHaveText("Voice Note");

    await page.locator(".sidebar").getByRole("link", { name: "Clinical Scribe", exact: true }).click();
    const busy = page.locator(".busy-card");
    await expect(busy).toContainText("A Voice Note is being recorded");
    await expect(busy).toContainText("One recording at a time.");
    await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
    const pill = page.locator(".sidebar .recording-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute("href", "#/voice");

    await busy.getByRole("button", { name: "Go to the recording" }).click();
    await expect(page.locator(".content-inner h1").first()).toHaveText("Voice Note");
    await expect(page.locator(".live-status")).toHaveText(/Recording/);
    await expect(pill).toBeHidden();
    await page.getByRole("button", { name: "Discard" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Discard recording" }).click();
    await expect(page.getByRole("button", { name: "Start voice note" })).toBeVisible();
    await page.locator(".sidebar").getByRole("link", { name: "Clinical Scribe", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("templates carry a Template Type that stays, and each tab offers its own", async ({ page }) => {
    const problems = watchProblems(page);
    await signIn(page, USER);
    await go(page, "/templates");
    await expect(page.locator(".template-card", { hasText: "SOAP note" }).locator(".chip.mode-scribe")).toHaveText("Clinical Scribe");
    await expect(page.locator(".template-card", { hasText: "Dictated note" }).locator(".chip.mode-voice")).toHaveText("Voice Note");

    await page.getByRole("button", { name: "Create template" }).first().click();
    const dialog = page.locator("dialog[open]");
    const type = dialog.getByRole("group", { name: "Template Type" });
    await expect(type.getByRole("button", { name: "Clinical Scribe" })).toHaveAttribute("aria-pressed", "true");
    await type.getByRole("button", { name: "Voice Note" }).click();
    await expect(dialog.getByText("Just you, dictating a note or a letter")).toBeVisible();
    await dialog.getByLabel("Describe the note you want").fill("A clinic letter to the family doctor: reason, findings and plan.");
    await dialog.getByRole("button", { name: "Create template" }).click();
    await expect(dialog.getByLabel("Template", { exact: true })).toHaveValue(/Reason for the letter:/, { timeout: 60_000 });
    await expect(dialog.locator(".type-fixed .chip.mode-voice")).toHaveText("Voice Note");
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(dialog).toHaveCount(0);
    const card = page.locator(".template-card", { hasText: "Clinic letter" });
    await expect(card.locator(".chip.mode-voice")).toHaveText("Voice Note");

    // Editing shows the type but cannot change it.
    await card.click();
    await page.locator("dialog[open]").getByRole("button", { name: "Edit" }).click();
    const builder = page.locator("dialog[open]").last();
    await expect(builder.getByText("The Template Type stays as it was made.")).toBeVisible();
    await expect(builder.getByRole("group", { name: "Template Type" })).toHaveCount(0);
    await builder.getByRole("button", { name: "Cancel" }).click();

    await go(page, "/voice");
    expect(await optionsOf(page.getByLabel("Note template"))).toContain("Clinic letter");
    await go(page, "/scribe");
    expect(await optionsOf(page.getByLabel("Note template"))).not.toContain("Clinic letter");
    expect(problems).toEqual([]);
  });

  test("admins see the type on the Recording page, in shared templates and in record reviews", async ({ page }) => {
    const problems = watchProblems(page);
    await signIn(page, ADMIN);
    await go(page, "/admin/recordings");
    const typeFilter = page.getByRole("group", { name: "Type" });
    await expect(typeFilter.getByRole("button")).toHaveText(["All types", "Clinical Scribe", "Voice Note"]);
    await typeFilter.getByRole("button", { name: "Voice Note" }).click();
    await expect(typeFilter.getByRole("button", { name: "Voice Note" })).toHaveAttribute("aria-pressed", "true");
    const rows = page.locator(".recordings-table tbody tr");
    await expect(rows.first()).toBeVisible();
    const types = await page.locator(".recordings-table tbody td[data-label='Type']").allTextContents();
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types)).toEqual(new Set(["Voice Note"]));
    await expectNoSideScroll(page);

    await go(page, "/admin/ai");
    await expect(page.locator(".list-row", { hasText: "Dictated note" }).locator(".chip.mode-voice")).toBeVisible();
    await expect(page.locator(".list-row", { hasText: "SOAP note" }).locator(".chip.mode-scribe")).toBeVisible();

    await go(page, "/admin/review");
    await page.getByLabel("Whose records do you need to review?").selectOption({ label: `${USER.name} (${USER.email})` });
    await page.getByLabel("Reason for this review").fill("Audit of dictated letters this month");
    await page.getByLabel("I understand that this review is recorded in the audit log, with my name and reason.").check();
    await page.getByRole("button", { name: "Start review" }).click();
    const record = page.getByRole("button", { name: /Dictated letter desktop/ });
    await expect(record.locator(".chip.mode-voice")).toHaveText("Voice Note");
    await record.click();
    await expect(page.locator(".detail-meta .chip.mode-voice")).toHaveText("Voice Note");
    await page.getByRole("button", { name: "End review" }).click();
    await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();

    // The audit log names the type of the record that was opened.
    await go(page, "/admin/audit");
    await page.getByLabel("Show").selectOption({ label: "Record reviews" });
    await page.getByRole("button", { name: "Show results" }).click();
    const entry = page.locator(".audit-row", { hasText: `opened ${USER.name}'s record "Dictated letter desktop"` }).first();
    await entry.getByRole("button", { name: "Details" }).click();
    await expect(entry.locator(".audit-details")).toContainText("Voice Note");
    expect(problems).toEqual([]);
  });
});
