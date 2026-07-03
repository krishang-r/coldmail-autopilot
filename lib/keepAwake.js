const { spawn } = require('child_process');
const logger = require('./logger');

// Keeps the Mac awake while there's active sending work, so a paced campaign
// (which can sit idle for minutes between sends) isn't frozen by the machine
// going to sleep mid-run. It engages only when sends are actually happening or
// imminently due, and releases the moment the queue is idle, so normal
// power-saving resumes the rest of the time.
//
// macOS only (uses the built-in `caffeinate`). IMPORTANT: `caffeinate -i`
// prevents *idle* sleep only - it CANNOT keep a laptop awake with the lid
// closed. For lid-closed / overnight schedules, also schedule a wake with
// `sudo pmset repeat wake ...` (see README).
//
// Disable entirely with PREVENT_SLEEP_WHILE_PENDING=false.

let child = null;

function enabled() {
  if (process.platform !== 'darwin') return false; // caffeinate is macOS-only
  return String(process.env.PREVENT_SLEEP_WHILE_PENDING || 'true').toLowerCase() !== 'false';
}

function engage() {
  if (child || !enabled()) return;
  try {
    // -i: prevent idle system sleep while caffeinate lives.
    // -w <pid>: tie its lifetime to our process, so it can never outlive the
    //   server and leave the Mac awake forever (even if we're SIGKILLed).
    child = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    child.on('error', (err) => {
      logger.error(`Keep-awake: could not start caffeinate: ${err.message}`);
      child = null;
    });
    child.on('exit', () => {
      child = null;
    });
    logger.info('Keep-awake: preventing idle sleep (caffeinate) while sends are active');
  } catch (err) {
    logger.error(`Keep-awake: ${err.message}`);
    child = null;
  }
}

function release() {
  if (!child) return;
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  child = null;
  logger.info('Keep-awake: released - no active sends, normal sleep resumes');
}

// desired: boolean - should the Mac stay awake right now?
function update(desired) {
  if (!enabled()) return;
  if (desired) engage();
  else release();
}

module.exports = { update, release, enabled };
