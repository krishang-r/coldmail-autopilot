const { execFile } = require('child_process');

// Best-effort desktop notification. Non-critical: everything is also written to
// logs/activity.log, so if the OS mechanism is missing we just silently skip it
// (errors are swallowed). macOS uses osascript, Linux uses notify-send (from
// libnotify), Windows uses a PowerShell balloon tip.
function notify(title, message) {
  try {
    if (process.platform === 'darwin') {
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
      execFile('osascript', ['-e', script], () => {});
    } else if (process.platform === 'linux') {
      execFile('notify-send', [title, message], () => {});
    } else if (process.platform === 'win32') {
      const ps =
        'Add-Type -AssemblyName System.Windows.Forms;' +
        '$n=New-Object System.Windows.Forms.NotifyIcon;' +
        '$n.Icon=[System.Drawing.SystemIcons]::Information;' +
        '$n.Visible=$true;' +
        `$n.ShowBalloonTip(8000, ${JSON.stringify(title)}, ${JSON.stringify(message)}, 'Info');` +
        'Start-Sleep -Seconds 9; $n.Dispose();';
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], () => {});
    }
  } catch {
    /* notifications are optional; never let one break a send */
  }
}

module.exports = { notify };
