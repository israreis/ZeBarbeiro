import zlib from 'node:zlib';
import { FONT_WIDTHS } from './font-metrics.js';

/**
 * Gerador mínimo de PDF (sem dependências) com as fontes padrão do PDF,
 * texto em WinAnsi (cobre acentos do português), retângulos, linhas e imagens JPEG.
 * As coordenadas são em pontos, com origem no canto SUPERIOR esquerdo da página.
 */

export const A4 = Object.freeze({ width: 595.28, height: 841.89 });

const FONTS = Object.freeze({
  Helvetica: 'F1',
  'Helvetica-Bold': 'F2',
  'Times-Bold': 'F3',
});

/** Converte texto para bytes cp1252 (WinAnsi); caracteres fora da tabela viram "?". */
const CP1252_EXTRA = new Map([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87], ['ˆ', 0x88],
  ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c], ['Ž', 0x8e], ['‘', 0x91], ['’', 0x92], ['“', 0x93],
  ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97], ['˜', 0x98], ['™', 0x99], ['š', 0x9a], ['›', 0x9b],
  ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
]);

function toWinAnsi(text) {
  const bytes = [];
  for (const char of String(text).normalize('NFC')) {
    const code = char.codePointAt(0);
    if (code === 0xa0) bytes.push(0x20);
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff)) bytes.push(code);
    else if (CP1252_EXTRA.has(char)) bytes.push(CP1252_EXTRA.get(char));
    else if (code === 0x09) bytes.push(0x20);
    else bytes.push(0x3f);
  }
  return bytes;
}

function escapePdfString(bytes) {
  let out = '';
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => (parseInt(value.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
}

const num = (value) => Number(value.toFixed(2)).toString();

/** Lê largura e altura de um JPEG (marcador SOF). */
function jpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('JPEG inválido.');
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('Dimensões do JPEG não encontradas.');
}

export class PdfDocument {
  #pages = [];
  #images = [];
  #current = null;

  constructor({ width = A4.width, height = A4.height } = {}) {
    this.width = width;
    this.height = height;
  }

  get pageCount() {
    return this.#pages.length;
  }

  addPage() {
    this.#current = { ops: [], images: new Set() };
    this.#pages.push(this.#current);
    return this;
  }

  /** Seleciona uma página já criada (ex.: para escrever o rodapé "Página x de y" no fim). */
  usePage(index) {
    this.#current = this.#pages[index];
    return this;
  }

  widthOf(text, font = 'Helvetica', size = 10) {
    const widths = FONT_WIDTHS[font];
    return toWinAnsi(text).reduce((sum, byte) => sum + (widths[byte - 32] || 500), 0) * (size / 1000);
  }

  /** Corta o texto com reticências para caber em `maxWidth`. */
  fit(text, font, size, maxWidth) {
    const value = String(text ?? '');
    if (this.widthOf(value, font, size) <= maxWidth) return value;
    let cut = value;
    while (cut.length && this.widthOf(`${cut}…`, font, size) > maxWidth) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  }

  /** Quebra o texto em linhas que caibam em `maxWidth`. */
  wrap(text, font, size, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.widthOf(candidate, font, size) <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  rect(x, y, width, height, { fill, stroke, lineWidth = 0.75 } = {}) {
    const ops = this.#current.ops;
    ops.push('q');
    if (fill) ops.push(`${hexToRgb(fill)} rg`);
    if (stroke) ops.push(`${hexToRgb(stroke)} RG ${num(lineWidth)} w`);
    ops.push(`${num(x)} ${num(this.height - y - height)} ${num(width)} ${num(height)} re`);
    let paint = 'S';
    if (fill && stroke) paint = 'B';
    else if (fill) paint = 'f';
    ops.push(paint, 'Q');
    return this;
  }

  line(x1, y1, x2, y2, { color = '#000000', width = 0.75 } = {}) {
    this.#current.ops.push(
      'q',
      `${hexToRgb(color)} RG ${num(width)} w`,
      `${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`,
      'Q',
    );
    return this;
  }

  /**
   * Escreve uma linha de texto. `y` é o topo da linha.
   * @param {object} [options] font, size, color, align ('left'|'right'|'center') e width (para alinhar)
   */
  text(value, x, y, {
    font = 'Helvetica', size = 10, color = '#000000', align = 'left', width = 0,
  } = {}) {
    const bytes = toWinAnsi(value);
    let left = x;
    if (align !== 'left') {
      const textWidth = this.widthOf(value, font, size);
      left = align === 'right' ? x + width - textWidth : x + (width - textWidth) / 2;
    }
    const baseline = this.height - y - size * 0.8;
    this.#current.ops.push(
      'BT',
      `/${FONTS[font]} ${num(size)} Tf`,
      `${hexToRgb(color)} rg`,
      `${num(left)} ${num(baseline)} Td`,
      `(${escapePdfString(bytes)}) Tj`,
      'ET',
    );
    return this;
  }

  image(jpeg, x, y, width, height) {
    let index = this.#images.findIndex((img) => img.data === jpeg);
    if (index === -1) {
      this.#images.push({ data: jpeg, ...jpegSize(jpeg) });
      index = this.#images.length - 1;
    }
    this.#current.images.add(index);
    this.#current.ops.push(
      'q',
      `${num(width)} 0 0 ${num(height)} ${num(x)} ${num(this.height - y - height)} cm`,
      `/Im${index + 1} Do`,
      'Q',
    );
    return this;
  }

  /** Monta o arquivo PDF. */
  toBuffer({ title = 'Relatório', author = '' } = {}) {
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length;
    };

    const catalogId = add(null);
    const pagesId = add(null);
    const fontIds = Object.keys(FONTS).map((name) => add(Buffer.from(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`,
      'latin1',
    )));
    const imageIds = this.#images.map((img) => add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`, 'latin1'),
      img.data,
      Buffer.from('\nendstream', 'latin1'),
    ])));

    const fontResources = Object.values(FONTS).map((key, i) => `/${key} ${fontIds[i]} 0 R`).join(' ');
    const pageIds = this.#pages.map((page) => {
      const content = zlib.deflateSync(Buffer.from(page.ops.join('\n'), 'latin1'));
      const contentId = add(Buffer.concat([
        Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
        content,
        Buffer.from('\nendstream', 'latin1'),
      ]));
      const xobjects = [...page.images].map((i) => `/Im${i + 1} ${imageIds[i]} 0 R`).join(' ');
      return add(Buffer.from(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] `
        + `/Resources << /Font << ${fontResources} >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> `
        + `/Contents ${contentId} 0 R >>`,
        'latin1',
      ));
    });

    objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1');
    objects[pagesId - 1] = Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
      'latin1',
    );
    const infoId = add(Buffer.from(
      `<< /Title (${escapePdfString(toWinAnsi(title))}) /Author (${escapePdfString(toWinAnsi(author))}) `
      + '/Producer (BarberApp) >>',
      'latin1',
    ));

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((body, i) => {
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      offsets.push(offset);
      chunks.push(chunk);
      offset += chunk.length;
    });

    const xref = [`xref\n0 ${objects.length + 1}`, '0000000000 65535 f ']
      .concat(offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `))
      .join('\n');
    chunks.push(Buffer.from(
      `${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
      'latin1',
    ));
    return Buffer.concat(chunks);
  }
}
