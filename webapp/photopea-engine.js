// Moteur Photopea PERSISTANT : une seule instance Chrome + iframe Photopea, gardée ouverte,
// qui traite les rendus en file d'attente (un à la fois). Réutilise la mécanique prouvée du POC.
// Reproduit fidèlement le mockup : ouvre le PSD, place l'image dans le smart object "Artwork",
// resize cover, aplatit, sauve (= replace contents), exporte le PNG/JPEG du PSD parent.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.CHROME_PATH,
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (p && fs.existsSync(p)) return p;
  throw new Error('Chrome introuvable. Définis CHROME_PATH.');
}

const PP_CONFIG = encodeURIComponent(JSON.stringify({ environment: { vmode: 0, intro: false } }));
const HOST_HTML = `<!DOCTYPE html><html><body style="margin:0">
<iframe id="pp" src="https://www.photopea.com#${PP_CONFIG}" style="width:1400px;height:1000px;border:0"></iframe>
<script>
  const pp = document.getElementById('pp').contentWindow;
  window.__q = []; window.__strings = []; window.__buffers = [];
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d instanceof ArrayBuffer) { window.__buffers.push(Array.from(new Uint8Array(d))); return; }
    if (typeof d === 'string') { if (d === 'done') { const r = window.__q.shift(); if (r) r(); } else window.__strings.push(d); }
  });
  window.ppSend = (msg) => new Promise((res) => { window.__q.push(res); pp.postMessage(msg, '*'); });
  window.ppOpenUrl = async (u) => { const ab = await (await fetch(u)).arrayBuffer(); return new Promise((res) => { window.__q.push(res); pp.postMessage(ab, '*'); }); };
</script></body></html>`;

