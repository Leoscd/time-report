// Vuelta del login de Google en modo redirect (lo usa la app instalada en iPhone, donde las
// ventanas emergentes no vuelven a la app). Google manda el token por POST a esta URL; acá solo
// se comprueba el token anti-CSRF y se devuelve el token a la app en el fragmento (#c=...), que
// no viaja a ningún servidor. La verificación real del token la hace el Apps Script.
module.exports = (req, res) => {
  const body = req.body || {};
  const cookie = (req.cookies && req.cookies.g_csrf_token) || '';
  if (req.method !== 'POST' || !body.credential || !cookie || cookie !== body.g_csrf_token) {
    res.statusCode = 303;
    res.setHeader('Location', '/');
    return res.end();
  }
  res.statusCode = 303;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', '/#c=' + encodeURIComponent(body.credential));
  res.end();
};
