(function () {
  'use strict';

let AUTH;
let conversationHistory = [];
let isSending = false;

// ── Auth ──
window.addEventListener('DOMContentLoaded', () => {
  AUTH = ccAuth.getAuth();
  if (!AUTH?.token) {
    window.location.href = '/learner/login.html?redirect=/learner/ask-examiner.html';
    return;
  }
  // Enter key to send
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
});

// ── Starter chip click ──
function askChip(btn) {
  const text = btn.textContent;
  document.getElementById('starter-chips').remove();
  sendMessage(text);

  if (typeof posthog !== 'undefined') {
    posthog.capture('ask_examiner_chip_clicked', { chip_text: text, source: 'starter_chip' });
  }
}

// ── Handle send ──
function handleSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || isSending) return;
  input.value = '';

  // Remove starter chips if still present
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

  // Add user message to UI
  appendMessage('user', text);

  // Add to conversation history
  conversationHistory.push({ role: 'user', content: text });

  // Show typing indicator
  const typing = document.getElementById('typing-indicator');
  typing.classList.add('show');
  scrollToBottom();

  try {
    const res = await ccAuth.fetchAuthed('/api/ask-examiner', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'},
      body: JSON.stringify({ messages: conversationHistory })
    });

    typing.classList.remove('show');

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Something went wrong');
    }

    const data = await res.json();
    const reply = data.reply;

    // Add assistant message to UI and history
    appendMessage('assistant', reply);
    conversationHistory.push({ role: 'assistant', content: reply });

    if (typeof posthog !== 'undefined') {
      posthog.capture('ask_examiner_question', {
        question: text,
        question_length: text.length,
        answer_length: reply.length,
        conversation_turn: Math.ceil(conversationHistory.length / 2),
        is_first_question: conversationHistory.length === 2
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
function appendMessage(role, text) {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'assistant' ? 'CC' : (AUTH.user?.name?.[0]?.toUpperCase() || 'U');

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

  scrollToBottom();
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
