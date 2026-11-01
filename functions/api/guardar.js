/* Cloudflare Pages Function: POST /api/guardar
   Verifica la contraseña del panel y sube datos.js (y las fotos nuevas)
   a GitHub en un solo commit. Cloudflare redespliega la página solo.

   Variables a configurar en Cloudflare (Settings → Variables and Secrets):
     ADMIN_CLAVE    la contraseña del panel (tipo Secret)
     GITHUB_TOKEN   token de GitHub con permiso "Contents: Read and write" sobre el repo (tipo Secret)
     GITHUB_REPO    usuario/repositorio, ej: mateitocasti/PAGINAMAMA
     GITHUB_BRANCH  rama, normalmente main (opcional)
*/

const FOTO_RE = /^fotos\/[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$/;
const PREFIJO = 'window.DATOS = ';
const MAX_BYTES = 40 * 1024 * 1024;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return new Uint8Array(buf);
}

async function claveCorrecta(recibida, esperada) {
  const [a, b] = await Promise.all([sha256(recibida), sha256(esperada)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function utf8ABase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_CLAVE) return json({ error: 'config' }, 500);

  const clave = request.headers.get('X-Admin-Clave') || '';
  if (!clave || !(await claveCorrecta(clave, env.ADMIN_CLAVE))) {
    return json({ error: 'clave' }, 401);
  }

  const largo = Number(request.headers.get('Content-Length') || 0);
  if (largo > MAX_BYTES) return json({ error: 'grande' }, 413);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'formato' }, 400); }

  if (body.verificar) return json({ ok: true });

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return json({ error: 'config' }, 500);

  // Validar datos.js: tiene que ser exactamente window.DATOS = {json};
  if (typeof body.datos !== 'string' || !body.datos.startsWith(PREFIJO)) {
    return json({ error: 'datos' }, 400);
  }
  try {
    const crudo = body.datos.slice(PREFIJO.length).trim().replace(/;$/, '');
    const obj = JSON.parse(crudo);
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.tortas)) throw new Error();
  } catch {
    return json({ error: 'datos' }, 400);
  }

  const fotos = Array.isArray(body.fotos) ? body.fotos : [];
  for (const f of fotos) {
    if (!f || typeof f.path !== 'string' || !FOTO_RE.test(f.path) ||
        typeof f.base64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(f.base64)) {
      return json({ error: 'foto' }, 400);
    }
  }

  const repo = env.GITHUB_REPO;
  const rama = env.GITHUB_BRANCH || 'main';
  const gh = async (ruta, opciones = {}) => {
    const r = await fetch(`https://api.github.com/repos/${repo}${ruta}`, {
      ...opciones,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'claudina-admin',
        'Content-Type': 'application/json',
      },
    });
    const t = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${t.message || ''}`.trim());
    return t;
  };

  try {
    const ref = await gh(`/git/ref/heads/${rama}`);
    const padre = ref.object.sha;
    const commitPadre = await gh(`/git/commits/${padre}`);

    const arbol = [];
    for (const f of fotos) {
      const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: f.base64, encoding: 'base64' }) });
      arbol.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const blobDatos = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: utf8ABase64(body.datos), encoding: 'base64' }) });
    arbol.push({ path: 'datos.js', mode: '100644', type: 'blob', sha: blobDatos.sha });

    const tree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commitPadre.tree.sha, tree: arbol }) });
    const commit = await gh('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: `Cambios desde el panel admin${fotos.length ? ` (+${fotos.length} foto${fotos.length > 1 ? 's' : ''})` : ''}`,
        tree: tree.sha,
        parents: [padre],
      }),
    });
    await gh(`/git/refs/heads/${rama}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });

    return json({ ok: true, commit: commit.sha });
  } catch (e) {
    return json({ error: 'github', detalle: String(e.message || e) }, 502);
  }
}

export async function onRequest() {
  return json({ error: 'metodo' }, 405);
}
