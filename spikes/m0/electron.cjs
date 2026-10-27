// M0 diagnostic harness. Uses only synthetic content and its own temporary profile.
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createServer } = require('node:http');
const { callbackProbe } = require('./probes.cjs');

const temp = process.env.OCLR_SPIKE_TEMP || fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-m0-'));
app.setPath('userData', path.join(temp, 'profile'));
const report = { evidence: 'synthetic-local-runtime', platform: process.platform,
  arch: process.arch, recordedAt: new Date().toISOString(), phase: process.env.OCLR_SPIKE_PHASE || 'single',
  versions: process.versions, packaged: app.isPackaged, checks: {} };
const deadline = setTimeout(() => { report.fatal = 'probe timeout (possible keychain prompt)'; finish(1); }, 45000);
app.on('window-all-closed', () => {});
function finish(code) {
  clearTimeout(deadline);
  const output = process.env.OCLR_SPIKE_REPORT;
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  app.exit(code);
}

app.whenReady().then(async () => {
  // Browser-backed local form POST -> 303 -> callback. Not an external OAuth test.
  const probe = await callbackProbe();
  const origin = createServer((req, res) => {
    if (req.url === '/approve' && req.method === 'POST') {
      res.writeHead(303, { Location: probe.url }).end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<form method="post" action="/approve"><button>Approve synthetic request</button></form>');
    }
  });
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
  const window = new BrowserWindow({ show: false, webPreferences: {
    nodeIntegration: false, contextIsolation: true, sandbox: true,
  } });
  await window.loadURL(`http://127.0.0.1:${origin.address().port}/`);
  await window.webContents.executeJavaScript('document.querySelector("form").requestSubmit()');
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const interval = setInterval(() => {
      if (probe.accepted() === 1) { clearInterval(interval); resolve(); }
      else if (Date.now() - started > 5000) { clearInterval(interval); reject(new Error('navigation timeout')); }
    }, 20);
  });
  report.checks.chromiumLocalForm303 = true;
  window.destroy();
  await probe.close();
  await new Promise(resolve => origin.close(resolve));

  // Database driver is tested in Electron, never inferred from host Node.
  const { DatabaseSync } = require('node:sqlite');
  const database = new DatabaseSync(path.join(temp, 'events.sqlite'));
  database.exec('PRAGMA journal_mode=WAL; DROP TABLE IF EXISTS events; CREATE TABLE events (id INTEGER PRIMARY KEY, body BLOB NOT NULL)');
  const key = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const aad = Buffer.from('synthetic-account|fixture|schema-1');
  const marker = 'SYNTHETIC_PRIVATE_LOG_測試_900000001';
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const sealed = Buffer.concat([cipher.update(marker, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  database.prepare('INSERT INTO events(body) VALUES (?)').run(Buffer.concat([nonce, tag, sealed]));
  const stored = Buffer.from(database.prepare('SELECT body FROM events').get().body);
  function decrypt(data, associated) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAAD(associated); decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString();
  }
  assert.equal(decrypt(stored, aad), marker);
  assert.throws(() => decrypt(stored, Buffer.from('other-account')));
  const tampered = Buffer.from(stored); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decrypt(tampered, aad));
  const files = fs.readdirSync(temp).filter(name => name.startsWith('events.sqlite'));
  assert.ok(files.includes('events.sqlite-wal'));
  for (const file of files) assert.ok(!fs.readFileSync(path.join(temp, file)).includes(Buffer.from(marker)));
  report.checks.sqlite = { driver: 'node:sqlite DatabaseSync', version: database.prepare('SELECT sqlite_version() AS version').get().version,
    walFilesScanned: files, ciphertextRoundTrip: true, tamperRejected: true, wrongAccountAADRejected: true, syntheticMarkerAbsent: true };
  database.close();

  report.checks.safeStorage = { asyncAPI: typeof safeStorage.isAsyncEncryptionAvailable === 'function' };
  if (process.platform === 'linux') {
    report.checks.safeStorage.status = 'not tested: provider assurance required; do not infer async safety from sync backend';
  } else {
    const available = await safeStorage.isAsyncEncryptionAvailable();
    report.checks.safeStorage.available = available;
    if (available) {
      const previous = path.join(temp, 'wrapped-key.bin');
      if (report.phase === 'restart') {
        const oldKey = await safeStorage.decryptStringAsync(fs.readFileSync(previous));
        assert.equal(crypto.createHash('sha256').update(oldKey.result).digest('hex'), fs.readFileSync(path.join(temp, 'key-hash.txt'), 'utf8'));
        report.checks.safeStorage.previousProcessKeyReadable = true;
      }
      const wrapped = await safeStorage.encryptStringAsync(key.toString('base64'));
      const opened = await safeStorage.decryptStringAsync(wrapped);
      assert.equal(opened.result, key.toString('base64'));
      report.checks.safeStorage.roundTrip = true;
      report.checks.safeStorage.shouldReEncrypt = opened.shouldReEncrypt;
      fs.writeFileSync(previous, wrapped);
      fs.writeFileSync(path.join(temp, 'key-hash.txt'), crypto.createHash('sha256').update(key.toString('base64')).digest('hex'));
    }
  }
  key.fill(0);
  finish(0);
}).catch(error => { report.fatal = error.message; finish(1); });
