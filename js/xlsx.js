/* Mis Cuentas — generador de Excel (.xlsx) sin dependencias.
   Convierte uno o varios "doc" de Core.construirInforme en un libro con formato
   (colores de la plantilla, totales en negrita, importes como números en €). */
(function (g) {
  'use strict';

  const enc = new TextEncoder();
  const esc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- ZIP (método "store", sin compresión) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zip(files) {
    const now = new Date();
    const dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      chunks.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, x) => s + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    const all = chunks.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
    let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
    return out;
  }

  /* ---------- estilos ---------- */
  const FILL = { gasto: 'FCE4D6', ingreso: 'E2EFDA', neutro: 'E7EBEF', cab: 'F3F5F7' };
  const FMT = { eur: '#,##0.00 "€"', eurDash: '#,##0.00 "€";-#,##0.00 "€";"–"', pct: '0.0%' };

  function Estilos() {
    const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    const numFmts = [];
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    const cache = new Map();
    const idx = (arr, xml) => { let i = arr.indexOf(xml); if (i < 0) { arr.push(xml); i = arr.length - 1; } return i; };
    this.get = function (o) {
      const k = JSON.stringify(o);
      if (cache.has(k)) return cache.get(k);
      const font = idx(fonts, `<font>${o.b ? '<b/>' : ''}${o.i ? '<i/>' : ''}<sz val="${o.sz || 11}"/>${o.gris ? '<color rgb="FF6B7785"/>' : ''}<name val="Calibri"/></font>`);
      const fill = o.fill ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${o.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
      const borde = (lado, est) => est ? `<${lado} style="${est}"><color rgb="FF${est === 'medium' ? '1D2733' : 'B8C0C8'}"/></${lado}>` : `<${lado}/>`;
      const border = (o.top || o.bottom) ? idx(borders, `<border><left/><right/>${borde('top', o.top)}${borde('bottom', o.bottom)}<diagonal/></border>`) : 0;
      let fmt = 0;
      if (o.fmt) { let j = numFmts.indexOf(FMT[o.fmt]); if (j < 0) { numFmts.push(FMT[o.fmt]); j = numFmts.length - 1; } fmt = 164 + j; }
      const al = (o.h || o.wrap) ? `<alignment${o.h ? ` horizontal="${o.h}"` : ''}${o.wrap ? ' wrapText="1" vertical="top"' : ''}/>` : '';
      xfs.push(`<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`);
      cache.set(k, xfs.length - 1);
      return xfs.length - 1;
    };
    this.xml = () => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : '') +
      `<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills>` +
      `<borders count="${borders.length}">${borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }

  const colL = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  /* ---------- una hoja por informe ---------- */
  function hoja(doc, st, textoCelda) {
    const filas = []; // [[{v, s}]]
    const anchos = [];
    const medir = (j, txt) => { anchos[j] = Math.max(anchos[j] || 8, Math.min(60, String(txt).length + 2)); };
    const add = (celdas, alto) => { filas.push({ celdas, alto }); };

    add([{ v: doc.titulo, s: st.get({ b: true, sz: 14 }) }], 22);
    for (const [k, v] of doc.meta) {
      const num = v && typeof v === 'object';
      add([{ v: k, s: st.get({ b: true }) }, num ? { n: v.n, s: st.get({ fmt: 'eur', h: 'right' }) } : { v: v, s: st.get({ h: 'left' }) }]);
      medir(0, k);
    }
    add([]);
    for (const sec of doc.secciones) {
      const nc = sec.cols.length;
      const fill = FILL[sec.tono] || FILL.neutro;
      if (sec.titulo) add(sec.cols.map((_, j) => ({ v: j === 0 ? sec.titulo : '', s: st.get({ b: true, fill, top: 'medium', bottom: 'medium' }) })), 18);
      if (!sec.sinCabecera) {
        add(sec.cols.map(c => ({ v: c.h, s: st.get({ b: true, fill: FILL.cab, bottom: 'thin', h: c.num ? 'right' : 'left' }) })));
        sec.cols.forEach((c, j) => medir(j, c.h));
      }
      for (const f of sec.filas) {
        const tot = f.k === 'total';
        add(f.c.map((c, j) => {
          const col = sec.cols[j] || {};
          const base = { b: tot, top: tot ? 'medium' : undefined };
          if (c && typeof c === 'object') {
            const fmt = c.f === 'pct' ? 'pct' : (sec.zeroDash ? 'eurDash' : 'eur');
            medir(j, textoCelda(c, sec) + '  ');
            return { n: c.f === 'pct' ? Math.round(c.n * 10000) / 10000 : c.n, s: st.get(Object.assign(base, { fmt, h: 'right' })) };
          }
          const v = c == null ? '' : c;
          medir(j, v);
          return { v, s: st.get(Object.assign(base, col.num ? { h: 'right' } : {})) };
        }));
      }
      for (let j = 0; j < nc; j++) anchos[j] = anchos[j] || 10;
      add([]);
    }
    for (const n of doc.notas || []) add([{ v: n, s: st.get({ i: true, gris: true }) }]);
    add([{ v: 'Generado el ' + new Date().toLocaleString('es-ES'), s: st.get({ i: true, gris: true, sz: 9 }) }]);

    const ancho = anchos.map(a => Math.min(a, 48));
    const rows = filas.map((f, i) => {
      const r = i + 1;
      const cells = f.celdas.map((c, j) => {
        const ref = colL(j) + r;
        if (c.n !== undefined) return `<c r="${ref}" s="${c.s}"><v>${Number.isFinite(c.n) ? c.n : 0}</v></c>`;
        if (c.v === '' || c.v == null) return `<c r="${ref}" s="${c.s}"/>`;
        return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
      }).join('');
      return `<row r="${r}"${f.alto ? ` ht="${f.alto}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    const land = doc.orient === 'l';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      `<cols>${ancho.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
      `<sheetData>${rows}</sheetData>` +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      `<pageSetup paperSize="9" orientation="${land ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>` +
      '</worksheet>';
  }

  function nombreHoja(s, usados) {
    let n = String(s).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Hoja';
    let k = 2; const base = n;
    while (usados.has(n)) n = (base.slice(0, 28) + ' ' + k++);
    usados.add(n);
    return n;
  }

  /** docs: uno o varios informes (cada uno en su hoja). Devuelve Uint8Array del .xlsx */
  function crearXlsx(docs, textoCelda) {
    const st = new Estilos();
    const usados = new Set();
    const hojas = docs.map(d => ({ nombre: nombreHoja(d.hoja || d.titulo, usados), xml: hoja(d, st, textoCelda) }));
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${esc(docs[0].titulo)}</dc:title><dc:creator>Mis Cuentas</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>` },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        hojas.map((h, i) => `<sheet name="${esc(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` }
    ];
    hojas.forEach((h, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: h.xml }));
    files.push({ name: 'xl/styles.xml', data: st.xml() }); // al final: los estilos se registran al construir las hojas
    return zip(files);
  }

  g.XLSXW = { crearXlsx };
})(typeof window !== 'undefined' ? window : globalThis);
