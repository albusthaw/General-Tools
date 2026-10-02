// Admin screens: people, minutes, roles, AI settings and model lists, record review
// and recording audio with their audit trail, Google sign-in and the email settings.
import { expect, test } from "@playwright/test";
import { mock } from "../helpers/local.mjs";
import { ADMIN, go, record, signIn, signOut, USER } from "./helpers.mjs";

test.describe.configure({ mode: "serial" });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop size");
});

const NEW_PERSON = { name: "Nurse Jo Lane", email: "jo@clinic.test", password: "Jo-start-2026x" };

function personRow(page, email) {
  return page.locator("tbody tr", { hasText: email });
}

async function rowAction(page, email, action) {
  await personRow(page, email).getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

test("add a person, give minutes, change role, suspend, restore and remove", async ({ page }) => {
  await signIn(page, ADMIN);
  await go(page, "/admin/users");
  await page.getByRole("button", { name: "Add person" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Full name").fill(NEW_PERSON.name);
  await dialog.getByLabel("Email address").fill(NEW_PERSON.email);
  await dialog.getByLabel("Starting password", { exact: true }).fill(NEW_PERSON.password);
  await dialog.getByLabel("ElevenLabs minutes").fill("15");
  await dialog.getByRole("button", { name: "Add person" }).click();
  await expect(personRow(page, NEW_PERSON.email)).toContainText("ElevenLabs 15 minutes");

  await rowAction(page, NEW_PERSON.email, "Transcription minutes");
  const minutes = page.locator("dialog[open]");
  await minutes.getByLabel("Minutes", { exact: true }).fill("30");
  await minutes.getByRole("button", { name: "Save minutes" }).click();
  await expect(minutes.locator(".ledger-row").first()).toContainText("Added");
  await minutes.getByRole("button", { name: "Close" }).first().click();
  await expect(personRow(page, NEW_PERSON.email)).toContainText("ElevenLabs 45 minutes");

  await rowAction(page, NEW_PERSON.email, "Make admin");
  await page.locator("dialog[open]").getByRole("button", { name: "Make admin" }).click();
  await expect(personRow(page, NEW_PERSON.email).locator(".chip", { hasText: "Admin" })).toBeVisible();

  await rowAction(page, NEW_PERSON.email, "Suspend");
  await page.locator("dialog[open]").getByRole("button", { name: "Suspend" }).click();
  await expect(personRow(page, NEW_PERSON.email)).toContainText("Suspended");
  await rowAction(page, NEW_PERSON.email, "Restore");
  await expect(personRow(page, NEW_PERSON.email)).toContainText("Active");

  await rowAction(page, NEW_PERSON.email, "Remove person");
  const confirm = page.locator("dialog[open]");
  await confirm.getByLabel(`Type ${NEW_PERSON.email} to confirm`).fill(NEW_PERSON.email);
  await confirm.getByRole("button", { name: "Remove permanently" }).click();
  await expect(personRow(page, NEW_PERSON.email)).toHaveCount(0);
});

test("change the note service in AI settings", async ({ page }) => {
  await signIn(page, ADMIN);
  await go(page, "/admin/ai");
  const notes = page.locator("section", { has: page.getByRole("heading", { name: "Notes", exact: true }) });
  await notes.getByRole("button", { name: "DeepSeek" }).click();
  await notes.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".toast", { hasText: "Settings saved." }).first()).toBeVisible();
  await notes.getByRole("button", { name: "Gemini" }).click();
  await notes.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".toast", { hasText: "Settings saved." }).first()).toBeVisible();
  await page.getByRole("button", { name: "Check key" }).first().click();
  await expect(page.locator(".key-result.ok").first()).toBeVisible();
});

