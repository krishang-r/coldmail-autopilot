const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'logs', 'activity.log');

function log(level, message) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`;
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, line);
  if (level === 'error') console.error(line.trim());
  else console.log(line.trim());
}

module.exports = {
  info: (msg) => log('info', msg),
  error: (msg) => log('error', msg),
};
