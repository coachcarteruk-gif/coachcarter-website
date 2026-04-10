(function () {
  'use strict';

const STORAGE_KEY = 'cc_advisor_conversation';
let AUTH;
let conversationHistory = [];
let isSending = false;

// ── Init ──
window.addEventListener('DOMContentLoaded', () => {
  AUTH = ccAuth.getAuth();

  // Show auth status hint
  const hint = document.getElementById('auth-hint');
  if (AUTH?.token) {
    hint.style.display = 'inline-block';
    hint.textContent = 'Signed in as ' + (AUTH.user?.name || 'learner') + ' — personalised recommendations active';
  } else {
    hint.style.display = 'inline-block';
    hint.textContent = 'Sign in for personalised recommendations based on your progress';
  }

  // Restore conversation from localStorage
  restoreConversation();

  // Enter key to send
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Check if returned from cancelled checkout
  const params = new URLSearchParams(window.location.search);
  if (params.get('cancelled') === 'true') {
    appendMessage('assistant', "No worries — the checkout was cancelled. You can change your mind anytime. Would you like to explore a different package, or is there anything else I can help with?");
    window.history.replaceState({}, '', window.location.pathname);
  }
});

// ── Conversation persistence ──
function saveConversation() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationHistory));
  } catch (e) { /* quota exceeded — clear old data */ }
}

function restoreConversation() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.length > 0) {
      // Hide starter chips
      const chips = document.getElementById('starter-chips');
      if (chips) chips.remove();

      conversationHistory = saved;
      for (const msg of conversationHistory) {
        appendMessage(msg.role, msg.content, true);
      }
      scrollToBottom();
    }
  } catch (e) { /* corrupted — start fresh */ }
}

function clearConversation() {
  localStorage.removeItem(STORAGE_KEY);
  conversationHistory = [];
}

// ── Starter chip click ──
function askChip(btn) {
  const text = btn.textContent;
  document.getElementById('starter-chips').remove();
  sendMessage(text);

  if (typeof posthog !== 'undefined') {
    posthog.capture('advisor_chip_clicked', { chip_text: text });
  }
}

// ── Handle send ──
function handleSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || isSending) return;
  input.value = '';

  const chips = document.getElementById('starter-chips');
  if (chips) chips.remove();

  sendMessage(text);
}

// ── Send message ──
async function sendMessage(text) {
  if (isSending) return;
  isSending = true;

  const sendBtn = document.getElementById('chat-send');
  sendBtn.disabled = true;
  hideError();

  appendMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });
  saveConversation();

  const typing = document.getElementById('typing-indicator');
  typing.classList.add('show');
  scrollToBottom();

  try {
    // Session cookie + CSRF header attached by ccAuth.fetchAuthed.
    const res = await ccAuth.fetchAuthed('/api/advisor', {
      method: 'POST',
      body: JSON.stringify({ messages: conversationHistory })
    });

    typing.classList.remove('show');

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Something went wrong');
    }

    const data = await res.json();

    if (data.type === 'checkout') {
      // AI created a checkout — show the card
      const summary = data.price_summary;
      appendMessage('assistant', data.reply || "Great choice! Here's your checkout:");
      conversationHistory.push({ role: 'assistant', content: data.reply || "Here's your checkout." });
      renderCheckoutCard(summary, data.checkout_url);

      if (typeof posthog !== 'undefined') {
        posthog.capture('advisor_checkout_created', {
          lessons: summary.qty,
          total: summary.totalPounds,
          discount_pct: summary.discountPct
        });
      }
    } else if (data.type === 'auth_required') {
      // Needs login to buy
      appendMessage('assistant', data.reply || "You'll need to sign in first to complete your purchase.");
      conversationHistory.push({ role: 'assistant', content: data.reply || "Sign in to purchase." });
      renderAuthCard();
    } else {
      // Normal text response
      appendMessage('assistant', data.reply);
      conversationHistory.push({ role: 'assistant', content: data.reply });
    }

    saveConversation();

    if (typeof posthog !== 'undefined') {
      posthog.capture('advisor_message_sent', {
        message_length: text.length,
        conversation_length: conversationHistory.length,
        is_authenticated: !!AUTH?.token
      });
    }
  } catch (err) {
    typing.classList.remove('show');
    showError(err.message || 'Something went wrong. Please try again.');
  }

  isSending = false;
  sendBtn.disabled = false;
  document.getElementById('chat-input').focus();
}

