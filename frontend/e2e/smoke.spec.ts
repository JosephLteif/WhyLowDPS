import { expect, test, type Page } from '@playwright/test';

async function mockBackend(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    localStorage.setItem('whylowdps_discord_prompt_dismissed', '1');
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/auth/me') {
      return route.fulfill({ json: { battletag: 'Tester#1234' } });
    }
    if (path === '/api/auth/bnet/credentials-status') {
      return route.fulfill({ json: { globally_configured: true } });
    }
    if (path === '/api/data/status') {
      return route.fulfill({ json: { status: 'ready', progress: 'Ready' } });
    }
    if (path === '/api/system/stats') {
      return route.fulfill({
        json: { cpu_usage: 0, memory_used: 0, memory_total: 1, active_jobs: 0 },
      });
    }
    if (path === '/api/history/stats') {
      return route.fulfill({ json: { size_bytes: 0, count: 1 } });
    }
    if (path === '/api/config') {
      return route.fulfill({ json: { max_jobs: 50, max_scenarios: 10 } });
    }
    if (path === '/api/character-profiles') {
      return route.fulfill({ json: [] });
    }
    if (path === '/api/routes') {
      return route.fulfill({ json: [] });
    }
    if (path === '/api/sims') {
      return route.fulfill({
        json: [
          {
            id: 'sim-1',
            status: 'done',
            sim_type: 'quick',
            created_at: new Date().toISOString(),
            fight_style: 'Patchwerk',
            iterations: 1000,
            error_message: null,
            player_name: 'Alice',
            player_class: 'Mage',
            realm: 'Illidan',
            dps: 123456,
            batch_id: null,
            size_bytes: 128,
            pinned: false,
          },
        ],
      });
    }
    if (path === '/api/sim' && route.request().method() === 'POST') {
      return route.fulfill({ status: 200, json: { id: 'new-sim', status: 'pending' } });
    }
    if (path === '/api/data/season-config') {
      return route.fulfill({ json: {} });
    }
    if (path === '/api/data/drops') {
      return route.fulfill({ json: {} });
    }
    if (path === '/api/data/instances') {
      return route.fulfill({ json: [] });
    }

    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('dashboard renders with mocked backend state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Quick Links')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Simulation Activity/ })).toBeVisible();
});

test('quick sim validates empty input and can submit pasted input', async ({ page }) => {
  await page.goto('/quick-sim');

  const runButton = page.getByRole('button', { name: /run simulation/i }).first();
  await expect(runButton).toBeDisabled();

  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.fill('mage="Alice"\nlevel=80\nspec=arcane\n');
  await expect(runButton).toBeEnabled();
  await runButton.click();
  await expect(page).toHaveURL(/\/sim\/new-sim/);
});

test('history shows mocked simulation row', async ({ page }) => {
  await page.goto('/history');
  await expect(page.getByText('Alice')).toBeVisible();
  await expect(page.getByText('Quick Sim')).toBeVisible();
});

test('drop finder page renders controls without live backend data', async ({ page }) => {
  await page.goto('/drop-finder');
  await expect(page.getByText(/Drop Finder/i).first()).toBeVisible();
});
