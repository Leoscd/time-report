// Backend falso para probar la interfaz sin Google ni Apps Script. Solo se carga en localhost con ?demo.
// Repite las reglas de apps-script/horas.gs y guarda todo en el navegador (clave "horas.demo").
window.HorasDemo = (() => {
  const H = window.Horas;
  const CLAVE = 'horas.demo';
  const TAREAS = ['Proyecto / diseño', 'Documentación', 'Dirección técnica', 'Visita de obra', 'Planificación',
    'Presupuesto', 'Reunión', 'Administración', 'Otro'];
  const PERSONAS = [
    { email: 'gerencia@demo', nombre: 'Gerencia (demo)', area: 'Gerencia', rol: 'gerente', horas_dia: 8 },
    { email: 'ana@demo', nombre: 'Ana Gómez', area: 'Gestión de Proyectos', rol: 'empleado', horas_dia: 8 },
    { email: 'bruno@demo', nombre: 'Bruno Ferreyra', area: 'Gestión de Obras', rol: 'empleado', horas_dia: 8 },
    { email: 'carla@demo', nombre: 'Carla Ríos', area: 'Desarrollo de Proyectos', rol: 'empleado', horas_dia: 8 },
    { email: 'diego@demo', nombre: 'Diego Paz', area: 'Desarrollo de Proyectos', rol: 'empleado', horas_dia: 8 },
    { email: 'elena@demo', nombre: 'Elena Suárez', area: 'Desarrollo de Proyectos', rol: 'empleado', horas_dia: 6 },
  ];
  const PROYECTOS = [
    { codigo: 'INT', nombre: 'Interno del estudio', cliente: 'Sáez Sánchez', activo: true },
    { codigo: 'P-021', nombre: 'Casa Las Lomas', cliente: 'Familia Pérez', activo: true },
    { codigo: 'P-024', nombre: 'Edificio Belgrano', cliente: 'Desarrollos BA', activo: true },
    { codigo: 'P-027', nombre: 'Loteo Altos del Río', cliente: 'Grupo Norte', activo: true },
    { codigo: 'P-030', nombre: 'Local Av. Alem', cliente: 'Comercial Sur', activo: true },
    { codigo: 'P-012', nombre: 'Vivienda Ruta 9', cliente: 'Particular', activo: false },
  ];

  const hoy = () => H.iso(new Date());
  const ahora = () => H.iso(new Date()) + ' ' + new Date().toTimeString().slice(0, 8);
  const error = mensaje => ({ ok: false, error: 'validacion', mensaje });

  function base() {
    let b = H.local.leer(CLAVE);
    if (b) return b;
    // Semilla: dos semanas de cargas al azar para el resto del equipo (no para quien prueba).
    b = { registros: [] };
    let n = 0;
    for (let i = 13; i >= 0; i--) {
      const f = H.sumarDias(hoy(), -i);
      if (!H.esHabil(f)) continue;
      PERSONAS.slice(1).forEach((p, j) => {
        if ((i + j) % 7 === 3 || (i === 0 && j % 2)) return; // algunos huecos
        let resto = p.horas_dia - ((i + j) % 4 === 0 ? 2 : 0);
        [1, 2, 3].forEach(k => {
          if (resto <= 0) return;
          const h = k === 3 ? resto : Math.min(resto, [2, 3, 4][(i + j + k) % 3]);
          const proy = PROYECTOS[(i * 3 + j * 2 + k) % 5];
          b.registros.push({
            id: 'r_demo' + String(n++).padStart(6, '0'), fecha: f, email: p.email, nombre: p.nombre, area: p.area,
            proyecto_codigo: proy.codigo, proyecto_nombre: proy.nombre, tarea: TAREAS[(i + j + k) % 8], horas: h,
            nota: k === 1 && j === 1 ? 'Ajustes de láminas' : '', cargado_en: `${f} 18:${String(10 + j * 7).slice(0, 2)}:00`,
            modificado_en: '', estado: 'activo',
          });
          resto -= h;
        });
      });
    }
    H.local.escribir(CLAVE, b);
    return b;
  }

  function datos(p) {
    return { persona: p, proyectos: PROYECTOS.filter(x => x.activo), tareas: TAREAS, hoy: hoy(), dias_editables: p.rol === 'empleado' ? 14 : null };
  }

  function validarFecha(p, f) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return error('La fecha no es válida.');
    if (f > hoy()) return error('No se pueden cargar horas de días que todavía no pasaron.');
    if (p.rol === 'empleado' && f < H.sumarDias(hoy(), -14)) return error('Solo se pueden cargar o corregir los últimos 14 días. Pedile a gerencia que lo corrija.');
    return null;
  }

  async function llamar(d) {
    await new Promise(r => setTimeout(r, 250));
    if (d.accion === 'login') {
      const p = PERSONAS.find(x => x.email === d.credential);
      return p ? Object.assign({ ok: true, sesion: p.email }, datos(p)) : { ok: false, error: 'no_habilitado' };
    }
    const p = PERSONAS.find(x => x.email === d.sesion);
    if (!p) return { ok: false, error: 'sesion' };
    const b = base();
    const guardar = () => { H.local.escribir(CLAVE, b); };

    if (d.accion === 'datos') return Object.assign({ ok: true }, datos(p));
    if (d.accion === 'registros') {
      return { ok: true, registros: b.registros.filter(r => r.email === p.email && r.estado === 'activo' && r.fecha >= d.desde && r.fecha <= d.hasta) };
    }
    if (d.accion === 'dashboard') {
      if (p.rol === 'empleado') return { ok: false, error: 'sin_acceso' };
      return { ok: true, hoy: hoy(), personas: PERSONAS, proyectos: PROYECTOS,
        registros: b.registros.filter(r => r.estado === 'activo' && r.fecha >= d.desde && r.fecha <= d.hasta) };
    }
    if (d.accion === 'guardar') {
      const v = validarFecha(p, d.fecha);
      if (v) return v;
      const proy = PROYECTOS.find(x => x.codigo === d.proyecto_codigo);
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
      const fila = { id: d.id, fecha: d.fecha, email: p.email, nombre: p.nombre, area: p.area, proyecto_codigo: proy.codigo,
        proyecto_nombre: proy.nombre, tarea: d.tarea, horas, nota: String(d.nota || '').slice(0, 500),
        cargado_en: previo ? previo.cargado_en : ahora(), modificado_en: previo ? ahora() : '', estado: 'activo' };
      if (previo) Object.assign(previo, fila); else b.registros.push(fila);
      guardar();
      return { ok: true, registro: fila };
    }
    if (d.accion === 'borrar') {
      const previo = b.registros.find(r => r.id === d.id);
      if (!previo || previo.estado !== 'activo') return { ok: true };
      if (previo.email !== p.email) return error('Esa carga no es tuya.');
      const v = validarFecha(p, previo.fecha);
      if (v) return v;
      previo.estado = 'borrado';
      previo.modificado_en = ahora();
      guardar();
      return { ok: true };
    }
    return { ok: false, error: 'accion_desconocida' };
  }

  function botones() {
    return '<p class="muted" style="margin:0;font-size:14px">Modo demo: elegí con quién entrar</p>'
      + PERSONAS.slice(0, 3).map(p => `<button type="button" class="btn" data-email="${p.email}">${H.esc(p.nombre)}</button>`).join('');
  }

  return { llamar, botones };
})();
