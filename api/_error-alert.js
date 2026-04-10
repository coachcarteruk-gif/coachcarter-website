/**
 * Fire-and-forget email error alerting.
 * Uses existing SMTP config + ERROR_ALERT_EMAIL env var for the recipient.
 *
 * SECURITY: Stack traces are sanitised before sending. Full stacks can contain
 * interpolated bind values from Postgres errors, absolute file paths, and
 * env-var-derived error messages — even with a single-recipient inbox we treat
 * the outbound email as untrusted transport.
 */
const path = require('path');
const { createTransporter } = require('./_auth-helpers');

// Resolve once at module load, not per call.
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Take a raw err.stack string and return the top N project frames rendered as
 * "function (relative/path:line)". Drops node internals and node_modules
 * frames, strips absolute path prefixes. Never returns source snippets.
 */
function sanitiseStack(rawStack, maxFrames = 3) {
  if (!rawStack || typeof rawStack !== 'string') return '';

  const lines = rawStack.split('\n');
  const frames = [];

  for (const line of lines) {
    if (frames.length >= maxFrames) break;

    // Only lines that look like "    at fn (path:line:col)" or "    at path:line:col"
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;

    // Skip node internals.
    if (trimmed.includes('node:internal/') ||
        trimmed.includes('(node:') ||
        trimmed.includes('internal/process/') ||
        trimmed.includes('internal/modules/')) continue;

    // Skip node_modules (not project code).
    if (trimmed.includes('node_modules')) continue;

    // Parse: "at fnName (file:line:col)" or "at file:line:col"
    const withFnMatch = trimmed.match(/^at\s+(.+?)\s+\((.+?):(\d+):\d+\)$/);
    const bareMatch   = trimmed.match(/^at\s+(.+?):(\d+):\d+$/);

    let fnName, filePath, lineNo;
    if (withFnMatch) {
      fnName = withFnMatch[1];
      filePath = withFnMatch[2];
      lineNo = withFnMatch[3];
    } else if (bareMatch) {
      fnName = '<anonymous>';
      filePath = bareMatch[1];
      lineNo = bareMatch[2];
    } else {
      continue;
    }

    // Strip absolute project root prefix so only relative paths are emitted.
    let relPath = filePath;
    if (filePath.startsWith(PROJECT_ROOT)) {
      relPath = filePath.slice(PROJECT_ROOT.length).replace(/^[\\/]+/, '');
    } else {
      // Not a project file — keep just basename to avoid leaking host paths.
      relPath = path.basename(filePath);
    }
    // Normalise Windows separators in the output.
    relPath = relPath.replace(/\\/g, '/');

    frames.push(`${fnName} (${relPath}:${lineNo})`);
  }

  return frames.join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function reportError(endpoint, err) {
  const to = process.env.ERROR_ALERT_EMAIL;
  if (!to) return;

  const name = err && err.name ? String(err.name) : 'Error';
  const message = err && err.message ? String(err.message) : String(err);
  const frames = sanitiseStack(err && err.stack);
  const timestamp = new Date().toISOString();

  const safeName = escapeHtml(name);
  const safeMessage = escapeHtml(message);
  const safeEndpoint = escapeHtml(endpoint);
  const safeFrames = escapeHtml(frames || '(no project frames)');

  try {
    const transporter = createTransporter();
    transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: `[CoachCarter] 500 Error on ${endpoint}`,
      text: `Endpoint: ${endpoint}\nTime: ${timestamp}\n\n${name}: ${message}\n\nTop frames:\n${frames || '(no project frames)'}`,
      html: `
        <h3 style="color:#ef4444;">500 Error on <code>${safeEndpoint}</code></h3>
        <p><strong>Time:</strong> ${timestamp}</p>
        <p><strong>${safeName}:</strong> ${safeMessage}</p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;overflow-x:auto;">${safeFrames}</pre>
      `
    }).catch(() => {}); // fire-and-forget
  } catch (_) {} // don't let alert failures break anything
}

module.exports = { reportError };
