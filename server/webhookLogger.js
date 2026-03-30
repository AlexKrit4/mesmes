const fs = require('fs');
const path = require('path');

// Путь к файлу логов
const logsDir = path.join(__dirname, '..', 'logs');
const logsFile = path.join(logsDir, 'casino-webhook.log');

// Создаем директорию если не существует
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function logWebhook(message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n${JSON.stringify(data, null, 2)}\n---\n`;
  
  fs.appendFileSync(logsFile, logEntry, 'utf8');
  console.log(`[CASINO-WEBHOOK] ${message}`, data);
}

function getRecentLogs(lines = 100) {
  try {
    if (!fs.existsSync(logsFile)) {
      return 'No logs yet';
    }
    const content = fs.readFileSync(logsFile, 'utf8');
    const allLines = content.split('\n');
    return allLines.slice(-lines).join('\n');
  } catch (error) {
    return `Error reading logs: ${error.message}`;
  }
}

module.exports = { logWebhook, getRecentLogs };
