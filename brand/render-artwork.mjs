#!/usr/bin/env node
// Render brand/source/icon.svg and brand.json's name into every desktop artwork file under brand/overlay/
// (paths mirror the upstream tree; prepare.mjs copies them over). Needs a prepared ./harness for sharp.
//
// Usage: node brand/render-artwork.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'harness', 'apps', 'desktop', 'package.json'))
const sharp = require('sharp')
const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8'))
const icon = readFileSync(join(root, 'brand', 'source', 'icon.svg'), 'utf8')
const overlay = join(root, 'brand', 'overlay')
const desktop = join(overlay, 'apps', 'desktop')

const write = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); console.log(`wrote ${path.slice(root.length + 1)}`) }
const png = async (svg, width, height, options = {}) => {
  let image = sharp(Buffer.from(svg), { density: 72 * Math.max(width, height) / 1024 * 2 }).resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  if (options.flatten) image = image.flatten({ background: options.flatten })
  return image.png().toBuffer()
}
const inner = icon.replace(/^[\s\S]*?<svg[^>]*>/u, '').replace(/<\/svg>\s*$/u, '')
const FONT = "font-family=\"'Segoe UI', 'Montserrat', Arial, sans-serif\""

// App icons. icon.png keeps upstream's padded 1104 canvas.
write(join(desktop, 'resources', 'icon-windows.svg'), icon)
write(join(desktop, 'resources', 'icon.svg'), icon)
write(join(desktop, 'resources', 'icon-macos.svg'), icon)
write(join(desktop, 'resources', 'icon-windows.png'), await png(icon, 1024, 1024))
write(join(desktop, 'resources', 'icon-macos.png'), await png(icon, 1024, 1024))
write(join(desktop, 'resources', 'icon.png'), await png(`<svg xmlns="http://www.w3.org/2000/svg" width="1104" height="1104" viewBox="-40 -40 1104 1104">${inner}</svg>`, 1104, 1104))

// Tray icon: PNG-compressed ICO entries at the sizes upstream bundles.
const sizes = [16, 20, 24, 32, 40, 48, 64]
const entries = await Promise.all(sizes.map(async size => ({ size, png: await png(icon, size, size) })))
const header = Buffer.alloc(6 + 16 * entries.length)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4)
let offset = header.length
entries.forEach(({ size, png: data }, index) => {
  const at = 6 + index * 16
  header.writeUInt8(size >= 256 ? 0 : size, at); header.writeUInt8(size >= 256 ? 0 : size, at + 1)
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6)
  header.writeUInt32LE(data.length, at + 8); header.writeUInt32LE(offset, at + 12)
  offset += data.length
})
write(join(desktop, 'resources', 'tray-windows.ico'), Buffer.concat([header, ...entries.map(e => e.png)]))

// Installer header logos (light and dark backgrounds) at 1x and 2x.
const logo = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="196" viewBox="0 0 600 196">
  <svg x="0" y="38" width="120" height="120" viewBox="0 0 1024 1024">${inner}</svg>
  <text x="140" y="92" ${FONT} font-size="40" font-weight="600" fill="${color}">${brand.APP_NAME_SHORT}</text>
  <text x="140" y="134" ${FONT} font-size="22" fill="${color}" fill-opacity="0.7">Unofficial DeepSeek Harness build</text>
</svg>`
for (const [suffix, color] of [['', '#111827'], ['-dark', '#f9fafb']]) {
  write(join(desktop, 'installer', 'assets', `brand${suffix}.png`), await png(logo(color), 600, 196))
  write(join(desktop, 'installer', 'assets', `brand${suffix}-2x.png`), await png(logo(color), 1200, 392))
}
// Uninstaller sidebar: opaque 164x314.
write(join(desktop, 'installer', 'assets', 'uninstaller-sidebar.png'), await png(`<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14b8a6"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs>
  <rect width="164" height="314" fill="url(#s)"/>
  <svg x="32" y="40" width="100" height="100" viewBox="0 0 1024 1024">${inner.replace('fill="url(#bg)"', 'fill="#ffffff" fill-opacity="0.12"')}</svg>
</svg>`, 164, 314, { flatten: '#1e3a8a' }))

// Welcome-window wordmark (472x40, colored by the page theme where the variable resolves).
write(join(desktop, 'renderer', 'assets', 'welcome-brand.svg'), `<svg width="472" height="40" viewBox="0 0 472 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<svg x="0" y="0" width="40" height="40" viewBox="0 0 1024 1024">${inner}</svg>
<text x="54" y="29" ${FONT} font-size="26" font-weight="600" fill="var(--dsw-alias-label-primary, #6b7280)">${brand.APP_NAME}</text>
</svg>
`)
