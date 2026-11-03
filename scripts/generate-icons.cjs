// Deterministic format conversion only; artwork is created with imagegen.
// Run with: npx electron scripts/generate-icons.cjs [master.png]
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-icon-conversion-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
const output = path.resolve('resources/icons')
async function main() {
  await app.whenReady()
  fs.mkdirSync(output, { recursive: true })
  const master = nativeImage.createFromPath(path.resolve(process.argv[2] || path.join(output, 'icon.png')))
  if (master.isEmpty() || master.getSize().width !== master.getSize().height || master.getSize().width < 1024) throw new Error('Square master of at least 1024px required')
  const png = size => master.resize({ width: size, height: size, quality: 'best' }).toPNG()
  for (const size of [32, 128, 256, 1024]) fs.writeFileSync(path.join(output, size === 1024 ? 'icon.png' : `icon-${size}.png`), png(size))
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  const frames = sizes.map(png)
  let offset = header.length
  frames.forEach((frame, i) => {
    const p = 6 + i * 16
    header[p] = header[p + 1] = sizes[i] % 256
    header.writeUInt16LE(1, p + 4); header.writeUInt16LE(32, p + 6)
    header.writeUInt32LE(frame.length, p + 8); header.writeUInt32LE(offset, p + 12)
    offset += frame.length
  })
  fs.writeFileSync(path.join(output, 'icon.ico'), Buffer.concat([header, ...frames]))
  const chunks = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]].map(([type, size]) => {
    const frame = png(size), block = Buffer.alloc(8)
    block.write(type); block.writeUInt32BE(frame.length + 8, 4)
    return Buffer.concat([block, frame])
  })
  const icns = Buffer.alloc(8)
  icns.write('icns'); icns.writeUInt32BE(8 + chunks.reduce((n, chunk) => n + chunk.length, 0), 4)
  fs.writeFileSync(path.join(output, 'icon.icns'), Buffer.concat([icns, ...chunks]))
  // The editable menu-bar silhouette is intentionally much simpler than the portrait.
  const svg = fs.readFileSync(path.join(output, 'tray-template.svg'), 'utf8')
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html,<html></html>')
  for (const size of [16, 32]) {
    const data = await window.webContents.executeJavaScript(`(async () => { const image = new Image(); image.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))}; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size}; canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size}); return canvas.toDataURL('image/png').split(',')[1] })()`)
    fs.writeFileSync(path.join(output, size === 16 ? 'trayTemplate.png' : 'trayTemplate@2x.png'), Buffer.from(data, 'base64'))
  }
  window.destroy()
  console.log('Generated PNG, seven-resolution ICO, ICNS and monochrome template assets.')
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }))
