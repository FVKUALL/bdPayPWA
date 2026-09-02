const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'ai_activity.json');

function readLog() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch (_) { return []; }
}

function writeLog(arr) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(arr.slice(-2000), null, 2), 'utf8');
}

function logAIActivity(entry) {
  const list = readLog();
  list.push({
    id: 'ai-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    at: new Date().toISOString(),
    ...entry
  });
  writeLog(list);
  return list[list.length - 1];
}

function listAIActivity(limit = 100) {
  return readLog().slice(-limit).reverse();
}

module.exports = { logAIActivity, listAIActivity, readLog };
