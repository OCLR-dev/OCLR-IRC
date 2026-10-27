// Read-only reachability check. Sends no IRC commands, password, or nickname.
const net = require('node:net');
const fs = require('node:fs');
const report = { evidence: 'live-transport-only', host: 'irc.ppy.sh', port: 6667,
  connected: false, receivedBytes: 0, sentApplicationBytes: 0,
  limitation: 'Does not establish login, identity, room permission, or Bancho response grammar.' };
const socket = net.createConnection({ host: report.host, port: report.port });
const timeout = setTimeout(() => { report.timeout = true; socket.destroy(); }, 8000);
socket.on('connect', () => { report.connected = true; setTimeout(() => socket.destroy(), 1000).unref(); });
socket.on('data', data => { report.receivedBytes += data.length; });
socket.on('error', error => { report.error = error.code; });
socket.on('close', () => {
  clearTimeout(timeout);
  if (process.env.OCLR_SPIKE_REPORT) fs.writeFileSync(process.env.OCLR_SPIKE_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!report.connected) process.exitCode = 1;
});
