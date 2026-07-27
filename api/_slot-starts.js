const DEFAULT_SLOT_START_INTERVAL_MINUTES = 30;
const ALLOWED_SLOT_START_INTERVAL_MINUTES = new Set([30, 60]);

function normaliseSlotStartInterval(value) {
  const interval = Number(value);
  return ALLOWED_SLOT_START_INTERVAL_MINUTES.has(interval)
    ? interval
    : DEFAULT_SLOT_START_INTERVAL_MINUTES;
}

function firstSlotStartForWindow(windowStart, intervalValue) {
  const interval = normaliseSlotStartInterval(intervalValue);
  if (interval === 60) return Math.ceil(windowStart / 60) * 60;
  return windowStart;
}

module.exports = {
  DEFAULT_SLOT_START_INTERVAL_MINUTES,
  normaliseSlotStartInterval,
  firstSlotStartForWindow,
};
