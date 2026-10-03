// The main flow: record, pause, resume, finish, read and copy the note, then find
// it in History and write another note from the same transcript.
import { expect, test } from "@playwright/test";
import { serverClient, sql } from "../helpers/local.mjs";
import { expectNoSideScroll, go, record, signIn, USER, watchProblems } from "./helpers.mjs";

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

  // Only the newest note is open. The older one opens when asked, and the order can change.
  const cards = page.locator(".note-card");
  await expect(cards.nth(0).locator(".note-body")).toBeVisible();
  await expect(cards.nth(1).locator(".note-body")).toBeHidden();
  const older = await cards.nth(1).getAttribute("data-id");
  await cards.nth(1).getByRole("button", { name: "Show note" }).click();
  await expect(cards.nth(1).locator(".note-body")).toBeVisible();
  await expect(cards.nth(1).getByRole("button", { name: "Hide note" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Oldest first" }).click();
  await expect(cards.nth(0)).toHaveAttribute("data-id", older);
  await expect(cards.nth(0).locator(".note-body")).toBeVisible();
  await expect(cards.nth(1).locator(".note-body")).toBeVisible();
  await cards.nth(0).getByRole("button", { name: "Hide note" }).click();
  await expect(cards.nth(0).locator(".note-body")).toBeHidden();
  await expectNoSideScroll(page);

  // Notes are final: there is no way to edit them.
  await expect(page.locator(".note-card textarea, .note-card [contenteditable=true]")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the history list finds recordings by label", async ({ page }, testInfo) => {
  await signIn(page, USER);
  await page.goto("/#/history");
  const search = page.getByLabel("Search recordings");
  await search.fill(`Clinic visit ${testInfo.project.name}`);
  await expect(page.locator(".history-list .list-row")).toHaveCount(1);
  await search.fill("no recording has this label");
  await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();
});

test("History shows ten recordings a page and searches inside transcripts", async ({ page }, testInfo) => {
  // Someone with 25 recordings of their own.
  const who = { email: `pages-${testInfo.project.name}@example.test`, password: "Pages-pass-2026" };
  const { data, error } = await serverClient().auth.admin.createUser({ email: who.email, password: who.password, email_confirm: true });
  expect(error).toBeNull();
  sql(`update public.profiles set status = 'active' where id = '${data.user.id}'`);
  sql(`insert into public.scribes (owner_id, title, status, segment_count, duration_seconds, transcript, started_at, finished_at, transcribed_at)
       select '${data.user.id}', 'Ward visit ' || g, 'transcribed', 1, 300,
              'Speaker 1: Review number ' || g || case when g = 17 then '. The chest film shows a small pneumothorax.' else '.' end,
              now() - make_interval(hours => g), now() - make_interval(hours => g), now() - make_interval(hours => g)
       from generate_series(1, 25) g`);

  await signIn(page, who);
  await go(page, "/history");
  const rows = page.locator(".history-list .list-row");
  await expect(rows).toHaveCount(10);
  await expect(page.locator(".pager-text")).toHaveText("Page 1 of 3");
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".pager-text")).toHaveText("Page 2 of 3");
  await expect(rows.first()).toContainText("Ward visit 11");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(rows).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await expectNoSideScroll(page);

  // Opening a recording and coming back keeps the page.
  await rows.first().click();
  await expect(page.locator(".content-inner h1")).toHaveText("Ward visit 21");
  await page.locator(".back-link").click();
  await expect(page.locator(".pager-text")).toHaveText("Page 3 of 3");

  // The search looks inside transcripts and shows the words it found.
  await page.getByLabel("Search recordings").fill("pneumothorax");
  await expect(page.locator(".search-count")).toHaveText("1 recording found");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Ward visit 17");
  await expect(rows.first().locator(".row-extract")).toContainText("Transcript:");
  await expect(rows.first().locator(".row-extract mark")).toHaveText("pneumothorax");
  await expect(page.locator(".pager")).toBeHidden();
  await expectNoSideScroll(page);
  await page.getByLabel("Search recordings").fill("");
  await expect(page.locator(".pager-text")).toHaveText("Page 1 of 3");
});
