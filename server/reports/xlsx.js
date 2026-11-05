import { createZip } from './zip.js';

/**
 * Gerador mínimo de planilhas .xlsx (Office Open XML), sem dependências.
 * Pensado para dados "limpos": cada coluna tem um tipo (texto, número, moeda,
 * percentual ou data), cabeçalho em negrito, primeira linha congelada e filtro.
 * Números e datas são gravados como valores reais, prontos para cálculos.
 */

const STYLE = Object.freeze({
  text: 0, header: 1, date: 2, currency: 3, integer: 4, percent: 5,
});

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // remove caracteres de controle inválidos em XML
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function columnLetter(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** AAAA-MM-DD → número de série de data do Excel (dias desde 30/12/1899). */
function excelDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/**
 * Evita que um texto vindo do usuário seja interpretado como fórmula ao abrir a
 * planilha (CSV/formula injection), prefixando com apóstrofo quando começa com =, +, - ou @.
 */
const safeText = (value) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

function cell(ref, value, type) {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'date':
      return `<c r="${ref}" s="${STYLE.date}"><v>${excelDate(value)}</v></c>`;
    case 'currency':
    case 'integer':
    case 'percent':
      return Number.isFinite(value) ? `<c r="${ref}" s="${STYLE[type]}"><v>${value}</v></c>` : '';
    default:
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(safeText(String(value)))}</t></is></c>`;
  }
}

function sheetXml({ columns, rows }) {
  const lastColumn = columnLetter(columns.length - 1);
  const lastRow = rows.length + 1;
  const header = columns
    .map((column, i) => `<c r="${columnLetter(i)}1" t="inlineStr" s="${STYLE.header}"><is><t>${escapeXml(column.header)}</t></is></c>`)
    .join('');
  const body = rows.map((row, r) => {
    const cells = columns.map((column, c) => cell(`${columnLetter(c)}${r + 2}`, row[c], column.type)).join('');
    return `<row r="${r + 2}">${cells}</row>`;
  }).join('');
  const cols = columns
    .map((column, i) => `<col min="${i + 1}" max="${i + 1}" width="${column.width ?? 14}" customWidth="1"/>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${cols}</cols>
  <sheetData><row r="1">${header}</row>${body}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
}

/**
 * @param {Array<{ name: string, columns: Array<{ header: string, type?: string, width?: number }>, rows: any[][] }>} sheets
 * @returns {Buffer} conteúdo do arquivo .xlsx
 */
export function buildXlsx(sheets) {
  const sheetEntries = sheets.map((sheet, i) => ({ ...sheet, id: i + 1, name: sheet.name.slice(0, 31) }));

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetEntries.map((s) => `<sheet name="${escapeXml(s.name)}" sheetId="${s.id}" r:id="rId${s.id}"/>`).join('')}</sheets>
  <definedNames>${sheetEntries.map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escapeXml(s.name)}'!$A$1:$${columnLetter(s.columns.length - 1)}$${s.rows.length + 1}</definedName>`).join('')}</definedNames>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetEntries.map((s) => `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`).join('')}
  <Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetEntries.map((s) => `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  return createZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...sheetEntries.map((s) => ({ name: `xl/worksheets/sheet${s.id}.xml`, content: sheetXml(s) })),
  ]);
}
