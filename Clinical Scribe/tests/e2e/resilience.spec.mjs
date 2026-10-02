// Processing carries on with the browser closed, and an interrupted recording can
// be recovered from what was saved on the device.
import { expect, test } from "@playwright/test";
import { serverClient, waitFor } from "../helpers/local.mjs";
import { go, record, signIn, USER } from "./helpers.mjs";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop size");
});

test("the note is written even after the browser is closed", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await signIn(page, USER);
  await record(page, { seconds: 4, label: "Closed early" });
  // As soon as the server has the recording, close everything.
  await expect(page.locator(".step").first()).toHaveClass(/is-done/, { timeout: 30_000 });
  await context.close();

  const server = serverClient();
  await waitFor(async () => {
    const { data } = await server.from("scribes").select("id, status, notes(status)").eq("title", "Closed early").maybeSingle();
    return data?.status === "transcribed" && data.notes.some((n) => n.status === "done");
  }, { label: "server-side processing", timeoutMs: 150_000 });

  const again = await browser.newContext({ permissions: ["microphone"] });
  const next = await again.newPage();
  await signIn(next, USER);
  await go(next, "/history");
  await next.getByRole("link", { name: /Closed early/ }).click();
  await expect(next.locator(".note-card .heading-line").first()).toHaveText("Subjective:");
  await again.close();
});

test("an interrupted recording can be processed later", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await signIn(page, USER);
  await go(page, "/scribe");
  await page.getByLabel("Label (optional)").fill("Interrupted visit");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.locator(".live-status")).toHaveText(/Recording/);
  await page.waitForTimeout(7000);
  // Close the tab without finishing, as a crash or flat battery would.
  await page.close({ runBeforeUnload: false });

  const next = await context.newPage();
  await next.goto("/");
  await expect(next.getByText("A recording was interrupted")).toBeVisible({ timeout: 20_000 });
  await next.getByRole("button", { name: "Process the saved audio" }).click();
  await expect(next.getByRole("heading", { name: "Your note is ready" })).toBeVisible({ timeout: 150_000 });
  await context.close();
});
