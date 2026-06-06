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
// Templates sauvegardés "pour toujours" : favoris Photopea (références PSD) + décors IA vierges (fichiers image).
const SAVED_DIR = path.join(__dirname, 'saved-templates');
const SAVED_DB = path.join(SAVED_DIR, 'templates.json');
fs.mkdirSync(SAVED_DIR, { recursive: true });

const app = express();
app.use(cors()); // ouvert : l'UI (servie par le backend ou en local) doit pouvoir appeler ce moteur
app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // sert l'UI aussi en local (test direct)
app.use('/uploads', express.static(UPLOADS));
// servir les aperçus directement depuis le dossier mockups
app.use('/mockups', express.static(MOCKUPS_PATH));
// servir les décors IA sauvegardés (fichiers image persistés)
app.use('/saved', express.static(SAVED_DIR));

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
// Anti path-traversal STRICT : on normalise (path.resolve gère les '..') et on exige une frontière
// de répertoire (root + séparateur), sinon un dossier FRÈRE partageant le préfixe passerait à tort.
function psdDiskPath(psdUrl) {
  const rel = decodeURIComponent(psdUrl.replace(/^\/mockups\//, ''));
  const root = path.resolve(MOCKUPS_PATH);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('chemin invalide');
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

// ---- Templates sauvegardés (favoris Photopea + décors IA vierges) ----
// Stockés dans saved-templates/templates.json : { photopea:[...], ai:[...] }.
// Les décors IA sont aussi écrits comme fichiers image dans saved-templates/ et servis via /saved.
let savedWriteChain = Promise.resolve(); // sérialise les écritures (read-modify-write atomique)

async function readSaved() {
  // IMPORTANT : ne renvoyer une DB vide QUE si le fichier n'existe pas encore (1er run).
  // Toute autre erreur (lecture EBUSY/EACCES, JSON corrompu) est propagée -> mutateSaved
  // abandonne l'écriture et NE remplace PAS le fichier (sinon on perdrait tous les favoris).
  let raw;
  try {
    raw = await fsp.readFile(SAVED_DB, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { photopea: [], ai: [] };
    throw e;
  }
  let db;
  try {
    db = JSON.parse(raw);
  } catch (e) {
    throw new Error('templates.json illisible (corrompu) — écriture annulée pour préserver les données : ' + e.message);
  }
  return { photopea: Array.isArray(db.photopea) ? db.photopea : [], ai: Array.isArray(db.ai) ? db.ai : [] };
}
// Applique une mutation (fn reçoit la db, la modifie, retourne une valeur) de façon sérialisée.
function mutateSaved(fn) {
  const run = async () => {
    const db = await readSaved();
    const result = await fn(db);
    await fsp.writeFile(SAVED_DB, JSON.stringify(db, null, 2));
    return result;
  };
  savedWriteChain = savedWriteChain.then(run, run); // continue même après une erreur précédente
  return savedWriteChain;
}
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Liste tous les templates sauvegardés. Les décors IA reçoivent une `url` servable (/saved/<file>).
app.get('/api/saved-templates', async (req, res) => {
  try {
    const db = await readSaved();
    const ai = db.ai.map((t) => ({ ...t, url: '/saved/' + encodeURIComponent(t.file) }));
    res.json({ success: true, photopea: db.photopea, ai });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Sauvegarde un favori Photopea (référence vers un PSD existant). Dédupe par chemin PSD.
app.post('/api/saved-templates/photopea', async (req, res) => {
  try {
    const { type, category, subName, psd, preview, orientations, context } = req.body || {};
    if (!psd || !subName) return res.status(400).json({ success: false, error: 'psd et subName requis' });
    const rec = await mutateSaved((db) => {
      const existing = db.photopea.find((t) => t.psd === psd);
      if (existing) return existing; // déjà en favori -> idempotent
      const r = {
        id: newId('pp_'), type: type || null, category: category || null, subName,
        psd, preview: preview || null,
        orientations: Array.isArray(orientations) ? orientations : [],
        context: context || null, savedAt: new Date().toISOString(),
      };
      db.photopea.push(r);
      return r;
    });
    res.json({ success: true, template: rec });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Sauvegarde un décor IA vierge : écrit l'image sur disque puis enregistre sa fiche.
app.post('/api/saved-templates/ai', async (req, res) => {
  try {
    const { image, product, orientation, theme, roomType } = req.body || {};
    if (!image || !image.startsWith('data:')) return res.status(400).json({ success: false, error: 'image (dataURL) requise' });
    const m = image.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return res.status(400).json({ success: false, error: 'dataURL invalide' });
    // Allowlist stricte : on n'écrit/sert QUE des images connues (pas de .html/.svg servi tel quel).
    const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };
    const ext = MIME_EXT[m[1].toLowerCase()];
    if (!ext) return res.status(400).json({ success: false, error: 'type image non supporté (png/jpeg/webp uniquement)' });
    const file = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await fsp.writeFile(path.join(SAVED_DIR, file), Buffer.from(m[2], 'base64'));
    let rec;
    try {
      rec = await mutateSaved((db) => {
        const r = {
          id: newId('ai_'), file, product: product || 'canvas',
          orientation: orientation || null, theme: theme || null,
          roomType: roomType || null, // pièce choisie au dropdown -> regroupement par pièce dans l'UI
          savedAt: new Date().toISOString(),
        };
        db.ai.push(r);
        return r;
      });
    } catch (e) {
      await fsp.unlink(path.join(SAVED_DIR, file)).catch(() => {}); // pas d'image orpheline si la fiche échoue
      throw e;
    }
    res.json({ success: true, template: { ...rec, url: '/saved/' + encodeURIComponent(rec.file) } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Supprime un template sauvegardé (et le fichier image pour les décors IA).
app.delete('/api/saved-templates/:kind/:id', async (req, res) => {
  try {
    const { kind, id } = req.params;
    if (kind !== 'photopea' && kind !== 'ai') return res.status(400).json({ success: false, error: 'kind invalide' });
    const removed = await mutateSaved((db) => {
      const arr = db[kind];
      const i = arr.findIndex((t) => t.id === id);
      if (i < 0) return null;
      return arr.splice(i, 1)[0];
    });
    if (!removed) return res.status(404).json({ success: false, error: 'introuvable' });
    if (kind === 'ai' && removed.file) {
      await fsp.unlink(path.join(SAVED_DIR, path.basename(removed.file))).catch(() => {});
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Supprime un mockup du disque (PC, dans MOCKUPS_PATH). Comportement (choix produit) :
//  - on retire les fichiers de l'ORIENTATION visée (le PSD + son aperçu) ;
//  - s'il ne reste PLUS AUCUN PSD dans le dossier sous-catégorie, on supprime le dossier entier
//    (aperçus orphelins, context.txt, etc.). Action définitive sur des fichiers source.
app.delete('/api/mockup', async (req, res) => {
  try {
    const { psd, preview } = req.body || {};
    if (!psd) return res.status(400).json({ success: false, error: 'psd requis' });
    const psdAbs = psdDiskPath(psd); // valide l'anti-traversal + le préfixe MOCKUPS_PATH
    const dir = path.dirname(psdAbs); // dossier SOUS-CATÉGORIE du mockup
    const rel = path.relative(MOCKUPS_PATH, dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
      return res.status(400).json({ success: false, error: 'chemin invalide' });
    const depth = rel.split(path.sep).filter(Boolean).length;
    // garde-fou : on n'autorise le rm d'un DOSSIER que s'il s'agit bien d'un dossier sous-catégorie,
    // JAMAIS d'une catégorie ni d'une racine type. Profondeur attendue : type/cat/sous-cat (3) si
    // structure par type, sinon cat/sous-cat (2). (depth>=2 effacerait toute une catégorie en mode type !)
    const { hasTypeDirs } = await scanMockups();
    const minDepth = hasTypeDirs ? 3 : 2;
    await fsp.unlink(psdAbs).catch(() => {}); // PSD de l'orientation visée (déjà absent = ok)
    if (preview && preview.startsWith('/mockups/')) {
      try { await fsp.unlink(psdDiskPath(preview)); } catch {} // aperçu de cette orientation
    }
    let folderRemoved = false;
    const remaining = await fsp.readdir(dir).catch(() => []);
    const hasPsd = remaining.some((f) => ['.psd', '.psb'].includes(path.extname(f).toLowerCase()));
    if (!hasPsd && depth >= minDepth) {
      await fsp.rm(dir, { recursive: true, force: true }); // plus aucun PSD -> on enlève la sous-catégorie
      folderRemoved = true;
      // hygiène : si le dossier CATÉGORIE parent devient vide, on l'enlève aussi (jamais une racine type).
      const parent = path.dirname(dir);
      const relParent = path.relative(MOCKUPS_PATH, parent);
      const parentDepth = (!relParent || relParent.startsWith('..') || path.isAbsolute(relParent))
        ? 0 : relParent.split(path.sep).filter(Boolean).length;
      if (parentDepth >= 1) {
        const leftover = await fsp.readdir(parent).catch(() => ['x']); // erreur de lecture -> ne rien supprimer
        if (leftover.length === 0) await fsp.rm(parent, { recursive: true, force: true });
      }
    }
    res.json({ success: true, folderRemoved });
  } catch (e) {
    console.error('[mockup delete]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// (collections + publish ne passent PAS par ce moteur : l'UI les appelle directement sur le backend,
//  même origine que la page. Ce serveur ne fait que le rendu local des mockups.)

// ---- Boot ----
(async () => {
  app.listen(PORT, () => console.log(`\n  Moteur de rendu MyselfMonArt → http://localhost:${PORT}\n  Mockups: ${MOCKUPS_PATH}\n`));
  if (process.env.SKIP_ENGINE) { console.log('[photopea] démarrage ignoré (SKIP_ENGINE).'); return; }
  try { await engine.start(); }
  catch (e) { console.error('[photopea] démarrage échoué:', e.message, '\n  Les rendus échoueront tant que le moteur n\'est pas prêt.'); }
})();

process.on('SIGINT', async () => { await engine.stop(); process.exit(0); });
