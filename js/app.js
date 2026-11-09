/* Mis Cuentas — interfaz. Los datos viven en tu hoja de Google; aquí solo se muestran y se anotan. */
(function () {
  'use strict';
  const { Core, Charts, Acceso } = window;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const LS = { cx: 'mc.conexion', datos: 'mc.datos', filtros: 'mc.filtros', ultCat: 'mc.ultimaCategoria' };
  const leer = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* almacenamiento lleno o bloqueado */ } };
  const borrarLS = k => { try { localStorage.removeItem(k); } catch (e) { } };
  // sesión que dura hasta cerrar la app (cuando no se marca "no volver a pedirla")
  const SS = {
    leer: k => { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    guardar: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    borrar: k => { try { sessionStorage.removeItem(k); } catch (e) { } }
  };

  const S = {
    cx: null,               // {url, token}
    recordar: true,         // ¿se queda abierta la sesión en este dispositivo?
    acceso: null,           // contenido de acceso.json (cifrado)
    accesoNuevo: null,      // acceso.json recién creado, pendiente de subir
    data: null,             // {cfg, cats, movs}
    sync: null,             // fecha de la última sincronización
    F: Object.assign({}, Core.FILTRO_VACIO),
    vista: 'resumen', informe: 'secretario', limite: 150, editando: null
  };

  /* ---------------- API ---------------- */
  async function api(action, extra) {
    let r, j;
    try {
      r = await fetch(S.cx.url, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita la comprobación CORS previa
        body: JSON.stringify(Object.assign({ token: S.cx.token, action }, extra || {}))
      });
    } catch (e) { throw new Error('No hay conexión con Google. Revisa internet y vuelve a intentarlo.'); }
    try { j = await r.json(); } catch (e) {
      throw new Error('La API no ha respondido como esperaba. Comprueba la dirección y que esté publicada para "Cualquier usuario".');
    }
    if (!j.ok) { const err = new Error(j.error || 'Error desconocido.'); err.code = j.code; throw err; }
    return j;
  }

  function guardarDatos() {
    if (S.recordar) guardar(LS.datos, { data: S.data, sync: (S.sync || new Date()).toISOString() });
  }

  async function sincronizar(silencioso) {
    estado('Actualizando…');
    try {
      const j = await api('getAll');
      S.data = j.data; S.sync = new Date();
      guardarDatos();
      ajustarFiltros(); render();
      estado('Actualizado a las ' + hora(S.sync));
      return true;
    } catch (e) {
      if (e.code === 'AUTH') { claveCaducada(); return false; }
      estado(S.sync ? 'Sin conexión · datos de las ' + hora(S.sync) : 'Sin conexión');
      if (!silencioso || !S.data) aviso(e.message, true);
      return false;
    }
  }
  const hora = d => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const estado = t => { $('#estado').textContent = t; };

  /* ---------------- acceso ---------------- */
  async function iniciar() {
    if (location.hash.indexOf('#cfg=') === 0) history.replaceState(null, '', location.pathname + location.search); // enlaces antiguos: ya no se usan
    enlazar();
    pintarInstalar(); Acceso.alCambiarInstalar(pintarInstalar);
    const f = leer(LS.filtros); if (f) S.F = Object.assign({}, Core.FILTRO_VACIO, f);

    S.cx = leer(LS.cx); S.recordar = !!S.cx;
    if (!S.cx) S.cx = SS.leer(LS.cx);
    if (S.cx) { entrarApp(); return; }

    mostrarPuerta('entrada'); // mientras se comprueba si existe acceso.json
    $('#enBoton').disabled = true;
    S.acceso = await Acceso.cargar();
    $('#enBoton').disabled = false;
    if (S.acceso) { mostrarPuerta('entrada'); setTimeout(() => $('#enClave').focus(), 50); }
    else mostrarPuerta('preparar');
  }

  function entrarApp() {
    const cache = S.recordar ? leer(LS.datos) : null;
    if (cache && cache.data) { S.data = cache.data; S.sync = new Date(cache.sync); }
    $('#entrada').hidden = true; $('#preparar').hidden = true; $('#app').hidden = false;
    if (S.data) { ajustarFiltros(); render(); estado('Datos de las ' + hora(S.sync)); }
    sincronizar(true);
  }

  function mostrarPuerta(cual, error) {
    $('#app').hidden = true;
    $('#entrada').hidden = cual !== 'entrada';
    $('#preparar').hidden = cual !== 'preparar';
    $('#irEntrada').hidden = !S.acceso;
    if (cual === 'entrada') $('#enError').textContent = error || '';
    if (cual === 'preparar') $('#prError').textContent = error || '';
  }

  function guardarSesion(cx, recordar) {
    S.cx = cx; S.recordar = recordar;
    if (recordar) { guardar(LS.cx, cx); SS.borrar(LS.cx); }
    else { SS.guardar(LS.cx, cx); borrarLS(LS.cx); borrarLS(LS.datos); }
  }

  function cerrarSesion() {
    [LS.cx, LS.datos, LS.ultCat].forEach(borrarLS); SS.borrar(LS.cx);
    S.cx = null; S.data = null; S.sync = null;
    cerrarHojas();
    $('#enClave').value = '';
  }

  async function claveCaducada() {
    cerrarSesion();
    S.acceso = S.acceso || await Acceso.cargar();
    mostrarPuerta('preparar', 'La clave de Apps Script ya no es válida (¿la has cambiado?). Vuelve a preparar el acceso con la clave nueva.');
  }

  async function entrar(e) {
    e.preventDefault();
    const clave = $('#enClave').value;
    if (!clave) { $('#enError').textContent = 'Escribe tu contraseña.'; return; }
    const b = $('#enBoton'); b.disabled = true; b.textContent = 'Comprobando…'; $('#enError').textContent = '';
    try {
      if (!S.acceso) S.acceso = await Acceso.cargar();
      if (!S.acceso) { mostrarPuerta('preparar', 'Todavía no hay ningún acceso preparado. Hazlo aquí una vez.'); return; }
      const cx = await Acceso.descifrar(S.acceso, clave);
      guardarSesion(cx, $('#enRecordar').checked);
      $('#enClave').value = '';
      entrarApp();
    } catch (err) {
      $('#enError').textContent = err.message === 'CLAVE' ? 'Esa no es la contraseña. Prueba otra vez.' : 'No se ha podido comprobar: ' + err.message;
      $('#enClave').select();
    } finally { b.disabled = false; b.textContent = 'Entrar'; }
  }

  function revisarClaves(c1, c2) {
    if (c1.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (c1 !== c2) return 'Las dos contraseñas no coinciden.';
    return '';
  }

  function descargarAcceso(acc) {
    descargar(new TextEncoder().encode(JSON.stringify(acc, null, 1)), 'acceso.json', 'application/json');
  }

  async function preparar(e) {
    e.preventDefault();
    const url = $('#prUrl').value.trim(), token = $('#prToken').value.trim();
    const c1 = $('#prClave1').value, c2 = $('#prClave2').value;
    let err = '';
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(url)) err = 'La dirección debe ser la de la aplicación web de Apps Script y terminar en /exec.';
    else if (token.length < 20) err = 'La clave de Apps Script es la cadena larga que tienes en el editor (mínimo 20 caracteres).';
    else err = revisarClaves(c1, c2);
    if (err) { $('#prError').textContent = err; return; }
    const b = $('#prBoton'); b.disabled = true; $('#prError').textContent = '';
    try {
      b.textContent = 'Comprobando la conexión…';
      S.cx = { url, token };
      try { await api('ping'); } catch (e2) { S.cx = null; throw new Error(e2.code === 'AUTH' ? 'La clave de Apps Script no es correcta.' : e2.message); }
      b.textContent = 'Cifrando…';
      S.accesoNuevo = await Acceso.cifrar(S.cx, c1);
      S.acceso = S.accesoNuevo;
      guardarSesion(S.cx, true);
      ['#prToken', '#prClave1', '#prClave2'].forEach(s => { $(s).value = ''; });
      descargarAcceso(S.accesoNuevo);
      entrarApp();
      abrirHoja('#hojaSubir');
    } catch (e2) { $('#prError').textContent = e2.message; }
    finally { b.disabled = false; b.textContent = 'Crear acceso y entrar'; }
  }

  async function cambiarClave(e) {
    e.preventDefault();
    const err = revisarClaves($('#ccClave1').value, $('#ccClave2').value);
    if (err) { $('#ccError').textContent = err; return; }
    const b = $('#ccBoton'); b.disabled = true; b.textContent = 'Cifrando…';
    try {
      S.accesoNuevo = await Acceso.cifrar(S.cx, $('#ccClave1').value);
      $('#ccClave1').value = ''; $('#ccClave2').value = '';
      cerrarHojas();
      descargarAcceso(S.accesoNuevo);
      abrirHoja('#hojaSubir');
    } catch (e2) { $('#ccError').textContent = e2.message; }
    finally { b.disabled = false; b.textContent = 'Crear archivo nuevo'; }
  }

  /* ---------------- instalar ---------------- */
  function pintarInstalar() {
    const st = Acceso.estadoInstalar();
    const html = {
      boton: '<p><b>Tenla en tu pantalla de inicio</b> y ábrela como una app más.</p><button type="button" class="btn primario" data-accion="instalar">Instalar app</button>',
      ios: '<p><b>Tenla en tu pantalla de inicio:</b> en Safari pulsa el botón <b>Compartir</b> <span class="ico-compartir" aria-hidden="true"></span> y luego <b>«Añadir a pantalla de inicio»</b>.</p>',
      manual: '<p><b>Tenla en tu pantalla de inicio:</b> abre el menú del navegador <b>⋮</b> y elige <b>«Instalar aplicación»</b> o <b>«Añadir a pantalla de inicio»</b>.</p>',
      hecho: ''
    }[st.modo];
    $$('[data-instalar]').forEach(el => { el.innerHTML = html; el.hidden = !html; });
  }

  /* ---------------- filtros ---------------- */
  function ajustarFiltros() {
    if (!leer(LS.filtros)) { // primera vez: el año más reciente con datos
      const a = Core.aniosConDatos(S.data.movs);
      S.F.anio = a.length ? a[a.length - 1] : 'all';
    }
    const validas = new Set(S.data.cats.map(c => Core.claveCat(c.tipo, c.nombre)));
    S.F.cats = S.F.cats.filter(k => validas.has(k));
  }
  function setFiltro(cambio) {
    Object.assign(S.F, cambio);
    if (cambio.tipo && cambio.tipo !== 'all') S.F.cats = S.F.cats.filter(k => k.startsWith(cambio.tipo + '|'));
    S.limite = 150;
    guardar(LS.filtros, S.F);
    render();
  }
  function pintarFiltros() {
    const anios = Core.aniosConDatos(S.data.movs);
    const hoy = new Date().getFullYear();
    if (anios.indexOf(hoy) < 0) anios.push(hoy);
    if (S.F.anio !== 'all' && anios.indexOf(S.F.anio) < 0) anios.push(S.F.anio);
    anios.sort((a, b) => b - a);
    $('#fAnio').innerHTML = '<option value="all">Todos los años</option>' + anios.map(a => `<option value="${a}">${a}</option>`).join('');
    $('#fAnio').value = String(S.F.anio);
    $('#fMes').innerHTML = '<option value="all">Todo el año</option>' + Core.MESES.map((m, i) => `<option value="${i + 1}">${Core.cap(m)}</option>`).join('');
    $('#fMes').value = String(S.F.mes);
    $('#fTipo').value = S.F.tipo;
    const n = S.F.cats.length;
    $('#fCats').textContent = n === 0 ? 'Todas las categorías' : n === 1 ? S.F.cats[0].split('|')[1] : n + ' categorías';
    $('#fCats').classList.toggle('activo', n > 0);
    const hayFiltros = S.F.mes !== 'all' || Core.hayFiltroDeContenido(S.F);
    $('#fLimpiar').hidden = !hayFiltros;
    $('#filtros').hidden = S.vista === 'ajustes';
  }

  /* ---------------- render ---------------- */
  function render() {
    if (!S.data) return;
    pintarFiltros();
    pintarSaldo();
    if (S.vista === 'resumen') pintarResumen();
    if (S.vista === 'movs') pintarLista();
    if (S.vista === 'informes') pintarInformes();
    if (S.vista === 'ajustes') pintarAjustes();
  }

  function manana() { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${Core.pad2(d.getMonth() + 1)}-${Core.pad2(d.getDate())}`; }

  function pintarSaldo() {
    const { cfg, movs } = S.data;
    const c = Core.saldoAntes(movs, cfg, manana());
    const el = $('#saldoNum');
    el.textContent = Core.eurC(c);
    el.classList.toggle('neg', c < 0);
    const [y, m, d] = cfg.fecha_saldo_inicial.split('-');
    $('#saldoSub').textContent = `Partiendo de ${Core.eur(cfg.saldo_inicial)} el ${d}/${m}/${y}`;
  }

  function pintarResumen() {
    const { cfg, cats, movs } = S.data;
    const F = S.F;
    const k = Core.kpis(movs, cfg, F);
    const item = (et, c, cls) => `<div class="${cls || ''}"><dt>${et}</dt><dd class="num">${c === null ? '—' : Core.eurC(c)}</dd></div>`;
    $('#kpis').innerHTML =
      (k.ini !== null ? item('Saldo al empezar', k.ini) : '') +
      item('Ingresos', k.ing, 'ing') + item('Gastos', k.gas, 'gas') +
      item('Ingresos − gastos', k.res, k.res < 0 ? 'res neg' : 'res') +
      (k.fin !== null ? item('Saldo al terminar', k.fin, 'fin') : '');
    $('#kpiNota').hidden = !k.filtrado;
    $('#kpiNota').textContent = 'Ingresos y gastos según los filtros. Los saldos son siempre los de la cuenta completa.';

    // evolución mensual (ignora el filtro de mes para dar contexto)
    const serie = Core.serieMensual(movs, cfg, F);
    const variosAnios = new Set(serie.map(x => x.y)).size > 1;
    const dat = serie.map(x => ({ ym: x.ym, et: Core.etiquetaMes(x.ym, variosAnios).slice(0, variosAnios ? 6 : 3), ing: x.ing / 100, gas: x.gas / 100, res: x.res / 100, v: x.fin / 100 }));
    const nombreMes = ym => Core.cap(Core.MESES[+ym.slice(5) - 1]) + ' ' + ym.slice(0, 4);
    const vacio = '<p class="vacio">No hay movimientos en este periodo.</p>';
    $('#gMeses').innerHTML = dat.length ? '' : vacio;
    $('#gSaldo').innerHTML = dat.length ? '' : vacio;
    Charts.columnas($('#gMeses'), dat, {
      aria: 'Ingresos y gastos por mes',
      html: d => `<b>${nombreMes(d.ym)}</b><span><i style="background:var(--c-ingreso)"></i>Ingresos ${Core.eur(d.ing)}</span><span><i style="background:var(--c-gasto)"></i>Gastos ${Core.eur(d.gas)}</span><span>Resultado ${Core.eur(d.res)}</span>`
    });
    Charts.linea($('#gSaldo'), dat, {
      aria: 'Saldo a final de cada mes', fmt: v => Core.eur(v),
      html: d => `<b>${nombreMes(d.ym)}</b><span>Saldo final ${Core.eur(d.v)}</span>`
    });
    const tabla = (cab, filas) => `<table class="tabla"><thead><tr>${cab.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${filas.map(f => `<tr>${f.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    $('#tMeses').innerHTML = tabla(['Mes', 'Ingresos', 'Gastos', 'Resultado'], dat.map(d => [nombreMes(d.ym), Core.eur(d.ing), Core.eur(d.gas), Core.eur(d.res)]));
    $('#tSaldo').innerHTML = tabla(['Mes', 'Saldo final'], dat.map(d => [nombreMes(d.ym), Core.eur(d.v)]));

    // por categoría (respeta todos los filtros)
    const lista = Core.filtrar(movs, F);
    for (const [tipo, id, tot, color] of [['gasto', '#gCatGas', '#gGasTot', '--c-gasto'], ['ingreso', '#gCatIng', '#gIngTot', '--c-ingreso']]) {
      const filas = Core.porCategoria(lista, cats, tipo, false).sort((a, b) => b.c - a.c).map(r => ({ nombre: r.nombre, v: r.c / 100 }));
      const total = filas.reduce((s, r) => s + r.v, 0);
      $(id).closest('figure').hidden = F.tipo !== 'all' && F.tipo !== tipo;
      $(tot).textContent = total ? 'Total ' + Core.eur(total) : '';
      Charts.barras($(id), filas, { color, total, fmt: v => Core.eur(v), vacio: tipo === 'gasto' ? 'Sin gastos en este periodo.' : 'Sin ingresos en este periodo.' });
    }
  }

  function pintarLista() {
    const q = $('#buscar').value.trim().toLowerCase();
    let lista = Core.ordenar(Core.filtrar(S.data.movs, S.F)).reverse();
    if (q) lista = lista.filter(m => (m.concepto + ' ' + m.categoria).toLowerCase().includes(q));
    const ol = $('#lista');
    if (!lista.length) {
      ol.innerHTML = `<li class="vacio">${q ? 'Ningún movimiento coincide con la búsqueda.' : 'No hay movimientos con estos filtros. Pulsa «Anotar» para añadir uno.'}</li>`;
      $('#masMovs').hidden = true; return;
    }
    // totales por mes para los separadores
    const porMes = {};
    lista.forEach(m => { const k = m.fecha.slice(0, 7); porMes[k] = (porMes[k] || 0) + (m.tipo === 'ingreso' ? 1 : -1) * Core.cents(m.importe); });
    let html = '', mesAct = '';
    lista.slice(0, S.limite).forEach(m => {
      const ym = m.fecha.slice(0, 7);
      if (ym !== mesAct) {
        mesAct = ym;
        html += `<li class="sep"><span>${Core.cap(Core.MESES[+ym.slice(5) - 1])} ${ym.slice(0, 4)}</span><span class="num">${Core.eurC(porMes[ym])}</span></li>`;
      }
      const ing = m.tipo === 'ingreso';
      html += `<li><button type="button" class="mov" data-id="${esc(m.id)}">
        <span class="mov-txt"><span class="mov-con">${esc(m.concepto || m.categoria)}</span><span class="mov-sub">${esc(m.categoria)} · ${esc(Core.fmtFecha(m))}</span></span>
        <span class="mov-imp num ${ing ? 'ing' : 'gas'}">${ing ? '+' : '−'}${esc(Core.eur(m.importe))}</span></button></li>`;
    });
    ol.innerHTML = html;
    $('#masMovs').hidden = lista.length <= S.limite;
  }

  /* ---------------- informes ---------------- */
  function ctxInforme() { return { cfg: S.data.cfg, cats: S.data.cats, movs: S.data.movs, F: S.F }; }

  function pintarInformes() {
    const fs = $('#tiposInforme');
    if (!fs.querySelector('input')) {
      fs.insertAdjacentHTML('beforeend', Core.INFORMES.map(i =>
        `<label class="tipo"><input type="radio" name="inf" value="${i.id}"><span><b>${i.nombre}</b><small>${i.desc}</small></span></label>`).join(''));
      fs.addEventListener('change', e => { S.informe = e.target.value; pintarInformes(); });
    }
    fs.querySelector(`input[value="${S.informe}"]`).checked = true;
    const doc = Core.construirInforme(S.informe, ctxInforme());
    const per = Core.periodoDeInforme(S.informe, S.F, S.data.movs);
    let txt = 'Periodo: ' + Core.etiquetaPeriodo(per.anio, per.mes) + '.';
    if (S.informe === 'mensual' && (S.F.anio === 'all' || S.F.mes === 'all'))
      txt += ' Este informe es de un mes concreto: uso el último con datos. Elige otro con los filtros de arriba.';
    if (['anual', 'meses', 'catmeses'].indexOf(S.informe) >= 0) {
      if (S.F.anio === 'all') txt += ' Este informe es de un año: uso el más reciente. Elige otro con el filtro de año.';
      else if (S.F.mes !== 'all') txt += ' Es del año completo; el filtro de mes no se aplica.';
    }
    if (S.informe === 'secretario' && Core.hayFiltroDeContenido(S.F)) txt += ' Incluye siempre todas las categorías (no aplica los filtros de tipo ni de categoría).';
    $('#infPeriodo').textContent = txt;
    ['#btnPdf', '#btnXlsx', '#btnCompartir'].forEach(s => { $(s).disabled = !!doc.vacio; });
    $('#previa').innerHTML = doc.vacio ? '<p class="vacio">No hay movimientos en este periodo.</p>' : docHtml(doc);
    $('#btnCompartir').hidden = !puedeCompartir();
  }

  function docHtml(doc) {
    const meta = doc.meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(Core.textoCelda(v))}</dd></div>`).join('');
    const secs = doc.secciones.map(sec => {
      const cab = sec.sinCabecera ? '' : `<thead><tr>${sec.cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead>`;
      const filas = sec.filas.map(f => `<tr class="${f.k || ''}">${f.c.map((c, j) => `<td class="${(sec.cols[j] || {}).num || (c && typeof c === 'object') ? 'num' : ''}">${esc(Core.textoCelda(c, sec))}</td>`).join('')}</tr>`).join('');
      return `<div class="p-sec ${sec.sinCabecera && sec.cols.length <= 3 ? 'estrecha' : ''}">${sec.titulo ? `<h4 class="tono-${sec.tono}">${esc(sec.titulo)}</h4>` : ''}<div class="desliza"><table class="tabla">${cab}<tbody>${filas}</tbody></table></div></div>`;
    }).join('');
    const notas = (doc.notas || []).map(n => `<p class="nota">${esc(n)}</p>`).join('');
    return `<h3>${esc(doc.titulo)}</h3><dl class="p-meta">${meta}</dl>${secs}${notas}`;
  }

  let pdfLibP = null;
  function cargarPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return pdfLibP || (pdfLibP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdf-lib.min.js';
      s.onload = () => res(window.PDFLib);
      s.onerror = () => { pdfLibP = null; rej(new Error('No se pudo cargar el generador de PDF. Revisa la conexión.')); };
      document.head.appendChild(s);
    }));
  }
  async function pdfDe(doc) { return PDFW.crearPdf(doc, Core.textoCelda, await cargarPdfLib()); }

  function descargar(bytes, nombre, tipo) {
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
  }
  const MIME_PDF = 'application/pdf', MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  function puedeCompartir() {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: MIME_PDF })] })); } catch (e) { return false; }
  }

  async function conBoton(btn, fn) {
    const txt = btn.textContent; btn.disabled = true; btn.textContent = 'Preparando…';
    try { await fn(); } catch (e) { if (e && e.name !== 'AbortError') aviso(e.message || String(e), true); }
    finally { btn.disabled = false; btn.textContent = txt; }
  }

  /* ---------------- ajustes ---------------- */
  function pintarAjustes() {
    const { cfg, cats, movs } = S.data;
    const [y, m, d] = cfg.fecha_saldo_inicial.split('-');
    const fila = (k, v) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
    $('#ajustesDatos').innerHTML = fila('Nombre', cfg.nombre || '—') + fila('Saldo de partida', `${Core.eur(cfg.saldo_inicial)} el ${d}/${m}/${y}`) +
      fila('Categorías', `${cats.filter(c => c.tipo === 'gasto').length} de gasto · ${cats.filter(c => c.tipo === 'ingreso').length} de ingreso`) +
      fila('Movimientos', movs.length) + fila('Última actualización', S.sync ? S.sync.toLocaleString('es-ES') : '—');
    $('#ajSesion').textContent = S.recordar
      ? 'Este dispositivo recuerda tu sesión: entras directamente al abrir la app.'
      : 'Este dispositivo te pide la contraseña cada vez que abres la app.';
  }

  /* ---------------- hoja de movimiento ---------------- */
  function abrirMov(mov) {
    S.editando = mov || null;
    const f = $('#formMov');
    $('#tMov').textContent = mov ? 'Editar movimiento' : 'Anotar';
    const tipo = mov ? mov.tipo : (f.tipo.value || 'gasto');
    f.querySelector(`input[name="tipo"][value="${tipo}"]`).checked = true;
    rellenarCategorias(tipo, mov ? mov.categoria : null);
    $('#mImporte').value = mov ? String(mov.importe).replace('.', ',') : '';
    $('#mConcepto').value = mov ? mov.concepto : '';
    $('#mFecha').value = mov ? mov.fecha : hoyIso();
    $('#mBorrar').hidden = !mov; $('#mBorrar').dataset.confirmar = '';
    $('#mBorrar').textContent = 'Eliminar';
    $('#mOtro').hidden = !!mov;
    $('#mError').textContent = '';
    if (mov && mov.origen === 'migración') $('#mError').textContent = 'Este movimiento viene de las pestañas antiguas y no tenía día: revisa la fecha si la cambias.';
    abrirHoja('#hojaMov');
    setTimeout(() => $('#mImporte').focus(), 60);
  }
  function hoyIso() { const d = new Date(); return `${d.getFullYear()}-${Core.pad2(d.getMonth() + 1)}-${Core.pad2(d.getDate())}`; }

  function rellenarCategorias(tipo, elegida) {
    const ult = (leer(LS.ultCat) || {})[tipo];
    const nombres = Core.catsDe(S.data.cats, tipo);
    const sel = $('#mCategoria');
    const actual = elegida || (nombres.indexOf(ult) >= 0 ? ult : '');
    sel.innerHTML = '<option value="" disabled>Elige una categoría</option>' + nombres.map(n => `<option>${esc(n)}</option>`).join('');
    sel.value = actual;
    rellenarConceptos();
  }
  function rellenarConceptos() {
    const cat = $('#mCategoria').value;
    const vistos = new Set();
    Core.ordenar(S.data.movs).reverse().forEach(m => { if ((!cat || m.categoria === cat) && m.concepto && vistos.size < 40) vistos.add(m.concepto); });
    $('#conceptos').innerHTML = [...vistos].map(c => `<option value="${esc(c)}">`).join('');
  }

  function leerImporte(s) {
    s = String(s).replace(/[\s€]/g, '');
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
  }

  async function guardarMov(e) {
    e.preventDefault();
    const f = $('#formMov');
    const otro = e.submitter && e.submitter.dataset.otro === '1';
    const mov = {
      tipo: f.tipo.value, categoria: $('#mCategoria').value, concepto: $('#mConcepto').value.trim(),
      importe: leerImporte($('#mImporte').value), fecha: $('#mFecha').value
    };
    const err = !(mov.importe > 0) ? 'Escribe un importe mayor que 0 (por ejemplo 12,50).' :
      !mov.categoria ? 'Elige una categoría.' : !/^\d{4}-\d{2}-\d{2}$/.test(mov.fecha) ? 'Elige una fecha.' : '';
    if (err) { $('#mError').textContent = err; return; }
    const botones = $$('#formMov .hoja-pie .btn'); botones.forEach(b => { b.disabled = true; });
    $('#mError').textContent = '';
    try {
      if (S.editando) {
        const j = await api('update', { id: S.editando.id, mov });
        const i = S.data.movs.findIndex(m => m.id === S.editando.id);
        if (i >= 0) S.data.movs[i] = j.mov;
        aviso('Cambios guardados');
      } else {
        const j = await api('add', { mov });
        S.data.movs.push(j.mov);
        const u = leer(LS.ultCat) || {}; u[mov.tipo] = mov.categoria; guardar(LS.ultCat, u);
        aviso((mov.tipo === 'gasto' ? 'Gasto' : 'Ingreso') + ' guardado: ' + Core.eur(mov.importe));
      }
      guardarDatos();
      render();
      if (otro) { $('#mImporte').value = ''; $('#mConcepto').value = ''; rellenarConceptos(); $('#mImporte').focus(); }
      else cerrarHojas();
    } catch (e2) {
      if (e2.code === 'AUTH') claveCaducada();
      else $('#mError').textContent = e2.message;
    } finally { botones.forEach(b => { b.disabled = false; }); }
  }

  async function borrarMov() {
    const b = $('#mBorrar');
    if (!b.dataset.confirmar) {
      b.dataset.confirmar = '1'; b.textContent = 'Pulsa otra vez para eliminar';
      setTimeout(() => { b.dataset.confirmar = ''; b.textContent = 'Eliminar'; }, 4000);
      return;
    }
    b.disabled = true;
    try {
      await api('delete', { id: S.editando.id });
      S.data.movs = S.data.movs.filter(m => m.id !== S.editando.id);
      guardarDatos();
      cerrarHojas(); render(); aviso('Movimiento eliminado');
    } catch (e) { $('#mError').textContent = e.message; }
    finally { b.disabled = false; }
  }

  /* ---------------- hoja de categorías ---------------- */
  function abrirCats() {
    const grupos = [['gasto', 'Gastos'], ['ingreso', 'Ingresos']].filter(([t]) => S.F.tipo === 'all' || S.F.tipo === t);
    $('#listaCats').innerHTML = grupos.map(([t, et]) => `<fieldset><legend>${et}</legend>` +
      Core.catsDe(S.data.cats, t).map(n => { const k = Core.claveCat(t, n); return `<label class="chk"><input type="checkbox" value="${esc(k)}"${S.F.cats.indexOf(k) >= 0 ? ' checked' : ''}><span>${esc(n)}</span></label>`; }).join('') +
      '</fieldset>').join('');
    abrirHoja('#hojaCats');
  }

  /* ---------------- hojas, avisos, navegación ---------------- */
  let foco = null;
  function abrirHoja(sel) { foco = document.activeElement; $(sel).hidden = false; document.body.classList.add('con-hoja'); }
  function cerrarHojas() { $$('.hoja-fondo').forEach(h => { h.hidden = true; }); document.body.classList.remove('con-hoja'); if (foco && foco.focus) foco.focus(); }

  let tAviso;
  function aviso(txt, error) {
    const a = $('#aviso');
    a.textContent = txt; a.classList.toggle('error', !!error); a.hidden = false;
    clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, error ? 6000 : 2800);
  }

  function irA(v) {
    S.vista = v;
    $$('.vista').forEach(s => { s.hidden = s.id !== 'v-' + v; });
    $$('.pestanas button').forEach(b => { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('#saldoHoy').hidden = v !== 'resumen';
    render();
    window.scrollTo(0, 0);
  }

  function enlazar() {
    $('#formEntrada').addEventListener('submit', entrar);
    $('#formPreparar').addEventListener('submit', preparar);
    $('#formClave').addEventListener('submit', cambiarClave);
    $('#irPreparar').addEventListener('click', () => mostrarPuerta('preparar'));
    $('#irEntrada').addEventListener('click', () => mostrarPuerta('entrada'));
    $$('[data-ver]').forEach(b => b.addEventListener('click', () => {
      const i = document.getElementById(b.dataset.ver);
      const ver = i.type === 'password';
      i.type = ver ? 'text' : 'password';
      b.textContent = ver ? 'Ocultar' : 'Ver';
      i.focus();
    }));
    document.addEventListener('click', async e => {
      if (!e.target.closest('[data-accion="instalar"]')) return;
      if (await Acceso.instalar()) aviso('Instalada. Ya la tienes en tu pantalla de inicio.');
    });
    $('#btnCambiarClave').addEventListener('click', () => { $('#ccError').textContent = ''; abrirHoja('#hojaClave'); setTimeout(() => $('#ccClave1').focus(), 60); });
    $('#btnBajarOtra').addEventListener('click', () => { if (S.accesoNuevo) descargarAcceso(S.accesoNuevo); });
    $('#btnSalir').addEventListener('click', async () => {
      cerrarSesion();
      S.acceso = S.acceso || await Acceso.cargar();
      mostrarPuerta(S.acceso ? 'entrada' : 'preparar');
    });

    $('#btnRecargar').addEventListener('click', () => sincronizar(false));
    $('#fAnio').addEventListener('change', e => setFiltro({ anio: e.target.value === 'all' ? 'all' : +e.target.value }));
    $('#fMes').addEventListener('change', e => setFiltro({ mes: e.target.value === 'all' ? 'all' : +e.target.value }));
    $('#fTipo').addEventListener('change', e => setFiltro({ tipo: e.target.value }));
    $('#fCats').addEventListener('click', abrirCats);
    $('#fLimpiar').addEventListener('click', () => setFiltro({ mes: 'all', tipo: 'all', cats: [] }));
    $('#listaCats').addEventListener('change', () => setFiltro({ cats: $$('#listaCats input:checked').map(i => i.value) }));
    $('#catsNinguna').addEventListener('click', () => { $$('#listaCats input').forEach(i => { i.checked = false; }); setFiltro({ cats: [] }); });

    $$('.pestanas button').forEach(b => b.addEventListener('click', () => irA(b.dataset.v)));
    $('#fab').addEventListener('click', () => abrirMov(null));
    $('#lista').addEventListener('click', e => {
      const b = e.target.closest('.mov'); if (!b) return;
      abrirMov(S.data.movs.find(m => m.id === b.dataset.id));
    });
    $('#masMovs').addEventListener('click', () => { S.limite += 150; pintarLista(); });
    let tBus; $('#buscar').addEventListener('input', () => { clearTimeout(tBus); tBus = setTimeout(pintarLista, 150); });

    $('#formMov').addEventListener('submit', guardarMov);
    $$('#formMov input[name="tipo"]').forEach(r => r.addEventListener('change', () => rellenarCategorias(r.value, null)));
    $('#mCategoria').addEventListener('change', rellenarConceptos);
    $('#mBorrar').addEventListener('click', borrarMov);
    $$('[data-cerrar]').forEach(b => b.addEventListener('click', cerrarHojas));
    $$('.hoja-fondo').forEach(h => h.addEventListener('click', e => { if (e.target === h) cerrarHojas(); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHojas(); });

    $('#btnPdf').addEventListener('click', e => conBoton(e.currentTarget, async () => {
      const doc = Core.construirInforme(S.informe, ctxInforme());
      descargar(await pdfDe(doc), doc.archivo + '.pdf', MIME_PDF);
    }));
    $('#btnXlsx').addEventListener('click', e => conBoton(e.currentTarget, async () => {
      const doc = Core.construirInforme(S.informe, ctxInforme());
      descargar(XLSXW.crearXlsx([doc], Core.textoCelda), doc.archivo + '.xlsx', MIME_XLSX);
    }));
    $('#btnTodoXlsx').addEventListener('click', e => conBoton(e.currentTarget, async () => {
      const docs = Core.INFORMES.map(i => Core.construirInforme(i.id, ctxInforme())).filter(d => !d.vacio);
      if (!docs.length) throw new Error('No hay movimientos en este periodo.');
      descargar(XLSXW.crearXlsx(docs, Core.textoCelda), `Informes_${Core.slugPeriodo(S.F.anio, S.F.mes)}.xlsx`, MIME_XLSX);
    }));
    $('#btnCompartir').addEventListener('click', e => conBoton(e.currentTarget, async () => {
      const doc = Core.construirInforme(S.informe, ctxInforme());
      const file = new File([await pdfDe(doc)], doc.archivo + '.pdf', { type: MIME_PDF });
      await navigator.share({ files: [file], title: doc.titulo });
    }));

    let tRes;
    window.addEventListener('resize', () => { clearTimeout(tRes); tRes = setTimeout(() => { if (S.vista === 'resumen' && S.data) pintarResumen(); }, 150); });
    document.addEventListener('visibilitychange', () => { // al volver a la app, refrescar si han pasado 5 min
      if (document.visibilityState === 'visible' && S.cx && S.sync && Date.now() - S.sync > 5 * 60 * 1000) sincronizar(true);
    });
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  iniciar();
})();
