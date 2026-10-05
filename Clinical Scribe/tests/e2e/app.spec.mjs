// The phone apps: the app build at /app/ with the iPhone look (Safari on an iPhone)
// and the Android look (Chrome on an Android phone, the same pages and frame as the
// Android app). They connect through the server link, sign in, and offer every
// section of the website inside the app frame. Gestures use real touch events.
import { expect, test } from "@playwright/test";
import { ADMIN, USER } from "./helpers.mjs";

const SERVER_LINK = "http://127.0.0.1:54321";
const IPHONE = {
  viewport: { width: 402, height: 874 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
};
const ANDROID = {
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
};

// The apps make their own phone set-ups, so they run once, not again at desktop size.
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "The phone apps are tested once, with their own phone set-ups.");
});

// Like watchProblems, but a server link is looked up in more than one place, and
// the places that have no connect file answer 404 (or no CORS) on purpose.
function watchAppProblems(page) {
  const problems = [];
  const expected = (text) => /connect\.json/.test(text);
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !/Failed to load resource/.test(text) && !expected(text)) problems.push(`console: ${text}`);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() >= 400 && !expected(url) && !/token\?grant_type=password/.test(url)) problems.push(`${response.status()} ${url}`);
  });
  return problems;
}

async function expectNoSideScroll(page) {
  const wider = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wider, "the page should not scroll sideways").toBeLessThanOrEqual(1);
}

async function signInHere(page, who) {
  await page.getByLabel("Email address").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
}

async function openTab(page, name) {
  await page.locator(".app-tabs").getByRole("link", { name }).click();
  await expect(page.locator(".content-inner h1").first()).toHaveText(name);
}

// Real touch events through the browser's touch emulation.
async function touch(page, steps) {
  const client = await page.context().newCDPSession(page);
  for (const step of steps) {
    if (step.wait) await page.waitForTimeout(step.wait);
    else await client.send("Input.dispatchTouchEvent", { type: step.type, touchPoints: step.at ? [{ x: step.at.x, y: step.at.y }] : [] });
  }
  await client.detach();
}

async function drag(page, from, to, { hold = 0 } = {}) {
  const moves = Array.from({ length: 10 }, (_, i) => ({
    type: "touchMove",
    at: { x: from.x + ((to.x - from.x) * (i + 1)) / 10, y: from.y + ((to.y - from.y) * (i + 1)) / 10 },
  }));
  await touch(page, [{ type: "touchStart", at: from }, ...(hold ? [{ wait: hold }] : []), ...moves.flatMap((move) => [move, { wait: 16 }]), { type: "touchEnd" }]);
}

