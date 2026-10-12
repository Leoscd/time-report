// Dashboard de gerencia: quién cargó hoy, horas por persona y día (agrupadas por régimen, con las horas
// extra aparte), por proyecto y por tarea,
// detalle y exportación a CSV con las mismas columnas que la pestaña "Registros".
(() => {
  const H = window.Horas;
  const $ = id => document.getElementById(id);
  const COLUMNAS = ['id', 'fecha', 'email', 'nombre', 'area', 'regimen', 'proyecto_codigo', 'proyecto_nombre', 'tarea',
    'horas', 'horas_normales', 'horas_extra', 'nota', 'cargado_en', 'modificado_en', 'estado'];
  const MAX_MATRIZ = 31;

  let periodo = 'semana';
  let rango = {};
  let datos = null; // {hoy, personas, proyectos, registros}
  let mostrar = 100;

  H.iniciar({ alEntrar });

  function alEntrar(d) {
    if (d.persona.rol === 'empleado') {
      $('vistaApp').classList.add('hidden');
      $('avisoTitulo').textContent = 'Sin acceso';
      $('avisoTexto').textContent = 'El dashboard es solo para gerencia. Desde acá podés cargar tus horas.';
      $('vistaAviso').classList.remove('hidden');
      return;
    }
    conectarEventos();
    elegirPeriodo('semana');
  }

  const hoy = () => H.iso(new Date());

  function elegirPeriodo(p) {
    periodo = p;
    const h = hoy();
    document.querySelectorAll('#periodos button').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === p));
    document.querySelectorAll('.rango').forEach(el => el.classList.toggle('hidden', p !== 'rango'));
    if (p === 'hoy') rango = { desde: h, hasta: h };
    if (p === 'semana') rango = { desde: H.lunes(h), hasta: h };
    if (p === 'mes') rango = { desde: h.slice(0, 8) + '01', hasta: h };
    if (p === 'rango') {
      if (!$('desde').value) $('desde').value = rango.desde || H.sumarDias(h, -30);
      if (!$('hasta').value) $('hasta').value = rango.hasta || h;
      rango = { desde: $('desde').value, hasta: $('hasta').value };
    }
    cargar();
  }

  async function cargar() {
    if (!rango.desde || !rango.hasta || rango.desde > rango.hasta) {
      $('estado').textContent = 'Revisá el rango de fechas.';
      return;
    }
    $('estado').textContent = 'Cargando…';
    $('actualizar').disabled = true;
    try {
      datos = await H.llamar('dashboard', rango);
      llenarFiltros();
      mostrar = 100;
      render();
      const ahora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const largo = { day: 'numeric', month: 'long', year: 'numeric' };
      const periodoTxt = rango.desde === rango.hasta ? H.fmtFecha(rango.desde, largo)
        : `Del ${H.fmtFecha(rango.desde, { day: 'numeric', month: 'long' })} al ${H.fmtFecha(rango.hasta, largo)}`;
      $('estado').textContent = `${periodoTxt} · actualizado a las ${ahora}`;
    } catch (e) {
      $('estado').textContent = e instanceof H.SinConexion ? 'Sin conexión. Probá de nuevo.' : e.message;
    } finally {
      $('actualizar').disabled = false;
    }
  }

  // ---------- filtros ----------

  function llenarFiltros() {
    const personas = new Map(datos.personas.map(p => [p.email, p.nombre]));
    const proyectos = new Map(datos.proyectos.map(p => [p.codigo, p.nombre + (p.activo ? '' : ' (cerrado)')]));
    const areas = new Set(datos.personas.map(p => p.area).filter(Boolean));
    const regimenes = new Set((datos.regimenes || []).map(r => r.regimen).concat(datos.personas.map(p => p.regimen)));
    datos.registros.forEach(r => {
      if (!personas.has(r.email)) personas.set(r.email, r.nombre);
      if (!proyectos.has(r.proyecto_codigo)) proyectos.set(r.proyecto_codigo, r.proyecto_nombre);
      if (r.area) areas.add(r.area);
      if (r.regimen) regimenes.add(r.regimen);
    });
    const llenar = (id, todas, pares) => {
      const v = $(id).value;
      $(id).innerHTML = `<option value="">${todas}</option>` + pares
        .sort((a, b) => a[1].localeCompare(b[1], 'es'))
        .map(([k, t]) => `<option value="${H.esc(k)}">${H.esc(t)}</option>`).join('');
      $(id).value = pares.some(([k]) => k === v) ? v : '';
    };
    llenar('fPersona', 'Todas', [...personas]);
    llenar('fProyecto', 'Todos', [...proyectos].map(([c, n]) => [c, `${c} · ${n}`]));
    llenar('fArea', 'Todas', [...areas].map(a => [a, a]));
    llenar('fRegimen', 'Todos', [...regimenes].filter(Boolean).map(r => [r, r]));
  }

  const filtro = () => ({ persona: $('fPersona').value, proyecto: $('fProyecto').value, area: $('fArea').value, regimen: $('fRegimen').value });

  // El régimen actual de la persona; si ya no está activa, el que tenía al cargar.
  const regimenDe = r => (datos.personas.find(p => p.email === r.email) || r).regimen;
  const esFeriado = d => (datos.feriados || []).includes(d);
  const jornada = (p, d) => (H.esHabil(d) && !esFeriado(d) ? p.horas_dia : 0);

  function filas() {
    const f = filtro();
    return datos.registros.filter(r => (!f.persona || r.email === f.persona) && (!f.proyecto || r.proyecto_codigo === f.proyecto)
      && (!f.area || r.area === f.area) && (!f.regimen || regimenDe(r) === f.regimen));
  }

  // Personas a las que se les espera carga: activas, sin el rol admin (SoyLeo AI), según los filtros.
  function controladas() {
    const f = filtro();
    return datos.personas.filter(p => p.rol !== 'admin' && (!f.persona || p.email === f.persona)
      && (!f.area || p.area === f.area) && (!f.regimen || p.regimen === f.regimen))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  function diasDelRango() {
    const fin = rango.hasta < hoy() ? rango.hasta : hoy();
    const dias = [];
    for (let d = rango.desde; d <= fin; d = H.sumarDias(d, 1)) dias.push(d);
    return dias;
  }

  const sumar = (lista, clave, campo = 'horas') => lista.reduce((m, r) => m.set(clave(r), (m.get(clave(r)) || 0) + Number(r[campo])), new Map());
  const total = (lista, campo = 'horas') => lista.reduce((s, r) => s + Number(r[campo]), 0);

  // ---------- pantalla ----------

  function render() {
    if (!datos) return;
    const rs = filas();
    const gente = controladas();
    const dias = diasDelRango();
    const f = filtro();

    // KPIs. El cumplimiento compara las horas normales con la jornada esperada (sin fines de semana ni feriados).
    const t = total(rs);
    const normales = total(rs, 'horas_normales');
    const extra = total(rs, 'horas_extra');
    const esperado = gente.reduce((s, p) => s + dias.reduce((a, d) => a + jornada(p, d), 0), 0);
    const laborables = dias.filter(d => H.esHabil(d) && !esFeriado(d)).length;
    const conCarga = gente.filter(p => rs.some(r => r.email === p.email)).length;
    const proyectos = new Set(rs.map(r => r.proyecto_codigo)).size;
    const pct = !f.proyecto && esperado ? Math.round(normales / esperado * 100) : null;
    $('kpis').innerHTML = [
      ['Horas cargadas', H.fmtHoras(t), `${H.fmtHoras(normales)} normales · ${rs.length} cargas`, ''],
      ['Horas extra', H.fmtHoras(extra), t ? `${Math.round(extra / t * 100)} % del total` : 'en el período', 'extra'],
      ['Cumplimiento', pct == null ? '—' : pct + ' %', f.proyecto ? 'No aplica con un proyecto elegido'
        : `de ${H.fmtHoras(esperado)} h esperadas (${laborables} ${laborables === 1 ? 'día laborable' : 'días laborables'})`, ''],
      ['Personas con carga', `${conCarga} de ${gente.length}`, 'en el período', ''],
      ['Proyectos con horas', proyectos, f.proyecto ? '' : 'en el período', ''],
    ].map(([tt, v, s, c]) => `<div class="kpi ${c}"><div class="t">${tt}</div><div class="v num">${v}</div><div class="s">${H.esc(s)}</div></div>`).join('');

    renderHoy(rs, gente);
    renderMatriz(rs, gente, dias);

    const nombreProy = new Map(datos.proyectos.map(p => [p.codigo, p.nombre]));
    rs.forEach(r => { if (!nombreProy.has(r.proyecto_codigo)) nombreProy.set(r.proyecto_codigo, r.proyecto_nombre); });
    const nombrePers = new Map(datos.personas.map(p => [p.email, p.nombre]));
    rs.forEach(r => { if (!nombrePers.has(r.email)) nombrePers.set(r.email, r.nombre); });
    barras('porProyecto', sumar(rs, r => r.proyecto_codigo), c => `${c} · ${nombreProy.get(c) || ''}`);
    barras('porPersona', sumar(rs, r => r.email), e => nombrePers.get(e) || e);
    barras('porTarea', sumar(rs, r => r.tarea), x => x);
    const extraPersona = new Map([...sumar(rs, r => r.email, 'horas_extra')].filter(([, v]) => v > 0));
    barras('extraPersona', extraPersona, e => `${nombrePers.get(e) || e} · ${regimenDe({ email: e, regimen: '' })}`, 'extra',
      'Nadie hizo horas extra en el período.');

    renderDetalle(rs);
  }

  function renderHoy(rs, gente) {
    const h = hoy();
    const visible = rango.desde <= h && rango.hasta >= h;
    $('seccionHoy').classList.toggle('hidden', !visible);
    if (!visible) return;
    const deHoy = rs.filter(r => r.fecha === h);
    const tarjetas = gente.map(p => {
      const mias = deHoy.filter(r => r.email === p.email);
      const porProy = [...sumar(mias, r => r.proyecto_nombre || r.proyecto_codigo)].sort((a, b) => b[1] - a[1]);
      return { p, total: total(mias), extra: total(mias, 'horas_extra'), j: jornada(p, h), porProy };
    }).sort((a, b) => (a.total > 0) - (b.total > 0) || a.p.nombre.localeCompare(b.p.nombre, 'es'));
    const cargaron = tarjetas.filter(x => x.total > 0).length;
    $('hoyResumen').textContent = `Cargaron ${cargaron} de ${tarjetas.length} · ${H.fmtHoras(total(deHoy))} h`
      + (total(deHoy, 'horas_extra') ? ` (${H.fmtHoras(total(deHoy, 'horas_extra'))} extra)` : '');
    $('personasHoy').innerHTML = tarjetas.map(({ p, total: tt, extra, j, porProy }) => `
      <div class="persona-hoy ${tt || !j ? '' : 'falta'}">
        <div class="cab"><span>${H.esc(p.nombre)}</span>
          ${tt ? `<span class="num">${H.fmtHoras(tt)}${j ? ' / ' + H.fmtHoras(j) : ''} h</span>` : j ? '<span class="etiqueta mala">Sin carga</span>' : ''}</div>
        <div class="area">${H.esc(p.area)} · ${H.esc(p.regimen)} ${H.fmtHoras(p.horas_dia)} h</div>
        ${extra ? `<div class="txt-extra" style="font-size:13px">${H.fmtHoras(extra)} h extra</div>` : ''}
        ${tt && j ? `<div class="barra"><i style="width:${Math.min(100, tt / j * 100)}%"></i></div>` : ''}
        ${tt ? `<ul>${porProy.map(([n, hs]) => `<li><span>${H.esc(n)}</span><span class="num">${H.fmtHoras(hs)} h</span></li>`).join('')}</ul>` : ''}
      </div>`).join('') || '<p class="muted">No hay personas para mostrar con estos filtros.</p>';
  }

  // Grilla persona × día, agrupada por régimen. Cada celda: horas normales y, aparte, "+N" de horas extra.
  function renderMatriz(rs, gente, dias) {
    const visible = dias.length > 0 && dias.length <= MAX_MATRIZ;
    $('seccionMatriz').classList.toggle('hidden', !visible);
    if (!visible) return;
    const filasP = gente.slice();
    rs.forEach(r => {
      if (!filasP.some(x => x.email === r.email)) {
        filasP.push({ email: r.email, nombre: r.nombre, regimen: r.regimen || 'Sin régimen', horas_dia: 0, externa: true });
      }
    });
    filasP.sort((a, b) => a.regimen.localeCompare(b.regimen, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
    const noLaborable = d => !H.esHabil(d) || esFeriado(d);
    const cab = dias.map(d => `<th class="${noLaborable(d) ? 'finde' : ''}" title="${H.esc(H.fmtFecha(d) + (esFeriado(d) ? ' (feriado)' : ''))}">
      ${H.fmtFecha(d, { weekday: 'narrow' })}<br>${H.deIso(d).getDate()}</th>`).join('');
    let grupo = null;
    const cuerpo = filasP.map(p => {
      let encabezado = '';
      if (p.regimen !== grupo) {
        grupo = p.regimen;
        encabezado = `<tr class="grupo"><td colspan="${dias.length + 3}">${H.esc(p.regimen)}${p.externa ? '' : ` · ${H.fmtHoras(p.horas_dia)} h por día`}</td></tr>`;
      }
      const mias = rs.filter(r => r.email === p.email);
      const celdas = dias.map(d => {
        const delDia = mias.filter(r => r.fecha === d);
        const n = total(delDia, 'horas_normales');
        const e = total(delDia, 'horas_extra');
        const j = p.externa ? 0 : jornada(p, d);
        let cls = '';
        if (j && n >= j) cls = 'ok';
        else if (n > 0) cls = 'parcial';
        else if (j && !e) cls = 'falta';
        else if (e) cls = 'solo-extra';
        const titulo = delDia.map(r => `${r.proyecto_nombre}: ${H.fmtHoras(r.horas)} h${r.horas_extra ? ` (${H.fmtHoras(r.horas_extra)} extra)` : ''}`).join('\n');
        const texto = (n ? H.fmtHoras(n) : e ? '' : '·') + (e ? `<small class="mas">+${H.fmtHoras(e)}</small>` : '');
        return `<td class="${noLaborable(d) ? 'finde' : ''}"><div class="c num ${cls}" title="${H.esc(titulo)}">${texto}</div></td>`;
      }).join('');
      const ex = total(mias, 'horas_extra');
      return `${encabezado}<tr><td>${H.esc(p.nombre)}</td>${celdas}<td class="num"><strong>${H.fmtHoras(total(mias))}</strong></td>
        <td class="num txt-extra">${ex ? H.fmtHoras(ex) : ''}</td></tr>`;
    }).join('');
    $('matriz').innerHTML = `<thead><tr><th>Persona</th>${cab}<th>Total</th><th>Extra</th></tr></thead><tbody>${cuerpo}</tbody>`;
  }

  function barras(id, mapa, etiqueta, clase = '', vacio = 'Sin horas en el período.') {
    const items = [...mapa].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const max = items.length ? items[0][1] : 0;
    $(id).innerHTML = items.map(([k, v]) => `
      <div class="item ${clase}"><span title="${H.esc(etiqueta(k))}">${H.esc(etiqueta(k))}</span>
        <span class="pista"><i style="width:${max ? v / max * 100 : 0}%"></i></span>
        <span class="num"><strong>${H.fmtHoras(v)}</strong> h</span></div>`).join('')
      || `<p class="muted" style="margin:0">${vacio}</p>`;
  }

  function ordenadas(rs) {
    return rs.slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || b.cargado_en.localeCompare(a.cargado_en));
  }

  function renderDetalle(rs) {
    const lista = ordenadas(rs);
    const ex = total(lista, 'horas_extra');
    $('detalleResumen').textContent = `${lista.length} filas · ${H.fmtHoras(total(lista))} h${ex ? ` (${H.fmtHoras(ex)} extra)` : ''}`;
    const corto = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : '';
    $('detalle').innerHTML = lista.slice(0, mostrar).map(r => `<tr>
      <td class="num">${H.fmtFecha(r.fecha, { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
      <td>${H.esc(r.nombre)}</td>
      <td>${H.esc(r.proyecto_codigo)} · ${H.esc(r.proyecto_nombre)}</td>
      <td>${H.esc(r.tarea)}</td>
      <td class="r num">${H.fmtHoras(r.horas)}</td>
      <td class="r num txt-extra">${r.horas_extra ? H.fmtHoras(r.horas_extra) : ''}</td>
      <td class="nota">${H.esc(r.nota)}</td>
      <td class="num muted" title="${r.modificado_en ? 'Editado ' + H.esc(r.modificado_en) : ''}">${corto(r.cargado_en)}${r.modificado_en ? ' ✎' : ''}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">Sin cargas en el período.</td></tr>';
    $('verMas').classList.toggle('hidden', lista.length <= mostrar);
  }

  // CSV estándar (coma, UTF-8 con BOM para que Excel respete los acentos), mismas columnas que la Sheet.
  function exportar() {
    const lista = ordenadas(filas());
    const celda = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = [COLUMNAS.join(',')].concat(lista.map(r => COLUMNAS.map(c => celda(r[c])).join(','))).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `horas-saez-sanchez_${rango.desde}_${rango.hasta}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let conectado = false;
  // ---------- proyectos: gerencia los agrega, edita, termina o borra sin abrir la Sheet ----------

  let proyectosLista = [];
  let vistaProy = 'activos';
  let editandoProy = null;
  let cambiaronProy = false;

  async function abrirProyectos() {
    cambiaronProy = false;
    limpiarFormProy();
    $('dlgProyectos').showModal();
    $('pLista').innerHTML = '<tr><td colspan="5" class="muted">Cargando…</td></tr>';
    try {
      proyectosLista = (await H.llamar('proyectos')).proyectos;
      pintarProyectos();
    } catch (e) {
      errorProy(e);
    }
  }

  function pintarProyectos() {
    const activos = proyectosLista.filter(p => p.activo);
    const lista = proyectosLista.filter(p => p.activo === (vistaProy === 'activos'))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
    document.querySelectorAll('#pVista button').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.v === vistaProy);
      b.textContent = b.dataset.v === 'activos' ? `En curso (${activos.length})` : `Terminados (${proyectosLista.length - activos.length})`;
    });
    $('pLista').innerHTML = lista.map(p => `<tr>
      <td class="num"><strong>${H.esc(p.codigo)}</strong></td>
      <td>${H.esc(p.nombre)}</td>
      <td class="muted">${H.esc(p.cliente)}</td>
      <td class="r num">${p.horas ? H.fmtHoras(p.horas) : ''}</td>
      <td class="acciones-proy">
        <button type="button" class="btn chico plano" data-accion="editar" data-codigo="${H.esc(p.codigo)}">Editar</button>
        <button type="button" class="btn chico" data-accion="${p.activo ? 'terminar' : 'reabrir'}" data-codigo="${H.esc(p.codigo)}">${p.activo ? 'Terminar' : 'Reabrir'}</button>
        ${p.usado ? '' : `<button type="button" class="btn chico plano peligro" data-accion="borrar" data-codigo="${H.esc(p.codigo)}">Borrar</button>`}
      </td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">${vistaProy === 'activos' ? 'No hay proyectos en curso.' : 'No hay proyectos terminados.'}</td></tr>`;
  }

  function limpiarFormProy() {
    editandoProy = null;
    $('pCodigo').value = '';
    $('pNombre').value = '';
    $('pCliente').value = '';
    $('pCodigo').disabled = false;
    $('pGuardar').textContent = '+ Agregar';
    $('pCancelar').classList.add('hidden');
    $('pError').classList.add('hidden');
  }

  function errorProy(e) {
    $('pError').textContent = e instanceof H.SinConexion ? 'Sin conexión. Probá de nuevo.' : e.message;
    $('pError').classList.remove('hidden');
  }

  // Manda un cambio; el servidor devuelve la lista actualizada.
  async function cambiarProyecto(accion, datosProy) {
    $('pError').classList.add('hidden');
    try {
      proyectosLista = (await H.llamar(accion, datosProy)).proyectos;
      cambiaronProy = true;
      pintarProyectos();
      return true;
    } catch (e) {
      errorProy(e);
      return false;
    }
  }

  async function guardarProyecto() {
    const datosProy = { codigo: $('pCodigo').value.trim(), nombre: $('pNombre').value.trim(), cliente: $('pCliente').value.trim(), nuevo: !editandoProy };
    $('pGuardar').disabled = true;
    const ok = await cambiarProyecto('proyecto_guardar', datosProy);
    $('pGuardar').disabled = false;
    if (ok) {
      if (!editandoProy) vistaProy = 'activos';
      limpiarFormProy();
      pintarProyectos();
      $('pCodigo').focus();
    }
  }

  function accionProyecto(e) {
    const b = e.target.closest('button[data-accion]');
    if (!b) return;
    const p = proyectosLista.find(x => x.codigo === b.dataset.codigo);
    if (!p) return;
    const nombre = `${p.codigo} · ${p.nombre}`;
    if (b.dataset.accion === 'editar') {
      editandoProy = p;
      $('pCodigo').value = p.codigo;
      $('pCodigo').disabled = true;
      $('pNombre').value = p.nombre;
      $('pCliente').value = p.cliente;
      $('pGuardar').textContent = 'Guardar cambios';
      $('pCancelar').classList.remove('hidden');
      $('pNombre').focus();
    } else if (b.dataset.accion === 'terminar') {
      if (confirm(`¿Terminar ${nombre}? Deja de aparecer para cargar horas; las horas cargadas quedan.`)) {
        cambiarProyecto('proyecto_estado', { codigo: p.codigo, estado: 'cerrado' });
      }
    } else if (b.dataset.accion === 'reabrir') {
      cambiarProyecto('proyecto_estado', { codigo: p.codigo, estado: 'activo' });
    } else if (b.dataset.accion === 'borrar') {
      if (confirm(`¿Borrar ${nombre}? No tiene horas cargadas, así que se elimina del todo.`)) {
        cambiarProyecto('proyecto_borrar', { codigo: p.codigo });
      }
    }
  }

  function conectarEventos() {
    if (conectado) return;
    conectado = true;
    $('periodos').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) elegirPeriodo(b.dataset.p);
    });
    ['desde', 'hasta'].forEach(id => $(id).addEventListener('change', () => {
      rango = { desde: $('desde').value, hasta: $('hasta').value };
      cargar();
    }));
    ['fPersona', 'fProyecto', 'fArea', 'fRegimen'].forEach(id => $(id).addEventListener('change', () => { mostrar = 100; render(); }));
    $('actualizar').addEventListener('click', () => (periodo === 'rango' ? cargar() : elegirPeriodo(periodo)));
    $('verMas').addEventListener('click', () => { mostrar += 100; renderDetalle(filas()); });
    $('exportar').addEventListener('click', exportar);
    $('btnProyectos').addEventListener('click', abrirProyectos);
    $('cerrarProyectos').addEventListener('click', () => $('dlgProyectos').close());
    $('formProyecto').addEventListener('submit', e => { e.preventDefault(); guardarProyecto(); });
    $('pCancelar').addEventListener('click', limpiarFormProy);
    $('pLista').addEventListener('click', accionProyecto);
    $('pVista').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) { vistaProy = b.dataset.v; pintarProyectos(); }
    });
    // Al cerrar el panel, si hubo cambios se recarga el dashboard (filtros y nombres de proyectos).
    $('dlgProyectos').addEventListener('close', () => { if (cambiaronProy) cargar(); });
    $('salir').addEventListener('click', H.salir);
    setInterval(() => { if (document.visibilityState === 'visible' && periodo !== 'rango') elegirPeriodo(periodo); }, 5 * 60000);
  }
})();
