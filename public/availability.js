(function () {
  'use strict';

// Parse URL params
const urlParams = new URLSearchParams(window.location.search);
const bookingRef = urlParams.get('ref');
const email = urlParams.get('email');

// Validate
if (!bookingRef || !email) {
  document.getElementById('availability-form').innerHTML = `
    <div style="text-align:center;padding:64px 24px;">
      <h1 style="font-family:var(--font-head);font-size:1.8rem;margin-bottom:16px;">Invalid link</h1>
      <p style="color:var(--muted);">Please use the link from your email or contact us directly.</p>
    </div>
  `;
} else {
  document.getElementById('booking-ref').textContent = bookingRef;
}

const timeSlots = [
  { label: 'Early', time: '7am – 9am' },
  { label: 'Morning', time: '9am – 12pm' },
  { label: 'Afternoon', time: '12pm – 3pm' },
  { label: 'Late', time: '3pm – 6pm' },
  { label: 'Evening', time: '6pm – 8pm' }
];

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const state = {
  slots: {},
  frequency: 'standard',
  notes: ''
};

function initGrid() {
  const grid = document.getElementById('timeGrid');

  grid.appendChild(document.createElement('div'));
  days.forEach(day => {
    const div = document.createElement('div');
    div.className = 'day-header';
    div.textContent = day;
    grid.appendChild(div);
  });

  timeSlots.forEach((slot, slotIdx) => {
    const label = document.createElement('div');
    label.className = 'time-label';
    label.innerHTML = `<div>${slot.label}<br><span style="font-weight:400;color:var(--muted)">${slot.time}</span></div>`;
    grid.appendChild(label);

    days.forEach((day, dayIdx) => {
      const cell = document.createElement('div');
      cell.className = 'slot-cell';
      cell.dataset.key = `${day}-${slotIdx}`;
      cell.title = `${day} ${slot.time}`;
      cell.addEventListener('click', () => toggleSlot(cell));
      grid.appendChild(cell);
    });
  });
}

function toggleSlot(cell) {
  const key = cell.dataset.key;
  const current = state.slots[key];

  if (!current) {
    state.slots[key] = 'available';
    cell.className = 'slot-cell selected';
  } else if (current === 'available') {
    state.slots[key] = 'preferred';
    cell.className = 'slot-cell selected preferred';
  } else {
    state.slots[key] = null;
    cell.className = 'slot-cell';
  }

  updateSummary();
}

function updateSummary() {
  const available = Object.values(state.slots).filter(s => s === 'available').length;
  const preferred = Object.values(state.slots).filter(s => s === 'preferred').length;
  const total = available + preferred;

  document.getElementById('slot-count').textContent = `${total} slot${total !== 1 ? 's' : ''}`;
  document.getElementById('pref-count').textContent = `${preferred} preferred`;
  document.getElementById('submitBtn').disabled = total < 3;
}

document.querySelectorAll('.priority-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.frequency = btn.dataset.value;
  });
});

document.getElementById('notes').addEventListener('input', (e) => {
  state.notes = e.target.value;
});

document.getElementById('submitBtn').addEventListener('click', async () => {
  const btn = document.getElementById('submitBtn');
  btn.classList.add('loading');
  btn.textContent = 'Submitting...';

  const payload = {
    booking_reference: bookingRef,
    email: email,
    availability: state.slots,
    frequency_preference: state.frequency,
    notes: state.notes
  };

  try {
    const response = await fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error('Submission failed');

    document.getElementById('availability-form').style.display = 'none';
    document.getElementById('success-card').classList.add('visible');

    document.querySelectorAll('.step')[2].classList.remove('active');
    document.querySelectorAll('.step')[2].classList.add('completed');
    document.querySelectorAll('.step')[3].classList.add('active');

  } catch (err) {
    document.getElementById('error-message').classList.add('visible');
    btn.classList.remove('loading');
    btn.textContent = 'Submit Availability →';
  }
});

initGrid();


})();
