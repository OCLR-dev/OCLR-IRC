const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { lineCollector, callbackProbe } = require('./probes.cjs');

test('SYNTHETIC: UTF-8 split at every byte boundary and CRLF framing', () => {
  const text = ':Example!u@synthetic PRIVMSG #mp_900000001 :測試🎵\r\nPING :synthetic\r\n';
  const bytes = Buffer.from(text);
  for (let split = 0; split <= bytes.length; split++) {
    const collect = lineCollector();
    assert.deepEqual([...collect(bytes.subarray(0, split)), ...collect(bytes.subarray(split))], text.split('\r\n').slice(0, -1));
  }
});

test('SYNTHETIC: bounded buffering; 512 is an experiment limit, not verified Bancho limit', () => {
  assert.throws(() => lineCollector()(Buffer.from('x'.repeat(513))));
  assert.throws(() => lineCollector()(Buffer.from('x'.repeat(511) + '\r\n')));
  assert.equal(lineCollector()(Buffer.from('x'.repeat(510) + '\r\n'))[0].length, 510);
});

test('REGRESSION: CRLF registration followed by LF-only Bancho replies must not stall', () => {
  const lines = [':server 001 Example :Welcome', ':BanchoBot PRIVMSG #mp_9 :Room name: synthetic, History: https://osu.ppy.sh/mp/9',
    ':BanchoBot PRIVMSG #mp_9 :Team mode: TeamVs, Win condition: ScoreV2', ':BanchoBot PRIVMSG #mp_9 :Players: 0',
    ':BanchoBot PRIVMSG #mp_9 :Match referees:', ':BanchoBot PRIVMSG #mp_9 :Example'];
  const bytes = Buffer.from(lines[0] + '\r\n' + lines.slice(1).join('\n') + '\n');
  for (let split = 0; split <= bytes.length; split++) {
    const collect = lineCollector();
    assert.deepEqual([...collect(bytes.subarray(0, split)), ...collect(bytes.subarray(split))], lines);
  }
  // Reproduce the previous delimiter defect without contacting a real room.
  assert.equal(bytes.toString().split('\r\n').slice(0, -1).filter(line => line.includes(' PRIVMSG ')).length, 0);
});

test('PUBLIC RFC 7636 vector: S256 challenge', () => {
  assert.equal(createHash('sha256').update('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').digest('base64url'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('LOCAL HTTP: bind loopback, reject wrong/duplicate state, accept once', async () => {
  const probe = await callbackProbe();
  try {
    assert.equal(probe.address.address, '127.0.0.1');
    assert.ok(probe.address.port >= 1024);
    assert.equal((await fetch(probe.url.replace(probe.state, 'wrong'))).status, 400);
    assert.equal((await fetch(probe.url + '&state=duplicate')).status, 400);
    assert.equal((await fetch(probe.url, { method: 'POST' })).status, 404);
    const response = await fetch(probe.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!(await response.text()).includes(probe.state));
    assert.equal((await fetch(probe.url)).status, 409);
    assert.equal(probe.accepted(), 1);
  } finally { await probe.close(); }
});
