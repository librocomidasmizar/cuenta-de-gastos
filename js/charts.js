/* Mis Cuentas — gráficos SVG propios (sin librerías), con tooltip y tabla de datos. */
(function (g) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function escala(min, max, n) {
    if (min === max) { max = min + 1; }
    const paso0 = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const paso = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= paso0);
    const lo = Math.floor(min / paso) * paso, hi = Math.ceil(max / paso) * paso;
    const ticks = []; for (let v = lo; v <= hi + paso / 2; v += paso) ticks.push(Math.round(v * 100) / 100);
    return { lo, hi, ticks };
  }
  const corto = v => Math.abs(v) >= 1000 ? (Math.round(v / 100) / 10).toLocaleString('es-ES') + ' mil' : Math.round(v).toLocaleString('es-ES');
  const el = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; };

  function tooltip(cont) {
    let t = cont.querySelector('.tt');
    if (!t) { t = document.createElement('div'); t.className = 'tt'; t.hidden = true; cont.appendChild(t); }
    return {
      show(html, x, y) {
        t.innerHTML = html; t.hidden = false;
        const w = t.offsetWidth, cw = cont.clientWidth;
        t.style.left = Math.max(0, Math.min(cw - w, x - w / 2)) + 'px';
        t.style.top = Math.max(0, y - t.offsetHeight - 10) + 'px';
      },
      hide() { t.hidden = true; }
    };
  }

  /** barras horizontales por categoría (HTML) */
  function barras(cont, filas, opts) {
    const max = Math.max(...filas.map(f => f.v), 0);
    cont.innerHTML = '';
    if (!filas.length || max <= 0) { cont.innerHTML = `<p class="vacio">${opts.vacio}</p>`; return; }
    const ul = document.createElement('ul'); ul.className = 'barras';
    filas.forEach(f => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="b-et"></span><span class="b-pista"><span class="b-barra" style="width:${Math.max(0.6, f.v / max * 100)}%;background:var(${opts.color})"></span></span><span class="b-val num"></span>`;
      li.querySelector('.b-et').textContent = f.nombre;
      li.querySelector('.b-val').textContent = opts.fmt(f.v);
      li.title = `${f.nombre}: ${opts.fmt(f.v)} (${opts.total ? Math.round(f.v / opts.total * 100) : 0} %)`;
      ul.appendChild(li);
    });
    cont.appendChild(ul);
  }

  /** columnas agrupadas: ingresos y gastos por mes */
  function columnas(cont, datos, opts) {
    cont.querySelector('svg')?.remove();
    if (!datos.length) return;
    const W = Math.max(280, cont.clientWidth), H = 220, m = { t: 12, r: 8, b: 26, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(...datos.flatMap(d => [d.ing, d.gas]), 1);
    const sc = escala(0, max, 4), Y = v => m.t + ih - (v - sc.lo) / (sc.hi - sc.lo) * ih;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.aria });
    sc.ticks.forEach(t => {
      svg.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'eje' : 'rejilla' }));
      const tx = el('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick' }); tx.textContent = corto(t); svg.appendChild(tx);
    });
    const banda = iw / datos.length, bw = Math.min(22, (banda - 10) / 2);
    const paso = Math.ceil(datos.length / Math.floor(iw / 44)); // no amontonar etiquetas
    datos.forEach((d, i) => {
      const cx = m.l + banda * i + banda / 2;
      const zona = el('rect', { x: cx - banda / 2, y: m.t, width: banda, height: ih, class: 'zona', 'data-i': i });
      svg.appendChild(zona);
      [['ing', '--c-ingreso', -1], ['gas', '--c-gasto', 1]].forEach(([k, c, lado]) => {
        const v = d[k]; if (!v) return;
        const x = cx + (lado < 0 ? -bw - 1 : 1), y = Y(v), h = Y(0) - y;
        const r = Math.min(4, bw / 2, h);
        svg.appendChild(el('path', { d: `M${x},${Y(0)}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${Y(0)}Z`, fill: `var(${c})`, class: 'marca' }));
      });
      if (i % paso === 0) { const tx = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick' }); tx.textContent = d.et; svg.appendChild(tx); }
    });
    cont.appendChild(svg);
    const tt = tooltip(cont);
    const mostrar = e => {
      const z = e.target.closest('.zona'); if (!z) return tt.hide();
      svg.querySelectorAll('.zona.on').forEach(n => n.classList.remove('on')); z.classList.add('on');
      const d = datos[+z.dataset.i];
      tt.show(opts.html(d), +z.getAttribute('x') + banda / 2, Y(Math.max(d.ing, d.gas)));
    };
    svg.addEventListener('pointermove', mostrar);
    svg.addEventListener('pointerdown', mostrar);
    svg.addEventListener('pointerleave', () => { tt.hide(); svg.querySelectorAll('.zona.on').forEach(n => n.classList.remove('on')); });
  }

  /** línea: saldo a final de cada mes */
  function linea(cont, datos, opts) {
    cont.querySelector('svg')?.remove();
    if (!datos.length) return;
    const W = Math.max(280, cont.clientWidth), H = 190, m = { t: 22, r: 16, b: 26, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = datos.map(d => d.v);
    const sc = escala(Math.min(0, ...vals), Math.max(...vals, 1), 4), Y = v => m.t + ih - (v - sc.lo) / (sc.hi - sc.lo) * ih;
    const X = i => datos.length === 1 ? m.l + iw / 2 : m.l + iw * i / (datos.length - 1);
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.aria });
    sc.ticks.forEach(t => {
      svg.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'eje' : 'rejilla' }));
      const tx = el('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick' }); tx.textContent = corto(t); svg.appendChild(tx);
    });
    const paso = Math.ceil(datos.length / Math.floor(iw / 44));
    datos.forEach((d, i) => { if (i % paso === 0) { const tx = el('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', class: 'tick' }); tx.textContent = d.et; svg.appendChild(tx); } });
    svg.appendChild(el('path', { d: datos.map((d, i) => (i ? 'L' : 'M') + X(i) + ',' + Y(d.v)).join(''), class: 'linea' }));
    datos.forEach((d, i) => svg.appendChild(el('circle', { cx: X(i), cy: Y(d.v), r: 4, class: 'punto' })));
    const ult = datos[datos.length - 1];
    const lab = el('text', { x: Math.min(X(datos.length - 1), W - m.r), y: Y(ult.v) - 9, 'text-anchor': 'end', class: 'etq' }); lab.textContent = opts.fmt(ult.v); svg.appendChild(lab);
    const guia = el('line', { y1: m.t, y2: m.t + ih, class: 'guia', visibility: 'hidden' }); svg.appendChild(guia);
    const hit = el('rect', { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' }); svg.appendChild(hit);
    cont.appendChild(svg);
    const tt = tooltip(cont);
    const mostrar = e => {
      const r = svg.getBoundingClientRect(), x = e.clientX - r.left;
      let i = datos.length === 1 ? 0 : Math.round((x - m.l) / iw * (datos.length - 1)); i = Math.max(0, Math.min(datos.length - 1, i));
      guia.setAttribute('x1', X(i)); guia.setAttribute('x2', X(i)); guia.setAttribute('visibility', 'visible');
      tt.show(opts.html(datos[i]), X(i), Y(datos[i].v));
    };
    hit.addEventListener('pointermove', mostrar); hit.addEventListener('pointerdown', mostrar);
    hit.addEventListener('pointerleave', () => { tt.hide(); guia.setAttribute('visibility', 'hidden'); });
  }

  g.Charts = { barras, columnas, linea };
})(window);
