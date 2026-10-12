# Horas · Sáez Sánchez

Registro diario de horas por proyecto. Cada persona carga, desde el celular o la PC, en qué proyecto
trabajó, qué tipo de tarea hizo y cuántas horas. Gerencia ve todo en un dashboard. El resultado es una
tabla limpia (pestaña **Registros** de la Google Sheet) que después alimenta el gestor de proyectos.

- `index.html`: carga de horas (pensada para el celular).
- `admin.html`: dashboard de gerencia (roles `gerente` y `admin`).
- Es una **app instalable** (PWA): en el celular queda como un ícono más y en la PC se abre en su propia
  ventana. No hace falta ninguna tienda.

## Cómo funciona

```
App (Vercel)  ── POST ──▶  Apps Script (apps-script/horas.gs)  ──▶  Google Sheet "Horas Sáez Sánchez"
```

- Cada uno entra con **su cuenta de Google**. El Apps Script verifica el token con Google, busca el
  email en la pestaña **Personas** y devuelve una sesión que dura 30 días. Nadie del equipo necesita
  acceso a la Sheet.
- Quién carga sale siempre de la sesión, nunca de lo que manda el navegador.
- Sin señal (en obra), lo cargado queda en el teléfono como "sin enviar" y se manda solo cuando vuelve
  la conexión.
- Reglas: de 0,5 a 12 h por fila, máximo 16 h por día, no se cargan días futuros, y los empleados
  pueden cargar o corregir hasta 14 días para atrás (gerencia, sin límite).

## Pestañas de la Sheet

| Pestaña | Columnas | Quién la mantiene |
|---|---|---|
| Personas | email, nombre, area, rol (`empleado` / `gerente` / `admin`), activo, regimen | Gerencia |
| Regimenes | regimen, horas_dia (ej. `Full time` 8, `Part time` 4) | Gerencia |
| Feriados | fecha, nombre | Gerencia |
| Proyectos | codigo, nombre, cliente, estado (`activo` / `cerrado`) | Gerencia |
| Tareas | tarea | Gerencia |
| Registros | la tabla de salida (abajo) | La app. No editar a mano |

- **Sumar a alguien:** una fila en Personas con su email de Google y `activo` tildado.
- **Sacar a alguien:** destildá `activo`. Sus registros quedan.
- **Cerrar un proyecto:** `estado` = `cerrado`. Deja de aparecer para cargar y las horas quedan.
- **Si se pierde un teléfono:** menú **Horas → Cerrar todas las sesiones**. Todos vuelven a entrar con Google.
- Cada persona tiene un **régimen** (pestaña Regimenes) que fija su jornada en horas por día. Se pueden crear
  todos los que hagan falta (`Part time 6 h`, etc.). Una persona sin régimen válido cuenta como 8 h.
- Los **feriados** se cargan a mano en la pestaña Feriados (uno por fila). Ese día no hay jornada.

## Horas extra

Cada día, las horas de una persona completan primero la jornada de su régimen, en el orden en que se
cargaron; lo que pasa de la jornada es **extra**. Sábados, domingos y feriados no tienen jornada: todo
es extra. Aplica a todos los regímenes y no necesita aprobación.

Ejemplo, régimen part time de 4 h: carga 3 h en un proyecto y después 3 h en otro → la primera fila
queda 3 normales, la segunda 1 normal + 2 extra. Si se borra o edita una fila, el día se vuelve a repartir.

La persona lo ve al cargar (aviso en el editor y "N extra" en cada fila) y gerencia en el dashboard
(indicador de horas extra, grilla agrupada por régimen con "+N", filtro por régimen y horas extra por
persona). El cumplimiento compara solo las horas normales con la jornada esperada.
- El rol `admin` (SoyLeo AI) ve el dashboard, pero no se le cuentan horas faltantes.

## Tabla de salida: Registros

Una fila por persona, día, proyecto y tarea. Es el contrato con el gestor de proyectos:

| columna | ejemplo | nota |
|---|---|---|
| id | `r_8f3k2m…` | único y estable (lo genera el teléfono) |
| fecha | 2026-10-12 | día trabajado |
| email, nombre, area | ana@…, Ana Gómez, Desarrollo de Proyectos | quién trabajó y cargó |
| regimen | Part time | su régimen al momento de cargar |
| proyecto_codigo, proyecto_nombre | P-024, Edificio Belgrano | |
| tarea | Documentación | |
| horas | 3.5 | decimal |
| horas_normales, horas_extra | 1.5, 2 | el reparto de esa fila (suman `horas`) |
| nota | Láminas de carpinterías | opcional |
| cargado_en | 2026-10-12 18:42:10 | fecha y hora de carga (hora de Argentina) |
| modificado_en | 2026-10-13 09:10:00 | vacío si nunca se editó |
| estado | `activo` / `borrado` | lo borrado no se elimina, se marca |

Para sincronizar con otro sistema, usá `id` como clave y `modificado_en` / `estado` para detectar
cambios y bajas. El dashboard exporta el mismo formato en CSV (coma, UTF-8).

## Qué se necesita para pasarlo a producción

### Cuentas

