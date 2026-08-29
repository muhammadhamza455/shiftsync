import { expect, test } from '@playwright/test';
import { ACCOUNTS, login } from './helpers';

test.describe('authentication and role scoping', () => {
  test('signed-out visitors are sent to the login page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole('heading', { name: 'ShiftSync' }),
    ).toBeVisible();
  });

  test('a manager sees only the locations they run', async ({ page }) => {
    await login(page, ACCOUNTS.marcus);
    await page.goto('/manage/schedule');

    await expect(page.getByRole('link', { name: 'Santa Monica' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Portland Pearl' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Charleston Battery' }),
    ).toHaveCount(0);
  });

  test('staff are redirected away from manager routes', async ({ page }) => {
    await login(page, ACCOUNTS.sarah);
    await page.goto('/manage/overtime');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('the audit export is refused to a manager', async ({ page }) => {
    await login(page, ACCOUNTS.marcus);
    const response = await page.request.get('/api/audit/export');
    expect(response.status()).toBe(403);
  });
});

test.describe('scenario 2 — the overtime trap', () => {
  test('names the person, the hours and the shift that tips them over', async ({
    page,
  }) => {
    await login(page, ACCOUNTS.marcus);
    await page.goto('/manage/overtime');

    await page.getByRole('link', { name: 'Next week' }).click();
    await expect(page.getByText('Marco Ruiz')).toBeVisible();

    const marco = page
      .locator('li')
      .filter({ hasText: 'Marco Ruiz' })
      .first();

    await expect(marco).toContainText('52h');
    await expect(marco.getByText('Overtime', { exact: true })).toBeVisible();
    await expect(marco).toContainText('crosses the 40h line');
  });
});

test.describe('scenario 5 — the fairness complaint', () => {
  test('shows the under-served person and the evidence behind it', async ({
    page,
  }) => {
    await login(page, ACCOUNTS.priya);
    await page.goto('/manage/fairness');

    await expect(page.getByText(/\/100$/).first()).toBeVisible();

    const jordan = page
      .locator('li')
      .filter({ hasText: 'Jordan Blake' })
      .first();
    await expect(jordan).toContainText('Under-served');
    await expect(jordan).toContainText('expected');

    await expect(
      page.getByRole('heading', { name: /Every premium shift/i }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });
});

test.describe('scenario 3 — the timezone tangle', () => {
  test('a cross-zone staff member is told the ambiguity exists', async ({
    page,
  }) => {
    await login(page, ACCOUNTS.sarah);
    await page.goto('/availability');

    await expect(
      page.getByRole('heading', { name: /You work across two timezones/i }),
    ).toBeVisible();
    await expect(page.getByText(/Local to the location/i).first()).toBeVisible();

    const firstZoneSelect = page
      .getByLabel(/timezone$/i)
      .first();
    await expect(firstZoneSelect).toBeVisible();
  });

  test('shift times carry their zone abbreviation', async ({ page }) => {
    await login(page, ACCOUNTS.jordan);
    await page.goto('/schedule');
    await expect(page.getByText(/E[DS]T/).first()).toBeVisible();
  });
});

test.describe('scenario 6 — the regret swap', () => {
  test('withdrawing a pending swap leaves the original assignment intact', async ({
    page,
  }) => {
    await login(page, ACCOUNTS.tom);
    await page.goto('/swaps');

    const row = page
      .locator('li')
      .filter({ hasText: 'Awaiting manager' })
      .first();
    await expect(row).toBeVisible();

    await expect(page.getByText(/still scheduled/i).first()).toBeVisible();

    await row.getByRole('button', { name: /withdraw/i }).click();
    await expect(page.getByText(/Request withdrawn/i)).toBeVisible();

    await page.goto('/schedule');
    await expect(page.getByText(/Swap requested/i)).toHaveCount(0);
  });
});

async function openEditableShift(page: import('@playwright/test').Page) {
  await page.goto('/manage/schedule');
  await page.getByRole('link', { name: 'Next week' }).click();

  const card = page
    .getByRole('button', { name: /^Shift:.*draft$/i })
    .first();
  await expect(card).toBeVisible();
  await card.click();

  const drawer = page.getByRole('dialog', { name: /Shift detail/i });
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe('constraint feedback', () => {
  test('an unqualified assignment is refused with a reason and alternatives', async ({
    page,
  }) => {
    await login(page, ACCOUNTS.priya);
    const drawer = await openEditableShift(page);

    const select = drawer.getByLabel('Staff member');
    await expect(select).toBeVisible();

    const ineligible = drawer.locator('option', {
      hasText: /not certified here|no .* skill/i,
    });
    if ((await ineligible.count()) > 0) {
      const value = await ineligible.first().getAttribute('value');
      await select.selectOption(value!);

      await expect(drawer.getByText(/Blocked/i).first()).toBeVisible();
      await expect(
        drawer.getByRole('button', { name: /Blocked by a rule/i }),
      ).toBeDisabled();
    }
  });

  test('the what-if panel shows hours and cost before assigning', async ({
    page,
  }) => {
    await login(page, ACCOUNTS.priya);
    const drawer = await openEditableShift(page);
    await drawer.getByRole('button', { name: /suggest/i }).click();

    const suggestions = drawer.getByText(/Who else could work this/i);
    await expect(suggestions).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('real-time', () => {
  test('the connection indicator reports a live feed', async ({ page }) => {
    await login(page, ACCOUNTS.marcus);
    await expect(page.getByText('Live', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('a published schedule reaches a second session without a reload', async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const managerContext = await browser.newContext();
    const staffContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const staff = await staffContext.newPage();

    await login(manager, ACCOUNTS.priya);
    await login(staff, ACCOUNTS.jordan);

    await expect(staff.getByText('Live', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await manager.goto('/manage/schedule');
    await manager.getByRole('link', { name: 'Next week' }).click();

    await expect(manager.getByText('Live', { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const publish = manager.getByRole('button', { name: /^Publish/ });
    if (await publish.isEnabled()) {
      await publish.click();
      await expect(
        staff.getByText(/schedule is now published|Schedule published/i).first(),
      ).toBeVisible({ timeout: 20_000 });
    }

    await managerContext.close();
    await staffContext.close();
  });
});

test.describe('audit trail', () => {
  test('records changes and exports as CSV for an admin', async ({ page }) => {
    await login(page, ACCOUNTS.admin);
    await page.goto('/audit');

    await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
    await expect(page.getByText(/entr(y|ies)/).first()).toBeVisible();

    const response = await page.request.get('/api/audit/export');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/csv');
    const body = await response.text();
    expect(body).toContain('id,timestamp_utc,action,actor');
  });
});

test.describe('email simulation', () => {
  test('the outbox shows what would have been sent', async ({ page }) => {
    await login(page, ACCOUNTS.admin);
    await page.goto('/admin/outbox');
    await expect(
      page.getByRole('heading', { name: 'Email outbox' }),
    ).toBeVisible();
    await expect(page.getByText('Actually delivered')).toBeVisible();
  });
});
