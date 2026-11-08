/* Mis Cuentas — PDF de un informe (usa pdf-lib, incluida en /vendor). */
(function (g) {
  'use strict';

  const TONO = { gasto: [252, 228, 214], ingreso: [226, 239, 218], neutro: [231, 235, 239] };
  const INK = [0.09, 0.13, 0.17], INK2 = [0.36, 0.41, 0.47], RULE = [0.72, 0.75, 0.78];

  async function crearPdf(doc, textoCelda, PDFLib) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdf = await PDFDocument.create();
    pdf.setTitle(doc.titulo + (doc.meta[1] ? ' — ' + plano(doc.meta[1][1]) : ''));
    pdf.setCreator('Mis Cuentas');
    const fR = await pdf.embedFont(StandardFonts.Helvetica);
    const fB = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fI = await pdf.embedFont(StandardFonts.HelveticaOblique);
    const juego = new Set(fR.getCharacterSet());
    const limpio = s => Array.from(String(s)).map(ch => juego.has(ch.codePointAt(0)) ? ch : (ch === '−' ? '-' : '?')).join('');
    const C = a => rgb(a[0], a[1], a[2]);
    const C255 = a => rgb(a[0] / 255, a[1] / 255, a[2] / 255);
    function plano(v) { return v && typeof v === 'object' ? textoCelda(v) : String(v == null ? '' : v); }

    const land = doc.orient === 'l';
    const W = land ? 841.89 : 595.28, H = land ? 595.28 : 841.89, M = land ? 30 : 42;
    const ancho = W - 2 * M, ABAJO = M + 22;
    const paginas = [];
    let pg, y;
    const nueva = () => { pg = pdf.addPage([W, H]); paginas.push(pg); y = H - M; };
    const texto = (s, x, yy, f, sz, col) => pg.drawText(limpio(s), { x, y: yy, size: sz, font: f, color: col || C(INK) });
    const anchoT = (s, f, sz) => f.widthOfTextAtSize(limpio(s), sz);

    function partir(s, f, sz, max) {
      const palabras = limpio(s).split(/\s+/).filter(Boolean);
      const lineas = []; let act = '';
      for (let w of palabras) {
        while (anchoT(w, f, sz) > max && w.length > 1) { // palabra más larga que la columna
          let k = w.length; while (k > 1 && anchoT(w.slice(0, k), f, sz) > max) k--;
          if (act) { lineas.push(act); act = ''; }
          lineas.push(w.slice(0, k)); w = w.slice(k);
        }
        const prueba = act ? act + ' ' + w : w;
        if (anchoT(prueba, f, sz) <= max) act = prueba; else { if (act) lineas.push(act); act = w; }
      }
      if (act) lineas.push(act);
      return lineas.length ? lineas.slice(0, 4) : [''];
    }

    nueva();
    // cabecera
    texto(doc.titulo, M, y - 16, fB, 16);
    y -= 30;
    const anchoEt = Math.max(...doc.meta.map(m => anchoT(m[0] + ':', fB, 9.5)), 60) + 10;
    for (const [k, v] of doc.meta) {
      texto(k + ':', M, y - 10, fB, 9.5, C(INK2));
      texto(plano(v), M + anchoEt, y - 10, fR, 9.5);
      y -= 14;
    }
    y -= 10;

    for (const sec of doc.secciones) {
      const nc = sec.cols.length;
      const sz = nc > 8 ? 7.2 : 9;
      const lh = sz + 2.6;
      const pesos = sec.cols.reduce((s, c) => s + c.w, 0);
      const anchoTabla = (sec.sinCabecera && nc <= 3) ? Math.min(ancho, 330) : ancho; // resúmenes: tabla estrecha, como la plantilla
      const xs = []; let acc = M;
      sec.cols.forEach(c => { xs.push(acc); acc += anchoTabla * c.w / pesos; });
      const wCol = j => anchoTabla * sec.cols[j].w / pesos;
      const PAD = 4;

      const banda = cont => {
        if (!sec.titulo) return;
        pg.drawRectangle({ x: M, y: y - 17, width: anchoTabla, height: 17, color: C255(TONO[sec.tono] || TONO.neutro) });
        pg.drawLine({ start: { x: M, y: y }, end: { x: M + anchoTabla, y: y }, thickness: 1, color: C(INK) });
        pg.drawLine({ start: { x: M, y: y - 17 }, end: { x: M + anchoTabla, y: y - 17 }, thickness: 1, color: C(INK) });
        texto(sec.titulo + (cont ? ' (continuación)' : ''), M + PAD, y - 12, fB, 9.5);
        y -= 17;
      };
      const cabecera = () => {
        if (sec.sinCabecera) return;
        sec.cols.forEach((c, j) => {
          const t = c.h || '';
          const x = c.num ? xs[j] + wCol(j) - PAD - anchoT(t, fB, sz) : xs[j] + PAD;
          texto(t, x, y - lh + 1, fB, sz, C(INK2));
        });
        y -= lh + 3;
        pg.drawLine({ start: { x: M, y: y + 1 }, end: { x: M + anchoTabla, y: y + 1 }, thickness: 0.6, color: C(RULE) });
      };

      const altoFila = f => {
        const tot = f.k === 'total';
        let n = 1;
        f.c.forEach((c, j) => { if (!(sec.cols[j] || {}).num && c && typeof c !== 'object') n = Math.max(n, partir(c, tot ? fB : fR, sz, wCol(j) - 2 * PAD).length); });
        return n * lh + 4;
      };

      const primera = sec.filas.length ? altoFila(sec.filas[0]) : 0;
      if (y - (17 + (sec.sinCabecera ? 0 : lh + 3) + primera) < ABAJO) nueva();
      banda(false); cabecera();

      for (const f of sec.filas) {
        const h = altoFila(f);
        if (y - h < ABAJO) { nueva(); banda(true); cabecera(); }
        const tot = f.k === 'total';
        if (tot) pg.drawLine({ start: { x: M, y: y }, end: { x: M + anchoTabla, y: y }, thickness: 1, color: C(INK) });
        f.c.forEach((c, j) => {
          const col = sec.cols[j] || {};
          const fnt = tot ? fB : fR;
          if (c && typeof c === 'object') {
            const t = textoCelda(c, sec);
            texto(t, xs[j] + wCol(j) - PAD - anchoT(t, fnt, sz), y - lh + 1, fnt, sz);
          } else if (c !== null && c !== undefined && c !== '') {
            partir(c, fnt, sz, wCol(j) - 2 * PAD).forEach((l, k) => {
              const x = col.num ? xs[j] + wCol(j) - PAD - anchoT(l, fnt, sz) : xs[j] + PAD;
              texto(l, x, y - lh * (k + 1) + 1, fnt, sz);
            });
          }
        });
        y -= h;
        if (!tot) pg.drawLine({ start: { x: M, y: y + 1 }, end: { x: M + anchoTabla, y: y + 1 }, thickness: 0.3, color: C([0.88, 0.9, 0.92]) });
      }
      y -= 16;
    }

    for (const n of doc.notas || []) {
      for (const l of partir(n, fI, 8.5, ancho)) {
        if (y - 12 < ABAJO) nueva();
        texto(l, M, y - 10, fI, 8.5, C(INK2)); y -= 12;
      }
    }

    const gen = 'Generado el ' + new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
    paginas.forEach((p, i) => {
      pg = p;
      pg.drawLine({ start: { x: M, y: M + 10 }, end: { x: W - M, y: M + 10 }, thickness: 0.4, color: C(RULE) });
      texto('Mis Cuentas · ' + gen, M, M, fR, 7.5, C(INK2));
      const t = `Página ${i + 1} de ${paginas.length}`;
      texto(t, W - M - anchoT(t, fR, 7.5), M, fR, 7.5, C(INK2));
    });
    return pdf.save();
  }

  g.PDFW = { crearPdf };
})(typeof window !== 'undefined' ? window : globalThis);