| Qué | Para qué | Recomendación |
|---|---|---|
| Cuenta de Google **del estudio** | Es dueña de la Sheet y del Apps Script (el script corre como esa cuenta) | Una cuenta institucional (ej. `sistemas@…`), no la personal de un empleado: si esa persona se va, el sistema queda sin dueño |
| Proyecto en Google Cloud | El Client ID del login. Solo pide nombre y email, así que Google no exige verificación | Con la misma cuenta del estudio. Gratis |
| Hosting estático con funciones | Servir la app y `api/google.js` (login en iPhone) | **Vercel**: el plan Hobby es solo para uso no comercial; para una empresa corresponde el plan Pro. Alternativas gratis con uso comercial: Netlify o Cloudflare Pages (hay que adaptar `api/google.js` al formato de funciones de cada uno) |
| Dominio (opcional) | Ej. `horas.<dominio-del-estudio>` | Un subdominio en el DNS del estudio apuntando al hosting |
| Este repositorio | Deploy automático en cada cambio | Conectarlo al hosting |

### Datos que define el estudio

- El equipo: nombre, **email de Google** de cada persona (Gmail o Workspace), área, rol y régimen (full time, part time…).
- Los regímenes con su jornada diaria y los feriados del año.
  Cada uno entra con ese email; si no está en Personas, la app no lo deja pasar.
- La lista de proyectos, con código y nombre.
- Los tipos de tarea (vienen 9 de ejemplo).
- Quiénes son `gerente` (ven el dashboard) y cuántos días para atrás se puede corregir (`DIAS_EDITABLES` en `horas.gs`).

### Límites conocidos

- Apps Script con cuenta gratuita: 20.000 llamadas externas por día (solo las usa el login) y hasta 30
  ejecuciones simultáneas. Sobra para un equipo de 20–30 personas.
- Cada pedido tarda 1–2 segundos: Apps Script no es instantáneo.
- En cada pedido se lee la pestaña Registros completa. Anda bien con decenas de miles de filas (años
  de uso de un estudio chico). Si crece mucho, archivar por año o pasar a una base de datos.

### Antes de abrirlo al equipo

- [ ] Login real en PC, Android y iPhone (con la app instalada).
- [ ] Cargar, editar y borrar una fila, y verlas en Registros.
- [ ] Entrar con una cuenta que no está en Personas: tiene que rechazarla.
- [ ] Borrar el proyecto `P-000` y las filas de ejemplo de Personas.
- [ ] Mandar al equipo el link y los pasos de "Instalar la app".

## Instalación (una sola vez)

1. **Client ID de Google.** En [Google Cloud Console](https://console.cloud.google.com/) → APIs y
   servicios → Pantalla de consentimiento de OAuth (tipo Externo, publicala) → Credenciales → Crear
   credenciales → ID de cliente de OAuth → **Aplicación web**.
   - Orígenes de JavaScript autorizados: `http://localhost:8080` y `https://<dominio-de-vercel>`.
   - URI de redireccionamiento autorizados: `https://<dominio-de-vercel>/api/google` (para iPhone).
2. **Sheet y Apps Script.** Creá la Google Sheet "Horas Sáez Sánchez" → Extensiones → Apps Script.
   Pegá `apps-script/horas.gs`, poné el Client ID en `CLIENT_ID`, tu email en `ADMIN_EMAIL` y ejecutá `configurar` (aceptá los
   permisos). Crea las pestañas con filas de ejemplo, las tareas y dos proyectos de ejemplo.
3. **Publicar el script.** Implementar → Nueva implementación → Aplicación web. Ejecutar como: **Yo**.
   Quién tiene acceso: **Cualquier persona**. Copiá la URL `/exec`.
4. **Config de la app.** En `assets/config.js` poné `ENDPOINT` (la URL `/exec`) y `GOOGLE_CLIENT_ID`.
5. **Datos reales.** Cargá los emails de cada persona en Personas y la lista de proyectos en Proyectos
   (la define gerencia). Borrá el proyecto `P-000`.
6. **Deploy.** Subí la carpeta `horas/` como proyecto nuevo en Vercel (sin framework; la función
   `api/google.js` se detecta sola). Sumá el dominio al Client ID (paso 1).

Si cambiás `horas.gs`: Implementar → Gestionar implementaciones → editar → Versión nueva (la URL no cambia).
Si cambiás archivos de la app: subí `VERSION` en `sw.js` para que los teléfonos tomen la versión nueva.

## Instalar la app

- **Android (Chrome):** abrí el link, entrá con Google y tocá **Instalar** en el aviso verde (o menú ⋮ → Instalar app).
- **iPhone (Safari):** abrí el link, tocá **Compartir → Agregar a inicio**, abrí la app desde el ícono y entrá con Google.
- **PC (Chrome o Edge):** ícono de instalar en la barra de direcciones. Después se puede anclar a la barra de tareas.

## Probar en local

```
python -m http.server 8080 --directory horas
```

- `http://localhost:8080/?demo` y `http://localhost:8080/admin.html?demo`: **modo demo**, con un
  backend falso en el navegador (`assets/demo.js`) y datos de ejemplo. Sirve para probar la interfaz
  o mostrársela al cliente sin configurar nada. Solo funciona en localhost.
- Sin `?demo`, usa el Apps Script y el login real de Google (el origen `http://localhost:8080` tiene
  que estar en el Client ID).
