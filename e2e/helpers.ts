import type { Page } from '@playwright/test';

export const PASSWORD = 'Coastal2026!';

export const ACCOUNTS = {
  admin: 'dana.reyes@coastaleats.com',
  marcus: 'marcus.hale@coastaleats.com',
  priya: 'priya.nadkarni@coastaleats.com',
  sarah: 'sarah.chen@coastaleats.com',
  marco: 'marco.ruiz@coastaleats.com',
  jordan: 'jordan.blake@coastaleats.com',
  tom: 'tom.okafor@coastaleats.com',
} as const;

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
}
