// Every screen opens without errors and fits the screen, at desktop and phone sizes.
import { expect, test } from "@playwright/test";
import { ADMIN, expectNoSideScroll, go, signIn, signOut, USER, watchProblems } from "./helpers.mjs";

const ADMIN_PAGES = [
  ["/admin/users", "User settings"],
  ["/admin/ai", "AI settings"],
  ["/admin/recordings", "Recording"],
  ["/admin/review", "Review records"],
  ["/admin/audit", "Audit log"],
  ["/admin/google", "Google sign-in"],
  ["/admin/email", "Email (SMTP)"],
  ["/admin/apps", "Phone apps"],
  ["/apps", "Phone apps"],
];

test("the sign-in page explains a wrong password in plain words", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectNoSideScroll(page);
  await page.getByLabel("Email address").fill(USER.email);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("The email address or password is not right.");
});

test("an admin can open every screen", async ({ page }) => {
  const problems = watchProblems(page);
  await signIn(page, ADMIN);
  for (const [path, title] of [["/scribe", "Clinical Scribe"], ["/voice", "Voice Note"], ["/templates", "Templates"], ["/history", "History"], ["/history/voice", "History"], ...ADMIN_PAGES]) {
    await go(page, path);
    await expect(page.locator(".content-inner h1").first()).toHaveText(title);
    await page.waitForTimeout(700);
    await expectNoSideScroll(page);
  }
  expect(problems).toEqual([]);
});

test("a user sees only Clinical Scribe and cannot open admin pages", async ({ page }) => {
  await signIn(page, USER);
  await expect(page.locator(".nav-heading")).toHaveCount(0);
  // Phone apps is for everyone; the clinic name stays with the admins.
  await expect(page.locator(".sidebar").getByRole("link", { name: "Phone apps", includeHidden: true })).toHaveCount(1);
  await go(page, "/apps");
  await expect(page.locator(".content-inner h1").first()).toHaveText("Phone apps");
  await expect(page.locator(".qr-code")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Name shown in the apps" })).toHaveCount(0);
  await expectNoSideScroll(page);
  await expect(page.getByRole("link", { name: "Recording", exact: true, includeHidden: true })).toHaveCount(0);
  for (const path of ["/admin/users", "/admin/recordings"]) {
    await page.goto(`/#${path}`);
    await expect(page).toHaveURL(/#\/scribe$/);
    await expect(page.locator(".content-inner h1").first()).toHaveText("Clinical Scribe");
  }
  await signOut(page);
});

test("phones use a drawer menu and a bottom tab bar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Phone layout only");
  await signIn(page, ADMIN);
  await expect(page.locator(".tabbar")).toBeVisible();
  // Four tabs; long names take two lines instead of being cut off.
  await expect(page.locator(".tabbar .module-tab")).toHaveText(["Clinical Scribe", "Voice Note", "Templates", "History"]);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    await page.waitForTimeout(300);
    const cut = await page.locator(".tabbar .module-tab span").evaluateAll((labels) => labels.filter((label) => label.scrollWidth > label.clientWidth + 1).length);
    expect(cut, `no tab name is cut off at ${width} px`).toBe(0);
    const tops = await page.locator(".tabbar .module-tab svg").evaluateAll((icons) => icons.map((icon) => Math.round(icon.getBoundingClientRect().top)));
    expect(new Set(tops).size, "the icons stay in one row").toBe(1);
    await expectNoSideScroll(page);
  }
  await page.locator(".tabbar").getByRole("link", { name: "Voice Note" }).click();
  await expect(page.locator(".content-inner h1").first()).toHaveText("Voice Note");
  await page.locator(".tabbar").getByRole("link", { name: "History" }).click();
  await expect(page.locator(".content-inner h1").first()).toHaveText("History");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.locator(".sidebar").getByRole("link", { name: "User settings" }).click();
  await expect(page.locator(".content-inner h1").first()).toHaveText("User settings");
  await expect(page.locator(".tabbar")).toBeHidden();
  await expectNoSideScroll(page);
});
