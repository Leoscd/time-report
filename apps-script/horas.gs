/**
 * Backend del registro de horas de Sáez Sánchez — Google Apps Script pegado en una Google Sheet.
 *
 * La app (horas/, publicada en Vercel) manda cada pedido por POST con una "accion". Cada persona entra
 * con su cuenta de Google: la app obtiene un ID token de Google, este script lo verifica, busca el email
 * en la pestaña "Personas" y devuelve una sesión propia firmada (30 días). Quién carga sale siempre de
 * la sesión, nunca de lo que manda el navegador. La Sheet queda privada: nadie del equipo necesita acceso.
 *
 * Pestañas:
 *   Personas   email, nombre, area, rol (empleado | gerente | admin), activo, regimen
 *   Regimenes  regimen, horas_dia (ej. "Full time" 8, "Part time" 4)
 *   Feriados   fecha, nombre
 *   Proyectos  codigo, nombre, cliente, estado (activo | cerrado)
 *   Tareas     tarea
 *   Registros  la tabla de salida (una fila por persona, día, proyecto y tarea). No se edita a mano.
 *
 * Horas extra: cada día, las horas de una persona completan primero la jornada de su régimen, en el
 * orden en que se cargaron, y lo que pasa de esa jornada es extra. Sábados, domingos y feriados no
 * tienen jornada: todo es extra. Cada fila guarda su reparto en horas_normales y horas_extra.
 *
 * Instalación (una sola vez):
 *   1. Creá una Google Sheet nueva llamada "Horas Sáez Sánchez".
 *   2. Extensiones → Apps Script. Borrá lo que haya, pegá este archivo y completá CLIENT_ID y ADMIN_EMAIL.
 *   3. Elegí la función "configurar" y tocá Ejecutar. Aceptá los permisos.
 *   4. Implementar → Nueva implementación → tipo "Aplicación web".
 *      Ejecutar como: Yo. Quién tiene acceso: Cualquier persona.
 *   5. Copiá la URL que termina en /exec y pegala en horas/assets/config.js (ENDPOINT).
 * Si después cambiás este código: Implementar → Gestionar implementaciones → editar → Versión nueva.
 *
 * Sumar a alguien: una fila en "Personas" con su email de Google y "activo" tildado.
 * Sacar a alguien: destildá "activo" (sus registros quedan). Cerrar un proyecto: estado "cerrado".
 */
const CLIENT_ID = 'PEGAR_AQUI.apps.googleusercontent.com'; // OAuth Client ID (Google Cloud Console)
const ADMIN_EMAIL = '';  // email de Google de quien administra: queda como admin al correr configurar()
const ZONA = 'America/Argentina/Buenos_Aires';
const DIAS_EDITABLES = 14;     // un empleado puede cargar o corregir hasta 14 días para atrás
const HORAS_MAX_FILA = 12;
const HORAS_MAX_DIA = 16;
const SESION_DIAS = 30;

const H = {
  personas: ['email', 'nombre', 'area', 'rol', 'activo', 'regimen'],
  regimenes: ['regimen', 'horas_dia'],
  feriados: ['fecha', 'nombre'],
  proyectos: ['codigo', 'nombre', 'cliente', 'estado'],
  tareas: ['tarea'],
  registros: ['id', 'fecha', 'email', 'nombre', 'area', 'regimen', 'proyecto_codigo', 'proyecto_nombre', 'tarea',
    'horas', 'horas_normales', 'horas_extra', 'nota', 'cargado_en', 'modificado_en', 'estado'],
};
const HOJAS = {
  personas: 'Personas', regimenes: 'Regimenes', feriados: 'Feriados',
  proyectos: 'Proyectos', tareas: 'Tareas', registros: 'Registros',
};
const REGIMEN_POR_DEFECTO = { regimen: 'Full time', horas_dia: 8 };

// ---------- web ----------

function doGet() {
  return json_({ ok: true, servicio: 'Horas Sáez Sánchez' });
}