async function centreOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("iPhone", () => {
  test.use(IPHONE);

  test("Safari shows the Home Screen steps, then the server link connects", async ({ page }) => {
    const problems = watchAppProblems(page);
    await page.goto("/app/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ios");
    await expect(page.getByRole("heading", { name: "Add to Home Screen" })).toBeVisible();
    await expect(page.locator(".install-step")).toHaveCount(3);
    await expectNoSideScroll(page);
    await page.getByRole("button", { name: "Continue in Safari" }).click();

    // The web app came from this clinic's site, so it finds the server by itself.
    await expect(page.locator(".connect-name")).toHaveText("127.0.0.1:4173?");
    await page.getByRole("button", { name: "Use another link" }).click();

    const link = page.getByLabel("Server link");
    const connect = page.getByRole("button", { name: "Connect" });
    for (const [typed, message] of [
      ["", "Enter the server link."],
      ["not a link", "That link does not look right. Check it and try again."],
      ["http://scribe.example.org", "Links must start with https://."],
    ]) {
      await link.fill(typed);
      await connect.click();
      await expect(page.locator(".field-error")).toHaveText(message);
    }
    await link.fill(SERVER_LINK);
    await connect.click();
    await expect(page.locator(".connect-name")).toHaveText("127.0.0.1:54321?");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page.locator(".clinic-chip")).toContainText("127.0.0.1:54321");
    await signInHere(page, USER);
    await expect(page.locator(".app-tabs")).toBeVisible();
    await expect(page.locator(".content-inner h1").first()).toHaveText("Clinical Scribe");
    await expectNoSideScroll(page);
    await openTab(page, "Voice Note");
    await expect(page.locator(".mode-card.is-voice")).toHaveAttribute("aria-current", "page");

    // Templates: the new-template button sits in the top bar on iPhone.
    await openTab(page, "Templates");
    await expect(page.locator(".app-bar-button")).toBeVisible();
    await expect(page.locator(".app-fab")).toBeHidden();
    await openTab(page, "History");
    await openTab(page, "More");
    await expect(page.locator(".more-row", { hasText: "Connected to" })).toContainText("127.0.0.1:54321");
    await expect(page.getByRole("heading", { name: "Admin settings" })).toHaveCount(0);
    await expectNoSideScroll(page);
    // Everyone has Phone apps in More, to set up another phone. Vibration is an Android app switch.
    await expect(page.locator(".more-switch")).toHaveCount(0);
    await page.locator(".more-list").getByRole("link", { name: "Phone apps" }).click();
    await expect(page.locator(".content-inner h1").first()).toHaveText("Phone apps");
    await expect(page.locator(".qr-code")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Name shown in the apps" })).toHaveCount(0);
    await page.locator(".app-back").click();
    await expect(page.locator(".content-inner h1").first()).toHaveText("More");

    // The connection is kept: opening the app again goes straight in.
    await page.reload();
    await expect(page.locator(".app-frame")).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("from the Home Screen there are no install steps, and admins reach every setting", async ({ page }) => {
    const problems = watchAppProblems(page);
    await page.addInitScript(() => Object.defineProperty(window.navigator, "standalone", { value: true }));
    await page.goto("/app/");
    await expect(page.locator("html")).toHaveAttribute("data-standalone", "true");
    await expect(page.locator(".connect-name")).toHaveText("127.0.0.1:4173?");
    await page.getByRole("button", { name: "Connect" }).click();
    await signInHere(page, ADMIN);

    await openTab(page, "More");
    for (const name of ["User settings", "AI settings", "Recording", "Review records", "Audit log", "Google sign-in", "Email (SMTP)", "Phone apps"]) {
      await page.locator(".more-list").getByRole("link", { name, exact: true }).click();
      await expect(page.locator(".content-inner h1").first()).toHaveText(name);
      await expect(page.locator(".app-back")).toBeVisible();
      await page.waitForTimeout(400);
      await expectNoSideScroll(page);
      await page.locator(".app-back").click();
      await expect(page.locator(".content-inner h1").first()).toHaveText("More");
    }

    await page.locator(".more-list").getByRole("link", { name: "Phone apps" }).click();
    await expect(page.locator(".qr-code")).toBeVisible();
    await expect(page.getByText("http://127.0.0.1:4173/app/")).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("recording carries on with Screen off; a locked screen or a call pauses it until Resume", async ({ page }) => {
    const problems = watchAppProblems(page);
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "standalone", { value: true });
      // Safari's audio session, which tells the page when a call takes the sound.
      const session = Object.assign(new EventTarget(), { type: "auto", state: "active" });
      Object.defineProperty(window.navigator, "audioSession", { value: session });
      // Lets the test lock the screen.
      window.__hidden = false;
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window.__hidden ? "hidden" : "visible") });
    });
    await page.goto("/app/");
    await page.getByRole("button", { name: "Connect" }).click();
    await signInHere(page, USER);

    await page.getByRole("button", { name: "Start recording" }).click();
    const status = page.locator(".live-status");
    await expect(status).toHaveText(/Recording/);
    await expect(page.locator(".record-hint")).toHaveText("Use Screen off to keep recording with a dark screen.");
    expect(await page.evaluate(() => navigator.audioSession.type)).toBe("play-and-record");

    // Screen off: a black screen where a tap does nothing; a press and hold shows the app.
    await page.getByRole("button", { name: "Screen off" }).click();
    const dark = page.locator(".screen-off");
    await expect(dark).toBeVisible();
    await expect(dark.locator(".screen-off-time")).toHaveText(/^Recording \d+:\d{2}$/);
    await expect(dark.getByText("Press and hold to show Clinical Scribe")).toBeVisible();
    await expectNoSideScroll(page);
    const middle = await centreOf(page.locator(".pause-circle"));
    await touch(page, [{ type: "touchStart", at: middle }, { wait: 200 }, { type: "touchEnd" }]);
    await page.waitForTimeout(400);
    await expect(dark).toBeVisible();
    await expect(status).toHaveText(/Recording/);
    await touch(page, [{ type: "touchStart", at: middle }, { wait: 1600 }, { type: "touchEnd" }]);
    await expect(dark).toBeHidden();
    await page.waitForTimeout(400);
    await expect(status, "lifting the finger does not press the button underneath").toHaveText(/Recording/);

    // The phone locks: an iPhone stops the microphone, so the recording pauses.
    await page.evaluate(() => {
      window.__hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      window.__hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(status).toHaveText(/Paused/);
    await expect(page.getByText("Paused because the screen locked or another app opened. Tap Resume to carry on.")).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(status).toHaveText(/Recording/);

    // A call during Screen off: the recording pauses and the app shows why.
    await page.getByRole("button", { name: "Screen off" }).click();
    await expect(dark).toBeVisible();
    await page.evaluate(() => {
      navigator.audioSession.state = "interrupted";
      navigator.audioSession.dispatchEvent(new Event("statechange"));
    });
    await expect(dark).toBeHidden();
    await expect(status).toHaveText(/Paused/);
    await expect(page.getByText(/^Paused because the microphone was needed elsewhere/)).toBeVisible();
    await page.evaluate(() => {
      navigator.audioSession.state = "active";
      navigator.audioSession.dispatchEvent(new Event("statechange"));
    });
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(status).toHaveText(/Recording/);
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator(".progress-card")).toBeVisible();
    expect(await page.evaluate(() => navigator.audioSession.type), "the audio session is handed back").toBe("auto");
    expect(problems).toEqual([]);
  });
});

