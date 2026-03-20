#!/usr/bin/env node
//
// Batch Video Uploader for CoachCarter
//
// Uploads video files from a folder to Cloudflare Stream via the API
// (bypasses browser SSL issues) and creates entries in the database.
//
// Usage:
//   node scripts/batch-upload.js <folder> [options]
//
// Options:
//   --category <slug>      Category slug (required, or prompts to pick)
//   --learner-only         Mark videos as learner-only (default: false)
//   --site <url>           Site URL (default: https://www.coachcarter.uk)
//   --token <jwt>          Admin JWT token (or set CC_ADMIN_TOKEN env var)
//   --cf-token <token>     Cloudflare API token (or set CLOUDFLARE_API_TOKEN env var)
//   --cf-account <id>      Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID env var)
//   --dry-run              Show what would be uploaded without uploading
//   --help                 Show this help
//
// Examples:
//   node scripts/batch-upload.js ./lesson-videos --category manoeuvres
//   node scripts/batch-upload.js ./clips --category theory --learner-only
//   node scripts/batch-upload.js ./videos --dry-run
//

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ── Config ───────────────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv']);
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB TUS chunks (smaller = more reliable)
const MAX_RETRIES = 5;
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000]; // exponential backoff
const MAX_DURATION_SECONDS = 3600;

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    folder: null,
    category: null,
    learnerOnly: false,
    site: 'https://www.coachcarter.uk',
    token: process.env.CC_ADMIN_TOKEN || null,
    cfToken: process.env.CLOUDFLARE_API_TOKEN || null,
    cfAccount: process.env.CLOUDFLARE_ACCOUNT_ID || null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').match(/\/\/.*Usage:[\s\S]*?\/\//)[0]);
      process.exit(0);
    }
    else if (arg === '--category')     opts.category = args[++i];
    else if (arg === '--learner-only') opts.learnerOnly = true;
    else if (arg === '--site')         opts.site = args[++i];
    else if (arg === '--token')        opts.token = args[++i];
    else if (arg === '--cf-token')     opts.cfToken = args[++i];
    else if (arg === '--cf-account')   opts.cfAccount = args[++i];
    else if (arg === '--dry-run')      opts.dryRun = true;
    else if (!arg.startsWith('-'))     opts.folder = arg;
  }

  return opts;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function titleFromFilename(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function jsonFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          json: () => { try { return JSON.parse(data); } catch { return null; } },
          text: () => data,
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Cloudflare Stream upload via TUS (server-side, no browser SSL issues) ───

async function uploadToCloudflare(filePath, cfToken, cfAccount) {
  const fileSize = fs.statSync(filePath).size;
  const fileName = path.basename(filePath);

  // Step 1: Create TUS upload
  const createUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/stream?direct_user=true`;
  const createResp = await new Promise((resolve, reject) => {
    const req = https.request(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfToken}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(fileSize),
        'Upload-Metadata': [
          `name ${Buffer.from(fileName).toString('base64')}`,
          `maxDurationSeconds ${Buffer.from(String(MAX_DURATION_SECONDS)).toString('base64')}`,
        ].join(','),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });

  if (createResp.status < 200 || createResp.status >= 300) {
    throw new Error(`Failed to create upload (${createResp.status}): ${createResp.body}`);
  }

  const uploadUrl = createResp.headers['location'];
  const uid = createResp.headers['stream-media-id'];
  if (!uploadUrl || !uid) {
    throw new Error('Cloudflare response missing location or stream-media-id header');
  }

  // Step 2: Upload file in chunks via TUS PATCH with retries
  const fd = fs.openSync(filePath, 'r');
  let offset = 0;

  try {
    while (offset < fileSize) {
      const chunkLen = Math.min(CHUNK_SIZE, fileSize - offset);
      const buffer = Buffer.alloc(chunkLen);
      fs.readSync(fd, buffer, 0, chunkLen, offset);

      let lastErr;
      let newOffset;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
          process.stdout.write(`\r  Retry ${attempt}/${MAX_RETRIES} after ${delay/1000}s...          `);
          await new Promise(r => setTimeout(r, delay));
        }
        try {
          newOffset = await new Promise((resolve, reject) => {
            const parsed = new URL(uploadUrl);
            const req = https.request({
              hostname: parsed.hostname,
              path: parsed.pathname + parsed.search,
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/offset+octet-stream',
                'Content-Length': String(chunkLen),
                'Tus-Resumable': '1.0.0',
                'Upload-Offset': String(offset),
              },
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  resolve(parseInt(res.headers['upload-offset'] || String(offset + chunkLen), 10));
                } else {
                  reject(new Error(`TUS PATCH failed (${res.statusCode}): ${data}`));
                }
              });
            });
            req.on('error', reject);
            req.write(buffer);
            req.end();
          });
          lastErr = null;
          break; // success, exit retry loop
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;

      offset = newOffset;
      const pct = Math.round((offset / fileSize) * 100);
      process.stdout.write(`\r  Uploading: ${pct}% (${formatBytes(offset)} / ${formatBytes(fileSize)})`);
    }
  } finally {
    fs.closeSync(fd);
  }

  console.log(); // newline after progress
  return uid;
}

// ── Poll for video readiness and duration ────────────────────────────────────

async function pollForReady(uid, cfToken, cfAccount, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const resp = await jsonFetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/stream/${uid}`,
      { headers: { 'Authorization': `Bearer ${cfToken}` } }
    );
    if (resp.ok) {
      const data = resp.json();
      if (data?.result?.readyToStream) {
        return {
          duration: data.result.duration ? Math.round(data.result.duration) : null,
          thumbnail: data.result.thumbnail || null,
        };
      }
    }
    process.stdout.write(`\r  Processing: attempt ${i + 1}/${maxAttempts}...`);
  }
  console.log();
  return { duration: null, thumbnail: null };
}