function doPost(e) {
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'pedido_invalido' });
  }
  try {
    if (d.accion === 'login') return json_(login_(d.credential));
    const p = sesion_(d.sesion);
    if (!p) return json_({ ok: false, error: 'sesion' });
    switch (d.accion) {
      case 'datos': return json_(Object.assign({ ok: true }, datos_(p)));
      case 'registros': return json_(misRegistros_(p, d.desde, d.hasta));
      case 'guardar': return json_(conLock_(() => guardar_(p, d)));
      case 'borrar': return json_(conLock_(() => borrar_(p, d.id)));
      case 'dashboard': return json_(dashboard_(p, d.desde, d.hasta));
      default: return json_({ ok: false, error: 'accion_desconocida' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'interno', mensaje: 'Error del servidor. Probá de nuevo en un rato.' });
  }
}

// ---------- login y sesión ----------

// Verifica el ID token de Google y, si el email está activo en Personas, devuelve una sesión propia.
function login_(credential) {
  if (!credential) return { ok: false, error: 'login' };
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential),
    { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { ok: false, error: 'login' };
  const t = JSON.parse(r.getContentText());
  const valido = t.aud === CLIENT_ID
    && (t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com')
    && String(t.email_verified) === 'true'
    && Number(t.exp) * 1000 > Date.now();
  if (!valido) return { ok: false, error: 'login' };

  const p = persona_(t.email);
  if (!p) return { ok: false, error: 'no_habilitado', email: t.email };
  const vence = Date.now() + SESION_DIAS * 864e5;
  const cuerpo = Utilities.base64EncodeWebSafe(JSON.stringify({ e: p.email, x: vence }));
  return Object.assign({ ok: true, sesion: cuerpo + '.' + firma_(cuerpo) }, datos_(p));
}

// Devuelve la persona de la sesión, o null si la firma no coincide, venció o la persona ya no está activa.
function sesion_(s) {
  const partes = String(s || '').split('.');
  if (partes.length !== 2 || firma_(partes[0]) !== partes[1]) return null;
  let c;
  try {
    c = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString());
  } catch (err) {
    return null;
  }
  if (!c.x || c.x < Date.now()) return null;
  return persona_(c.e);
}

function firma_(texto) {
  const secreto = PropertiesService.getScriptProperties().getProperty('SECRETO');
  if (!secreto) throw new Error('Falta correr configurar()');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, secreto)).replace(/=+$/, '');
}

// Cambia el secreto: todas las sesiones abiertas se cierran y cada uno vuelve a entrar con Google.
function cerrarTodasLasSesiones() {
  PropertiesService.getScriptProperties().setProperty('SECRETO', Utilities.getUuid() + Utilities.getUuid());
}

// ---------- lectura de pestañas ----------

function filas_(clave) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJAS[clave]);
  if (!hoja || hoja.getLastRow() < 2) return [];
  const cab = H[clave];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, cab.length).getValues()
    .map((r, i) => {
      const o = { _fila: i + 2 };
      cab.forEach((c, j) => { o[c] = r[j]; });
      return o;
    });
}

const verdadero_ = v => v === true || String(v).toUpperCase() === 'TRUE';

function regimenes_() {
  return filas_('regimenes')
    .filter(r => String(r.regimen).trim())
    .map(r => ({ regimen: String(r.regimen).trim(), horas_dia: Number(r.horas_dia) || 0 }));
}

function feriados_() {
  return filas_('feriados').map(r => fecha_(r.fecha)).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f));
}

function personas_() {
  const regs = regimenes_();
  return filas_('personas')
    .filter(r => String(r.email).trim() && verdadero_(r.activo))
    .map(r => ({
      email: String(r.email).trim().toLowerCase(),
      nombre: String(r.nombre).trim() || String(r.email).trim(),
      area: String(r.area).trim(),
      rol: ['gerente', 'admin'].includes(String(r.rol).trim().toLowerCase()) ? String(r.rol).trim().toLowerCase() : 'empleado',
      ...(regs.find(x => x.regimen === String(r.regimen).trim()) || REGIMEN_POR_DEFECTO),
    }));
}

function persona_(email) {
  const e = String(email || '').trim().toLowerCase();
  return e ? personas_().find(p => p.email === e) || null : null;
}

function proyectos_() {
  return filas_('proyectos')
    .filter(r => String(r.codigo).trim())
    .map(r => ({
      codigo: String(r.codigo).trim(),
      nombre: String(r.nombre).trim(),
      cliente: String(r.cliente).trim(),
      activo: String(r.estado).trim().toLowerCase() !== 'cerrado',
    }));
}

