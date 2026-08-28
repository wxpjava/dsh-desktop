'use strict'

/**
 * Generate the tray icon PNG at runtime (no asset needed in the repo): a round
 * badge in a brand color on a transparent background, encoded as a minimal PNG
 * with zlib. Pure Node, so the encoder is unit-testable headlessly.
 */

const fs = require('node:fs')
const zlib = require('node:zlib')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** Encode raw RGBA pixels (width×height×4) into a PNG buffer. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type 6 = RGBA
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A round indigo badge on a transparent background. */
function badgePng(size = 32) {
  const rgba = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  const radius = size / 2 - 1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center
      const dy = y - center
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * size + x) * 4
        rgba[i] = 77 // R
        rgba[i + 1] = 85 // G
        rgba[i + 2] = 255 // B
        rgba[i + 3] = 255 // A
      }
    }
  }
  return encodePng(size, size, rgba)
}

function writeBadge(filePath, size = 32) {
  fs.writeFileSync(filePath, badgePng(size))
  return filePath
}

module.exports = { encodePng, badgePng, writeBadge }
