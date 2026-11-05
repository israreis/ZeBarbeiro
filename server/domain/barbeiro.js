/** URL pública da foto; o nome do arquivo muda a cada envio, o que invalida o cache antigo. */
export function fotoUrl(barbeiro) {
  if (!barbeiro.foto) return null;
  return `/api/barbeiros/${encodeURIComponent(barbeiro.id)}/foto?v=${barbeiro.foto.split('.')[0]}`;
}