function tareas_() {
  return filas_('tareas').map(r => String(r.tarea).trim()).filter(Boolean);
}

function registros_() {
  return filas_('registros').filter(r => String(r.id).trim()).map(r => ({
    _fila: r._fila,
    id: String(r.id),
    fecha: fecha_(r.fecha),
    email: String(r.email).toLowerCase(),
    nombre: String(r.nombre),
    area: String(r.area),
    regimen: String(r.regimen),
    proyecto_codigo: String(r.proyecto_codigo),
    proyecto_nombre: String(r.proyecto_nombre),
    tarea: String(r.tarea),
    horas: Number(r.horas) || 0,
    horas_normales: Number(r.horas_normales) || 0,
    horas_extra: Number(r.horas_extra) || 0,
    nota: String(r.nota),
    cargado_en: momento_(r.cargado_en),
    modificado_en: momento_(r.modificado_en),
    estado: String(r.estado) || 'activo',
  }));
}

function datos_(p) {
  return {
    persona: p,
    proyectos: proyectos_().filter(x => x.activo),
    tareas: tareas_(),
    feriados: feriados_(),
    hoy: hoy_(),
    dias_editables: p.rol === 'empleado' ? DIAS_EDITABLES : null,
  };
}

// ---------- acciones ----------

function misRegistros_(p, desde, hasta) {
  const r = rango_(desde, hasta, 62);
  if (!r) return { ok: false, error: 'rango' };
  return {
    ok: true,
    registros: registros_()
      .filter(x => x.email === p.email && x.estado === 'activo' && x.fecha >= r.desde && x.fecha <= r.hasta)
      .map(publico_),
  };
}

// Crea o edita una fila. El id lo genera la app, así un reintento sin señal no duplica la carga.
function guardar_(p, d) {
  const id = String(d.id || '');
  if (!/^r_[a-z0-9]{8,32}$/.test(id)) return error_('El identificador de la carga no es válido.');
  const fecha = String(d.fecha || '');
  const v = validarFecha_(p, fecha);
  if (v) return v;

  const proyecto = proyectos_().find(x => x.codigo === String(d.proyecto_codigo || ''));
  if (!proyecto) return error_('Ese proyecto no existe. Actualizá la app y elegilo de nuevo.');
  const tarea = String(d.tarea || '');
  if (!tareas_().includes(tarea)) return error_('Ese tipo de tarea no existe.');
  const horas = Math.round(Number(d.horas) * 4) / 4;
  if (!(horas > 0) || horas > HORAS_MAX_FILA) return error_(`Las horas tienen que estar entre 0,5 y ${HORAS_MAX_FILA}.`);
  const nota = String(d.nota || '').trim().slice(0, 500);

  const todos = registros_();
  const previo = todos.find(x => x.id === id);
  if (previo && previo.email !== p.email) return error_('Esa carga no es tuya.');
  if (previo && previo.estado !== 'activo') return error_('Esa carga fue borrada.');
  if (previo && previo.fecha !== fecha) {
    const v2 = validarFecha_(p, previo.fecha);
    if (v2) return v2;
  }
  if (!previo && !proyecto.activo) return error_('Ese proyecto está cerrado.');

  const delDia = todos.filter(x => x.email === p.email && x.estado === 'activo' && x.fecha === fecha && x.id !== id)
    .reduce((s, x) => s + x.horas, 0);
  if (delDia + horas > HORAS_MAX_DIA) {
    return error_(`Con esta carga el día sumaría ${fmtHoras_(delDia + horas)} h. El máximo es ${HORAS_MAX_DIA} h.`);
  }

  const hoja = hojaRegistros_();
  const ahora = new Date();
  const fila = {
    id, fecha, email: p.email, nombre: p.nombre, area: p.area, regimen: p.regimen,
    proyecto_codigo: proyecto.codigo, proyecto_nombre: proyecto.nombre, tarea, horas, nota: limpiar_(nota),
    cargado_en: previo ? previo.cargado_en : ahora, modificado_en: '', estado: 'activo',
  };
  if (previo) {
    const igual = previo.fecha === fecha && previo.proyecto_codigo === proyecto.codigo && previo.tarea === tarea
      && previo.horas === horas && previo.nota === nota;
    if (igual) return { ok: true, registro: publico_(previo) };
    fila.cargado_en = hoja.getRange(previo._fila, col_('cargado_en')).getValue();
    fila.modificado_en = ahora;
    repartirDia_(hoja, todos, p, fecha, fila);
    hoja.getRange(previo._fila, 1, 1, H.registros.length).setValues([H.registros.map(c => fila[c])]);
    if (previo.fecha !== fecha) repartirDia_(hoja, todos.filter(x => x.id !== id), p, previo.fecha, null);
  } else {
    repartirDia_(hoja, todos, p, fecha, fila);
    hoja.appendRow(H.registros.map(c => fila[c]));
  }
  fila.cargado_en = momento_(fila.cargado_en);
  fila.modificado_en = momento_(fila.modificado_en);
  fila.nota = nota;
  return { ok: true, registro: publico_(fila) };
}

