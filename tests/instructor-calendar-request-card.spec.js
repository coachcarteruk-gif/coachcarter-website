// @ts-check

const { test, expect } = require('@playwright/test');

test.describe('instructor calendar lesson requests', () => {
  test('renders a future pending request when the wider schedule read fails', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cc_instructor', JSON.stringify({
        instructor: {
          id: 1,
          school_id: 1,
          name: 'Shadow Step 12 Instructor'
        }
      }));
    });

    await page.route('**/api/instructor?*', async route => {
      const action = new URL(route.request().url()).searchParams.get('action');

      if (action === 'profile') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            instructor: {
              calendar_start_hour: 7,
              slug: 'shadow-step-12-instructor',
              transmission_type: 'manual'
            }
          })
        });
      }

      if (action === 'schedule-range') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Failed to load schedule' })
        });
      }

      if (action === 'list-requests') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            requests: [{
              id: 1,
              scheduled_date: '2026-08-14',
              start_time: '09:00:00',
              end_time: '10:30:00',
              status: 'pending',
              payment_method: 'card_hold',
              pickup_address: 'Shadow pickup',
              expires_at: '2026-08-08T08:47:17.748Z',
              learner_name: 'Shadow Step 13 Learner',
              lesson_type_name: 'Standard Lesson',
              duration_minutes: 90
            }]
          })
        });
      }

      if (action === 'availability') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            windows: [{ day_of_week: 5, start_time: '09:00:00', end_time: '17:00:00' }]
          })
        });
      }

      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/instructor/?date=2026-08-14', { waitUntil: 'domcontentloaded' });

    const requestCard = page.locator('.day-card.request[data-request-id="1"]');
    await expect(page.locator('#plannerDayTitle')).toContainText('Friday 14 August');
    await expect(requestCard).toContainText('09:00');
    await expect(requestCard).toContainText('10:30');
    await expect(requestCard).toContainText('Shadow Step 13 Learner');
    await expect(requestCard.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(requestCard.getByRole('button', { name: 'Decline' })).toBeVisible();
  });
});
