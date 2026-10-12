// Conexión con el Apps Script, login con Google y sesión guardada en el dispositivo.
// La usan las dos páginas: index.html (carga) y admin.html (dashboard).
// Modo demo, solo en localhost: agregá ?demo a la URL y la app usa un backend falso en el navegador
// (assets/demo.js), sin Google ni Apps Script. Sirve para probar la interfaz.
window.Horas = (() => {
  const CFG = window.CONFIG_HORAS || {};
  const DEMO = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('demo');
  const K = { sesion: 'horas.sesion', datos: 'horas.datos' };
  const $ = id => document.getElementById(id);

  const local = {
    leer(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    escribir(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio o bloqueado */ } },
    borrar(k) { try { localStorage.removeItem(k); } catch (e) { /* bloqueado */ } },
  };

  // Sin red: la app guarda lo cargado y lo manda después. ErrorApi: el servidor contestó que no.
  class SinConexion extends Error {}
  class ErrorApi extends Error {
    constructor(r) {
      super(r.mensaje || 'No se pudo completar la operación.');
      this.codigo = r.error;
    }
  }

  let alSalirDeSesion = () => location.reload();

  async function llamar(accion, datos = {}) {
    const cuerpo = Object.assign({ accion, sesion: local.leer(K.sesion) }, datos);
    let r;
    if (DEMO) {
      r = await window.HorasDemo.llamar(cuerpo);
    } else {
      let res;
      try {
        res = await fetch(CFG.ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(cuerpo),
          cache: 'no-store',
        });
      } catch (e) {
        throw new SinConexion('sin_conexion');
      }
      try {
        r = await res.json();
      } catch (e) {
        throw new ErrorApi({ error: 'interno', mensaje: 'El servidor no respondió bien. Probá de nuevo en un rato.' });
      }
    }
    if (!r.ok && r.error === 'sesion') {
      local.borrar(K.sesion);
      alSalirDeSesion();
    }
    if (!r.ok) throw new ErrorApi(r);
    return r;
  }

  function vista(nombre) {
    ['vistaCargando', 'vistaLogin', 'vistaApp', 'vistaAviso'].forEach(v => {
      if ($(v)) $(v).classList.toggle('hidden', v !== nombre);
    });
  }

  function aviso(titulo, texto) {
    $('avisoTitulo').textContent = titulo;
    $('avisoTexto').textContent = texto;
    vista('vistaAviso');
  }

  // Muestra el login o entra directo si hay sesión. alEntrar recibe {persona, proyectos, tareas, hoy, ...}.
  async function iniciar({ alEntrar }) {
    if (!DEMO && (!CFG.ENDPOINT || !CFG.GOOGLE_CLIENT_ID)) {
      return aviso('Falta configurar la app', 'Completá ENDPOINT y GOOGLE_CLIENT_ID en assets/config.js (ver README.md).');
    }
    if (DEMO) await cargarScript('assets/demo.js');
    registrarServiceWorker();

    const entrar = datos => {
      local.escribir(K.datos, datos);
      document.querySelectorAll('[data-nombre]').forEach(el => { el.textContent = datos.persona.nombre; });
      document.querySelectorAll('[data-solo-gerencia]').forEach(el => el.classList.toggle('hidden', datos.persona.rol === 'empleado'));
      vista('vistaApp');
      alEntrar(datos);
    };
    alSalirDeSesion = () => mostrarLogin(entrar, 'Tu sesión venció. Volvé a entrar.');

    // Vuelta del login de Google en modo redirect (iPhone con la app instalada): /#c=<token>
    const m = location.hash.match(/^#c=([^&]+)/);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      return canjear(decodeURIComponent(m[1]), entrar);
    }

    if (!local.leer(K.sesion)) return mostrarLogin(entrar);
    vista('vistaCargando');
    try {
      entrar(await llamar('datos'));
    } catch (e) {
      const guardados = local.leer(K.datos);
      if (e instanceof SinConexion && guardados) return entrar(guardados);
      if (e instanceof ErrorApi && e.codigo === 'sesion') return; // ya se mostró el login
      aviso('No se pudo abrir la app', e instanceof SinConexion ? 'Revisá tu conexión y volvé a abrirla.' : e.message);
    }
  }

  async function canjear(credential, entrar) {
    vista('vistaCargando');
    try {
      const r = await llamar('login', { credential });
      local.escribir(K.sesion, r.sesion);
      delete r.sesion;
      entrar(r);
    } catch (e) {
      if (e.codigo === 'no_habilitado') {
        return mostrarLogin(entrar, 'Tu cuenta de Google no está habilitada. Pedile a gerencia que te sume con ese email.');
      }
      mostrarLogin(entrar, e instanceof SinConexion ? 'Sin conexión. Probá de nuevo cuando tengas señal.' : 'No se pudo entrar con Google. Probá de nuevo.');
    }
  }

  async function mostrarLogin(entrar, error) {
    vista('vistaLogin');
    $('loginError').textContent = error || '';
    $('loginError').classList.toggle('hidden', !error);
    const boton = $('botonGoogle');
    boton.innerHTML = '';

    if (DEMO) {
      boton.innerHTML = window.HorasDemo.botones();
      boton.querySelectorAll('button').forEach(b => b.addEventListener('click', () => canjear(b.dataset.email, entrar)));
      return;
    }
    try {
      await cargarScript('https://accounts.google.com/gsi/client');
    } catch (e) {
      $('loginError').textContent = 'No se pudo cargar el ingreso con Google. Revisá tu conexión.';
      $('loginError').classList.remove('hidden');
      return;
    }
    // En una app instalada en iPhone las ventanas emergentes no vuelven a la app: usamos redirect.
    const redirect = window.navigator.standalone === true;
    google.accounts.id.initialize({
      client_id: CFG.GOOGLE_CLIENT_ID,
      callback: r => canjear(r.credential, entrar),
      ux_mode: redirect ? 'redirect' : 'popup',
      login_uri: redirect ? location.origin + '/api/google' : undefined,
      auto_select: false,
    });
    google.accounts.id.renderButton(boton, {
      theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'filled_black' : 'outline',
      size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 280,
    });
  }

  function salir() {
    local.borrar(K.sesion);
    local.borrar(K.datos);
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  const scripts = {};
  function cargarScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = ok;
        s.onerror = mal;
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  function registrarServiceWorker() {
    if ('serviceWorker' in navigator && !DEMO) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
    }
  }

  // ---------- utilidades de fechas y formato (zona local del dispositivo) ----------

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const deIso = s => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
  const sumarDias = (s, n) => { const d = deIso(s); d.setDate(d.getDate() + n); return iso(d); };
  const lunes = s => { const d = deIso(s); return sumarDias(s, -((d.getDay() + 6) % 7)); };
  const esHabil = s => { const g = deIso(s).getDay(); return g !== 0 && g !== 6; };
  const fmtHoras = n => (Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const fmtFecha = (s, op) => deIso(s).toLocaleDateString('es-AR', op || { weekday: 'long', day: 'numeric', month: 'long' });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  return {
    DEMO, llamar, iniciar, salir, local, SinConexion, ErrorApi,
    iso, deIso, sumarDias, lunes, esHabil, fmtHoras, fmtFecha, esc,
  };
})();
