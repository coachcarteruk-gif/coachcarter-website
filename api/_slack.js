/**
 * Fire-and-forget Slack error alerting.
 * Set the SLACK_ERROR_WEBHOOK env var to a Slack Incoming Webhook URL.
 */

function reportError(endpoint, err) {
  const url = process.env.SLACK_ERROR_WEBHOOK;
  if (!url) return;

  const message = err && err.message ? err.message : String(err);
  const payload = {
    text: `*500 Error* on \`${endpoint}\`\n${message}\n_${new Date().toISOString()}_`
  };

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {}); // non-blocking — don't slow down the error response
}

module.exports = { reportError };
