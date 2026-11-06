/**
 * Tipos de imagem aceitos, identificados pela assinatura do arquivo (magic bytes)
 * e não pelo Content-Type ou extensão informados pelo cliente, que podem ser falsificados.
 */
const SIGNATURES = Object.freeze([
  { ext: 'jpg', contentType: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    contentType: 'image/png',
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'webp',
    contentType: 'image/webp',
    matches: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
]);

export const IMAGE_CONTENT_TYPES = Object.freeze(SIGNATURES.map((s) => s.contentType));

/** @returns {{ ext: string, contentType: string } | null} */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const signature = SIGNATURES.find((s) => s.matches(buffer));
  return signature ? { ext: signature.ext, contentType: signature.contentType } : null;
}
