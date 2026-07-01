const { execFile } = require('child_process');

function notify(title, message) {
  if (process.platform !== 'darwin') return;
  const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
  execFile('osascript', ['-e', script], () => {});
}

module.exports = { notify };
