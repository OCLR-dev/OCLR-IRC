// Disposable experiments: no production Bancho parser or authentication endpoint.
const { StringDecoder } = require('node:string_decoder');
const { createServer } = require('node:http');
const { randomBytes } = require('node:crypto');

function lineCollector(limit = 512) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return chunk => {
    pending += decoder.write(chunk);
    const lines = [];
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      const framed = pending.slice(0, end);
      const hasCR = framed.endsWith('\r');
      const line = hasCR ? framed.slice(0, -1) : framed;
      if (Buffer.byteLength(framed) + 1 > limit) throw new Error('line too long');
      lines.push(line);
      pending = pending.slice(end + 1);
    }
    if (Buffer.byteLength(pending) > limit) throw new Error('buffer too long');
    return lines;
  };
}

async function callbackProbe() {
  const state = randomBytes(32).toString('base64url');
  let consumed = false;
  let accepted = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method !== 'GET' || url.pathname !== '/oclr/callback') {
      res.writeHead(404).end(); return;
    }
    if (url.searchParams.getAll('state').length !== 1 ||
        url.searchParams.getAll('code').length !== 1 ||
        url.searchParams.get('state') !== state ||
        url.searchParams.get('code') !== 'SYNTHETIC_CODE') {
      res.writeHead(400).end('Rejected synthetic callback'); return;
    }
    if (consumed) { res.writeHead(409).end(); return; }
    consumed = true;
    accepted++;
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Synthetic callback accepted');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server, state, base,
    address: server.address(),
    url: `${base}/oclr/callback?code=SYNTHETIC_CODE&state=${state}`,
    accepted: () => accepted,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

module.exports = { lineCollector, callbackProbe };
