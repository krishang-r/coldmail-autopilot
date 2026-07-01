const net = require('net');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'mailbox-verify-cache.json');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // don't re-probe the same mailbox for 30 days

// Pacing knobs. Hammering a mail server with rapid-fire RCPT TOs (or opening
// many connections back to back across domains) is exactly the pattern spam
// filters and IP reputation systems watch for, so every probe is spaced out
// and each domain is checked over a single reused connection instead of one
// connection per candidate address.
const RCPT_DELAY_MS = Number(process.env.SMTP_VERIFY_DELAY_MS || 400);
const DOMAIN_DELAY_MS = Number(process.env.SMTP_VERIFY_DOMAIN_DELAY_MS || 1000);
const CONNECT_TIMEOUT_MS = Number(process.env.SMTP_VERIFY_TIMEOUT_MS || 8000);
const HELO_NAME = process.env.SMTP_VERIFY_HELO || os.hostname() || 'localhost';
// Probing with a real, accountable address (rather than a forged one) reads
// as legitimate to receiving servers and is less likely to get flagged.
const MAIL_FROM = process.env.SMTP_VERIFY_FROM || process.env.GMAIL_USER || 'verify@example.com';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function connectSmtp(host) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 25 });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`Connection to ${host}:25 timed out (often means outbound port 25 is blocked on this network)`));
    });
    socket.once('error', reject);
    socket.once('connect', () => resolve(socket));
  });
}

// Reads one (possibly multi-line) SMTP response, e.g. "250-a\r\n250 b\r\n".
function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve({ code: Number(last.slice(0, 3)), text: buf });
      }
    };
    const onErr = (err) => {
      cleanup();
      reject(err);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error('SMTP response timed out'));
    };
    function cleanup() {
      socket.off('data', onData);
      socket.off('error', onErr);
      socket.off('timeout', onTimeout);
    }
    socket.on('data', onData);
    socket.once('error', onErr);
    socket.once('timeout', onTimeout);
  });
}

async function sendCommand(socket, command) {
  socket.write(command + '\r\n');
  return readResponse(socket);
}

// Verifies every candidate mailbox on one domain over a single SMTP session
// (one MAIL FROM, multiple RCPT TOs) instead of one connection per address.
// Status per address is one of: 'valid' | 'invalid' | 'catch-all' | 'unknown'.
async function verifyDomainMailboxes(domain, mxHost, localParts) {
  const results = new Map();
  let socket;
  try {
    socket = await connectSmtp(mxHost);
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    await readResponse(socket); // 220 greeting

    const helo = await sendCommand(socket, `EHLO ${HELO_NAME}`);
    if (helo.code >= 400) throw new Error(`EHLO rejected (${helo.code})`);

    const mailFrom = await sendCommand(socket, `MAIL FROM:<${MAIL_FROM}>`);
    if (mailFrom.code >= 400) throw new Error(`MAIL FROM rejected (${mailFrom.code})`);

    // Probe an address that can't plausibly exist first. If the server
    // accepts it, the domain accepts mail for any local part (catch-all),
    // so a "valid" result for the real addresses would be meaningless.
    const probeUser = `verify-${crypto.randomBytes(6).toString('hex')}`;
    const probeResp = await sendCommand(socket, `RCPT TO:<${probeUser}@${domain}>`);
    const isCatchAll = probeResp.code === 250;

    if (isCatchAll) {
      for (const lp of localParts) results.set(`${lp}@${domain}`, 'catch-all');
    } else {
      for (const lp of localParts) {
        await sleep(RCPT_DELAY_MS);
        const email = `${lp}@${domain}`;
        try {
          const resp = await sendCommand(socket, `RCPT TO:<${email}>`);
          if (resp.code === 250) results.set(email, 'valid');
          else if (resp.code >= 550 && resp.code < 560) results.set(email, 'invalid');
          else results.set(email, 'unknown'); // e.g. 4xx greylisting - inconclusive, not a rejection
        } catch {
          results.set(email, 'unknown');
        }
      }
    }

    await sendCommand(socket, 'QUIT').catch(() => {});
  } catch {
    // Connection refused, port 25 blocked, timeout, EHLO/MAIL FROM rejected,
    // etc. - all inconclusive rather than "invalid".
    for (const lp of localParts) {
      const email = `${lp}@${domain}`;
      if (!results.has(email)) results.set(email, 'unknown');
    }
  } finally {
    if (socket) socket.destroy();
  }
  return results;
}

// candidates: [{ email }]. Returns Map<lowercased email, status>.
async function verifyMailboxes(candidates) {
  const cache = loadCache();
  const now = Date.now();
  const toVerify = new Map(); // domain -> [localPart, ...]
  const output = new Map();

  for (const { email } of candidates) {
    const key = email.toLowerCase();
    const cached = cache[key];
    if (cached && now - cached.checkedAt < CACHE_TTL_MS) {
      output.set(key, cached.status);
      continue;
    }
    const domain = key.split('@')[1];
    if (!domain) continue;
    if (!toVerify.has(domain)) toVerify.set(domain, []);
    toVerify.get(domain).push(key.split('@')[0]);
  }

  let isFirstDomain = true;
  for (const [domain, localParts] of toVerify) {
    if (!isFirstDomain) await sleep(DOMAIN_DELAY_MS);
    isFirstDomain = false;

    let mxHost = null;
    try {
      const records = await dns.resolveMx(domain);
      records.sort((a, b) => a.priority - b.priority);
      mxHost = records[0] && records[0].exchange;
    } catch {
      mxHost = null;
    }

    let results;
    if (!mxHost) {
      results = new Map(localParts.map((lp) => [`${lp}@${domain}`, 'unknown']));
    } else {
      results = await verifyDomainMailboxes(domain, mxHost, localParts);
    }

    for (const [email, status] of results) {
      const key = email.toLowerCase();
      output.set(key, status);
      cache[key] = { status, checkedAt: now };
    }
  }

  saveCache(cache);
  return output;
}

module.exports = { verifyMailboxes };
