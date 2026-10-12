// A recording never ends by itself. A microphone that stops, or sound played by
// Clinical Scribe itself, pauses the recording and says why; Resume carries on
// (opening the microphone again when it had stopped), and the recording is then
// saved and transcribed as usual. Each such pause leaves an information gap: the
// recorder lists it, and after processing the gap list, the transcript and the note
// all show where it was.
import { expect, test } from "@playwright/test";
import { expectNoSideScroll, go, signIn, USER, watchProblems } from "./helpers.mjs";

// Keeps every microphone stream the page opens, so the test can stop one.
async function watchMicrophone(page) {
  await page.addInitScript(() => {
    window.__streams = [];
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await open(constraints);
      window.__streams.push(stream);
      return stream;
    };
  });
}

test("a stopped microphone or sound from the app pauses the recording, and Resume carries on", async ({ page }) => {
  const problems = watchProblems(page);
  await watchMicrophone(page);
  await signIn(page, USER);
  await go(page, "/scribe");
  await page.getByRole("button", { name: "Start recording" }).click();
  const status = page.locator(".live-status");
  await expect(status).toHaveText(/Recording/);
  await page.waitForTimeout(2000);

  // The microphone stops, for example because it was unplugged.
  await page.evaluate(() => {
    const track = window.__streams.at(-1).getAudioTracks()[0];
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(status).toHaveText(/Paused/);
  await expect(page.getByText("The microphone stopped. Tap Resume to try again.")).toBeVisible();
  const time = await page.locator(".timer").textContent();
  await page.waitForTimeout(1500);
  await expect(page.locator(".timer"), "the time stops while paused").toHaveText(time);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(status).toHaveText(/Recording/);
  await expect(page.getByText("The microphone stopped.")).toHaveCount(0);
  expect(await page.evaluate(() => window.__streams.length), "the microphone was opened again").toBe(2);
  // The recorder lists where it paused by itself.
  const live = page.locator(".gaps-banner");
  await expect(live).toContainText("The recording paused by itself once so far");
  await expect(live.locator("li")).toHaveCount(1);
  await expect(live.locator("li").first()).toContainText("because of the microphone stopping");
  await page.waitForTimeout(2000);

  // Sound played in Clinical Scribe would be recorded too, so the recording pauses.
  await page.evaluate(() => {
    const rate = 8000;
    const samples = rate / 4;
    const wav = new DataView(new ArrayBuffer(44 + samples * 2));
    const text = (at, value) => [...value].forEach((letter, i) => wav.setUint8(at + i, letter.charCodeAt(0)));
    text(0, "RIFF");
    wav.setUint32(4, 36 + samples * 2, true);
    text(8, "WAVEfmt ");
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 1, true);
    wav.setUint32(24, rate, true);
    wav.setUint32(28, rate * 2, true);
    wav.setUint16(32, 2, true);
    wav.setUint16(34, 16, true);
    text(36, "data");
    wav.setUint32(40, samples * 2, true);
    const audio = new Audio(URL.createObjectURL(new Blob([wav.buffer], { type: "audio/wav" })));
    document.body.append(audio);
    return audio.play();
  });
  await expect(status).toHaveText(/Paused/);
  await expect(page.getByText("Paused while sound played in Clinical Scribe. Tap Resume to carry on.")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(status).toHaveText(/Recording/);
  await expect(live.locator("li")).toHaveCount(2);
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".progress-card")).toBeVisible();
  // Straight after Finish: where it paused, as soon as the parts have reached the server.
  const after = page.locator(".gaps-banner");
  await expect(after).toContainText("The recording paused by itself 2 times", { timeout: 30_000 });
  await expect(after.locator("li").nth(0)).toContainText("because of the microphone stopping");
  await expect(after.locator("li").nth(1)).toContainText("because of sound playing in Clinical Scribe");
  await expect(page.getByRole("heading", { name: "Your note is ready" })).toBeVisible({ timeout: 120_000 });

  // After processing: the note points out each gap, and the transcript marks each place.
  const note = page.locator(".note-card").first();
  await expect(note.locator(".info-gap")).toHaveCount(2);
  await expect(note.locator(".info-gap").first()).toContainText(/^There is an information gap after .+\(\d+:\d{2}\)\. Please relate accordingly\.$/);
  await page.getByRole("button", { name: "Show transcript" }).click();
  const marks = page.locator(".transcript-body .info-gap");
  await expect(marks).toHaveCount(2);
  await expect(marks.nth(0)).toContainText(/^\[Information gap at \d+:\d{2}\. The recording paused for .+ because of the microphone stopping\. Nothing was recorded during this time\.\]$/);
  await expect(marks.nth(1)).toContainText("because of sound playing in Clinical Scribe");

  // History shows the same.
  await page.getByRole("link", { name: "Open in History" }).click();
  await expect(page.locator(".gaps-banner li")).toHaveCount(2);
  await expect(page.locator(".transcript-body .info-gap")).toHaveCount(2);
  await expectNoSideScroll(page);
  expect(problems).toEqual([]);
});