function borrar_(p, id) {
  const previo = registros_().find(x => x.id === String(id || ''));
  if (!previo || previo.estado !== 'activo') return { ok: true }; // ya no está: nada que hacer
  if (previo.email !== p.email) return error_('Esa carga no es tuya.');
  const v = validarFecha_(p, previo.fecha);
  if (v) return v;
  const hoja = hojaRegistros_();
  hoja.getRange(previo._fila, col_('modificado_en')).setValue(new Date());
  hoja.getRange(previo._fila, col_('estado')).setValue('borrado');
  repartirDia_(hoja, registros_().filter(x => x.id !== previo.id), p, previo.fecha, null);
  return { ok: true };
}

// Reparte las horas de un día de una persona: completan primero la jornada de su régimen, en el orden
// en que se cargaron, y el resto es extra. `nueva` es la fila que se está por escribir (recibe su reparto);
// las demás filas del día que cambian de reparto se reescriben en la hoja con su modificado_en.
function repartirDia_(hoja, todos, p, fecha, nueva) {
  const delDia = todos.filter(x => x.email === p.email && x.estado === 'activo' && x.fecha === fecha
    && (!nueva || x.id !== nueva.id));
  if (nueva) delDia.push(nueva);
  const orden = r => momento_(r.cargado_en);
  delDia.sort((a, b) => orden(a).localeCompare(orden(b)) || a.id.localeCompare(b.id));
  let resta = jornada_(p, fecha);
  const ahora = new Date();
  delDia.forEach(r => {
    const normales = Math.min(r.horas, Math.max(resta, 0));
    const extra = r.horas - normales;
    resta -= normales;
    if (r === nueva) {
      r.horas_normales = normales;
      r.horas_extra = extra;
    } else if (r.horas_normales !== normales || r.horas_extra !== extra) {
      hoja.getRange(r._fila, col_('horas_normales'), 1, 2).setValues([[normales, extra]]);
      hoja.getRange(r._fila, col_('modificado_en')).setValue(ahora);
    }
  });
}

// Horas de la jornada de esa persona ese día: 0 los sábados, domingos y feriados.
function jornada_(p, fecha) {
  const dia = new Date(fecha + 'T12:00:00Z').getUTCDay();
  if (dia === 0 || dia === 6 || feriados_().includes(fecha)) return 0;
  return p.horas_dia;
}

function col_(columna) {
  return H.registros.indexOf(columna) + 1;
}

function dashboard_(p, desde, hasta) {
  if (p.rol === 'empleado') return { ok: false, error: 'sin_acceso' };
  const r = rango_(desde, hasta, 400);
  if (!r) return { ok: false, error: 'rango' };
  return {
    ok: true,
    hoy: hoy_(),
    personas: personas_(),
    regimenes: regimenes_(),
    feriados: feriados_(),
    proyectos: proyectos_(),
    registros: registros_().filter(x => x.estado === 'activo' && x.fecha >= r.desde && x.fecha <= r.hasta).map(publico_),
  };
}

// ---------- validaciones y utilidades ----------

function validarFecha_(p, fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(new Date(fecha + 'T12:00:00Z'))) return error_('La fecha no es válida.');
  const hoy = hoy_();
  if (fecha > hoy) return error_('No se pueden cargar horas de días que todavía no pasaron.');
  if (p.rol === 'empleado' && fecha < sumarDias_(hoy, -DIAS_EDITABLES)) {
    return error_(`Solo se pueden cargar o corregir los últimos ${DIAS_EDITABLES} días. Pedile a gerencia que lo corrija.`);
  }
  return null;
}