// ── Create video entry in database ───────────────────────────────────────────

async function createVideoEntry(site, token, videoData) {
  const resp = await jsonFetch(`${site}/api/videos?action=create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(videoData),
  });

  if (!resp.ok) {
    const body = resp.text();
    throw new Error(`Failed to create video entry (${resp.status}): ${body}`);
  }

  return resp.json();
}

// ── Fetch available categories ───────────────────────────────────────────────

async function fetchCategories(site) {
  const resp = await jsonFetch(`${site}/api/videos?action=categories`);
  if (!resp.ok) throw new Error('Failed to fetch categories');
  const data = resp.json();
  return data?.categories || [];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Validate folder
  if (!opts.folder) {
    console.error('Error: No folder specified.\n');
    console.error('Usage: node scripts/batch-upload.js <folder> --category <slug> [options]');
    console.error('       node scripts/batch-upload.js --help');
    process.exit(1);
  }

  const folder = path.resolve(opts.folder);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Error: "${folder}" is not a directory.`);
    process.exit(1);
  }

  // Validate credentials
  if (!opts.cfToken) {
    console.error('Error: Cloudflare API token required. Use --cf-token or set CLOUDFLARE_API_TOKEN.');
    process.exit(1);
  }
  if (!opts.cfAccount) {
    console.error('Error: Cloudflare account ID required. Use --cf-account or set CLOUDFLARE_ACCOUNT_ID.');
    process.exit(1);
  }
  if (!opts.token) {
    console.error('Error: Admin JWT token required. Use --token or set CC_ADMIN_TOKEN.');
    process.exit(1);
  }

  // Find video files
  const files = fs.readdirSync(folder)
    .filter(f => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.error(`No video files found in "${folder}".`);
    console.error(`Supported formats: ${[...VIDEO_EXTENSIONS].join(', ')}`);
    process.exit(1);
  }

  // Fetch and validate category
  console.log('Fetching categories...');
  const categories = await fetchCategories(opts.site);

  if (categories.length === 0) {
    console.error('No categories found. Create categories in the admin portal first.');
    process.exit(1);
  }

  if (!opts.category) {
    console.log('\nAvailable categories:');
    categories.forEach(c => console.log(`  ${c.slug.padEnd(20)} ${c.label} (${c.video_count} videos)`));
    console.error('\nError: No category specified. Use --category <slug>');
    process.exit(1);
  }

  const category = categories.find(c => c.slug === opts.category);
  if (!category) {
    console.error(`Error: Category "${opts.category}" not found.`);
    console.log('Available:', categories.map(c => c.slug).join(', '));
    process.exit(1);
  }

  // Summary
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  CoachCarter Batch Video Upload');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Folder:       ${folder}`);
  console.log(`  Category:     ${category.label} (${category.slug})`);
  console.log(`  Learner only: ${opts.learnerOnly ? 'Yes' : 'No'}`);
  console.log(`  Videos:       ${files.length}`);
  console.log(`  Total size:   ${formatBytes(files.reduce((sum, f) => sum + fs.statSync(path.join(folder, f)).size, 0))}`);
  if (opts.dryRun) console.log('  Mode:         DRY RUN (no uploads)');
  console.log('════════════════════════════════════════════════════════\n');

  // List files
  files.forEach((f, i) => {
    const size = fs.statSync(path.join(folder, f)).size;
    console.log(`  ${String(i + 1).padStart(3)}. ${f} (${formatBytes(size)}) → "${titleFromFilename(f)}"`);
  });
  console.log();

  if (opts.dryRun) {
    console.log('Dry run complete. Remove --dry-run to upload.');
    return;
  }

  // Upload each file
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(folder, file);
    const title = titleFromFilename(file);
    const fileSize = fs.statSync(filePath).size;

    console.log(`\n[${i + 1}/${files.length}] ${file} (${formatBytes(fileSize)})`);

    try {
      // Upload to Cloudflare Stream
      console.log('  Uploading to Cloudflare Stream...');
      const uid = await uploadToCloudflare(filePath, opts.cfToken, opts.cfAccount);
      console.log(`  Cloudflare UID: ${uid}`);

      // Poll for processing
      console.log('  Waiting for processing...');
      const meta = await pollForReady(uid, opts.cfToken, opts.cfAccount);
      console.log();
      if (meta.duration) console.log(`  Duration: ${Math.floor(meta.duration / 60)}m ${meta.duration % 60}s`);

      // Create database entry
      console.log('  Creating database entry...');
      const entry = await createVideoEntry(opts.site, opts.token, {
        cloudflare_uid: uid,
        title,
        description: '',
        category_slug: opts.category,
        thumbnail_url: meta.thumbnail || null,
        learner_only: opts.learnerOnly,
        duration_seconds: meta.duration,
      });

      console.log(`  Done! Video ID: ${entry.video?.id || 'unknown'}`);
      results.push({ file, uid, title, status: 'success' });
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      results.push({ file, uid: null, title, status: 'failed', error: err.message });
    }
  }

  // Summary
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  Upload Summary');
  console.log('════════════════════════════════════════════════════════');
  const success = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');
  console.log(`  Successful: ${success.length}`);
  console.log(`  Failed:     ${failed.length}`);

  if (failed.length > 0) {
    console.log('\n  Failed files:');
    failed.forEach(r => console.log(`    - ${r.file}: ${r.error}`));
  }

  console.log('\n════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
