/* Mis Cuentas — acceso con una sola contraseña.
   La dirección de la API y la clave de Apps Script se guardan cifradas en acceso.json
   (AES-GCM con una llave derivada de tu contraseña con PBKDF2-SHA256).
   El archivo puede estar a la vista en GitHub: sin la contraseña no se puede leer. */
(function (g) {
  'use strict';
  const ITER = 600000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function llave(clave, sal, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(clave.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: iter, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /** {url, token} + contraseña -> objeto para guardar como acceso.json */
  async function cifrar(cx, clave) {
    const sal = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await llave(clave, sal, ITER);
    const datos = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify({ u: cx.url, t: cx.token }))));
    return { app: 'mis-cuentas', v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, sal: b64(sal), iv: b64(iv), datos: b64(datos) };
  }

  /** acceso.json + contraseña -> {url, token}; lanza Error('CLAVE') si la contraseña no es la buena */
  async function descifrar(acc, clave) {
    const k = await llave(clave, deB64(acc.sal), acc.iter || ITER);
    let claro;
    try { claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(acc.iv) }, k, deB64(acc.datos)); }
    catch (e) { throw new Error('CLAVE'); }
    const o = JSON.parse(dec.decode(claro));
    return { url: o.u, token: o.t };
  }

  /** descarga el archivo; null si todavía no existe */
  async function cargar() {
    try {
      const r = await fetch('acceso.json', { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.app === 'mis-cuentas' && j.datos ? j : null;
    } catch (e) { return null; }
  }

  /* ---------- instalar en la pantalla de inicio ---------- */
  let aviso = null;
  const oyentes = [];
  g.addEventListener('beforeinstallprompt', e => { e.preventDefault(); aviso = e; oyentes.forEach(f => f()); });
  g.addEventListener('appinstalled', () => { aviso = null; oyentes.forEach(f => f()); });
  const instalada = () => g.matchMedia('(display-mode: standalone)').matches || g.navigator.standalone === true;
  const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function estadoInstalar() {
    if (instalada()) return { modo: 'hecho' };
    if (aviso) return { modo: 'boton' };
    if (esIOS()) return { modo: 'ios' };
    return { modo: 'manual' };
  }
  async function instalar() {
    if (!aviso) return false;
    aviso.prompt();
    const r = await aviso.userChoice;
    aviso = null; oyentes.forEach(f => f());
    return r.outcome === 'accepted';
  }

  g.Acceso = { cifrar, descifrar, cargar, estadoInstalar, instalar, alCambiarInstalar: f => oyentes.push(f), instalada };
})(window);
