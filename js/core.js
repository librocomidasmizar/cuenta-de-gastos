/* Mis Cuentas — lógica pura: filtros, saldos, agregados e informes.
   Sin acceso al DOM, para poder probarla aparte. Todo el cálculo se hace en céntimos. */
(function (g) {
  'use strict';

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const pad2 = n => String(n).padStart(2, '0');

  const cents = n => Math.round(Number(n) * 100) || 0;
  const signed = m => (m.tipo === 'ingreso' ? 1 : -1) * cents(m.importe);

  const NF = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  /** importe en euros -> "1234,56 €" (espacios normales, apto para PDF) */
  function eur(n) {
    let x = Math.round(Number(n) * 100) / 100;
    if (!x || Math.abs(x) < 0.005) x = 0;
    return NF.format(x).replace(/[  ]/g, ' ');
  }
  const eurC = c => eur(c / 100);

  function fmtFecha(m) {
    const [y, mo, d] = m.fecha.split('-');
    if (m.origen === 'migración') return `${MES_C[+mo - 1]} ${y}`; // las pestañas antiguas no tenían día
    return `${d}/${mo}/${y}`;
  }

  function etiquetaPeriodo(anio, mes) {
    if (anio === 'all' && mes === 'all') return 'Todos los años';
    if (anio === 'all') return `${cap(MESES[mes - 1])} (todos los años)`;
    if (mes === 'all') return `Año ${anio}`;
    return `${cap(MESES[mes - 1])} ${anio}`;
  }
  function slugPeriodo(anio, mes) {
    if (anio === 'all' && mes === 'all') return 'todos';
    if (anio === 'all') return `${MESES[mes - 1]}-todos`;
    return mes === 'all' ? String(anio) : `${anio}-${pad2(mes)}`;
  }

  /* ---------- filtros ---------- */
  // F = { anio: 'all'|2026, mes: 'all'|1..12, tipo: 'all'|'gasto'|'ingreso', cats: ['gasto|Ropa', ...] }
  const FILTRO_VACIO = { anio: 'all', mes: 'all', tipo: 'all', cats: [] };
  const claveCat = (tipo, nombre) => tipo + '|' + nombre;

  function pasa(m, F, sinMes) {
    if (F.anio !== 'all' && +m.fecha.slice(0, 4) !== F.anio) return false;
    if (!sinMes && F.mes !== 'all' && +m.fecha.slice(5, 7) !== F.mes) return false;
    if (F.tipo !== 'all' && m.tipo !== F.tipo) return false;
    if (F.cats.length && F.cats.indexOf(claveCat(m.tipo, m.categoria)) < 0) return false;
    return true;
  }
  const filtrar = (movs, F, sinMes) => movs.filter(m => pasa(m, F, sinMes));
  const hayFiltroDeContenido = F => F.tipo !== 'all' || F.cats.length > 0;

  function ordenar(movs) {
    // por fecha y, dentro del mismo día, en el orden en que se anotaron
    return movs.map((m, i) => [m, i]).sort((a, b) => a[0].fecha < b[0].fecha ? -1 : a[0].fecha > b[0].fecha ? 1 : a[1] - b[1]).map(x => x[0]);
  }

  /* ---------- saldos (siempre de la cuenta completa) ---------- */
  function saldoAntes(movs, cfg, iso) {
    let c = cents(cfg.saldo_inicial);
    for (const m of movs) if (m.fecha >= cfg.fecha_saldo_inicial && m.fecha < iso) c += signed(m);
    return c;
  }
  function saldoTotal(movs, cfg) {
    let c = cents(cfg.saldo_inicial);
    for (const m of movs) if (m.fecha >= cfg.fecha_saldo_inicial) c += signed(m);
    return c;
  }
  function mesSiguiente(y, m) { return m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`; }

  /** [inicio, finExclusivo|null] del periodo, o null si el periodo no es continuo (un mes de todos los años) */
  function limites(F, cfg) {
    if (F.anio === 'all') return F.mes === 'all' ? [cfg.fecha_saldo_inicial, null] : null;
    if (F.mes === 'all') return [`${F.anio}-01-01`, `${F.anio + 1}-01-01`];
    return [`${F.anio}-${pad2(F.mes)}-01`, mesSiguiente(F.anio, F.mes)];
  }
  function saldosPeriodo(movs, cfg, F) {
    const l = limites(F, cfg);
    if (!l) return { ini: null, fin: null };
    return { ini: saldoAntes(movs, cfg, l[0]), fin: l[1] ? saldoAntes(movs, cfg, l[1]) : saldoTotal(movs, cfg) };
  }

  function totales(lista) {
    let ing = 0, gas = 0;
    for (const m of lista) { if (m.tipo === 'ingreso') ing += cents(m.importe); else gas += cents(m.importe); }
    return { ing, gas, res: ing - gas, n: lista.length };
  }

  function kpis(movs, cfg, F) {
    const t = totales(filtrar(movs, F));
    return Object.assign(t, saldosPeriodo(movs, cfg, F), { filtrado: hayFiltroDeContenido(F) });
  }

  /* ---------- agregados ---------- */
  function catsDe(cats, tipo) {
    return cats.filter(c => c.tipo === tipo).sort((a, b) => a.orden - b.orden).map(c => c.nombre);
  }
  /** suma por categoría: [{nombre, c}] en el orden de la pestaña Categorías (+ las desconocidas al final) */
  function porCategoria(lista, cats, tipo, incluirCeros) {
    const mapa = new Map(catsDe(cats, tipo).map(n => [n, 0]));
    for (const m of lista) if (m.tipo === tipo) mapa.set(m.categoria, (mapa.get(m.categoria) || 0) + cents(m.importe));
    return [...mapa].map(([nombre, c]) => ({ nombre, c })).filter(x => incluirCeros || x.c !== 0);
  }

  /** meses 'YYYY-MM' con datos de la cuenta en el año del filtro (del primero al último, sin huecos) */
  function mesesRango(movs, anio) {
    const ms = movs.filter(m => anio === 'all' || +m.fecha.slice(0, 4) === anio).map(m => m.fecha.slice(0, 7)).sort();
    if (!ms.length) return [];
    const out = [];
    let [y, mo] = ms[0].split('-').map(Number);
    const fin = ms[ms.length - 1];
    for (;;) { const k = `${y}-${pad2(mo)}`; out.push(k); if (k >= fin) break; mo++; if (mo > 12) { mo = 1; y++; } }
    return out;
  }
  function etiquetaMes(ym, conAnio) {
    const [y, m] = ym.split('-').map(Number);
    return conAnio ? `${cap(MES_C[m - 1])} ${String(y).slice(2)}` : cap(MESES[m - 1]);
  }

  /** evolución mensual: ingresos/gastos según filtros (salvo el mes) y saldo de la cuenta */
  function serieMensual(movs, cfg, F) {
    return mesesRango(movs, F.anio).map(ym => {
      const [y, m] = ym.split('-').map(Number);
      const t = totales(movs.filter(x => x.fecha.slice(0, 7) === ym && pasa(x, F, true)));
      return { ym, y, m, ing: t.ing, gas: t.gas, res: t.res,
        ini: saldoAntes(movs, cfg, `${ym}-01`), fin: saldoAntes(movs, cfg, mesSiguiente(y, m)) };
    });
  }

  function aniosConDatos(movs) {
    return [...new Set(movs.map(m => +m.fecha.slice(0, 4)))].sort((a, b) => a - b);
  }

  /** completa el periodo que necesita cada informe cuando el filtro dice "todos" */
  function periodoEfectivo(F, movs, necesita) {
    let anio = F.anio, mes = F.mes;
    if (necesita === 'anio' || necesita === 'mes') {
      if (anio === 'all') { const a = aniosConDatos(movs); anio = a.length ? a[a.length - 1] : new Date().getFullYear(); }
      if (necesita === 'anio') mes = 'all';
    }
    if (necesita === 'mes' && mes === 'all') {
      const ms = movs.filter(m => +m.fecha.slice(0, 4) === anio).map(m => +m.fecha.slice(5, 7));
      mes = ms.length ? Math.max(...ms) : new Date().getMonth() + 1;
    }
    return { anio, mes };
  }

  /* ---------- informes ----------
     Modelo común que pintan la vista previa, el PDF y el Excel:
     doc = { id, titulo, meta: [[etiqueta, celda]], secciones: [sec], notas: [], orient: 'p'|'l', hoja, archivo }
     sec = { titulo, tono: 'gasto'|'ingreso'|'neutro', cols: [{h, w, num}], sinCabecera, zeroDash, filas: [{c: [celda], k: 'total'}] }
     celda = texto | {n: euros, f: 'eur'|'pct'} | null                                                    */
  const E = c => ({ n: c / 100, f: 'eur' });
  const P = x => ({ n: x, f: 'pct' });

  const INFORMES = [
    { id: 'secretario', nombre: 'Para el Secretario', desc: 'Total de gastos e ingresos por categoría, como la parte derecha de cada pestaña.', necesita: 'periodo' },
    { id: 'mensual', nombre: 'Mensual completo', desc: 'Saldos del mes, resumen por categoría y todos los movimientos.', necesita: 'mes' },
    { id: 'anual', nombre: 'Anual', desc: 'Total del año por categoría, con porcentajes y saldos.', necesita: 'anio' },
    { id: 'meses', nombre: 'Por meses', desc: 'Saldo inicial, ingresos, gastos, resultado y saldo final de cada mes.', necesita: 'anio' },
    { id: 'catmeses', nombre: 'Categorías por meses', desc: 'Cada categoría mes a mes, como la pestaña Resumen anual.', necesita: 'anio' },
    { id: 'detalle', nombre: 'Movimientos', desc: 'La lista de movimientos que ves con los filtros actuales.', necesita: 'periodo' }
  ];

  function periodoDeInforme(id, F, movs) {
    const inf = INFORMES.find(i => i.id === id);
    return periodoEfectivo(F, movs, inf.necesita);
  }

  function seccionResumen(titulo, tono, filas, total, conPct) {
    const cols = conPct ? [{ h: 'Categoría', w: 3 }, { h: 'Importe', w: 1.3, num: true }, { h: '%', w: 0.8, num: true }]
      : [{ h: 'Categoría', w: 3 }, { h: 'Importe', w: 1.3, num: true }];
    return {
      titulo, tono, cols, sinCabecera: !conPct,
      filas: filas.map(r => ({ c: conPct ? [r.nombre, E(r.c), P(total ? r.c / total : 0)] : [r.nombre, E(r.c)] }))
        .concat([{ c: conPct ? ['TOTAL:', E(total), P(total ? 1 : 0)] : ['TOTAL:', E(total)], k: 'total' }])
    };
  }

  function docSecretario(ctx) {
    const { cfg, cats, movs, F } = ctx;
    const lista = filtrar(movs, { anio: F.anio, mes: F.mes, tipo: 'all', cats: [] });
    const g = porCategoria(lista, cats, 'gasto', true), i = porCategoria(lista, cats, 'ingreso', true);
    const sum = a => a.reduce((s, x) => s + x.c, 0);
    return {
      id: 'secretario', titulo: 'PARA EL SECRETARIO',
      meta: [['Nombre', cfg.nombre || ''], ['Periodo', etiquetaPeriodo(F.anio, F.mes)]],
      secciones: [seccionResumen('GASTOS', 'gasto', g, sum(g)), seccionResumen('INGRESOS', 'ingreso', i, sum(i))],
      notas: [], orient: 'p', hoja: 'Secretario', archivo: `Secretario_${slugPeriodo(F.anio, F.mes)}`, vacio: !lista.length
    };
  }

  function seccionesResumen(lista, cats, F, conPct) {
    const out = [];
    const incluirCeros = !F.cats.length;
    for (const [tipo, titulo, tono] of [['gasto', 'GASTOS', 'gasto'], ['ingreso', 'INGRESOS', 'ingreso']]) {
      if (F.tipo !== 'all' && F.tipo !== tipo) continue;
      let filas = porCategoria(lista, cats, tipo, incluirCeros);
      if (F.cats.length) filas = filas.filter(r => F.cats.indexOf(claveCat(tipo, r.nombre)) >= 0);
      out.push(seccionResumen(titulo, tono, filas, filas.reduce((s, x) => s + x.c, 0), conPct));
    }
    return out;
  }
  function seccionResultado(t) {
    return { titulo: 'RESULTADO', tono: 'neutro', cols: [{ h: '', w: 3 }, { h: 'Importe', w: 1.3, num: true }], sinCabecera: true,
      filas: [{ c: ['Ingresos', E(t.ing)] }, { c: ['Gastos', E(t.gas)] }, { c: ['Ingresos − gastos', E(t.res)], k: 'total' }] };
  }
  function notaFiltros(F, cats) {
    if (!hayFiltroDeContenido(F)) return [];
    const partes = [];
    if (F.tipo !== 'all') partes.push(F.tipo === 'gasto' ? 'solo gastos' : 'solo ingresos');
    if (F.cats.length) partes.push('categorías: ' + F.cats.map(k => k.split('|')[1]).join(', '));
    return ['Filtrado (' + partes.join('; ') + '). Los saldos son siempre los de la cuenta completa.'];
  }

  function docMensual(ctx) {
    const { cfg, cats, movs } = ctx;
    const per = periodoEfectivo(ctx.F, movs, 'mes');
    const F = Object.assign({}, ctx.F, per);
    const lista = ordenar(filtrar(movs, F));
    const s = saldosPeriodo(movs, cfg, F);
    const secs = seccionesResumen(lista, cats, F, false);
    secs.push(seccionResultado(totales(lista)));
    for (const [tipo, titulo, tono, h] of [['gasto', 'DETALLE DE GASTOS', 'gasto', 'Coste'], ['ingreso', 'DETALLE DE INGRESOS', 'ingreso', 'Ingreso']]) {
      if (F.tipo !== 'all' && F.tipo !== tipo) continue;
      const del = lista.filter(m => m.tipo === tipo);
      secs.push({ titulo, tono, cols: [{ h: 'Categoría', w: 1.6 }, { h: 'Concepto', w: 3.2 }, { h, w: 1.1, num: true }],
        filas: del.map(m => ({ c: [m.categoria, m.concepto, E(cents(m.importe))] }))
          .concat([{ c: ['TOTAL:', '', E(del.reduce((a, m) => a + cents(m.importe), 0))], k: 'total' }]) });
    }
    return {
      id: 'mensual', titulo: 'Informe mensual',
      meta: [['Nombre', cfg.nombre || ''], ['Año', String(F.anio)], ['Mes', cap(MESES[F.mes - 1])],
        ['Saldo inicio mes', E(s.ini)], ['Saldo fin de mes', E(s.fin)]],
      secciones: secs, notas: notaFiltros(F, cats), orient: 'p', hoja: 'Mensual',
      archivo: `Informe_mensual_${slugPeriodo(F.anio, F.mes)}`, vacio: !lista.length
    };
  }

  function docAnual(ctx) {
    const { cfg, cats, movs } = ctx;
    const F = Object.assign({}, ctx.F, periodoEfectivo(ctx.F, movs, 'anio'));
    const lista = filtrar(movs, F);
    const s = saldosPeriodo(movs, cfg, F);
    const secs = seccionesResumen(lista, cats, F, true);
    secs.push(seccionResultado(totales(lista)));
    return {
      id: 'anual', titulo: 'Informe anual',
      meta: [['Nombre', cfg.nombre || ''], ['Año', String(F.anio)], ['Saldo inicio año', E(s.ini)], ['Saldo fin de año', E(s.fin)]],
      secciones: secs, notas: notaFiltros(F, cats), orient: 'p', hoja: 'Anual', archivo: `Informe_anual_${F.anio}`, vacio: !lista.length
    };
  }

  function docMeses(ctx) {
    const { cfg, cats, movs } = ctx;
    const F = Object.assign({}, ctx.F, periodoEfectivo(ctx.F, movs, 'anio'));
    const serie = serieMensual(movs, cfg, F);
    const t = serie.reduce((a, x) => ({ ing: a.ing + x.ing, gas: a.gas + x.gas }), { ing: 0, gas: 0 });
    return {
      id: 'meses', titulo: 'Informe por meses',
      meta: [['Nombre', cfg.nombre || ''], ['Año', String(F.anio)]],
      secciones: [{
        titulo: 'EVOLUCIÓN MENSUAL', tono: 'neutro',
        cols: [{ h: 'Mes', w: 1.4 }, { h: 'Saldo inicial', w: 1.2, num: true }, { h: 'Ingresos', w: 1.2, num: true },
          { h: 'Gastos', w: 1.2, num: true }, { h: 'Resultado', w: 1.2, num: true }, { h: 'Saldo final', w: 1.2, num: true }],
        filas: serie.map(x => ({ c: [etiquetaMes(x.ym, false), E(x.ini), E(x.ing), E(x.gas), E(x.res), E(x.fin)] }))
          .concat([{ c: ['TOTAL', null, E(t.ing), E(t.gas), E(t.ing - t.gas), null], k: 'total' }])
      }],
      notas: notaFiltros(F, cats), orient: 'p', hoja: 'Por meses', archivo: `Informe_por_meses_${F.anio}`, vacio: !serie.length
    };
  }

  function docCatMeses(ctx) {
    const { cfg, cats, movs } = ctx;
    const F = Object.assign({}, ctx.F, periodoEfectivo(ctx.F, movs, 'anio'));
    const meses = mesesRango(movs, F.anio);
    const lista = filtrar(movs, F);
    const cols = [{ h: 'Categoría', w: 2.6 }].concat(meses.map(ym => ({ h: etiquetaMes(ym, true), w: 1, num: true })), [{ h: 'Total', w: 1.2, num: true }]);
    const secs = [];
    const totMes = {};
    for (const [tipo, titulo, tono] of [['gasto', 'GASTOS', 'gasto'], ['ingreso', 'INGRESOS', 'ingreso']]) {
      if (F.tipo !== 'all' && F.tipo !== tipo) continue;
      let nombres = porCategoria(lista, cats, tipo, !F.cats.length).map(r => r.nombre);
      if (F.cats.length) nombres = nombres.filter(n => F.cats.indexOf(claveCat(tipo, n)) >= 0);
      const celda = (n, ym) => lista.filter(m => m.tipo === tipo && m.categoria === n && m.fecha.slice(0, 7) === ym).reduce((a, m) => a + cents(m.importe), 0);
      const filas = nombres.map(n => { const v = meses.map(ym => celda(n, ym)); return { c: [n].concat(v.map(E), [E(v.reduce((a, b) => a + b, 0))]) }; });
      const tm = meses.map(ym => lista.filter(m => m.tipo === tipo && m.fecha.slice(0, 7) === ym).reduce((a, m) => a + cents(m.importe), 0));
      totMes[tipo] = tm;
      filas.push({ c: ['TOTAL'].concat(tm.map(E), [E(tm.reduce((a, b) => a + b, 0))]), k: 'total' });
      secs.push({ titulo, tono, cols, zeroDash: true, filas });
    }
    if (totMes.gasto && totMes.ingreso) {
      const d = meses.map((_, i) => totMes.ingreso[i] - totMes.gasto[i]);
      secs.push({ titulo: 'SALDO DEL MES (INGRESOS − GASTOS)', tono: 'neutro', cols, sinCabecera: true, zeroDash: true,
        filas: [{ c: ['SALDO'].concat(d.map(E), [E(d.reduce((a, b) => a + b, 0))]), k: 'total' }] });
    }
    return {
      id: 'catmeses', titulo: 'Categorías por meses',
      meta: [['Nombre', cfg.nombre || ''], ['Año', String(F.anio)]],
      secciones: secs, notas: notaFiltros(F, cats), orient: meses.length > 4 ? 'l' : 'p', hoja: 'Categorías por meses',
      archivo: `Categorias_por_meses_${F.anio}`, vacio: !meses.length
    };
  }

  function docDetalle(ctx) {
    const { cfg, cats, movs, F } = ctx;
    const lista = ordenar(filtrar(movs, F));
    const t = totales(lista);
    return {
      id: 'detalle', titulo: 'Movimientos',
      meta: [['Nombre', cfg.nombre || ''], ['Periodo', etiquetaPeriodo(F.anio, F.mes)]],
      secciones: [{
        titulo: '', tono: 'neutro',
        cols: [{ h: 'Fecha', w: 1.1 }, { h: 'Categoría', w: 1.7 }, { h: 'Concepto', w: 3 }, { h: 'Ingreso', w: 1.1, num: true }, { h: 'Gasto', w: 1.1, num: true }],
        filas: lista.map(m => ({ c: [fmtFecha(m), m.categoria, m.concepto, m.tipo === 'ingreso' ? E(cents(m.importe)) : null, m.tipo === 'gasto' ? E(cents(m.importe)) : null] }))
          .concat([{ c: ['TOTAL', '', '', E(t.ing), E(t.gas)], k: 'total' }, { c: ['Ingresos − gastos', '', '', E(t.res), null], k: 'total' }])
      }],
      notas: notaFiltros(F, cats), orient: 'p', hoja: 'Movimientos', archivo: `Movimientos_${slugPeriodo(F.anio, F.mes)}`, vacio: !lista.length
    };
  }

  const CONSTRUCTORES = { secretario: docSecretario, mensual: docMensual, anual: docAnual, meses: docMeses, catmeses: docCatMeses, detalle: docDetalle };
  const construirInforme = (id, ctx) => CONSTRUCTORES[id](ctx);

  /** texto de una celda tal y como se ve en PDF y en pantalla */
  function textoCelda(c, sec) {
    if (c === null || c === undefined) return '';
    if (typeof c !== 'object') return String(c);
    if (c.f === 'pct') return (Math.round(c.n * 1000) / 10).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
    if (sec && sec.zeroDash && Math.abs(c.n) < 0.005) return '–';
    return eur(c.n);
  }

  g.Core = {
    MESES, MES_C, cap, pad2, cents, eur, eurC, fmtFecha, etiquetaPeriodo, slugPeriodo,
    FILTRO_VACIO, claveCat, pasa, filtrar, hayFiltroDeContenido, ordenar,
    saldoAntes, saldoTotal, saldosPeriodo, totales, kpis, catsDe, porCategoria, mesesRango, etiquetaMes,
    serieMensual, aniosConDatos, periodoEfectivo, periodoDeInforme, INFORMES, construirInforme, textoCelda
  };
})(typeof window !== 'undefined' ? window : globalThis);
