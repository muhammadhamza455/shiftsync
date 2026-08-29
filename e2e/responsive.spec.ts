import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, login } from './helpers';

const VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPad portrait', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
] as const;

const MANAGER_ROUTES = [
  '/dashboard',
  '/manage/schedule',
  '/manage/overtime',
  '/manage/fairness',
  '/manage/swaps',
  '/manage/staff',
  '/on-duty',
  '/audit',
  '/notifications',
  '/settings',
];

const STAFF_ROUTES = [
  '/dashboard',
  '/schedule',
  '/swaps',
  '/swaps/open',
  '/availability',
];

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    if (overflow <= 1) return null;

    const guilty: string[] = [];
    const limit = doc.clientWidth + 1;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= limit) continue;
      const style = getComputedStyle(el);
      let scrollableAncestor = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') {
          scrollableAncestor = true;
          break;
        }
      }
      if (scrollableAncestor || style.position === 'fixed') continue;
      guilty.push(
        `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 60)} right=${Math.round(rect.right)}`,
      );
      if (guilty.length >= 3) break;
    }
    return { overflow, guilty };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('manager pages do not scroll sideways', async ({ page }) => {
      await login(page, ACCOUNTS.priya);
      const failures: string[] = [];
      for (const route of MANAGER_ROUTES) {
        await page.goto(route);
        await page.waitForLoadState('networkidle').catch(() => {});
        const result = await horizontalOverflow(page);
        if (result) {
          failures.push(
            `${route}: overflows by ${result.overflow}px — ${result.guilty.join(' | ')}`,
          );
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });

    test('staff pages do not scroll sideways', async ({ page }) => {
      await login(page, ACCOUNTS.jordan);
      const failures: string[] = [];
      for (const route of STAFF_ROUTES) {
        await page.goto(route);
        await page.waitForLoadState('networkidle').catch(() => {});
        const result = await horizontalOverflow(page);
        if (result) {
          failures.push(
            `${route}: overflows by ${result.overflow}px — ${result.guilty.join(' | ')}`,
          );
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });

    test('navigation is reachable', async ({ page }) => {
      await login(page, ACCOUNTS.priya);
      const sidebar = page.getByRole('navigation', { name: 'Main' });
      const menuButton = page.getByRole('button', { name: /menu|navigation/i });
      const reachable =
        (await sidebar.isVisible().catch(() => false)) ||
        (await menuButton.isVisible().catch(() => false));
      expect(reachable, 'no way to navigate at this viewport').toBe(true);
    });
  });
}
