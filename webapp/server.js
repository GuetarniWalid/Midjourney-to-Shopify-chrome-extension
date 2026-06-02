// MOTEUR DE RENDU MyselfMonArt Publisher — tourne sur le PC (qui a les PSD + Chrome + Photopea).
// Exposé via un tunnel (Cloudflare) pour être appelé par l'UI servie par le backend.
// Fournit : /api/templates (scan mockups), /api/render (rendu Photopea), /uploads + /mockups (fichiers).
// La page UI (servie ailleurs) appelle ce moteur pour les rendus, et le backend pour collections/publish.
try { require('dotenv').config(); } catch {} // charge .env si présent (optionnel)
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { PhotopeaEngine } = require('./photopea-engine');

// ---- Config (via variables d'environnement) ----
const PORT = process.env.PORT || 4000;
const MOCKUPS_PATH = process.env.MOCKUPS_PATH || String.raw`C:\Users\gueta\Documents\MyselfMonArt - Mockups (templates PSD)`;
const UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
app.use(cors()); // ouvert : l'UI (servie par le backend ou en local) doit pouvoir appeler ce moteur
app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // sert l'UI aussi en local (test direct)
app.use('/uploads', express.static(UPLOADS));
// servir les aperçus directement depuis le dossier mockups
app.use('/mockups', express.static(MOCKUPS_PATH));

// ---- Scan tolérant des mockups (jpg/png, casse, typos d'orientation) ----
const ORI = {
  portrait: [/^portrait$/i, /^portrait\s*\d+$/i],
  landscape: [/^landscape$/i, /^lanscape$/i, /^landsacpe$/i, /^paysage$/i, /^landscape\s*\d+$/i],
  square: [/^square$/i, /^carre$/i, /^carré$/i, /^square\s*\d+$/i],
};
function classifyBase(base) {
  for (const [ori, pats] of Object.entries(ORI)) if (pats.some((p) => p.test(base))) return ori;
  return null;
}

const PRODUCT_TYPES = ['toile', 'poster', 'tapisserie'];

// Scanne <root>/categorie/sous-categorie/*.{psd,png,jpg} et retourne les catégories.
// prefixSegs = segments d'URL à préfixer (ex: ['toile']) pour /mockups/toile/cat/sub/file.
async function scanCategories(root, prefixSegs = []) {
  const categories = [];
  let catDirs;
  try { catDirs = await fsp.readdir(root, { withFileTypes: true }); } catch { return categories; }
  for (const cat of catDirs) {
    if (!cat.isDirectory()) continue;
    const catPath = path.join(root, cat.name);
    const subDirs = await fsp.readdir(catPath, { withFileTypes: true });
    const subcategories = [];
    for (const sub of subDirs) {
      if (!sub.isDirectory()) continue;
      const subPath = path.join(catPath, sub.name);
      const files = await fsp.readdir(subPath);
      const layouts = {}; // ori -> { psd, preview }
      let context = null;
      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        const base = path.basename(f, path.extname(f));
        if (f.toLowerCase() === 'context.txt') {
          try { context = (await fsp.readFile(path.join(subPath, f), 'utf8')).trim(); } catch {}
          continue;
        }
        const ori = classifyBase(base);
        if (!ori) continue;
        layouts[ori] = layouts[ori] || {};
        const segs = [...prefixSegs, cat.name, sub.name, f];
        const urlPath = '/mockups/' + segs.map(encodeURIComponent).join('/');
        if (ext === '.psd' || ext === '.psb') layouts[ori].psd = urlPath;
        else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          if (!layouts[ori].preview) layouts[ori].preview = urlPath;
        }
      }
      const usable = {};
      for (const [ori, v] of Object.entries(layouts)) if (v.psd) usable[ori] = v;
      if (Object.keys(usable).length === 0) continue;
      subcategories.push({ name: sub.name, layouts: usable, orientations: Object.keys(usable), context });
    }
    if (subcategories.length) categories.push({ name: cat.name, subcategories });
  }
  return categories;
}

