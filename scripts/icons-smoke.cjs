// Offline native decoding and small-size artwork review; no application profile.
const { app, BrowserWindow, nativeImage } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(process.env.OCLR_QA_TEMP, 'icons'))
const dir = path.resolve('resources/icons')
function checkPng(bytes, size) {
  const image = nativeImage.createFromBuffer(bytes)
  assert.deepEqual(image.getSize(), { width: size, height: size })
  const bitmap = image.toBitmap()
  for (const pixel of [0, size - 1, size * (size - 1), size * size - 1]) assert.equal(bitmap[pixel * 4 + 3], 0, 'Transparent corner')
  assert.ok(bitmap.some((value, i) => i % 4 === 3 && value === 255), 'Artwork has opaque pixels')
}
async function main() {
  await app.whenReady()
  for (const [file, size] of [['icon.png', 1024], ['icon-32.png', 32], ['icon-128.png', 128], ['icon-256.png', 256], ['tray-color.png', 32], ['trayTemplate.png', 16], ['trayTemplate@2x.png', 32]]) checkPng(fs.readFileSync(path.join(dir, file)), size)
  assert.ok(fs.readFileSync(path.join(dir, 'OCLR.icon/Assets/Liru.png')).equals(fs.readFileSync(path.join(dir, 'icon.png'))), 'Icon Composer artwork stays in sync with the master')
  const ico = fs.readFileSync(path.join(dir, 'icon.ico'))
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 7)
  for (let i = 0; i < 7; i++) {
    const p = 6 + i * 16, size = ico[p] || 256, length = ico.readUInt32LE(p + 8), start = ico.readUInt32LE(p + 12)
    assert.ok(start + length <= ico.length)
    checkPng(ico.subarray(start, start + length), size)
  }
  const icns = fs.readFileSync(path.join(dir, 'icon.icns'))
  assert.equal(icns.toString('ascii', 0, 4), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)
  const sizes = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 }
  const seen = []
  for (let p = 8; p < icns.length;) {
    const type = icns.toString('ascii', p, p + 4), length = icns.readUInt32BE(p + 4)
    assert.ok(length > 8 && p + length <= icns.length)
    checkPng(icns.subarray(p + 8, p + length), sizes[type]); seen.push(type); p += length
  }
  assert.deepEqual(seen, Object.keys(sizes))
  if (process.platform === 'darwin') {
    const template = nativeImage.createFromPath(path.join(dir, 'trayTemplate.png'))
    assert.deepEqual(template.getScaleFactors(), [1, 2])
    template.setTemplateImage(true); assert.equal(template.isTemplateImage(), true)
  }
  const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, 'icon-256.png')).toString('base64')
  const template = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, 'trayTemplate@2x.png')).toString('base64')
  const html = `<html><style>*{box-sizing:border-box}body{margin:0;font:12px system-ui;background:#111116;color:#eee}main{display:flex;gap:32px;padding:28px}h1{font-size:18px;margin:0 0 18px}section{display:flex;gap:22px;align-items:center;height:88px}.size{display:grid;gap:8px;justify-items:center}img{object-fit:contain}aside{width:220px}.tray{display:flex;align-items:center;gap:20px;padding:8px 18px;border-radius:8px;background:#fff}.tray.dark{background:#28242f}.dark img{filter:invert(1)}</style><main><aside><h1>OCLR IRC · Liru</h1><img src="${icon}" width="200" height="200"></aside><div><h1>Native sizes</h1><section>${[16, 32, 64, 128].map(size => `<div class="size"><img src="${icon}" width="${size}" height="${size}"><span>${size}px</span></div>`).join('')}</section><h1 style="margin-top:36px">macOS menu bar</h1><section><div class="tray"><img src="${template}" width="16" height="16"><img src="${template}" width="32" height="32"></div><div class="tray dark"><img src="${template}" width="16" height="16"><img src="${template}" width="32" height="32"></div></section></div></main></html>`
  const window = new BrowserWindow({ width: 760, height: 360, show: false, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await window.webContents.executeJavaScript('Promise.all(Array.from(document.images, image=>image.decode()))')
  fs.mkdirSync('artifacts', { recursive: true })
  fs.writeFileSync('artifacts/liru-icon-sizes.png', (await window.webContents.capturePage()).toPNG())
  console.log(JSON.stringify({ evidence: 'offline-icon-formats', passed: ['native PNG decoding and transparent corners', 'seven ICO resolutions', 'standard and Retina ICNS frames', ...(process.platform === 'darwin' ? ['macOS 1x/2x native template'] : [])] }))
  window.destroy(); app.quit()
}
main().catch(error => { console.error(error); app.exit(1) })
