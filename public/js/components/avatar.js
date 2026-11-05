import { el } from '../core/dom.js';

/**
 * Foto redonda da pessoa ou, se não houver foto, as iniciais do nome.
 * @param {{ nome: string, fotoUrl?: string|null }} pessoa
 * @param {'sm'|'md'|'lg'} [size]
 */
export function avatar({ nome, fotoUrl }, size = 'md') {
  const className = `avatar avatar-${size}`;
  if (fotoUrl) {
    return el('img', {
      className, src: fotoUrl, alt: '', loading: 'lazy', decoding: 'async',
    });
  }
  // Iniciais apenas de palavras que começam com letra ("Barbeiro 05" → "B", "João Pedro" → "JP").
  const palavras = nome.trim().split(/\s+/).filter((parte) => /^\p{L}/u.test(parte));
  const iniciais = (palavras.length ? palavras : [nome.trim()])
    .slice(0, 2).map((parte) => parte.charAt(0).toUpperCase()).join('');
  return el('span', { className: `${className} avatar-initials`, text: iniciais, attrs: { 'aria-hidden': 'true' } });
}

/** Avatar + nome lado a lado (células de tabela, cartões). */
export function personLabel(pessoa, size = 'sm') {
  return el('span', { className: 'person' }, [avatar(pessoa, size), el('span', { text: pessoa.nome })]);
}
