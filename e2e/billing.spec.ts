import { test, expect } from '@playwright/test';

test('billing outage shows a retryable error, never a demo paid plan or invoices', async ({page}) => {
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Billing Browser Tester');
  await page.getByLabel('Work email').fill(`billing-${Date.now()}@e2e.test`);
  await page.getByLabel('Password', {exact:true}).fill('correct-horse-battery');
  await page.getByRole('button', {name:'Create account',exact:true}).click();
  await expect(page).toHaveURL(/\/(onboarding|dashboard)$/);
  let unavailable=true;
  await page.route('**/v1/workspaces/current/billing', route => unavailable
    ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'unavailable',message:'Billing cannot be loaded right now.'}})})
    : route.continue());
  await page.goto('/billing?checkout=success');
  await expect(page.getByText('Billing is unavailable', {exact:true})).toBeVisible();
  await expect(page.getByText('Current plan', {exact:true})).toHaveCount(0);
  await expect(page.getByText('Payment received', {exact:true})).toHaveCount(0);
  await expect(page.getByText('4242', {exact:false})).toHaveCount(0);
  unavailable=false;
  await page.getByRole('button', {name:'Try again',exact:true}).click();
  await expect(page.getByText('Current plan', {exact:true})).toBeVisible();
  await expect(page.getByText('No invoices yet.', {exact:true})).toBeVisible();
  await expect(page.getByText('Paid plans aren\'t available on this server yet.', {exact:false})).toBeVisible();
});