test.describe("Android look", () => {
  test.use(ANDROID);

  test("record, use the mini recorder on other tabs, then rename with a swipe or a long press", async ({ page }) => {
    const problems = watchAppProblems(page);
    await page.goto("/app/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "android");
    await expect(page.locator(".connect-name")).toHaveText("127.0.0.1:4173?");
    await page.getByRole("button", { name: "Connect" }).click();
    await signInHere(page, USER);

    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.locator(".live-status")).toHaveText(/Recording/);
    await page.waitForTimeout(2500);

    // While recording, the other tabs show a small recorder that can pause.
    await openTab(page, "History");
    const mini = page.getByRole("region", { name: "Recording in progress" });
    await expect(mini).toBeVisible();
    await mini.getByRole("button", { name: "Pause" }).click();
    await expect(mini.getByRole("button", { name: "Resume" })).toBeVisible();
    await mini.getByRole("button", { name: "Resume" }).click();
    await mini.locator(".mini-open").click();
    await expect(page.locator(".content-inner h1").first()).toHaveText("Clinical Scribe");
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator(".progress-card")).toBeVisible();

    // History: the floating button starts a new recording of the tab's type; rows
    // have swipe actions.
    await openTab(page, "History");
    await expect(page.locator(".app-fab")).toHaveAccessibleName("New recording");
    await page.locator(".history-tab", { hasText: "Voice Note" }).click();
    await expect(page.locator(".app-fab")).toHaveAccessibleName("New voice note");
    await expect(page.locator(".app-back")).toBeHidden();
    await page.locator(".history-tab", { hasText: "Clinical Scribe" }).click();
    await expect(page.locator(".app-fab")).toBeVisible();
    const row = page.locator(".list-row").first();
    await expect(row).toBeVisible();
    const start = await centreOf(row);
    await drag(page, { x: start.x + 120, y: start.y }, { x: start.x - 140, y: start.y });
    await expect(page.locator(".swipe-wrap.is-open")).toBeVisible();
    // A person lifts the finger, then taps. Newer browsers ignore a tap that comes
    // within a few milliseconds of a fast swipe, as it would stop the swipe's motion.
    await page.waitForTimeout(600);
    await expect(page.locator(".swipe-wrap.is-open")).toBeVisible();
    await page.locator(".swipe-wrap.is-open .swipe-action", { hasText: "Rename" }).tap();
    const sheet = page.locator("dialog.sheet[open]");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".sheet-grabber")).toBeVisible();
    await sheet.getByLabel("Label").fill("Swiped visit");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".list-row .row-title").first()).toHaveText("Swiped visit");

    // A long press offers the same actions in a sheet.
    const pressAt = await centreOf(page.locator(".list-row").first());
    await touch(page, [{ type: "touchStart", at: pressAt }, { wait: 800 }, { type: "touchEnd" }]);
    const actions = page.getByRole("menu", { name: "Swiped visit" });
    await expect(actions).toBeVisible();
    await page.waitForTimeout(600);
    await expect(actions).toBeVisible();
    await actions.getByRole("menuitem", { name: "Rename" }).tap();
    await page.locator("dialog.sheet[open]").getByLabel("Label").fill("Pressed visit");
    await page.locator("dialog.sheet[open]").getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".list-row .row-title").first()).toHaveText("Pressed visit");

    // Pull down at the top of the page to reload it.
    const top = await centreOf(page.locator(".content-inner h1").first());
    await drag(page, top, { x: top.x, y: top.y + 320 });
    await expect(page.locator(".list-row .row-title").first()).toHaveText("Pressed visit");
    expect(problems).toEqual([]);
  });

  test("every tab fits a small phone, and Change server leaves for another clinic", async ({ page }) => {
    const problems = watchAppProblems(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/app/");
    await page.getByRole("button", { name: "Connect" }).click();
    await expectNoSideScroll(page);
    await signInHere(page, ADMIN);
    for (const name of ["Clinical Scribe", "Voice Note", "Templates", "History", "More"]) {
      await openTab(page, name);
      await page.waitForTimeout(400);
      await expectNoSideScroll(page);
    }
    // Five tabs at 320 px: no name is cut off, and the icons stay in one row.
    await expect(page.locator("html")).toHaveClass(/tab-names-two-lines/);
    const labels = page.locator(".app-tab-label");
    await expect(labels).toHaveText(["Clinical Scribe", "Voice Note", "Templates", "History", "More"]);
    expect(await labels.evaluateAll((items) => items.filter((item) => item.scrollWidth > item.clientWidth + 1).length)).toBe(0);
    const fits = await page.locator(".app-tab").evaluateAll((tabs) => tabs.every((tab) => {
      const label = tab.querySelector(".app-tab-label").getBoundingClientRect();
      const box = tab.getBoundingClientRect();
      return label.left >= box.left - 1 && label.right <= box.right + 1 && label.bottom <= box.bottom + 1;
    }));
    expect(fits, "each name stays inside its tab").toBe(true);
    const tops = await page.locator(".app-tab-icon").evaluateAll((icons) => icons.map((icon) => Math.round(icon.getBoundingClientRect().top)));
    expect(new Set(tops).size, "the icons stay in one row").toBe(1);
    await page.getByRole("button", { name: "Change server" }).click();
    const confirm = page.locator("dialog.sheet[open]");
    await expect(confirm).toContainText("You will be signed out of 127.0.0.1:4173 on this phone.");
    await confirm.getByRole("button", { name: "Change server" }).click();
    await expect(page.getByRole("heading", { name: "Connect" })).toBeVisible();
    // The server stays in the recent list, one tap away.
    const recent = page.locator(".recent-open", { hasText: "127.0.0.1:4173" });
    await expect(recent).toBeVisible();
    await recent.click();
    await expect(page.getByLabel("Email address")).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe("the website on phones", () => {
  test("offers the iPhone web app on an iPhone", async ({ browser }) => {
    const context = await browser.newContext({ ...IPHONE, baseURL: "http://127.0.0.1:4173" });
    const page = await context.newPage();
    await page.goto("/");
    const offer = page.locator(".get-app");
    await expect(offer).toContainText("Get the iPhone app");
    await expect(offer.getByRole("link", { name: "Open" })).toHaveAttribute("href", "./app/");
    await offer.getByRole("button", { name: "Hide" }).click();
    await expect(offer).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.locator(".get-app")).toHaveCount(0);
    await context.close();
  });

  test("offers the Android app on Android when one is published", async ({ browser }) => {
    const context = await browser.newContext({ ...ANDROID, baseURL: "http://127.0.0.1:4173" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    const published = await page.evaluate(async () => Boolean((await (await fetch("./connect.json")).json()).android_app));
    const offer = page.locator(".get-app");
    if (published) {
      await expect(offer).toContainText("Get the Android app");
      await expect(offer.getByRole("link", { name: "Download" })).toHaveAttribute("href", "http://127.0.0.1:4173/downloads/clinical-scribe.apk");
    } else {
      await expect(offer).toBeHidden();
    }
    await context.close();
  });
});
