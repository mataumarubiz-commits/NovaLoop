function crc32Table() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = crc32Table()

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    Math.floor(date.getSeconds() / 2)
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0xf) << 5) |
    (date.getDate() & 0x1f)
  return { dosDate, dosTime }
}

function writeUint16LE(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
}

function writeUint32LE(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

export function createZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0

  for (const file of files) {
    const fileName = encoder.encode(file.name)
    const fileData = file.data
    const crc = crc32(fileData)
    const { dosDate, dosTime } = dosDateTime()

    const localHeader = new Uint8Array(30 + fileName.length)
    writeUint32LE(localHeader, 0, 0x04034b50)
    writeUint16LE(localHeader, 4, 20)
    writeUint16LE(localHeader, 6, 0)
    writeUint16LE(localHeader, 8, 0)
    writeUint16LE(localHeader, 10, dosTime)
    writeUint16LE(localHeader, 12, dosDate)
    writeUint32LE(localHeader, 14, crc)
    writeUint32LE(localHeader, 18, fileData.length)
    writeUint32LE(localHeader, 22, fileData.length)
    writeUint16LE(localHeader, 26, fileName.length)
    writeUint16LE(localHeader, 28, 0)
    localHeader.set(fileName, 30)
    localParts.push(localHeader, fileData)

    const centralHeader = new Uint8Array(46 + fileName.length)
    writeUint32LE(centralHeader, 0, 0x02014b50)
    writeUint16LE(centralHeader, 4, 20)
    writeUint16LE(centralHeader, 6, 20)
    writeUint16LE(centralHeader, 8, 0)
    writeUint16LE(centralHeader, 10, 0)
    writeUint16LE(centralHeader, 12, dosTime)
    writeUint16LE(centralHeader, 14, dosDate)
    writeUint32LE(centralHeader, 16, crc)
    writeUint32LE(centralHeader, 20, fileData.length)
    writeUint32LE(centralHeader, 24, fileData.length)
    writeUint16LE(centralHeader, 28, fileName.length)
    writeUint16LE(centralHeader, 30, 0)
    writeUint16LE(centralHeader, 32, 0)
    writeUint16LE(centralHeader, 34, 0)
    writeUint16LE(centralHeader, 36, 0)
    writeUint32LE(centralHeader, 38, 0)
    writeUint32LE(centralHeader, 42, localOffset)
    centralHeader.set(fileName, 46)
    centralParts.push(centralHeader)

    localOffset += localHeader.length + fileData.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const localSize = localParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  writeUint32LE(end, 0, 0x06054b50)
  writeUint16LE(end, 4, 0)
  writeUint16LE(end, 6, 0)
  writeUint16LE(end, 8, files.length)
  writeUint16LE(end, 10, files.length)
  writeUint32LE(end, 12, centralSize)
  writeUint32LE(end, 16, localSize)
  writeUint16LE(end, 20, 0)

  const totalSize = localSize + centralSize + end.length
  const output = new Uint8Array(totalSize)
  let offset = 0
  for (const part of localParts) {
    output.set(part, offset)
    offset += part.length
  }
  for (const part of centralParts) {
    output.set(part, offset)
    offset += part.length
  }
  output.set(end, offset)
  return output
}
