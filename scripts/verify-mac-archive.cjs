// Compatibility entry point; the shared verifier preserves macOS signing checks.
if (process.platform !== 'darwin') throw new Error('macOS only')
require('./verify-archive.cjs').main().catch(error => { console.error(error); process.exitCode = 1 })
