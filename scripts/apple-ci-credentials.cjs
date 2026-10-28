const fs = require('node:fs')
const path = require('node:path')
const { randomBytes, createPrivateKey } = require('node:crypto')
const { spawnSync } = require('node:child_process')
function configuration(env) {
  const names = ['MAC_CERTIFICATE_P12_BASE64', 'MAC_CERTIFICATE_PASSWORD', 'APPLE_API_PRIVATE_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID', 'MAC_TEAM_ID']
  for (const name of names) if (!env[name]?.trim()) throw new Error(`Missing signing setting: ${name}`)
  const certificate = env.MAC_CERTIFICATE_P12_BASE64.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(certificate) || !Buffer.from(certificate, 'base64').length) throw new Error('Invalid P12 base64')
  if (!/^[A-Z0-9]{10}$/.test(env.MAC_TEAM_ID)) throw new Error('MAC_TEAM_ID must be a 10-character Team ID')
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_API_KEY_ID)) throw new Error('Invalid API Key ID')
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.APPLE_API_ISSUER_ID)) throw new Error('Invalid Team API Issuer ID')
  try { if (createPrivateKey(env.APPLE_API_PRIVATE_KEY).asymmetricKeyType !== 'ec') throw new Error() }
  catch { throw new Error('APPLE_API_PRIVATE_KEY must contain the downloaded Team API .p8 private key') }
  return { certificate: Buffer.from(certificate, 'base64'), team: env.MAC_TEAM_ID }
}
function run(command, args, stage) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 })
  // Never print command arguments: security import contains the P12 password.
  if (result.error || result.status !== 0) throw new Error(`${stage} failed. Check the signing environment settings.`)
  return result.stdout || ''
}
function stateFile(env) {
  if (!env.RUNNER_TEMP) throw new Error('This script requires the isolated GitHub runner temporary directory')
  return path.join(env.RUNNER_TEMP, 'oclr-apple-signing-state.json')
}
function cleanup(env) {
  const state = stateFile(env)
  if (!fs.existsSync(state)) return
  const data = JSON.parse(fs.readFileSync(state, 'utf8'))
  let failure
  try { run('security', ['list-keychains', '-d', 'user', '-s', ...data.original], 'Restore keychain list') } catch (error) { failure = error }
  try { if (fs.existsSync(data.keychain)) run('security', ['delete-keychain', data.keychain], 'Remove temporary keychain') } catch (error) { failure = error }
  finally { fs.rmSync(data.dir, { recursive: true, force: true }); fs.rmSync(state, { force: true }) }
  if (failure) throw failure
}
function setup(env) {
  const config = configuration(env), state = stateFile(env)
  if (!env.GITHUB_ENV) throw new Error('Missing GitHub environment export path')
  if (fs.existsSync(state)) throw new Error('A previous signing setup must be cleaned up first')
  const original = [...run('security', ['list-keychains', '-d', 'user'], 'Read keychain list').matchAll(/"([^"]+)"/g)].map(match => match[1])
  const dir = fs.mkdtempSync(path.join(env.RUNNER_TEMP, 'oclr-apple-signing-'))
  const keychain = path.join(dir, 'build.keychain-db'), cert = path.join(dir, 'certificate.p12'), key = path.join(dir, 'AuthKey.p8')
  fs.writeFileSync(state, JSON.stringify({ dir, keychain, original }), { mode: 0o600 })
  try {
    fs.writeFileSync(cert, config.certificate, { mode: 0o600 }); fs.writeFileSync(key, env.APPLE_API_PRIVATE_KEY, { mode: 0o600 })
    const password = randomBytes(32).toString('hex')
    run('security', ['create-keychain', '-p', password, keychain], 'Create temporary keychain')
    run('security', ['set-keychain-settings', '-lut', '7200', keychain], 'Configure temporary keychain')
    run('security', ['unlock-keychain', '-p', password, keychain], 'Unlock temporary keychain')
    run('security', ['import', cert, '-P', env.MAC_CERTIFICATE_PASSWORD, '-k', keychain, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'], 'Import Developer ID identity')
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-k', password, keychain], 'Authorize codesign')
    run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...original], 'Add temporary keychain')
    const identities = [...run('security', ['find-identity', '-v', '-p', 'codesigning', keychain], 'Check identity').matchAll(/\b([A-Fa-f0-9]{40})\s+"Developer ID Application: [^"]+\(([A-Z0-9]{10})\)"/g)].filter(match => match[2] === config.team)
    if (identities.length !== 1) throw new Error('Expected one valid Developer ID Application identity matching MAC_TEAM_ID, with its private key')
    run('xcrun', ['notarytool', 'store-credentials', 'oclr-ci-notary', '--key', key, '--key-id', env.APPLE_API_KEY_ID, '--issuer', env.APPLE_API_ISSUER_ID, '--keychain', keychain], 'Validate notarization credentials')
    fs.rmSync(cert); fs.rmSync(key)
    fs.appendFileSync(env.GITHUB_ENV, `MAC_KEYCHAIN_PATH=${keychain}\nMAC_SIGNING_IDENTITY=${identities[0][1]}\nMAC_NOTARY_PROFILE=oclr-ci-notary\nMAC_TEAM_ID=${config.team}\n`)
    console.log('Developer ID identity imported and notarization credentials validated.')
  } catch (error) { try { cleanup(env) } catch {} throw error }
}
module.exports = { configuration }
if (require.main === module) {
  try {
    if (process.platform !== 'darwin') throw new Error('macOS only')
    if (process.argv[2] === 'setup') setup(process.env)
    else if (process.argv[2] === 'cleanup') cleanup(process.env)
    else throw new Error('Expected setup or cleanup')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
