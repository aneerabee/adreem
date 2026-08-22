export function decodeCanonicalBase64(value = '') {
  const encoded = String(value || '').replace(/\s+/g, '')
  const isCanonicalBase64 = encoded.length > 0 && encoded.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  if (!isCanonicalBase64) throw new Error('Attachment data is invalid.')
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.toString('base64') !== encoded) throw new Error('Attachment data is invalid.')
  return buffer
}

export function attachmentContentMatchesMime(buffer, mimeType = '') {
  const mime = String(mimeType || '').toLowerCase()
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false
  if (mime === 'image/jpeg') {
    return buffer.length >= 20 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff &&
      buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9
  }
  if (mime === 'image/png') {
    return buffer.length >= 33 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
      buffer.subarray(12, 16).toString('ascii') === 'IHDR'
  }
  if (mime === 'image/webp') {
    return buffer.length >= 16 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  if (mime === 'application/pdf') {
    const header = buffer.subarray(0, 8).toString('ascii')
    const trailer = buffer.subarray(Math.max(0, buffer.length - 1024)).toString('ascii')
    return buffer.length >= 16 && /^%PDF-\d\.\d/.test(header) && trailer.includes('%%EOF')
  }
  return false
}
