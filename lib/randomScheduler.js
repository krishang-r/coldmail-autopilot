const MIN_GAP_MS = 4 * 60 * 1000;
const WINDOW_MS = 20 * 60 * 1000;
const MAX_IN_WINDOW = 5;

// Tightest legal packing (ms offsets from 0) for n sends: consecutive sends
// >= MIN_GAP_MS apart, and no 20-minute window ever contains more than
// MAX_IN_WINDOW sends (sliding-window rate limit, same trick as a token bucket).
function tightOffsets(n) {
  const times = [0];
  for (let i = 1; i < n; i++) {
    let t = times[i - 1] + MIN_GAP_MS;
    if (i >= MAX_IN_WINDOW) {
      t = Math.max(t, times[i - MAX_IN_WINDOW] + WINDOW_MS);
    }
    times.push(t);
  }
  return times;
}

// Largest n that fits in a slot of slotDurationMs (offsets are a strict
// prefix as n grows, so we can just extend one at a time).
function maxCapacityForSlot(slotDurationMs) {
  if (slotDurationMs < 0) return 0;
  const times = [0];
  let count = 1;
  while (true) {
    const i = count;
    let t = times[i - 1] + MIN_GAP_MS;
    if (i >= MAX_IN_WINDOW) {
      t = Math.max(t, times[i - MAX_IN_WINDOW] + WINDOW_MS);
    }
    if (t > slotDurationMs) break;
    times.push(t);
    count++;
  }
  return count;
}

function checkCapacity(n, slotDurationMs) {
  if (n <= 0) return { feasible: true, maxCapacity: 0, requiredMs: 0 };
  const times = tightOffsets(n);
  const requiredMs = times[n - 1];
  const feasible = requiredMs <= slotDurationMs;
  return {
    feasible,
    requiredMs,
    maxCapacity: feasible ? n : maxCapacityForSlot(slotDurationMs),
  };
}

// Randomly distribute n send times inside [start, end], respecting the
// min-gap and rolling-window constraints. Throws if it doesn't fit.
function generateRandomTimes(n, start, end) {
  const slotDurationMs = end.getTime() - start.getTime();
  const { feasible, requiredMs, maxCapacity } = checkCapacity(n, slotDurationMs);
  if (!feasible) {
    const err = new Error(
      `${n} recipients need at least ${Math.ceil(requiredMs / 60000)} minutes ` +
        `(4-min min gap, max 5 per 20 min), but the window is only ` +
        `${Math.floor(slotDurationMs / 60000)} minutes. This window fits at most ${maxCapacity}.`
    );
    err.code = 'CAPACITY_EXCEEDED';
    err.maxCapacity = maxCapacity;
    throw err;
  }

  const tight = tightOffsets(n);
  const slack = slotDurationMs - requiredMs;

  if (n === 1) {
    // Single email: pick any random point in the window.
    const offset = Math.floor(Math.random() * (slack + 1));
    return [new Date(start.getTime() + offset)];
  }

  const weights = Array.from({ length: n }, () => Math.random());
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const extras = weights.map((w) => (w / weightSum) * slack);

  const times = [];
  let cumulativeExtra = 0;
  for (let i = 0; i < n; i++) {
    cumulativeExtra += extras[i];
    times.push(new Date(start.getTime() + tight[i] + cumulativeExtra));
  }
  return times;
}

module.exports = {
  MIN_GAP_MS,
  WINDOW_MS,
  MAX_IN_WINDOW,
  tightOffsets,
  maxCapacityForSlot,
  checkCapacity,
  generateRandomTimes,
};
