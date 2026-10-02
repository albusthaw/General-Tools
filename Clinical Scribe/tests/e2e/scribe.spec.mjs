// The main flow: record, pause, resume, finish, read and copy the note, then find
// it in History and write another note from the same transcript.
import { expect, test } from "@playwright/test";
import { expectNoSideScroll, record, signIn, USER, watchProblems } from "./helpers.mjs";

test("record a consultation and get a SOAP note", async ({ page }, testInfo) => {
  const problems = watchProblems(page);
  const label = `Clinic visit ${testInfo.project.name}`;
  await signIn(page, USER);
  await expect(page.getByText(/minutes left/)).toBeVisible();

  // Seven seconds with 5-second parts: the recording is split into two parts.
  await record(page, { seconds: 7, label });
  await expect(page.getByRole("heading", { name: "Your note is ready" })).toBeVisible({ timeout: 120_000 });
  const note = page.locator(".note-card").first();
  await expect(note.locator(".heading-line").first()).toHaveText("Subjective:");
  await expect(note).toContainText("Cough for two weeks");
  await expectNoSideScroll(page);

  await note.getByRole("button", { name: "Copy note" }).click();
  await expect(page.locator(".toast", { hasText: "Note copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Subjective:");
  expect(copied).toContain("Plan:");

  await page.getByRole("button", { name: "Show transcript" }).click();
  await expect(page.locator(".transcript-body")).toContainText("Speaker 1:");

  // History keeps the transcript and every note.
  await page.getByRole("link", { name: "Open in History" }).click();
  await expect(page.locator(".content-inner h1")).toHaveText(label);
  await expect(page.locator(".transcript-card")).toContainText("Good morning");
  await page.getByRole("button", { name: "Write note" }).click();
  await expect(page.locator(".note-card")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.locator(".note-card .heading-line").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Notes (2)" })).toBeVisible();

  // Notes are final: there is no way to edit them.
  await expect(page.locator(".note-card textarea, .note-card [contenteditable=true]")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the history list finds recordings by label", async ({ page }, testInfo) => {
  await signIn(page, USER);
  await page.goto("/#/history");
  const search = page.getByLabel("Search recordings by label");
  await search.fill(`Clinic visit ${testInfo.project.name}`);
  await expect(page.locator(".history-list .list-row")).toHaveCount(1);
  await search.fill("no recording has this label");
  await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();
});
