// Backend falso para probar la interfaz sin Google ni Apps Script. Solo se carga en localhost con ?demo.
// Repite las reglas de apps-script/horas.gs y guarda todo en el navegador (clave "horas.demo3").
window.HorasDemo = (() => {
  const H = window.Horas;
  const CLAVE = 'horas.demo3';
  const TAREAS = ['Proyecto / diseño', 'Documentación', 'Dirección técnica', 'Visita de obra', 'Planificación',
    'Presupuesto', 'Reunión', 'Administración', 'Otro'];
  const REGIMENES = [
    { regimen: 'Full time', horas_dia: 8 },
    { regimen: 'Part time', horas_dia: 4 },
    { regimen: 'Part time 6 h', horas_dia: 6 },
  ];
  const persona = (email, nombre, area, rol, regimen) =>
    Object.assign({ email, nombre, area, rol }, REGIMENES.find(r => r.regimen === regimen));
  const PERSONAS = [
    persona('gerencia@demo', 'Gerencia (demo)', 'Gerencia', 'gerente', 'Full time'),
    persona('ana@demo', 'Ana Gómez', 'Gestión de Proyectos', 'empleado', 'Full time'),
    persona('bruno@demo', 'Bruno Ferreyra', 'Gestión de Obras', 'empleado', 'Full time'),
    persona('carla@demo', 'Carla Ríos', 'Desarrollo de Proyectos', 'empleado', 'Part time'),
    persona('diego@demo', 'Diego Paz', 'Desarrollo de Proyectos', 'empleado', 'Full time'),
    persona('elena@demo', 'Elena Suárez', 'Desarrollo de Proyectos', 'empleado', 'Part time 6 h'),
  ];
  const PROYECTOS = [
    { codigo: 'INT', nombre: 'Interno del estudio', cliente: 'Sáez Sánchez', activo: true },
    { codigo: 'P-021', nombre: 'Casa Las Lomas', cliente: 'Familia Pérez', activo: true },
    { codigo: 'P-024', nombre: 'Edificio Belgrano', cliente: 'Desarrollos BA', activo: true },
    { codigo: 'P-027', nombre: 'Loteo Altos del Río', cliente: 'Grupo Norte', activo: true },
    { codigo: 'P-030', nombre: 'Local Av. Alem', cliente: 'Comercial Sur', activo: true },
    { codigo: 'P-012', nombre: 'Vivienda Ruta 9', cliente: 'Particular', activo: false },
  ];
  const FERIADOS = [];

  const hoy = () => H.iso(new Date());
  const ahora = () => H.iso(new Date()) + ' ' + new Date().toTimeString().slice(0, 8);
  const error = mensaje => ({ ok: false, error: 'validacion', mensaje });
  const jornada = (p, f) => (H.esHabil(f) && !FERIADOS.includes(f) ? p.horas_dia : 0);

  // Mismo reparto que el Apps Script: la jornada se completa en el orden de carga, el resto es extra.
  function repartir(b, p, f, marcar) {
    let resta = jornada(p, f);
    b.registros.filter(r => r.email === p.email && r.fecha === f && r.estado === 'activo')
      .sort((x, y) => x.cargado_en.localeCompare(y.cargado_en) || x.id.localeCompare(y.id))
      .forEach(r => {
        const n = Math.min(r.horas, Math.max(resta, 0));
        resta -= n;
        if (marcar && (r.horas_normales !== n || r.horas_extra !== r.horas - n)) r.modificado_en = ahora();
        r.horas_normales = n;
        r.horas_extra = r.horas - n;
      });
  }

  function base() {
    let b = H.local.leer(CLAVE);
    if (b) return b;
    // Semilla: dos semanas de cargas al azar para el resto del equipo (no para quien prueba),
    // con algunos días de más horas que la jornada y algún sábado.
    b = { registros: [], proyectos: PROYECTOS.map(x => Object.assign({}, x)) };
    let n = 0;
    for (let i = 13; i >= 0; i--) {
      const f = H.sumarDias(hoy(), -i);
      const sabado = H.deIso(f).getDay() === 6;
      if (!H.esHabil(f) && !sabado) continue;
      PERSONAS.slice(1).forEach((p, j) => {
        if (sabado && j !== 1) return;                                       // solo Bruno trabaja algún sábado
        if (!sabado && ((i + j) % 7 === 3 || (i === 0 && j % 2))) return;   // algunos huecos
        let resto = sabado ? 4 : p.horas_dia - ((i + j) % 4 === 0 ? 2 : 0) + ((i + j) % 5 === 1 ? 2 : 0);
        [1, 2, 3].forEach(k => {
          if (resto <= 0) return;
          const h = k === 3 ? resto : Math.min(resto, [2, 3, 4][(i + j + k) % 3]);
          const proy = PROYECTOS[(i * 3 + j * 2 + k) % 5];
          b.registros.push({
            id: 'r_demo' + String(n++).padStart(6, '0'), fecha: f, email: p.email, nombre: p.nombre, area: p.area,
            regimen: p.regimen, proyecto_codigo: proy.codigo, proyecto_nombre: proy.nombre, tarea: TAREAS[(i + j + k) % 8],
            horas: h, horas_normales: 0, horas_extra: 0, nota: k === 1 && j === 1 ? 'Ajustes de láminas' : '',
            cargado_en: `${f} 18:${String(10 + j * 7)}:0${k}`, modificado_en: '', estado: 'activo',
          });
          resto -= h;
        });
        repartir(b, p, f, false);
      });
    }
    H.local.escribir(CLAVE, b);
    return b;
  }

  function datos(p, b) {
    return { persona: p, proyectos: b.proyectos.filter(x => x.activo), tareas: TAREAS, feriados: FERIADOS, hoy: hoy(),
      dias_editables: p.rol === 'empleado' ? 14 : null };
  }

  function validarFecha(p, f) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return error('La fecha no es válida.');
    if (f > hoy()) return error('No se pueden cargar horas de días que todavía no pasaron.');
    if (p.rol === 'empleado' && f < H.sumarDias(hoy(), -14)) return error('Solo se pueden cargar o corregir los últimos 14 días. Pedile a gerencia que lo corrija.');
    return null;
  }

  async function llamar(d) {
    await new Promise(r => setTimeout(r, 250));
    const b = base();
    const guardar = () => { H.local.escribir(CLAVE, b); };
    if (d.accion === 'login') {
      const p = PERSONAS.find(x => x.email === d.credential);
      return p ? Object.assign({ ok: true, sesion: p.email }, datos(p, b)) : { ok: false, error: 'no_habilitado' };
    }
    const p = PERSONAS.find(x => x.email === d.sesion);
    if (!p) return { ok: false, error: 'sesion' };

    if (d.accion === 'datos') return Object.assign({ ok: true }, datos(p, b));
    if (d.accion === 'registros') {
      return { ok: true, registros: b.registros.filter(r => r.email === p.email && r.estado === 'activo' && r.fecha >= d.desde && r.fecha <= d.hasta) };
    }
    if (d.accion === 'dashboard') {
      if (p.rol === 'empleado') return { ok: false, error: 'sin_acceso' };
      return { ok: true, hoy: hoy(), personas: PERSONAS, regimenes: REGIMENES, feriados: FERIADOS, proyectos: b.proyectos,
        registros: b.registros.filter(r => r.estado === 'activo' && r.fecha >= d.desde && r.fecha <= d.hasta) };
    }
    if (d.accion === 'guardar') {
      const v = validarFecha(p, d.fecha);
      if (v) return v;
      const proy = b.proyectos.find(x => x.codigo === d.proyecto_codigo);
      if (!proy) return error('Ese proyecto no existe.');
      if (!TAREAS.includes(d.tarea)) return error('Ese tipo de tarea no existe.');
      const horas = Math.round(Number(d.horas) * 4) / 4;
      if (!(horas > 0) || horas > 12) return error('Las horas tienen que estar entre 0,5 y 12.');
      const previo = b.registros.find(r => r.id === d.id);
      if (previo && previo.email !== p.email) return error('Esa carga no es tuya.');
      if (!previo && !proy.activo) return error('Ese proyecto está cerrado.');
      const delDia = b.registros.filter(r => r.email === p.email && r.estado === 'activo' && r.fecha === d.fecha && r.id !== d.id)
        .reduce((s, r) => s + r.horas, 0);
      if (delDia + horas > 16) return error(`Con esta carga el día sumaría ${H.fmtHoras(delDia + horas)} h. El máximo es 16 h.`);
      const fechaAnterior = previo && previo.fecha;
      const fila = { id: d.id, fecha: d.fecha, email: p.email, nombre: p.nombre, area: p.area, regimen: p.regimen,
        proyecto_codigo: proy.codigo, proyecto_nombre: proy.nombre, tarea: d.tarea, horas, horas_normales: 0, horas_extra: 0,
        nota: String(d.nota || '').slice(0, 500), cargado_en: previo ? previo.cargado_en : ahora(),
        modificado_en: previo ? ahora() : '', estado: 'activo' };
      if (previo) Object.assign(previo, fila); else b.registros.push(fila);
      const registro = previo || fila;
      repartir(b, p, d.fecha, true);
      if (!previo) registro.modificado_en = '';
      if (fechaAnterior && fechaAnterior !== d.fecha) repartir(b, p, fechaAnterior, true);
      guardar();
      return { ok: true, registro };
    }
    if (d.accion === 'borrar') {
      const previo = b.registros.find(r => r.id === d.id);
      if (!previo || previo.estado !== 'activo') return { ok: true };
      if (previo.email !== p.email) return error('Esa carga no es tuya.');
      const v = validarFecha(p, previo.fecha);
      if (v) return v;
      previo.estado = 'borrado';
      previo.modificado_en = ahora();
      repartir(b, p, previo.fecha, true);
      guardar();
      return { ok: true };
    }
    if (d.accion.startsWith('proyecto')) {
      if (p.rol === 'empleado') return { ok: false, error: 'sin_acceso' };
      const lista = () => ({ ok: true, proyectos: b.proyectos.map(x => Object.assign({}, x, {
        horas: b.registros.filter(r => r.estado === 'activo' && r.proyecto_codigo === x.codigo).reduce((t, r) => t + r.horas, 0),
        usado: b.registros.some(r => r.proyecto_codigo === x.codigo),
      })) });
      const existente = b.proyectos.find(x => x.codigo.toLowerCase() === String(d.codigo || '').trim().toLowerCase());
      if (d.accion === 'proyecto_guardar') {
        const codigo = String(d.codigo || '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(codigo)) return error('El código lleva letras, números o guiones (hasta 20), por ejemplo P-031.');
        if (!String(d.nombre || '').trim()) return error('Falta el nombre del proyecto.');
        if (d.nuevo && existente) return error(`Ya existe un proyecto con el código ${existente.codigo}.`);
        if (!d.nuevo && !existente) return error('Ese proyecto no existe.');
        if (d.nuevo) b.proyectos.push({ codigo, nombre: d.nombre.trim(), cliente: String(d.cliente || '').trim(), activo: true });
        else Object.assign(existente, { nombre: d.nombre.trim(), cliente: String(d.cliente || '').trim() });
      } else if (d.accion === 'proyecto_estado') {
        if (!existente) return error('Ese proyecto no existe.');
        existente.activo = d.estado === 'activo';
      } else if (d.accion === 'proyecto_borrar') {
        if (existente && b.registros.some(r => r.proyecto_codigo === existente.codigo)) {
          return error('Ese proyecto tiene horas cargadas: no se puede borrar. Terminalo, así sus horas quedan.');
        }
        b.proyectos = b.proyectos.filter(x => x !== existente);
      }
      if (d.accion !== 'proyectos') guardar();
      return lista();
    }
    return { ok: false, error: 'accion_desconocida' };
  }

  function botones() {
    return '<p class="muted" style="margin:0;font-size:14px">Modo demo: elegí con quién entrar</p>'
      + [PERSONAS[0], PERSONAS[1], PERSONAS[3]].map(p => `<button type="button" class="btn" data-email="${p.email}">${H.esc(p.nombre)} · ${H.esc(p.regimen)}</button>`).join('');
  }

  return { llamar, botones };
})();
