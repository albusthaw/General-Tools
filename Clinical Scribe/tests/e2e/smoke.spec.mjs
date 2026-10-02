// Every screen opens without errors and fits the screen, at desktop and phone sizes.
import { expect, test } from "@playwright/test";
import { ADMIN, expectNoSideScroll, go, signIn, signOut, USER, watchProblems } from "./helpers.mjs";

const ADMIN_PAGES = [
  ["/admin/users", "User settings"],
  ["/admin/ai", "AI settings"],
  ["/admin/review", "Review records"],
  ["/admin/audit", "Audit log"],
  ["/admin/google", "Google sign-in"],
  ["/admin/email", "Email (SMTP)"],
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
  for (const [path, title] of [["/scribe", "Scribe"], ["/templates", "Templates"], ["/history", "History"], ...ADMIN_PAGES]) {
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
  await page.goto("/#/admin/users");
  await expect(page).toHaveURL(/#\/scribe$/);
  await expect(page.locator(".content-inner h1").first()).toHaveText("Scribe");
  await signOut(page);
});

test("phones use a drawer menu and a bottom tab bar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Phone layout only");
  await signIn(page, ADMIN);
  await expect(page.locator(".tabbar")).toBeVisible();
  await page.locator(".tabbar").getByRole("link", { name: "History" }).click();
  await expect(page.locator(".content-inner h1").first()).toHaveText("History");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.locator(".sidebar").getByRole("link", { name: "User settings" }).click();
  await expect(page.locator(".content-inner h1").first()).toHaveText("User settings");
  await expect(page.locator(".tabbar")).toBeHidden();
  await expectNoSideScroll(page);
});
