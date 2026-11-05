import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { unprocessable } from '../http/errors.js';

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

const CONTENT_TYPES = Object.fromEntries(SIGNATURES.map(({ ext, contentType }) => [ext, contentType]));
const FILE_NAME = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return SIGNATURES.find((signature) => signature.matches(buffer)) ?? null;
}

/**
 * Armazena fotos em disco com nomes aleatórios (sem relação com o nome enviado),
 * o que evita path traversal e faz cada nova foto ter uma URL diferente (cache sempre correto).
 */
export function createPhotoStorage(dir) {
  const resolve = (fileName) => {
    if (!FILE_NAME.test(fileName)) throw new Error(`Nome de arquivo de foto inválido: ${fileName}`);
    return path.join(dir, fileName);
  };

  return {
    async save(buffer) {
      const type = detectImageType(buffer);
      if (!type) throw unprocessable('Envie uma imagem JPG, PNG ou WEBP.');
      await fs.mkdir(dir, { recursive: true });
      const fileName = `${crypto.randomUUID()}.${type.ext}`;
      await fs.writeFile(resolve(fileName), buffer);
      return fileName;
    },

    async read(fileName) {
      const content = await fs.readFile(resolve(fileName));
      return { content, contentType: CONTENT_TYPES[path.extname(fileName).slice(1)] };
    },

    async remove(fileName) {
      if (!fileName) return;
      await fs.rm(resolve(fileName), { force: true });
    },
  };
}
