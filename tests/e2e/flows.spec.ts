import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:8787';

async function fillComplaint(page: Page, item = 'Black backpack') {
  await page.goto('access/student');
  await page.getByRole('button', { name: /Development sign-in/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('report');
  await page.getByLabel('Category').selectOption('Bag / Backpack');
  await page.getByLabel('Item name').fill(item);
  await page.getByLabel('Description').fill('Black backpack with a laptop sleeve and two front pockets');
  await page.getByLabel('Colour & distinguishing features').fill('Black with red zipper pulls');
  await page.getByLabel('Last seen location').fill('Central library, second floor');
  await page.getByLabel('Date lost').fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Private ownership evidence').fill('Green notebook inside with my roll number on the cover');
  await page.getByRole('checkbox', { name: /I confirm these details/ }).check();
  await page.waitForTimeout(3200); // anti-bot minimum fill time
}

async function submitComplaint(page: Page, item?: string) {
  await fillComplaint(page, item);
  await page.getByRole('button', { name: 'Submit complaint' }).click();
  await expect(page.getByRole('heading', { name: 'Complaint submitted' })).toBeVisible({ timeout: 20000 });
  const id = (await page.getByTestId('cred-id').textContent())!.trim();
  expect(id).toMatch(/^FB-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  return { id };
}

test('public pages, language switch and direct-route loading', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lost something on campus?');
  await page.getByRole('button', { name: 'Switch to Telugu' }).first().click().catch(async () => {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Switch to Telugu' }).click();
  });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('క్యాంపస్‌లో');
  await page.evaluate(() => localStorage.setItem('fb.lang', 'en'));
  for (const path of ['how-it-works', 'help', 'privacy', 'track', 'access/student', 'access/guest']) {
    const r = await page.goto(path);
    expect(r?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
  }
  await page.goto('definitely-not-a-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.goto('dashboard');
  await expect(page).toHaveURL(/\/findback-campus\/?$/);
});

test('validation feedback blocks empty submission', async ({ page }) => {
  await page.goto('report');
  await expect(page).toHaveURL(/\/findback-campus\/?$/);
});

test('full lifecycle through the UI: submit → verify → staff match → claim → approve → handover', async ({ page, browser }) => {
  const { id } = await submitComplaint(page);
  await page.getByRole('checkbox').check();
  await page.getByRole('link', { name: 'Open my private dashboard' }).click();
  await page.getByText(id).click();
  await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();

  // staff in a separate context
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await staff.goto('staff');
  await staff.getByRole('button', { name: /Development sign-in/ }).click();
  await expect(staff.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await staff.getByRole('link', { name: 'Register found item' }).first().click();
  await staff.getByLabel('Category').selectOption('Bag / Backpack');
  await staff.getByLabel('Item name').fill('Black backpack');
  await staff.getByLabel('Public description').fill('Black backpack found near library stairs');
  await staff.getByLabel('Private verification details').fill('Green notebook with roll number 22CSE104');
  await staff.getByLabel('Colour & features').fill('Black, red zipper pulls');
  await staff.getByLabel('Found location').fill('Central library stairs');
  await staff.getByLabel('Storage location').fill('Shelf B2');
  await staff.getByRole('button', { name: 'Register item' }).click();
  await expect(staff.getByText('Possible owners')).toBeVisible();
  const row = staff.locator('li', { hasText: id });
  await row.getByRole('button', { name: 'Propose match' }).click();
  await expect(staff.getByText('Match proposed to student')).toBeVisible();

  // verified reporter claims
  await page.goto(`dashboard/complaints/${id}`);
  await page.getByPlaceholder('Private ownership evidence').fill('My green notebook with roll number 22CSE104 is inside');
  await page.getByRole('button', { name: 'Submit ownership claim' }).click();
  await expect(page.getByText('Ownership Verification').first()).toBeVisible();

  // staff approves with checklist, then hands over
  await staff.goto('staff/claims');
  const card = staff.locator('.card', { hasText: id }).first();
  await card.getByRole('button', { name: 'Approve claim' }).isDisabled();
  for (const c of await card.getByRole('checkbox').all()) await c.check();
  await card.getByLabel('Decision notes').fill('Notebook and roll number match');
  await card.getByRole('button', { name: 'Approve claim' }).click();
  await expect(staff.getByText(/Claim approved/)).toBeVisible();
  await staff.goto('staff/handovers');
  await staff.getByRole('button', { name: 'Start handover' }).first().click();
  await staff.getByRole('button', { name: 'Generate receiver code' }).click();
  const code = (await staff.locator('.font-mono.text-4xl').textContent())!.trim();
  await page.goto(`dashboard/complaints/${id}`);
  await page.getByLabel('6-digit handover code').fill(code);
  await page.getByLabel('Digital receipt acknowledgment').fill('I confirm that I received this item at the office counter.');
  await page.getByRole('button', { name: 'Confirm digital receipt' }).click();
  await staff.reload();
  await staff.getByRole('button', { name: 'Verify & release' }).click();
  await staff.getByRole('checkbox', { name: /physically checked/ }).check();
  await staff.getByRole('button', { name: 'Confirm physical release' }).click();
  await expect(staff.getByText(/marked Returned/)).toBeVisible();

  await page.reload();
  await expect(page.getByText('Returned', { exact: true }).first()).toBeVisible();

  // analytics + activity show the work
  await staff.goto('staff/activity');
  await expect(staff.getByText('item handed over').first()).toBeVisible();
  await staff.goto('staff/analytics');
  await expect(staff.getByText('Recovery rate')).toBeVisible();
  await staffCtx.close();
});

test('API isolation: a student token cannot read staff data or other complaints', async ({ request }) => {
  const r = await request.get(`${API}/api/staff/dashboard`, { headers: { origin: 'http://127.0.0.1:4173' } });
  expect(r.status()).toBe(401);
  const p = await request.get(`${API}/api/portal`, { headers: { origin: 'http://127.0.0.1:4173', authorization: 'Bearer forged.token' } });
  expect(p.status()).toBe(401);
  const evil = await request.get(`${API}/api/public/config`, { headers: { origin: 'https://evil.example' } });
  expect(evil.status()).toBe(403);
});

test('PWA: manifest, service worker and installability basics', async ({ page }) => {
  await page.goto('');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const res = await page.request.get(new URL(manifestHref!, page.url()).toString());
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toContain('/findback-campus/');
});

test('mobile layouts have no horizontal overflow @mobile', async ({ page }) => {
  for (const path of ['', 'access/student', 'access/guest', 'track', 'how-it-works', 'help', 'privacy', 'staff', 'management']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `overflow on /${path}`).toBeLessThanOrEqual(1);
  }
  await page.goto('');
  await page.screenshot({ path: 'test-results/mobile-home.png', fullPage: true });
  await page.goto('access/student');
  await page.screenshot({ path: 'test-results/mobile-access.png' });
});