test("update the AI model lists and test the chosen models", async ({ page }) => {
  await signIn(page, ADMIN);
  await go(page, "/admin/ai");
  const models = page.locator("section", { has: page.getByRole("heading", { name: "AI models" }) });
  await models.getByRole("button", { name: "Update model lists" }).click();
  await expect(page.locator(".toast", { hasText: "Model lists updated." }).first()).toBeVisible();
  await expect(models).toContainText("Lists updated just now.");

  const transcription = page.locator("section", { has: page.getByRole("heading", { name: "Transcription", exact: true }) });
  await expect(transcription.getByLabel("ElevenLabs model")).toHaveValue("scribe_v2_medical");
  await expect(transcription.getByLabel("ElevenLabs model").locator("option", { hasText: "Scribe v2 Medical (recommended)" })).toHaveCount(1);
  await expect(transcription.getByLabel("Gemini model").locator("option", { hasText: /live/i })).toHaveCount(0);
  const notes = page.locator("section", { has: page.getByRole("heading", { name: "Notes", exact: true }) });
  await expect(notes.getByLabel("Gemini model").locator("option", { hasText: "(recommended)" })).toHaveCount(1);

  await models.getByRole("button", { name: "Test chosen models" }).click();
  await expect(models.locator(".test-result.ok")).toHaveCount(3);
  await expect(models.locator(".test-results")).toContainText("Transcription: ElevenLabs, scribe_v2_medical");
});

test("review another person's records, with every step in the audit log", async ({ page }) => {
  // Make sure the user has a record to review.
  await signIn(page, USER);
  await record(page, { seconds: 3, label: "For review" });
  await expect(page.getByRole("heading", { name: "Your note is ready" })).toBeVisible({ timeout: 120_000 });
  await signOut(page);

  await signIn(page, ADMIN);
  await go(page, "/admin/review");
  await expect(page.getByText("These records belong to the clinicians who made them")).toBeVisible();
  await page.getByLabel("Whose records do you need to review?").selectOption({ label: `${USER.name} (${USER.email})` });
  await page.getByLabel("Reason for this review").fill("Quality audit of SOAP notes");
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText("Tick the box to confirm you understand the review is recorded.")).toBeVisible();
  await page.getByLabel("I understand that this review is recorded in the audit log, with my name and reason.").check();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.locator(".review-bar")).toContainText(`Review in progress: ${USER.name}`);
  await page.getByRole("button", { name: /For review/ }).click();
  await expect(page.locator(".transcript-card")).toContainText("Good morning");
  await page.getByRole("button", { name: "Copy transcript" }).click();
  await page.getByRole("button", { name: "End review" }).click();
  await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();

  await go(page, "/admin/audit");
  await page.getByLabel("Show").selectOption({ label: "Record reviews" });
  await page.getByRole("button", { name: "Show results" }).click();
  const list = page.locator(".audit-list");
  await expect(list).toContainText(`${ADMIN.name} started a review of ${USER.name}'s records`);
  await expect(list).toContainText(`${ADMIN.name} opened ${USER.name}'s record "For review"`);
  await expect(list).toContainText(`${ADMIN.name} copied the transcript from ${USER.name}'s record`);
  await expect(list).toContainText(`${ADMIN.name} ended the review of ${USER.name}'s records`);
  await expect(list).toContainText("Reason: Quality audit of SOAP notes");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^clinical-scribe-audit-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("listen to a recording only after giving a reason, with every step in the audit log", async ({ page }) => {
  // Uses the "For review" recording made in the test above.
  await signIn(page, ADMIN);
  await go(page, "/admin/recordings");
  await expect(page.getByText("Only administrators can see this page")).toBeVisible();
  await expect(page.locator(".page-intro")).toContainText("Audio is kept for 7 days after the transcript is ready.");
  await page.getByLabel("Person").selectOption({ label: `${USER.name} (${USER.email})` });
  const row = page.locator(".recordings-table tbody tr").first();
  await expect(row).toContainText(USER.name);
  await expect(row).toContainText("Kept until");
  await row.getByRole("button", { name: /Listen to the recording/ }).click();

  const dialog = page.locator("dialog[open]");
  await expect(dialog).toContainText(`This audio belongs to ${USER.name} and their patient`);
  await dialog.getByRole("button", { name: "Open audio" }).click();
  await expect(dialog.getByText("Give a clear reason of at least 10 characters.")).toBeVisible();
  await dialog.getByLabel("Reason", { exact: true }).fill("Checking a disputed transcript");
  await dialog.getByRole("button", { name: "Open audio" }).click();
  await expect(dialog.getByText("Tick the box to confirm you understand that opening the audio is recorded.")).toBeVisible();
  await dialog.getByLabel("I understand that opening this audio is written in the audit log, with my name and reason.").check();
  await dialog.getByRole("button", { name: "Open audio" }).click();
  await expect(dialog.locator(".facts")).toContainText("For review");
  const audio = dialog.locator("audio").first();
  await expect(audio).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => audio.evaluate((el) => el.readyState), { message: "the audio can be played" }).toBeGreaterThan(0);

  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download" }).first().click();
  expect((await download).suggestedFilename()).toMatch(/^clinical-scribe-\d{4}-\d{2}-\d{2}-part-1\.webm$/);
  await expect(page.locator(".toast", { hasText: "Download started. It is written in the audit log." })).toBeVisible();
  await dialog.locator(".dialog-foot").getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  await go(page, "/admin/audit");
  await page.getByLabel("Show").selectOption({ label: "Recording audio" });
  await page.getByRole("button", { name: "Show results" }).click();
  const list = page.locator(".audit-list");
  await expect(list).toContainText(`${ADMIN.name} opened the audio of ${USER.name}'s recording "For review"`);
  await expect(list).toContainText(`${ADMIN.name} downloaded part 1 of the audio of ${USER.name}'s recording`);
  await expect(list).toContainText("Reason: Checking a disputed transcript");
});