// Détecte la structure : par TYPE (mockups/toile/…, mockups/poster/…) ou PLATE (rétrocompat).
// Retourne { byType: { toile:[cats], poster:[cats], tapisserie:[cats] } }.
async function scanMockups() {
  const top = await fsp.readdir(MOCKUPS_PATH, { withFileTypes: true }).catch(() => []);
  const topDirs = top.filter(d => d.isDirectory()).map(d => d.name.toLowerCase());
  const hasTypeDirs = PRODUCT_TYPES.some(t => topDirs.includes(t));

  const byType = {};
  if (hasTypeDirs) {
    for (const t of PRODUCT_TYPES) {
      // tolérant à la casse : retrouve le dossier réel correspondant au type
      const real = top.find(d => d.isDirectory() && d.name.toLowerCase() === t);
      byType[t] = real ? await scanCategories(path.join(MOCKUPS_PATH, real.name), [real.name]) : [];
    }
  } else {
    // ancienne structure plate -> mêmes mockups pour les 3 types
    const flat = await scanCategories(MOCKUPS_PATH, []);
    for (const t of PRODUCT_TYPES) byType[t] = flat;
  }
  return { byType, hasTypeDirs };
}

// ---- Moteur Photopea (démarré au boot) ----
const engine = new PhotopeaEngine({});

// ---- API ----
app.get('/api/health', (req, res) => res.json({ ok: true, engineReady: engine.ready, mockupsPath: MOCKUPS_PATH }));

app.get('/api/templates', async (req, res) => {
  try {
    const { byType, hasTypeDirs } = await scanMockups();
    const type = PRODUCT_TYPES.includes(req.query.type) ? req.query.type : null;
    // si ?type= fourni -> renvoie les catégories de ce type ; sinon tout (byType).
    if (type) res.json({ success: true, type, hasTypeDirs, categories: byType[type] || [] });
    else res.json({ success: true, hasTypeDirs, byType });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Résout le chemin disque absolu d'un PSD à partir d'une URL /mockups/...
function psdDiskPath(psdUrl) {
  const rel = decodeURIComponent(psdUrl.replace(/^\/mockups\//, ''));
  const abs = path.join(MOCKUPS_PATH, rel);
  if (!abs.startsWith(MOCKUPS_PATH)) throw new Error('chemin invalide'); // anti path-traversal
  return abs;
}

// POST /api/render { psd: "/mockups/...psd", image: dataURL|url, mockupContext? } -> { success, url, mockupContext }
app.post('/api/render', async (req, res) => {
  try {
    const { psd, image, mockupContext } = req.body || {};
    if (!psd || !image) return res.status(400).json({ success: false, error: 'psd et image requis' });

    const psdAbs = psdDiskPath(psd);
    const psdBuffer = await fsp.readFile(psdAbs);

    // image : dataURL (upload) ou URL http
    let artworkBuffer, artMime = 'image/jpeg';
    if (image.startsWith('data:')) {
      const m = image.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) throw new Error('dataURL invalide');
      artMime = m[1]; artworkBuffer = Buffer.from(m[2], 'base64');
    } else {
      const r = await fetch(image);
      artMime = r.headers.get('content-type') || 'image/jpeg';
      artworkBuffer = Buffer.from(await r.arrayBuffer());
    }

    const out = await engine.render(psdBuffer, artworkBuffer, artMime, 0.92);
    const fname = `mockup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    await fsp.writeFile(path.join(UPLOADS, fname), out);
    res.json({ success: true, url: `/uploads/${fname}`, mockupContext: mockupContext || null });
  } catch (e) {
    console.error('[render]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/upload/:name', async (req, res) => {
  try {
    const name = path.basename(req.params.name); // anti traversal
    await fsp.unlink(path.join(UPLOADS, name));
    res.json({ success: true });
  } catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

// (collections + publish ne passent PAS par ce moteur : l'UI les appelle directement sur le backend,
//  même origine que la page. Ce serveur ne fait que le rendu local des mockups.)

// ---- Boot ----
(async () => {
  app.listen(PORT, () => console.log(`\n  Moteur de rendu MyselfMonArt → http://localhost:${PORT}\n  Mockups: ${MOCKUPS_PATH}\n`));
  try { await engine.start(); }
  catch (e) { console.error('[photopea] démarrage échoué:', e.message, '\n  Les rendus échoueront tant que le moteur n\'est pas prêt.'); }
})();

process.on('SIGINT', async () => { await engine.stop(); process.exit(0); });