function rango_(desde, hasta, maxDias) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  if (!ok(desde) || !ok(hasta) || desde > hasta) return null;
  if (hasta > sumarDias_(desde, maxDias)) return null;
  return { desde, hasta };
}

function hojaRegistros_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(HOJAS.registros);
}

function conLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function publico_(r) {
  const o = {};
  H.registros.forEach(c => { o[c] = r[c]; });
  return o;
}

function error_(mensaje) {
  return { ok: false, error: 'validacion', mensaje };
}

function hoy_() {
  return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
}

function sumarDias_(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// La Sheet puede devolver la fecha como texto o como Date: siempre la devolvemos como yyyy-MM-dd.
function fecha_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA, 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

function momento_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA, 'yyyy-MM-dd HH:mm:ss');
  return String(v || '');
}

function fmtHoras_(n) {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

// Evita que un texto que empieza con = + - @ se interprete como fórmula, y corta textos enormes.
function limpiar_(v) {
  if (v instanceof Date || typeof v === 'number') return v;
  const s = String(v == null ? '' : v).slice(0, 5000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- configuración ----------

// Crea las pestañas con datos iniciales y el secreto de las sesiones. Se puede volver a correr:
// no pisa pestañas que ya existen. Después completá Personas con los emails reales del equipo.
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(ZONA);
  if (!PropertiesService.getScriptProperties().getProperty('SECRETO')) cerrarTodasLasSesiones();

  crear_(ss, 'regimenes', [['Full time', 8], ['Part time', 4]], hoja => hoja.setColumnWidth(1, 200));

  crear_(ss, 'feriados', [], hoja => {
    hoja.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    hoja.setColumnWidth(2, 260);
  });

  crear_(ss, 'personas', [
    [ADMIN_EMAIL, 'Administrador', 'Sistemas', 'admin', true, 'Full time'],
    ['', 'Gerente (completar)', 'Gerencia', 'gerente', true, 'Full time'],
    ['', 'Empleado de ejemplo (completar)', 'Desarrollo de Proyectos', 'empleado', true, 'Full time'],
    ['', 'Part time de ejemplo (completar)', 'Desarrollo de Proyectos', 'empleado', true, 'Part time'],
  ], hoja => {
    hoja.getRange('E2:E').insertCheckboxes();
    hoja.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['empleado', 'gerente', 'admin'], true).build());
    hoja.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInRange(ss.getSheetByName(HOJAS.regimenes).getRange('A2:A'), true).build());
    hoja.setColumnWidth(1, 260);
    hoja.setColumnWidth(2, 200);
    hoja.setColumnWidth(3, 200);
  });

  crear_(ss, 'proyectos', [
    ['INT', 'Interno del estudio', 'Sáez Sánchez', 'activo'],
    ['P-000', 'Proyecto de prueba (borrar)', '', 'activo'],
  ], hoja => {
    hoja.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['activo', 'cerrado'], true).build());
    hoja.setColumnWidth(2, 280);
    hoja.setColumnWidth(3, 200);
  });

  crear_(ss, 'tareas', [
    'Proyecto / diseño', 'Documentación', 'Dirección técnica', 'Visita de obra', 'Planificación',
    'Presupuesto', 'Reunión', 'Administración', 'Otro',
  ].map(t => [t]), hoja => hoja.setColumnWidth(1, 220));

  crear_(ss, 'registros', [], hoja => {
    hoja.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    hoja.getRange('J:L').setNumberFormat('0.##');
    hoja.getRange('N:O').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    const proteccion = hoja.protect().setDescription('La llena la app de horas. No editar a mano.');
    proteccion.setWarningOnly(true);
  });
}

function crear_(ss, clave, filas, extra) {
  if (ss.getSheetByName(HOJAS[clave])) return;
  const hoja = ss.insertSheet(HOJAS[clave]);
  const cab = H[clave];
  hoja.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  if (filas.length) hoja.getRange(2, 1, filas.length, cab.length).setValues(filas);
  if (extra) extra(hoja);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Horas')
    .addItem('Cerrar todas las sesiones', 'cerrarTodasLasSesiones')
    .addToUi();
}