const EDIT_SCRIPT = `(function(){var d=app.activeDocument;function f(ls){for(var i=0;i<ls.length;i++){var L=ls[i],n=(L.name||'').toLowerCase();if(n.indexOf('artwork')>=0||n.indexOf('oeuvre')>=0||n.indexOf('add your art')>=0)return L;if(L.layers){var r=f(L.layers);if(r)return r;}}return null;}var a=f(d.layers);if(!a){app.echoToOE('NO_ARTWORK');return;}d.activeLayer=a;executeAction(stringIDToTypeID("placedLayerEditContents"));app.echoToOE('EDIT_OK');})();`;
const REPLACE_SCRIPT = `(function(){var d=app.activeDocument;var L=d.activeLayer;function num(v){if(v==null)return NaN;if(typeof v==='number')return v;if(v.n!==undefined)return v.n;if(v.value!==undefined)return v.value;return Number(v);}function bn(L){var b=L.bounds;return[num(b[0]),num(b[1]),num(b[2]),num(b[3])];}var b=bn(L),lw=b[2]-b[0],lh=b[3]-b[1];if(lw>0&&lh>0){var p=Math.max(d.width/lw,d.height/lh)*100*1.02;L.resize(p,p);var nb=bn(L),cx=(nb[0]+nb[2])/2,cy=(nb[1]+nb[3])/2;L.translate(d.width/2-cx,d.height/2-cy);}d.flatten();d.save();d.close();app.echoToOE('REPLACED');})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class PhotopeaEngine {
  constructor({ getPsdBuffer }) {
    this.getPsdBuffer = getPsdBuffer; // fn(jobKey) -> Buffer du PSD à servir
    this.browser = null;
    this.page = null;
    this.ready = false;
    this.queue = Promise.resolve(); // sérialise les rendus
    this._currentPsd = null;
    this._server = null;
    this._base = null;
  }

  // Démarre Chrome + un mini serveur interne qui sert le PSD courant et l'hôte iframe.
  async start() {
    const http = require('http');
    this._server = http.createServer((q, r) => {
      if (q.url === '/psd' && this._currentPsd) { r.writeHead(200); return r.end(this._currentPsd); }
      r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(HOST_HTML);
    });
    await new Promise((r) => this._server.listen(0, r));
    this._base = 'http://localhost:' + this._server.address().port;

    this.browser = await puppeteer.launch({
      executablePath: findChrome(), headless: 'new', protocolTimeout: 300000,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=8192', '--disable-gpu'],
    });
    this.page = await this.browser.newPage();
    await this.page.goto(this._base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForFunction(() => typeof window.ppSend === 'function', { timeout: 30000 });
    await sleep(8000); // laisser le moteur Photopea s'initialiser
    this.ready = true;
    console.log('[photopea] moteur prêt');
  }

  _S(s) { return this.page.evaluate((x) => window.ppSend(x), s); }
  _strings() { return this.page.evaluate(() => window.__strings.splice(0)); }
  async _probe(expr) {
    await this.page.evaluate(() => { window.__strings.length = 0; });
    await this._S('app.echoToOE(String(' + expr + '))');
    const s = await this._strings();
    return s.length ? s[s.length - 1] : null;
  }
  async _waitFor(expr, ms = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await this._probe(expr)) === 'true') return true; await sleep(500); }
    throw new Error('timeout: ' + expr);
  }

  // Rend un mockup. psdBuffer = Buffer du PSD ; artworkBuffer/artMime = l'oeuvre. Retourne un Buffer JPEG.
  render(psdBuffer, artworkBuffer, artMime = 'image/jpeg', quality = 0.92) {
    // sérialisé : on chaîne sur la queue pour ne traiter qu'un rendu à la fois
    const task = this.queue.then(() => this._renderNow(psdBuffer, artworkBuffer, artMime, quality));
    this.queue = task.catch(() => {}); // la queue ne doit jamais se bloquer sur une erreur
    return task;
  }

  async _renderNow(psdBuffer, artworkBuffer, artMime, quality) {
    if (!this.ready) throw new Error('moteur non démarré');
    const page = this.page, base = this._base;
    this._currentPsd = psdBuffer;
    const artDataUrl = `data:${artMime};base64,${artworkBuffer.toString('base64')}`;

    // reset : fermer tout doc résiduel
    await this._S('while(app.documents.length>0){app.activeDocument.close();}').catch(() => {});
    await page.evaluate(() => { window.__buffers.length = 0; window.__strings.length = 0; });

    // 0) ouvrir le PSD (fetch binaire -> postMessage ; ok gros fichiers)
    await page.evaluate((u) => window.ppOpenUrl(u), base + '/psd');
    await this._waitFor('app.documents.length>=1 && app.activeDocument.width>1');

    // 1) éditer le smart object Artwork
    await page.evaluate((s) => window.ppSend(s), EDIT_SCRIPT);
    const e1 = await this._strings();
    if (e1.includes('NO_ARTWORK')) throw new Error('NO_ARTWORK');
    await this._waitFor('app.documents.length>=2');
    const n0 = parseInt(await this._probe('app.activeDocument.layers.length'), 10) || 1;

    // 2) placer l'oeuvre DANS le SO (asSmart=true)
    await page.evaluate((u) => window.ppSend('app.open("' + u + '", true, true);'), artDataUrl);
    await this._waitFor(`app.documents.length>=2 && app.activeDocument.layers.length>${n0}`);

    // 3) cover + flatten + save (=replace) + close
    await page.evaluate((s) => window.ppSend(s), REPLACE_SCRIPT);
    await this._waitFor('app.documents.length===1');
    await sleep(600);

    // 4) export
    await page.evaluate(() => { window.__buffers.length = 0; });
    await this._S(`app.activeDocument.saveToOE("jpg:${quality}");`);
    await page.waitForFunction(() => window.__buffers.length > 0, { timeout: 60000 });
    const arr = await page.evaluate(() => window.__buffers[window.__buffers.length - 1]);
    return Buffer.from(arr);
  }

  async stop() {
    try { if (this.browser) await this.browser.close(); } catch (e) {}
    if (this._server) this._server.close();
    this.ready = false;
  }
}

module.exports = { PhotopeaEngine };
