import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:8787';

async function fillComplaint(page: Page, item = 'Black backpack') {
  await page.goto('report');
  await page.getByLabel('Full name').fill('Asha Reddy');
  await page.getByLabel('Student / employee ID').fill('22CSE104');
  await page.getByLabel('Department / class').fill('CSE — II Year');
  await page.getByLabel('Phone').fill('+91 98765 43210');
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
  const pin = (await page.getByTestId('cred-pin').textContent())!.trim();
  expect(id).toMatch(/^FB-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  expect(pin).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/);
  expect(page.url()).not.toContain(pin);
  return { id, pin };
}

async function login(page: Page, id: string, pin: string) {
  await page.goto('track');
  await page.getByLabel('Complaint ID').fill(id);
  await page.getByLabel('Secret PIN').fill(pin);
  await page.getByRole('button', { name: 'Open my complaint' }).click();
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
  for (const path of ['how-it-works', 'help', 'privacy', 'track', 'report']) {
    const r = await page.goto(path);
    expect(r?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
  }
  await page.goto('definitely-not-a-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.goto('portal');
  await expect(page).toHaveURL(/\/track$/);
});

test('validation feedback blocks empty submission', async ({ page }) => {
  await page.goto('report');
  await page.getByRole('button', { name: 'Submit complaint' }).click();
  await expect(page.getByText('Please check the highlighted fields.')).toBeVisible();
  await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
});

test('full lifecycle through the UI: submit → verify → staff match → claim → approve → handover', async ({ page, browser }) => {
  const { id, pin } = await submitComplaint(page);
  // credentials are gone after reload
  await page.reload();
  await expect(page.getByText(/shown only once/)).toBeVisible();

  // wrong PIN rejected
  await login(page, id, pin.slice(0, -1) + (pin.endsWith('A') ? 'B' : 'A'));
  await expect(page.getByText('The Complaint ID or PIN is incorrect.')).toBeVisible();
  // correct PIN
  await login(page, id, pin);
  await expect(page.getByRole('heading', { name: 'Submitted', exact: true })).toBeVisible();
  await page.reload(); // refresh keeps the short-lived session
  await expect(page.locator('h1')).toContainText(id);

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

  // student claims
  await page.goto('portal/matches');
  await page.getByRole('link', { name: /request claim/ }).click();
  await page.getByLabel('Ownership evidence').fill('My green notebook with roll number 22CSE104 is inside');
  await page.getByRole('button', { name: 'Send claim for verification' }).click();
  await expect(page.getByText('Ownership claim submitted').first()).toBeVisible();

  // staff approves with checklist, then hands over
  await staff.goto('staff/claims');
  const card = staff.locator('.card', { hasText: id }).first();
  await card.getByRole('button', { name: 'Approve claim' }).isDisabled();
  for (const c of await card.getByRole('checkbox').all()) await c.check();
  await card.getByLabel('Decision notes').fill('Notebook and roll number match');
  await card.getByRole('button', { name: 'Approve claim' }).click();
  await expect(staff.getByText(/Claim approved/)).toBeVisible();
  await staff.goto('staff/handovers');
  await staff.getByRole('button', { name: 'Record handover' }).first().click();
  await staff.getByLabel('Receiver full name').fill('Asha Reddy');
  await staff.getByRole('checkbox', { name: /checked the receiver/ }).check();
  await staff.getByRole('button', { name: 'Confirm handover' }).click();
  await expect(staff.getByText(/Handover recorded/)).toBeVisible();

  await page.goto('portal/timeline');
  await expect(page.getByText('Item handed over to you.')).toBeVisible();
  await page.goto('portal');
  await expect(page.getByRole('heading', { name: 'Returned', exact: true })).toBeVisible();

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
  for (const path of ['', 'report', 'track', 'how-it-works', 'help', 'privacy', 'staff']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `overflow on /${path}`).toBeLessThanOrEqual(1);
  }
  await page.goto('');
  await page.screenshot({ path: 'test-results/mobile-home.png', fullPage: true });
  await page.goto('report');
  await page.screenshot({ path: 'test-results/mobile-report.png' });
});
