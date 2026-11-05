/**
 * Prepara uma foto escolhida pelo usuário antes do envio: recorta no centro em formato
 * quadrado e reduz para `size` pixels. Além de deixar o arquivo leve, a imagem é
 * redesenhada num canvas, o que descarta metadados (como a localização GPS da câmera).
 * @param {File} file
 * @param {number} [size]
 * @returns {Promise<Blob>} imagem JPEG
 */
export async function prepareSquarePhoto(file, size = 480) {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível processar a imagem.'))), 'image/jpeg', 0.85);
  });
}
