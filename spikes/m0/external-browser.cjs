// Synthetic native-browser navigation probe; never contacts osu! or OCLR.
const { createServer } = require('node:http');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const { callbackProbe } = require('./probes.cjs');

(async () => {
  if (process.platform !== 'darwin') throw new Error('Only macOS launcher implemented in this experiment');
  const callback = await callbackProbe();
  const origin = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method === 'POST' && req.url === '/approve') {
      res.writeHead(303, { Location: callback.url }).end();
    } else if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<title>OCLR M0 synthetic navigation</title><p>Local synthetic callback test. No account login.</p><form method="post" action="/approve"></form><script>document.querySelector("form").requestSubmit()</script>');
    } else res.writeHead(404).end();
  });
  try {
    await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
    await new Promise((resolve, reject) => execFile('/usr/bin/open', [`http://127.0.0.1:${origin.address().port}/`], error => error ? reject(error) : resolve()));
    const start = Date.now();
    while (!callback.accepted() && Date.now() - start < 30000) await new Promise(resolve => setTimeout(resolve, 100));
    const report = { evidence: 'synthetic-system-default-browser', platform: process.platform,
      loopback: '127.0.0.1', formPost303Callback: callback.accepted() === 1,
      limitation: 'Local HTTP origin only; not production HTTPS OAuth, CSRF, browser matrix, or Electron shell.openExternal.' };
    if (process.env.OCLR_SPIKE_REPORT) fs.writeFileSync(process.env.OCLR_SPIKE_REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (!report.formPost303Callback) process.exitCode = 1;
  } finally {
    await callback.close();
    await new Promise(resolve => origin.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
