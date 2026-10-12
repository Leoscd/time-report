// Carga de horas: tira de la semana, día seleccionado y editor de filas.
// Lo que se guarda sin señal queda en una cola en el dispositivo y se manda solo al volver la conexión.
// El id de cada fila lo genera el teléfono, así un reintento nunca duplica la carga.
// Horas extra: las horas del día completan primero la jornada del régimen de la persona, en el orden en
// que se cargaron, y el resto es extra (mismo cálculo que el Apps Script). Sábados, domingos y feriados: todo extra.
(() => {
  const H = window.Horas;
  const $ = id => document.getElementById(id);
  const PASO = 0.5;
  const MAX_FILA = 12;
  const MAX_DIA = 16;

  let D;                     // persona, proyectos, tareas, dias_editables
  let K;                     // claves de guardado local, por persona
  let registros = {};        // id → registro (incluye los que esperan en la cola)
  let cola = [];             // [{tipo: 'guardar' | 'borrar', datos}]
  let semana;                // lunes de la semana visible
  let dia;                   // día seleccionado
  let editando = null;       // fila que se edita, o null si es nueva
  let form = {};
  const traidas = new Map(); // lunes → momento en que se pidió esa semana al servidor
  let instalador = null;

  const hoy = () => H.iso(new Date());
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    instalador = e;
    if (D) instalacion();
  });

  H.iniciar({ alEntrar });

  function alEntrar(datos) {
    D = datos;
    K = { registros: 'horas.registros.' + D.persona.email, cola: 'horas.cola.' + D.persona.email };
    registros = H.local.leer(K.registros) || {};
    cola = H.local.leer(K.cola) || [];
    dia = hoy();
    semana = H.lunes(dia);
    document.querySelector('.marca small').textContent = `${D.persona.nombre} · ${D.persona.regimen} ${H.fmtHoras(D.persona.horas_dia)} h`;
    conectarEventos();
    render();
    traerSemana(semana);
    enviarCola();
    instalacion();
  }

  // ---------- datos ----------

  function persistir() {
    H.local.escribir(K.registros, registros);
    H.local.escribir(K.cola, cola);
  }

  const enCola = id => cola.some(op => op.datos.id === id);
  const delDia = f => Object.values(registros).filter(r => r.fecha === f)
    .sort((a, b) => (a.cargado_en || '9').localeCompare(b.cargado_en || '9') || a.id.localeCompare(b.id));
  const totalDia = (f, excepto) => delDia(f).filter(r => r.id !== excepto).reduce((s, r) => s + Number(r.horas), 0);
  const feriado = f => (D.feriados || []).includes(f);
  const jornada = f => (H.esHabil(f) && !feriado(f) ? D.persona.horas_dia : 0);

  // Horas extra de cada fila del día: id → horas que pasan la jornada.
  function extras(f) {
    const extra = {};
    let resta = jornada(f);
    delDia(f).forEach(r => {
      const normales = Math.min(Number(r.horas), Math.max(resta, 0));
      resta -= normales;
      extra[r.id] = Number(r.horas) - normales;
    });
    return extra;
  }

  const editable = f => f <= hoy() && (D.dias_editables == null || f >= H.sumarDias(hoy(), -D.dias_editables));

  // Trae del servidor la semana y la anterior (para "Repetir día anterior" y los días en rojo).
  async function traerSemana(lunes, forzar) {
    const ultima = traidas.get(lunes);
    if (!forzar && ultima && Date.now() - ultima < 120000) return;
    traidas.set(lunes, Date.now());
    const desde = H.sumarDias(lunes, -7);
    const hasta = H.sumarDias(lunes, 6);
    try {
      const r = await H.llamar('registros', { desde, hasta });
      Object.values(registros).forEach(x => {
        if (x.fecha >= desde && x.fecha <= hasta && !enCola(x.id)) delete registros[x.id];
      });
      r.registros.forEach(x => { if (!enCola(x.id)) registros[x.id] = x; });
      traidas.set(H.sumarDias(lunes, -7), Date.now());
      persistir();
      render();
    } catch (e) {
      traidas.delete(lunes);
      if (!(e instanceof H.SinConexion) && e.codigo !== 'sesion') toast(e.message);
    }
  }

  // Manda una operación. Devuelve 'ok' o 'cola' (sin señal o error pasajero). Tira el error si el
  // servidor la rechaza por una validación, para mostrarlo.
  async function enviar(op) {
    cola = cola.filter(x => x.datos.id !== op.datos.id);
    try {
      const r = await H.llamar(op.tipo, op.datos);
      if (op.tipo === 'guardar') registros[r.registro.id] = r.registro;
      persistir();
      return 'ok';
    } catch (e) {
      if (e instanceof H.SinConexion || e.codigo !== 'validacion') {
        cola.push(op);
        persistir();
        return 'cola';
      }
      throw e;
    }
  }

  let enviando = false;
  async function enviarCola() {
    if (enviando || !cola.length) return;
    enviando = true;
    try {
      for (const op of cola.slice()) {
        try {
          const r = await H.llamar(op.tipo, op.datos);
          if (op.tipo === 'guardar') registros[r.registro.id] = r.registro;
          cola = cola.filter(x => x !== op);
        } catch (e) {
          if (e instanceof H.SinConexion || e.codigo !== 'validacion') break; // se reintenta más tarde
          cola = cola.filter(x => x !== op);
          delete registros[op.datos.id];
          traidas.clear();
          toast(`No se pudo guardar una carga del ${H.fmtFecha(op.datos.fecha || dia, { day: 'numeric', month: 'short' })}: ${e.message}`);
        }
      }
    } finally {
      enviando = false;
      persistir();
      render();
      if (!cola.length) traerSemana(semana, true);
    }
  }

  function nuevoId() {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const b = crypto.getRandomValues(new Uint8Array(16));
    return 'r_' + Array.from(b, x => abc[x % abc.length]).join('');
  }

  function recientes() {
    const vistos = [];
    Object.values(registros)
      .sort((a, b) => (b.fecha + (b.cargado_en || '9')).localeCompare(a.fecha + (a.cargado_en || '9')))
      .forEach(r => { if (!vistos.includes(r.proyecto_codigo)) vistos.push(r.proyecto_codigo); });
    return vistos.filter(c => D.proyectos.some(p => p.codigo === c)).slice(0, 4);
  }

  // ---------- pantalla ----------

  function render() {
    if (!D) return;
    const h = hoy();

    const fin = H.sumarDias(semana, 6);
    const corto = { day: 'numeric', month: 'short' };
    $('semanaTitulo').textContent = semana === H.lunes(h) ? 'Esta semana'
      : `${H.fmtFecha(semana, corto)} – ${H.fmtFecha(fin, corto)}`;
    $('semanaSig').disabled = fin >= h;

    $('dias').innerHTML = Array.from({ length: 7 }, (_, i) => {
      const f = H.sumarDias(semana, i);
      const t = totalDia(f);
      const j = jornada(f);
      const cls = ['dia'];
      if (f === dia) cls.push('sel');
      if (!j) cls.push('finde');
      if (!j && t > 0) cls.push('extra');
      else if (t >= j && t > 0) cls.push('completo');
      else if (t > 0) cls.push('parcial');
      else if (j && f < h && traidas.has(H.lunes(f))) cls.push('falta');
      return `<button type="button" class="${cls.join(' ')}" data-f="${f}" ${f > h ? 'disabled' : ''}>
        <span class="n">${H.fmtFecha(f, { weekday: 'short' }).replace('.', '')}</span>
        <span class="d">${H.deIso(f).getDate()}</span>
        <span class="h num">${t ? H.fmtHoras(t) + ' h' : ''}</span></button>`;
    }).join('');

    const total = totalDia(dia);
    const j = jornada(dia);
    const extraDia = Math.max(0, total - j);
    $('diaTitulo').textContent = (dia === h ? 'Hoy, ' : '') + (dia === h ? H.fmtFecha(dia) : cap(H.fmtFecha(dia)));
    $('diaTotal').innerHTML = (j ? `${H.fmtHoras(total)} / ${H.fmtHoras(j)} h` : `${H.fmtHoras(total)} h`)
      + (extraDia ? ` · <span class="txt-extra">${H.fmtHoras(extraDia)} h extra</span>` : '');
    $('diaBarra').parentElement.classList.toggle('hidden', !j);
    $('diaBarra').style.width = (j ? Math.min(100, total / j * 100) : 0) + '%';
    $('diaNota').classList.toggle('hidden', !!j);
    $('diaNota').textContent = j ? '' : `${feriado(dia) ? 'Feriado' : 'Fin de semana'}: no hay jornada, todas las horas cuentan como extra.`;
    const extra = extras(dia);

    const puede = editable(dia);
    const filas = delDia(dia);
    $('filas').innerHTML = filas.length ? filas.map(r => `
      <button type="button" class="fila" data-id="${H.esc(r.id)}" ${puede ? '' : 'disabled'}>
        <span class="info">
          <span class="proy">${H.esc(r.proyecto_nombre || r.proyecto_codigo)}${enCola(r.id) ? '<span class="pendiente">sin enviar</span>' : ''}</span>
          <span class="det">${H.esc(r.tarea)}${r.nota ? ' · ' + H.esc(r.nota) : ''}</span>
        </span>
        <span class="hs num">${H.fmtHoras(r.horas)} h${extra[r.id] ? `<small class="txt-extra">${H.fmtHoras(extra[r.id])} extra</small>` : ''}</span>
      </button>`).join('')
      : `<div class="vacio">${puede ? 'Todavía no cargaste horas este día.' : 'Sin horas cargadas.'}</div>`;

    $('acciones').classList.toggle('hidden', !puede);
    $('repetir').classList.toggle('hidden', !(puede && !filas.length && diaAnterior()));
    $('soloLectura').classList.toggle('hidden', puede);
    $('soloLectura').textContent = puede ? '' : 'Este día ya no se puede modificar. Si hay que corregir algo, pedíselo a gerencia.';
  }

  // El último día con horas antes del seleccionado (hasta 10 días para atrás).
  function diaAnterior() {
    for (let i = 1; i <= 10; i++) {
      const f = H.sumarDias(dia, -i);
      if (delDia(f).length) return f;
    }
    return null;
  }

  // ---------- editor ----------

  function abrirEditor(reg) {
    editando = reg || null;
    const resto = jornada(dia) - totalDia(dia, reg && reg.id);
    const ult = Object.values(registros).sort((a, b) => (b.cargado_en || '').localeCompare(a.cargado_en || ''))[0];
    form = reg
      ? { proyecto_codigo: reg.proyecto_codigo, tarea: reg.tarea, horas: Number(reg.horas), nota: reg.nota || '' }
      : { proyecto_codigo: recientes()[0] || '', tarea: (ult && ult.tarea) || D.tareas[0], horas: resto >= PASO ? Math.min(resto, 8) : 1, nota: '' };

    $('editorTitulo').textContent = reg ? 'Editar horas' : 'Agregar horas';
    $('borrar').classList.toggle('hidden', !reg);
    $('editorError').classList.add('hidden');

    const rec = recientes();
    const opt = p => `<option value="${H.esc(p.codigo)}">${H.esc(p.codigo)} · ${H.esc(p.nombre)}</option>`;
    const todos = D.proyectos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    let html = '<option value="">Elegí un proyecto…</option>';
    if (reg && !D.proyectos.some(p => p.codigo === reg.proyecto_codigo)) {
      html += opt({ codigo: reg.proyecto_codigo, nombre: reg.proyecto_nombre + ' (cerrado)' });
    }
    if (rec.length) html += `<optgroup label="Últimos usados">${rec.map(c => opt(D.proyectos.find(p => p.codigo === c))).join('')}</optgroup>`;
    html += `<optgroup label="Todos los proyectos">${todos.map(opt).join('')}</optgroup>`;
    $('fProyecto').innerHTML = html;
    $('fProyecto').value = form.proyecto_codigo;

    const tareas = D.tareas.includes(form.tarea) ? D.tareas : D.tareas.concat(form.tarea);
    $('fTareas').innerHTML = tareas.map(t => `<button type="button" class="chip" data-tarea="${H.esc(t)}">${H.esc(t)}</button>`).join('');
    $('fNota').value = form.nota;

    const rapidas = [1, 2, 4, 8];
    let chips = rapidas.map(n => `<button type="button" class="chip" data-h="${n}">${n} h</button>`).join('');
    if (resto >= PASO && !rapidas.includes(resto)) chips += `<button type="button" class="chip" data-h="${resto}">Resto del día: ${H.fmtHoras(resto)} h</button>`;
    $('rapidas').innerHTML = chips;

    pintarEditor();
    $('editor').showModal();
  }

  function pintarEditor() {
    $('fHoras').textContent = H.fmtHoras(form.horas);
    $('fTareas').querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.tarea === form.tarea));
    $('rapidas').querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.h) === form.horas));
    $('menos').disabled = form.horas <= PASO;
    $('mas').disabled = form.horas >= MAX_FILA;
    const total = totalDia(dia, editando && editando.id) + form.horas;
    const j = jornada(dia);
    const extra = Math.max(0, total - j);
    $('editorExtra').classList.toggle('hidden', !extra);
    $('editorExtra').textContent = !extra ? ''
      : j ? `El día queda en ${H.fmtHoras(total)} h: ${H.fmtHoras(extra)} h cuentan como extra (tu jornada es de ${H.fmtHoras(j)} h).`
        : `Día sin jornada: ${H.fmtHoras(extra)} h extra.`;
  }

  function errorEditor(msj) {
    $('editorError').textContent = msj;
    $('editorError').classList.remove('hidden');
  }

  async function guardar() {
    form.proyecto_codigo = $('fProyecto').value;
    form.nota = $('fNota').value.trim();
    if (!form.proyecto_codigo) return errorEditor('Elegí un proyecto.');
    if (!form.tarea) return errorEditor('Elegí una tarea.');
    const suma = totalDia(dia, editando && editando.id) + form.horas;
    if (suma > MAX_DIA) return errorEditor(`Con esta carga el día sumaría ${H.fmtHoras(suma)} h. El máximo es ${MAX_DIA} h.`);

    const datos = { id: editando ? editando.id : nuevoId(), fecha: dia, proyecto_codigo: form.proyecto_codigo,
      tarea: form.tarea, horas: form.horas, nota: form.nota };
    const proyecto = D.proyectos.find(p => p.codigo === datos.proyecto_codigo);
    const local = Object.assign({}, editando || {}, datos, {
      proyecto_nombre: proyecto ? proyecto.nombre : (editando && editando.proyecto_nombre) || datos.proyecto_codigo,
      cargado_en: editando ? editando.cargado_en : '',
    });

    $('guardar').disabled = true;
    $('guardar').textContent = 'Guardando…';
    try {
      const r = await enviar({ tipo: 'guardar', datos });
      if (r === 'cola') {
        registros[datos.id] = local;
        persistir();
        toast('Sin conexión: quedó guardado en este dispositivo y se envía solo cuando vuelva la señal.');
      } else {
        toast(editando ? 'Cambios guardados' : 'Horas guardadas');
      }
      $('editor').close();
      render();
    } catch (e) {
      errorEditor(e.message);
    } finally {
      $('guardar').disabled = false;
      $('guardar').textContent = 'Guardar';
    }
  }

  async function borrar() {
    if (!editando || !confirm('¿Borrar esta carga?')) return;
    const id = editando.id;
    try {
      await enviar({ tipo: 'borrar', datos: { id, fecha: editando.fecha } });
      delete registros[id];
      persistir();
      $('editor').close();
      toast('Carga borrada');
      render();
    } catch (e) {
      errorEditor(e.message);
    }
  }

  async function repetir() {
    const origen = diaAnterior();
    if (!origen) return;
    $('repetir').disabled = true;
    try {
      for (const r of delDia(origen)) {
        const datos = { id: nuevoId(), fecha: dia, proyecto_codigo: r.proyecto_codigo, tarea: r.tarea, horas: Number(r.horas), nota: r.nota || '' };
        if (!D.proyectos.some(p => p.codigo === r.proyecto_codigo)) continue; // proyecto cerrado
        if (await enviar({ tipo: 'guardar', datos }) === 'cola') {
          registros[datos.id] = Object.assign({}, datos, { proyecto_nombre: r.proyecto_nombre, cargado_en: '' });
          persistir();
        }
      }
      toast(`Se copiaron las horas del ${H.fmtFecha(origen, { weekday: 'long', day: 'numeric' })}. Ajustalas si hace falta.`);
    } catch (e) {
      toast(e.message);
    } finally {
      $('repetir').disabled = false;
      render();
    }
  }

  // ---------- eventos ----------

  let conectado = false;
  function conectarEventos() {
    if (conectado) return;
    conectado = true;
    $('dias').addEventListener('click', e => {
      const b = e.target.closest('.dia');
      if (!b || b.disabled) return;
      dia = b.dataset.f;
      render();
    });
    $('semanaAnt').addEventListener('click', () => moverSemana(-7));
    $('semanaSig').addEventListener('click', () => moverSemana(7));
    $('filas').addEventListener('click', e => {
      const b = e.target.closest('.fila');
      if (b && !b.disabled) abrirEditor(registros[b.dataset.id]);
    });
    $('agregar').addEventListener('click', () => abrirEditor(null));
    $('repetir').addEventListener('click', repetir);
    $('salir').addEventListener('click', () => {
      if (cola.length && !confirm('Hay cargas sin enviar en este dispositivo. Si salís se pierden. ¿Salir igual?')) return;
      H.salir();
    });

    $('fTareas').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (b) { form.tarea = b.dataset.tarea; pintarEditor(); }
    });
    $('rapidas').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (b) { form.horas = Number(b.dataset.h); pintarEditor(); }
    });
    $('menos').addEventListener('click', () => { form.horas = Math.max(PASO, form.horas - PASO); pintarEditor(); });
    $('mas').addEventListener('click', () => { form.horas = Math.min(MAX_FILA, form.horas + PASO); pintarEditor(); });
    $('formEditor').addEventListener('submit', e => { e.preventDefault(); guardar(); });
    $('cancelar').addEventListener('click', () => $('editor').close());
    $('borrar').addEventListener('click', borrar);

    window.addEventListener('online', enviarCola);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      render();
      enviarCola();
      traerSemana(semana);
    });
    setInterval(enviarCola, 60000);
  }

  function moverSemana(n) {
    semana = H.sumarDias(semana, n);
    const fin = H.sumarDias(semana, 6);
    const h = hoy();
    dia = fin < h ? H.sumarDias(semana, 4) : h; // viernes de esa semana, u hoy si es la actual
    if (dia < semana) dia = semana;
    render();
    traerSemana(semana);
  }

  // ---------- instalar la app ----------

  function instalacion() {
    const instalada = matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (instalada || H.local.leer('horas.instalarCerrado')) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (instalador) {
      $('instalarTexto').textContent = 'Instalá la app para abrirla con un toque, como cualquier otra.';
      $('instalarBoton').classList.remove('hidden');
    } else if (ios) {
      $('instalarTexto').textContent = 'Para tenerla como app: tocá Compartir y después “Agregar a inicio”.';
    } else {
      return;
    }
    $('instalar').classList.remove('hidden');
    $('instalarBoton').onclick = async () => {
      instalador.prompt();
      await instalador.userChoice;
      instalador = null;
      $('instalar').classList.add('hidden');
    };
    $('instalarCerrar').onclick = () => {
      H.local.escribir('horas.instalarCerrado', true);
      $('instalar').classList.add('hidden');
    };
  }

  let reloj;
  function toast(msj) {
    $('toast').textContent = msj;
    $('toast').classList.remove('hidden');
    clearTimeout(reloj);
    reloj = setTimeout(() => $('toast').classList.add('hidden'), 4000);
  }
})();
