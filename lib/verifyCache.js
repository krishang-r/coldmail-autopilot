const fs = require('fs');
const path = require('path');

// Local memory of which addresses are known-bad, learned from real bounces.
//
// WHY: every bounce is a black mark against the sending account's reputation
// (high bounce rates are the strongest "this is a spammer scraping addresses"
// signal mailbox providers have). Once an address has bounced we must never
// try it again, so bounced addresses are cached as 'invalid' for 30 days and
// the email guesser tags/un-ticks them automatically.

const CACHE_PATH = path.join(__dirname, '..', 'data', 'mailbox-verify-cache.json');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// Record a definitive answer learned from a real bounce (or lack of one).
function recordVerifyResult(email, status) {
  const cache = loadCache();
  cache[email.toLowerCase()] = { status, checkedAt: Date.now(), method: 'bounce' };
  saveCache(cache);
}

// Returns 'valid' | 'invalid' | null (unknown or stale).
function getCachedStatus(email) {
  const entry = loadCache()[email.toLowerCase()];
  if (!entry) return null;
  if (Date.now() - entry.checkedAt > CACHE_TTL_MS) return null;
  return entry.status || null;
}

module.exports = { recordVerifyResult, getCachedStatus };
