const dns = require('dns').promises;

const { getCachedStatus } = require('./verifyCache');

const PREFIXES = [
  'hr',
  'careers',
  'career',
  'jobs',
  'recruitment',
  'recruiting',
  'talent',
  'hiring',
];

// .ai and .io are included because startups and AI/tech companies (e.g.
// dhan.co, many fintech/AI firms) often use them as their primary domain
// rather than .com. Each domain is still MX-checked, so a TLD the company
// doesn't own just fails the check and sinks to the bottom of the list.
const TLDS = ['com', 'in', 'co.in', 'co', 'ai', 'io'];

const STOPWORDS = /\b(inc|ltd|llc|limited|corp|corporation|pvt|private|technologies|technology|solutions|group|co)\b/gi;

function normalizeCompany(name) {
  return name
    .toLowerCase()
    .replace(STOPWORDS, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

const mxCache = new Map();

async function hasMx(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  let ok = false;
  try {
    const records = await dns.resolveMx(domain);
    ok = Array.isArray(records) && records.length > 0;
  } catch {
    ok = false;
  }
  mxCache.set(domain, ok);
  return ok;
}

// Returns { company, domains: [{domain, valid}], candidates: [{email, domain, domainValid}] }
async function guessCompanyEmails(companyName) {
  const base = normalizeCompany(companyName);
  const domains = TLDS.map((tld) => `${base}.${tld}`);

  const domainResults = await Promise.all(
    domains.map(async (domain) => ({ domain, valid: await hasMx(domain) }))
  );

  const candidates = [];
  for (const { domain, valid } of domainResults) {
    for (const prefix of PREFIXES) {
      const email = `${prefix}@${domain}`;
      candidates.push({
        email,
        domain,
        domainValid: valid,
        // An address that already bounced once must never be emailed again -
        // repeat bounces are the fastest way to get the sender flagged as a
        // spammer. The UI un-ticks these and labels them.
        knownInvalid: getCachedStatus(email) === 'invalid',
      });
    }
  }

  // Sort so valid-domain candidates surface first, known-bounced ones last
  candidates.sort(
    (a, b) => Number(a.knownInvalid) - Number(b.knownInvalid) || Number(b.domainValid) - Number(a.domainValid)
  );

  return {
    company: companyName,
    domains: domainResults,
    candidates,
  };
}

async function guessMany(companyNames) {
  const results = [];
  for (const name of companyNames) {
    results.push(await guessCompanyEmails(name));
  }
  return results;
}

module.exports = { guessCompanyEmails, guessMany, normalizeCompany };
