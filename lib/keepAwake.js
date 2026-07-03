const { spawn } = require('child_process');
const logger = require('./logger');

// Keeps the computer awake while there's active sending work, so a paced
// campaign (which can sit idle for minutes between sends) isn't frozen by the
// machine going to sleep mid-run. It engages only when sends are actually
// happening or imminently due, and releases the moment the queue is idle, so
// normal power-saving resumes the rest of the time.
//
// Cross-platform, using each OS's native mechanism, and every strategy ties
// the inhibitor's lifetime to THIS process so it can never outlive the server
// and pin the machine awake forever (even if we're SIGKILLed):
//   - macOS:   caffeinate -i -w <pid>
//   - Linux:   systemd-inhibit (needs systemd; most desktop distros have it)
//   - Windows: SetThreadExecutionState via PowerShell
//
// IMPORTANT: this prevents *idle* sleep only - it can't keep a laptop awake
// with the lid closed. For lid-closed / overnight schedules, also schedule a
// wake (macOS `pmset`, Linux `rtcwake`/systemd timer, Windows Task Scheduler
// "wake the computer") - see the README.
//
// Fail-safe: if the OS mechanism is missing or errors, we log once and carry
// on without it (sends still run; they're just vulnerable to sleep). Disable
// entirely with PREVENT_SLEEP_WHILE_PENDING=false.

let child = null;
let warnedUnsupported = false;
let warnedError = false;

function enabled() {
  return String(process.env.PREVENT_SLEEP_WHILE_PENDING || 'true').toLowerCase() !== 'false';
}

// Returns a spawned child process that holds a "don't sleep" lock for as long
// as it lives, or null if this platform has no supported mechanism.
function spawnInhibitor() {
  const pid = process.pid;

  if (process.platform === 'darwin') {
    // -i: prevent idle sleep. -w <pid>: exit when our process exits.
    return spawn('caffeinate', ['-i', '-w', String(pid)], { stdio: 'ignore' });
  }

  if (process.platform === 'linux') {
    // systemd-inhibit holds a sleep lock while its child runs. The child is a
    // guard loop that exits once our process is gone, so the lock is released
    // even if the server is SIGKILLed (no orphaned inhibitor).
    const guard = `while kill -0 ${pid} 2>/dev/null; do sleep 5; done`;
    return spawn(
      'systemd-inhibit',
      [
        '--what=sleep:idle',
        '--who=Coldmail Autopilot',
        '--why=Active email sends in progress',
        '--mode=block',
        'sh',
        '-c',
        guard,
      ],
      { stdio: 'ignore' }
    );
  }

  if (process.platform === 'win32') {
    // Set ES_CONTINUOUS | ES_SYSTEM_REQUIRED (0x80000001) to keep the system
    // awake, hold it until our process exits, then clear it. Killing this
    // PowerShell process also clears the flag (it's reset when the setting
    // thread exits), so there's no orphan risk.
    const psCommand = [
      "$sig='[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);';",
      '$api=Add-Type -MemberDefinition $sig -Name Power -Namespace Win32 -PassThru;',
      '[void]$api::SetThreadExecutionState(0x80000001);',
      `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 30 }`,
      ';[void]$api::SetThreadExecutionState(0x80000000);',
    ].join(' ');
    return spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
      stdio: 'ignore',
    });
  }

  return null;
}

function engage() {
  if (child || !enabled()) return;

  let spawned;
  try {
    spawned = spawnInhibitor();
  } catch (err) {
    if (!warnedError) {
      warnedError = true;
      logger.error(`Keep-awake: could not start the sleep inhibitor: ${err.message} (sends still run, but may be interrupted by sleep)`);
    }
    return;
  }

  if (!spawned) {
    if (!warnedUnsupported) {
      warnedUnsupported = true;
      logger.info(`Keep-awake: no supported sleep-prevention mechanism for platform "${process.platform}" - sends run but may be interrupted by sleep`);
    }
    return;
  }

  child = spawned;
  child.on('error', (err) => {
    // e.g. the tool isn't installed (systemd-inhibit on a non-systemd distro).
    if (!warnedError) {
      warnedError = true;
      logger.error(`Keep-awake: sleep inhibitor unavailable: ${err.message} (sends still run, but may be interrupted by sleep). On Linux this needs systemd-inhibit.`);
    }
    child = null;
  });
  child.on('exit', () => {
    child = null;
  });
  logger.info(`Keep-awake: preventing idle sleep while sends are active (${process.platform})`);
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

// desired: boolean - should the machine stay awake right now?
function update(desired) {
  if (!enabled()) return;
  if (desired) engage();
  else release();
}

module.exports = { update, release, enabled };
