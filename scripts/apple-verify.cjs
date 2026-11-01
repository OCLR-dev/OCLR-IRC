const { spawnSync } = require('node:child_process')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// Ticket validation is read-only. Retry only explicit Apple transport failures;
// invalid signatures/tickets still fail, and notarization submission is never retried here.
async function appleVerify(command, args, run = spawnSync, pause = delay) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = run(command, args, { encoding: 'utf8', timeout: 120000 })
    if (result.status === 0) return
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    if (attempt === 2 || !/NSURLErrorDomain|network connection was lost|could not connect to the server|connection timed out/i.test(output)) throw new Error(`Apple verification failed: ${command} ${args[0]}`)
    console.log('Apple verification transport interrupted; retrying the same read-only check.')
    await pause(1000 * (attempt + 1))
  }
}
module.exports = { appleVerify }
