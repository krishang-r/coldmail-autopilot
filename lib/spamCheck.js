// Lightweight, best-effort spam-trigger linter. It does NOT guarantee inbox
// placement - it just flags the well-known content patterns that raise spam
// scores, so you can rephrase before sending. Everything here is advisory.

const SPAM_PHRASES = [
  'act now', 'apply now', 'buy now', 'order now', 'click here', 'click below',
  'limited time', 'urgent', 'congratulations', 'winner', 'you have been selected',
  'risk-free', 'risk free', '100% free', 'free money', 'earn money', 'earn cash',
  'make money', 'extra cash', 'double your', 'guarantee', 'guaranteed',
  'no obligation', 'no cost', 'no fees', 'cheap', 'discount', 'lowest price',
  'best price', 'save big', 'special promotion', 'this is not spam', 'dear friend',
  'work from home', 'be your own boss', 'million dollars', 'cash bonus',
  'increase sales', 'incredible deal', 'once in a lifetime', 'while supplies last',
];

const URL_SHORTENERS = /\b(bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|rebrand\.ly)\b/i;

// options: { subject, body, recipientCount, hasPersonalizationToken }
function spamCheck({ subject = '', body = '', recipientCount = 0, hasPersonalizationToken } = {}) {
  const warnings = [];
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();

  // ALL-CAPS subject
  const letters = subject.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 4 && subject === subject.toUpperCase()) {
    warnings.push('Subject is in ALL CAPS — a classic spam signal. Use normal sentence case.');
  }

  // Excessive exclamation / punctuation
  const bangs = (text.match(/!/g) || []).length;
  if (bangs >= 3) {
    warnings.push(`Multiple exclamation marks (${bangs}) look promotional. Aim for none or one.`);
  }
  if (/[!?]{2,}/.test(text)) {
    warnings.push('Repeated punctuation like "!!" or "?!" trips spam filters.');
  }

  // Spam-trigger phrases
  const phraseHits = [...new Set(SPAM_PHRASES.filter((p) => lower.includes(p)))];
  if (phraseHits.length) {
    warnings.push(`Contains spam-trigger phrase(s): "${phraseHits.slice(0, 8).join('", "')}".`);
  }

  // Link volume + shorteners
  const links = (text.match(/https?:\/\//gi) || []).length;
  if (links >= 4) {
    warnings.push(`${links} links — lots of links raises spam scores. Keep it to 1–2.`);
  }
  if (URL_SHORTENERS.test(text)) {
    warnings.push('URL shorteners (bit.ly, tinyurl, …) are strongly associated with spam. Use full URLs.');
  }

  // Money / discount patterns
  if (/\${2,}/.test(text) || /\b\d{1,3}\s*%\s*(off|free|discount)\b/i.test(text)) {
    warnings.push('Money/discount patterns ("$$$", "50% off") read as promotional.');
  }

  // Subject length
  if (subject.length > 90) {
    warnings.push(`Subject is ${subject.length} characters — long subjects get truncated and look spammy. Aim for under ~60.`);
  }
  if (subject.trim().length === 0) {
    warnings.push('Empty subject lines are very likely to be filtered.');
  }

  // Personalization when blasting many recipients
  const usesToken =
    typeof hasPersonalizationToken === 'boolean'
      ? hasPersonalizationToken
      : /{{\s*\w+\s*}}/.test(`${subject}${body}`);
  if (recipientCount >= 5 && !usesToken) {
    warnings.push('Identical, non-personalized copy to many recipients looks like a mass blast. Add a {{company}} placeholder or personalize.');
  }

  // Excessive capitalized WORDS in body
  const capsWords = (body.match(/\b[A-Z]{4,}\b/g) || []).length;
  if (capsWords >= 3) {
    warnings.push(`${capsWords} ALL-CAPS words in the body — use emphasis sparingly.`);
  }

  return warnings;
}

module.exports = { spamCheck };
