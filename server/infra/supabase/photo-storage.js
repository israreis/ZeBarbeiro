import crypto from 'node:crypto';
import { unprocessable } from '../../http/errors.js';
import { detectImageType } from '../image-type.js';

/**
 * Fotos dos barbeiros no Supabase Storage (bucket público, somente leitura pela URL).
 * Cada envio recebe um nome aleatório: não há path traversal e a URL muda a cada
 * troca de foto, então o cache longo nunca mostra a imagem antiga.
 */
export function createSupabasePhotoStorage({ admin, bucket, logger = console }) {
  const files = () => admin.storage.from(bucket);

  return {
    /** Valida a imagem pelo conteúdo, envia e devolve o caminho salvo. */
    async save(buffer) {
      const type = detectImageType(buffer);
      if (!type) throw unprocessable('Envie uma imagem JPG, PNG ou WEBP.');
      const path = `barbeiros/${crypto.randomUUID()}.${type.ext}`;
      const { error } = await files().upload(path, buffer, {
        contentType: type.contentType,
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) throw error;
      return path;
    },

    async remove(path) {
      if (!path) return;
      const { error } = await files().remove([path]);
      // Arquivo órfão não deve quebrar a operação principal.
      if (error) logger.warn(`[storage] não foi possível remover ${path}: ${error.message}`);
    },

    publicUrl(path) {
      return path ? files().getPublicUrl(path).data.publicUrl : null;
    },
  };
}
