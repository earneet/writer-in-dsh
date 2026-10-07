/**
 * 极简 ZIP 构建器（仅 stored 不压缩条目）：ePub 导出的唯一二进制依赖点。
 * 不引入外部 zip 库——EPUB 对 mimetype 条目要求「首个且不压缩」，stored 模式天然满足，
 * 且实现面小到可全量单测（CRC32 + 本地文件头 + 中央目录）。纯函数、无 I/O。
 * @module dsh-writer-export/zip
 */

/** CRC-32（IEEE 802.3）查表。 */
const CRC_TABLE: readonly number[] = (() => {
  const table = new Array<number>(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** 计算字节的 CRC-32（无符号 32 位）。 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 一个 zip 条目：名称 + 内容（文本按 UTF-8 编码）。 */
export interface ZipEntry {
  name: string
  data: string | Uint8Array
}

/**
 * 构建 stored（不压缩）ZIP 包：条目按传入顺序写入（EPUB 要求 mimetype 首个，由调用方保证顺序）。
 * @returns 完整 zip 文件的字节。
 */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    const crc = crc32(data)
    // 本地文件头（stored）：签名 0x04034b50 + 版本 20 + 标志 0x0800（UTF-8 名）+ 方法 0 + 时间 0 + crc + 大小
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true)
    lv.setUint16(8, 0, true)
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    locals.push(local, data)
    // 中央目录条目
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralBytes = centrals.map((c) => [...c])
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, offset > 0 ? centralBytes.reduce((sum, c) => sum + c.length, 0) : 0, true)
  ev.setUint32(16, offset, true)
  const parts: number[][] = [...locals.map((l) => [...l]), ...centralBytes, [...end]]
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