test("switch Google sign-in on, see it on the sign-in page, and switch it off", async ({ page, browser }) => {
  await signIn(page, ADMIN);
  await go(page, "/admin/google");
  await page.getByLabel("Supabase access token").fill("sbp_test_management_token_0001");
  await page.getByRole("button", { name: "Save token" }).click();
  await expect(page.locator(".chip", { hasText: "Saved · ends in 0001" })).toBeVisible();
  await page.getByLabel("Client ID").fill("123-abc.apps.googleusercontent.com");
  await page.getByLabel("Client secret").fill("GOCSPX-test-secret");
  await page.getByLabel("Let people sign in with Google").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".card-head .chip", { hasText: /^On$/ })).toBeVisible();
  const config = await mock("/__auth_config");
  expect(config.external_google_enabled).toBe(true);
  expect(config.uri_allow_list).toContain("http://127.0.0.1:4173/");

  const visitor = await browser.newContext();
  const login = await visitor.newPage();
  await login.goto("/");
  await expect(login.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await visitor.close();

  await page.getByLabel("Let people sign in with Google").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".card-head .chip", { hasText: /^Off$/ })).toBeVisible();
});

test("save the email settings without sending anything", async ({ page }) => {
  await signIn(page, ADMIN);
  await go(page, "/admin/email");
  await expect(page.getByText("Not in use yet")).toBeVisible();
  await page.getByLabel("Server", { exact: true }).fill("smtp.example.test");
  await page.getByRole("button", { name: "SSL/TLS" }).click();
  await expect(page.getByLabel("Port")).toHaveValue("465");
  await page.getByLabel("User name").fill("mailer");
  await page.getByLabel("Password", { exact: true }).fill("mail-password-1");
  await page.getByLabel("Sender email address").fill("noreply@example.test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".toast", { hasText: "Email settings saved." })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("placeholder", /Saved/);
  await expect(page.getByLabel("Server", { exact: true })).toHaveValue("smtp.example.test");
});
