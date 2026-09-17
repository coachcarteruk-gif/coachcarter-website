// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const publicRoot = path.resolve(__dirname, '..', 'public');

test('sitemap uses the production host and contains no retired landing page', () => {
  const sitemap = fs.readFileSync(path.join(publicRoot, 'sitemap.xml'), 'utf8');
  expect(sitemap).not.toContain('coachcarter-landing.html');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(locations.length).toBeGreaterThan(0);
  expect(locations.every((url) => url.startsWith('https://www.coachcarter.uk/'))).toBe(true);
});

test('public marketing canonicals use the redirect destination host', () => {
  const pages = [
    'index.html',
    'lessons.html',
    'free-trial.html',
    'free-consultation.html',
    'free-lesson.html',
    'check-my-driving.html',
    'privacy.html',
    'terms.html',
  ];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicRoot, page), 'utf8');
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i);
    expect(canonical, page).not.toBeNull();
    expect(canonical[1], page).toMatch(/^https:\/\/www\.coachcarter\.uk\//);
  }
});
