function log(msg) {
  console.log(`${new Date().toLocaleString()} | 💡 ${msg}`);
}

function warn(msg) {
  console.warn(`${new Date().toLocaleString()} | ⚠️ ${msg}`);
}

function error(msg, err) {
  console.error(`${new Date().toLocaleString()} | ❌ ${msg}`, err || "");
}

module.exports = { log, warn, error };