// ── Render checkout card ──
function renderCheckoutCard(summary, checkoutUrl) {
  const messages = document.getElementById('chat-messages');
  const card = document.createElement('div');
  card.className = 'checkout-card';

  const hours = (summary.qty * 1.5).toFixed(1).replace('.0', '');
  let savings = '';
  if (parseFloat(summary.savingsPounds) > 0) {
    savings = '<div class="checkout-detail"><span class="label">You save</span><span class="value green">\u00A3' + summary.savingsPounds + ' (' + summary.discountPct + '% off)</span></div>';
  }

  card.innerHTML =
    '<div class="checkout-card-title">' + summary.qty + ' Driving Lesson' + (summary.qty > 1 ? 's' : '') + '</div>' +
    '<div class="checkout-detail"><span class="label">Lessons</span><span class="value">' + summary.qty + ' \u00D7 1.5hr</span></div>' +
    '<div class="checkout-detail"><span class="label">Total hours</span><span class="value">' + hours + ' hours</span></div>' +
    '<div class="checkout-detail"><span class="label">Per lesson</span><span class="value">\u00A3' + summary.perLessonPounds + '</span></div>' +
    savings +
    '<div class="checkout-detail" style="border-top:2px solid var(--surface);padding-top:10px;margin-top:4px;"><span class="label" style="font-weight:700;">Total</span><span class="value" style="font-size:1.15rem;">\u00A3' + summary.totalPounds + '</span></div>' +
    '<a href="' + checkoutUrl + '" class="checkout-btn">Pay Now \u2014 Secure Checkout \u2192</a>' +
    '<div class="checkout-footer">Powered by Stripe \u00B7 Card &amp; Klarna accepted</div>';

  messages.appendChild(card);
  scrollToBottom();
}

// ── Render auth-required card ──
function renderAuthCard() {
  const messages = document.getElementById('chat-messages');
  const card = document.createElement('div');
  card.className = 'auth-card';
  card.innerHTML =
    '<p>To complete your purchase, please sign in or create a free account first.</p>' +
    '<a href="/learner/login.html?redirect=/learner/advisor.html">Sign In / Create Account</a>' +
    '<div class="hint">Your conversation will be saved and waiting for you when you return.</div>';
  messages.appendChild(card);
  scrollToBottom();
}

// ── Lightweight markdown → HTML (XSS-safe) ──
function renderMarkdown(text) {
  // Escape HTML first to prevent XSS
  let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Split into lines for block-level processing
  const lines = s.split('\n');
  const out = [];
  let inUl = false, inOl = false;
  for (const line of lines) {
    const trimmed = line.trim();
    // Headings
    if (/^### (.+)/.test(trimmed)) { closeList(); out.push('<h5>' + RegExp.$1 + '</h5>'); continue; }
    if (/^## (.+)/.test(trimmed))  { closeList(); out.push('<h4>' + RegExp.$1 + '</h4>'); continue; }
    // Unordered list
    if (/^[-*] (.+)/.test(trimmed)) {
      if (!inUl) { closeList(); out.push('<ul>'); inUl = true; }
      out.push('<li>' + inline(RegExp.$1) + '</li>'); continue;
    }
    // Ordered list
    if (/^\d+\. (.+)/.test(trimmed)) {
      if (!inOl) { closeList(); out.push('<ol>'); inOl = true; }
      out.push('<li>' + inline(RegExp.$1) + '</li>'); continue;
    }
    // Empty line → close lists, add break
    if (trimmed === '') { closeList(); out.push('<br>'); continue; }
    // Normal paragraph line
    closeList();
    out.push('<p>' + inline(trimmed) + '</p>');
  }
  closeList();
  return out.join('');

  function closeList() {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  }
  function inline(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }
}

// ── Append message to chat ──
function appendMessage(role, text, isRestore) {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (isRestore) div.style.animation = 'none';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'assistant' ? 'CC' : (AUTH?.user?.name?.[0]?.toUpperCase() || 'U');

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (role === 'assistant') {
    bubble.innerHTML = renderMarkdown(text);
  } else {
    bubble.textContent = text;
  }

  div.appendChild(avatar);
  div.appendChild(bubble);
  messages.appendChild(div);

  if (!isRestore) scrollToBottom();
}

// ── Scroll to bottom ──
function scrollToBottom() {
  const messages = document.getElementById('chat-messages');
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

// ── Error handling ──
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.add('show');
}

function hideError() {
  document.getElementById('error-msg').classList.remove('show');
}

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action="ask-chip"]');
  if (t) askChip(t);
});
(function wire() {
  var send = document.getElementById('chat-send');
  if (send) send.addEventListener('click', handleSend);
})();
})();
