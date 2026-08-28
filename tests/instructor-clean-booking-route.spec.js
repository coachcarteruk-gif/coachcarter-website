const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('Simon clean booking route', () => {
  test('publishes /simon and redirects the legacy booking URL', () => {
    const vercelConfig = JSON.parse(read('vercel.json'));

    expect(vercelConfig.rewrites).toContainEqual({
      source: '/simon',
      destination: '/learner/book.html',
    });
    expect(vercelConfig.redirects).toContainEqual({
      source: '/book/simon',
      destination: '/simon',
      permanent: true,
    });
  });

  test('selects Simon at the short URL and shares that canonical path', () => {
    const learnerBooking = read('public/learner/book.js');
    const instructorProfile = read('public/instructor/profile.js');

    expect(learnerBooking).toContain("window.location.pathname.replace(/\\/+$/, '') === '/simon'");
    expect(learnerBooking).toContain("preselectedInstructorSlug = 'simon'");
    expect(instructorProfile).toContain("String(slug).toLowerCase() === 'simon' ? '/simon' : '/book/' + slug");
    expect(instructorProfile).toContain('window.location.origin + bookingPathForInstructor(slug)');
  });
});
