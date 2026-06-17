import { expect, test } from "@playwright/test";

const quickDomain = process.env.QUICK_DOMAIN?.trim() || "local.example.com";
const quickScheme = process.env.QUICK_SCHEME?.trim() || "https";
const platformOrigin = process.env.QUICK_E2E_PLATFORM_ORIGIN?.trim() || `${quickScheme}://${quickDomain}`;
const siteOrigin = process.env.QUICK_E2E_SITE_ORIGIN?.trim() || `${quickScheme}://demo.${quickDomain}`;
const testEmail = process.env.QUICK_E2E_EMAIL ?? "dev@quick.local";

async function completeDevCodeLogin(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "Quick login" })).toBeVisible();

  const emailInput = page.locator('input[name="email"]');
  if (await emailInput.isVisible()) {
    await emailInput.fill(testEmail);
    await page.getByRole("button", { name: "Send code" }).click();
  }

  const codeText = await page.getByText(/Development code:/).textContent();
  const code = codeText?.match(/\b\d{6}\b/)?.[0];
  expect(code, `Expected dev code on login page, got: ${codeText}`).toBeTruthy();

  await page.locator('input[name="code"]').fill(code!);
  await page.getByRole("button", { name: "Verify" }).click();
}

test.describe("Quick platform", () => {
  test("serves the repo-contained platform homepage", async ({ page }) => {
    await page.goto(`${platformOrigin}/`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("link", { name: "Quick" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  });
});

test.describe("Quick auth edge flow", () => {
  test("rejects external return_to values", async ({ request }) => {
    const response = await request.get(`${platformOrigin}/api/auth/login`, {
      params: {
        format: "json",
        return_to: "https://evil.example/phish",
      },
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.returnTo).toBe("/");
    expect(new URL(body.authorizationUrl).origin).toBe(platformOrigin);
  });

  test("redirects anonymous static requests to platform login and shares session across subdomains", async ({ page, context }) => {
    await context.clearCookies();

    await page.goto(`${siteOrigin}/`, { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).origin).toBe(platformOrigin);

    await completeDevCodeLogin(page);

    await expect(page).toHaveURL(new RegExp(`^${siteOrigin.replaceAll(".", "\\.")}/?$`));
    await expect(page.getByRole("heading", { name: "Demo Quick Site" })).toBeVisible();

    const siteSession = await context.request.get(`${siteOrigin}/api/auth/session`);
    expect(siteSession.status()).toBe(200);
    await expect(siteSession).toBeOK();
    expect(await siteSession.json()).toMatchObject({
      authenticated: true,
      user: { email: testEmail },
    });

    const platformSession = await context.request.get(`${platformOrigin}/api/auth/session`);
    await expect(platformSession).toBeOK();
    expect(await platformSession.json()).toMatchObject({
      authenticated: true,
      user: { email: testEmail },
    });
  });
});
