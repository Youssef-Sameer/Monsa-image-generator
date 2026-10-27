// Monsa Studio — the whole website runs in this file, inside your browser.
// Everything you save (products, models, images, settings) is kept in this browser only (IndexedDB).

const POLLINATIONS = 'https://gen.pollinations.ai';
const LISTS = ['options', 'prompts', 'models', 'products', 'gallery', 'costs', 'log', 'settings'];
const S = { sel: {}, results: [], adminTab: 'dashboard', optTab: 'productTypes' };
const view = document.getElementById('view');

// ---------- browser storage ----------

const DB = (() => {
  let opened;
  const open = () => opened || (opened = new Promise((resolve, reject) => {
    const r = indexedDB.open('monsa-studio', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('files'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  };
  return {
    get: k => run('kv', 'readonly', s => s.get(k)),
    set: (k, v) => run('kv', 'readwrite', s => s.put(v, k)),
    del: k => run('kv', 'readwrite', s => s.delete(k)),
    getFile: id => run('files', 'readonly', s => s.get(id)),
    putFile: (id, blob) => run('files', 'readwrite', s => s.put(blob, id)),
    delFile: id => run('files', 'readwrite', s => s.delete(id)),
    fileIds: () => run('files', 'readonly', s => s.getAllKeys()),
    clear: store => run(store, 'readwrite', s => s.clear()),
  };
})();

const clone = o => JSON.parse(JSON.stringify(o));
const fallback = name => DEFAULTS[name] ? clone(DEFAULTS[name]) : name === 'settings' ? {} : [];
const save = name => DB.set(name, S[name]);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function saveFile(blob) {
  const id = newId();
  await DB.putFile(id, blob);
  return id;
}

const urlCache = {};
async function fileUrl(id) {
  if (!(id in urlCache)) { const b = await DB.getFile(id); urlCache[id] = b ? URL.createObjectURL(b) : ''; }
  return urlCache[id];
}

// An <img> that loads its picture from browser storage.
function pic(id, attrs = {}) {
  const el = h('img', attrs);
  if (id) fileUrl(id).then(u => { el.src = u; });
  return el;
}

const extOf = type => type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg';

async function downloadFile(id, name) {
  const b = await DB.getFile(id);
  if (!b) return toast('File not found.', true);
  const a = h('a', { href: URL.createObjectURL(b), download: name + extOf(b.type) });
  document.body.append(a); a.click(); a.remove();
}

function downloadBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
}

function log(what) {
  S.log.unshift({ at: new Date().toISOString(), what });
  if (S.log.length > 1000) S.log.length = 1000;
  save('log');
}

// ---------- small helpers ----------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

// Replaces what's inside an element, skipping empty (null/false) parts.
function put(el, ...kids) {
  el.replaceChildren();
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
}

function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), err ? 6000 : 2500);
}

async function busy(btn, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Working…';
  try { return await fn(); } catch (e) { console.error(e); toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = old; }
}

const enabled = list => (list || []).filter(x => x.enabled !== false);
const def = list => (list.find(x => x.default) || list[0] || {}).id;
const byId = (list, id) => (list || []).find(x => x.id === id);
const pick = (list, id) => byId(S.options[list], id) || byId(S.options[list], def(S.options[list] || [])) || {};
const F = () => S.options.features || {};
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const month = () => new Date().toISOString().slice(0, 7);

// Shrinks a photo before saving (keeps it sharp, max 1600px).
function readImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(resolve, 'image/jpeg', 0.92);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Could not read ' + file.name));
    img.src = URL.createObjectURL(file);
  });
}

function chips(items, current, onPick, extra) {
  return h('div', { class: 'chips' }, items.map(it =>
    h('button', { class: 'chip' + (it.id === current ? ' on' : ''), onclick: () => onPick(it.id) },
      extra ? extra(it) : null, it.name)));
}

function step(n, title, ...body) {
  return h('section', { class: 'card' }, h('div', { class: 'step-title' }, h('span', { class: 'step-num' }, n), h('h2', {}, title)), ...body);
}

function modal(...content) {
  const m = h('div', { class: 'modal', onclick: e => { if (e.target === m) m.remove(); } }, h('div', {}, ...content));
  document.body.append(m);
  return m;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- start-up ----------

async function boot() {
  for (const name of LISTS) {
    const v = await DB.get(name);
    S[name] = v === undefined ? fallback(name) : v;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  const siteName = S.settings.siteName || 'Monsa Studio';
  document.title = siteName;
  document.getElementById('brand').textContent = siteName;
  if (!S.settings.setupDone) return renderWelcome();
  document.getElementById('top').hidden = false;
  route();
}

function renderWelcome() {
  const pass = h('input', { type: 'password', placeholder: 'Admin passcode (optional)' });
  const btn = h('button', { class: 'btn' }, 'Start');
  btn.onclick = () => busy(btn, async () => {
    if (pass.value) S.settings.adminHash = await sha256(pass.value);
    S.settings.setupDone = true;
    await save('settings');
    log('Started Monsa Studio');
    boot();
  });
  put(view, h('div', { class: 'card auth' },
    h('h1', {}, 'Welcome to Monsa Studio'),
    h('p', {}, 'Everything you make here is saved in this browser, on this device.'),
    h('p', { class: 'muted' }, 'Choose a passcode to lock the Admin page (where settings and the AI key are). Leave it empty for no lock.'),
    pass, h('div', { style: 'margin-top:16px' }, btn)));
}

document.getElementById('lockBtn').onclick = () => { sessionStorage.removeItem('monsa-admin'); location.hash = 'create'; route(); };
document.getElementById('menuBtn').onclick = () => document.getElementById('nav').classList.toggle('open');
window.addEventListener('hashchange', () => S.settings && S.settings.setupDone && route());

function route() {
  const page = (location.hash.slice(1) || 'create').split('/')[0];
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + page));
  document.getElementById('nav').classList.remove('open');
  document.getElementById('lockBtn').hidden = !(S.settings.adminHash && sessionStorage.getItem('monsa-admin'));
  const pages = { create: renderCreate, products: renderProducts, models: renderModels, gallery: renderGallery, admin: renderAdmin };
  (pages[page] || renderCreate)();
  window.scrollTo(0, 0);
}

// ---------- the image engine (Pollinations) ----------

function b64ToBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const type = bytes[0] === 0x89 ? 'image/png' : bytes[8] === 0x57 ? 'image/webp' : 'image/jpeg';
  return new Blob([bytes], { type });
}

// Sends a prompt (+ reference images) to Pollinations and returns the new image. Swap this to use another service.
async function callEngine(engine, prompt, refIds, w, hgt, seed) {
  const key = (S.settings.pollinationsKey || '').trim();
  if (!key) throw new Error('No Pollinations key yet. Add it in Admin > Settings, or use Copy prompt instead.');
  const refs = refIds.slice(0, engine.maxRefs || 10);
  const size = engine.sizeRule === 'openai' ? (w === hgt ? '1024x1024' : w < hgt ? '1024x1536' : '1536x1024') : `${w}x${hgt}`;
  let res;
  if (!refs.length) {
    const body = { prompt, model: engine.model, size, response_format: 'b64_json' };
    if (seed >= 0) body.seed = seed;
    res = await fetch(POLLINATIONS + '/v1/images/generations', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } else {
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('model', engine.model);
    fd.append('size', size);
    fd.append('response_format', 'b64_json');
    if (seed >= 0) fd.append('seed', String(seed));
    for (const id of refs) {
      const b = await DB.getFile(id);
      if (b) fd.append('image', b, id + extOf(b.type));
    }
    res = await fetch(POLLINATIONS + '/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const err = json && json.error;
    throw new Error('The AI service said: ' + ((err && (err.message || err)) || text.slice(0, 200)));
  }
  const first = json.data[0];
  if (first.b64_json) return b64ToBlob(first.b64_json);
  return (await fetch(first.url)).blob();
}

// ---------- prompts, cost & limits ----------

// Builds the full prompt and the list of reference images for a generation request.
function buildJob(r) {
  const P = S.prompts;
  const product = byId(S.products, r.productId);
  if (!product) throw new Error('Please choose a product first.');
  const type = pick('productTypes', product.type);
  const style = pick('styles', r.style);
  const onModel = r.mode === 'onModel';
  const model = onModel ? byId(S.models, r.modelId) : null;
  if (onModel && !model) throw new Error('Please choose a model.');
  const size = pick('sizes', r.size);
  let bg = r.customColor;
  if (bg) bg = 'the colour ' + bg;
  else { const b = pick('backgrounds', r.background); bg = `${(b.name || 'deep blue').toLowerCase()} (${b.color || '#1f3a8a'})`; }

  const refs = [...product.images];
  const productCount = refs.length;
  if (model) refs.push(...(model.images || []));
  const modelCount = refs.length - productCount;
  const v = {
    product_type: (type.name || 'product').toLowerCase(), background: bg,
    scene: pick('scenes', r.scene).prompt || '', pose: pick('poses', r.pose).prompt || '',
    framing: pick('framings', r.framing).prompt || '', outfit: pick('outfits', r.outfit).prompt || '',
    ratio: size.ratio || '4:5', product_count: String(productCount),
    model_part: model && modelCount ? `; the next ${modelCount} image(s) show the model` : '',
  };
  const base = !onModel ? 'productOnly' : type.id === 'clothing' ? 'clothingOnModel' : 'onModel';
  const parts = [P[base], model && `The model: ${model.description}.`, style.prompt, type.prompt, P.references, P.aspect, P.accuracy,
    r.extra && r.extra.trim() && 'Extra notes: ' + r.extra.trim()];
  const prompt = fill(parts.filter(p => p && p.trim()).join('\n\n'), v);
  return { prompt, refs, size, product, model, style };
}

function usage() {
  const m = month();
  const monthCost = [...S.gallery, ...S.costs].filter(g => (g.createdAt || '').startsWith(m)).reduce((a, g) => a + (g.cost || 0), 0);
  const limit = Number(S.settings.monthlyCostLimit) || 0;
  return { monthCost, limit, near: limit > 0 && monthCost >= limit * 0.8 };
}

function checkLimit(cost) {
  const u = usage();
  if (u.limit > 0 && u.monthCost + cost > u.limit) throw new Error(`The monthly cost limit (${u.limit} pollen) has been reached. You can raise it in Admin > Settings.`);
}

async function addToGallery(blob, settings, prompt, engine, cost, style) {
  const s = { ...settings };
  delete s.likeImage;
  const entry = {
    id: newId(), file: await saveFile(blob), productId: settings.productId || '',
    modelId: settings.mode === 'onModel' ? settings.modelId || '' : '', style: style.id || '', mode: settings.mode || '',
    engine: engine.id, engineName: engine.name, cost, prompt, settings: s, createdAt: new Date().toISOString(),
  };
  S.gallery.push(entry);
  await save('gallery');
  return entry;
}

const engine = id => { const e = pick('engines', id); if (!e.id) throw new Error('No AI engine is set up. Add one in Admin > Options.'); return e; };
const rand = () => Math.floor(Math.random() * 2e9);

async function generate(r) {
  const job = buildJob(r);
  const eng = engine(r.engine);
  let prompt = job.prompt;
  const refs = [...job.refs];
  if (r.likeImage) { refs.push(r.likeImage); prompt += '\n\n' + S.prompts.moreLikeThis; }
  const count = Math.max(1, Math.min(4, r.count || 1));
  const cost = eng.costPerImage || 0;
  checkLimit(cost * count);
  const settled = await Promise.allSettled(Array.from({ length: count }, () => callEngine(eng, prompt, refs, job.size.width, job.size.height, rand())));
  const images = [], errors = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') images.push(await addToGallery(s.value, r, prompt, eng, cost, job.style));
    else errors.push(s.reason.message);
  }
  if (!images.length) throw new Error(errors[0] || 'Generation failed.');
  log(`Generated ${images.length} image(s) of ${job.product.name}`);
  return { images, errors };
}

async function editImage(g, instruction) {
  if (!instruction.trim()) throw new Error('Type what you want to change.');
  const eng = engine(g.settings.engine);
  const product = byId(S.products, g.productId);
  const refs = [g.file, ...(product ? product.images : [])];
  const prompt = fill(S.prompts.edit, { instruction });
  checkLimit(eng.costPerImage || 0);
  const size = pick('sizes', g.settings.size);
  const blob = await callEngine(eng, prompt, refs, size.width, size.height, -1);
  const entry = await addToGallery(blob, { ...g.settings, editOf: g.id, instruction }, prompt, eng, eng.costPerImage || 0, pick('styles', g.style));
  log('Edited an image: ' + instruction);
  return { images: [entry], errors: [] };
}

// ---------- Create page ----------

function defaults() {
  const o = S.options, s = S.sel;
  const modes = [F().onModel && 'onModel', F().productOnly && 'productOnly'].filter(Boolean);
  if (!modes.includes(s.mode)) s.mode = modes[0];
  for (const [key, list] of [['style', 'styles'], ['background', 'backgrounds'], ['scene', 'scenes'], ['pose', 'poses'],
    ['framing', 'framings'], ['outfit', 'outfits'], ['size', 'sizes'], ['engine', 'engines']])
    if (!byId(enabled(o[list]), s[key])) s[key] = def(enabled(o[list]));
  if (!byId(enabled(S.models), s.modelId)) s.modelId = def(enabled(S.models));
  if (!byId(S.products, s.productId)) s.productId = (S.products[S.products.length - 1] || {}).id;
  s.count = s.count || 1;
}

function renderCreate() {
  defaults();
  const o = S.options, s = S.sel;
  const rerender = () => renderCreate();
  const set = (k, v) => { s[k] = v; if (k === 'background') s.customColor = ''; rerender(); };
  const style = byId(o.styles, s.style) || {};
  const product = byId(S.products, s.productId);
  const isClothing = product && product.type === 'clothing';
  const onModel = s.mode === 'onModel';
  const eng = byId(o.engines, s.engine);
  const n = (() => { let i = 0; return () => ++i; })();

  const parts = [h('h1', {}, 'Create images')];
  if (!S.settings.pollinationsKey && F().oneClickGenerate) parts.push(h('div', { class: 'notice' },
    'No AI key yet, so one-click Generate won\'t work. You can still use "Copy prompt" below. ',
    h('a', { href: '#admin/settings' }, 'Add the free Pollinations key')));
  if (usage().near) parts.push(h('div', { class: 'notice' }, 'This month\'s cost is close to the limit set in Admin > Settings.'));

  // 1. product
  parts.push(step(n(), 'Product',
    S.products.length ? h('div', { class: 'grid' }, S.products.map(p =>
      h('div', { class: 'tile' + (p.id === s.productId ? ' on' : ''), onclick: () => set('productId', p.id) },
        pic(p.images[0], { loading: 'lazy' }),
        h('div', { class: 'cap' }, h('b', {}, p.name), (byId(o.productTypes, p.type) || {}).name || p.type)))) : h('p', { class: 'muted' }, 'No products yet. Upload your first one:'),
    uploadProductForm(p => { s.productId = p.id; rerender(); })));

  // 2. mode
  const modes = [F().onModel && { id: 'onModel', name: 'On model' }, F().productOnly && { id: 'productOnly', name: 'Product only' }].filter(Boolean);
  if (modes.length > 1) parts.push(step(n(), 'Mode', chips(modes, s.mode, v => set('mode', v))));

  // 3. model
  if (onModel) {
    const models = enabled(S.models);
    parts.push(step(n(), 'Model', models.length ? h('div', { class: 'grid' }, models.map(m =>
      h('div', { class: 'tile' + (m.id === s.modelId ? ' on' : ''), onclick: () => set('modelId', m.id) },
        m.images.length ? pic(m.images[0], { loading: 'lazy' }) : h('div', { class: 'empty-img' }, 'No reference image yet — make one on the Models page'),
        h('div', { class: 'cap' }, h('b', {}, m.name))))) : h('p', { class: 'muted' }, 'No models yet. Add one on the Models page.')));
  }

  // 4. style
  parts.push(step(n(), 'Style', chips(enabled(o.styles), s.style, v => set('style', v))));

  // 5. options
  const opt = [];
  if (style.usesBackground) {
    const custom = h('input', { type: 'color', value: s.customColor || '#1f3a8a', oninput: e => { s.customColor = e.target.value; }, onchange: rerender });
    opt.push(h('label', {}, 'Background colour'), h('div', { class: 'row' },
      chips(enabled(o.backgrounds), s.customColor ? null : s.background, v => set('background', v), it => h('span', { class: 'swatch', style: 'background:' + it.color })),
      h('span', { class: 'check' }, 'Custom:', custom)));
  }
  if (style.usesScene) opt.push(h('label', {}, 'Scene'), chips(enabled(o.scenes), s.scene, v => set('scene', v)));
  if (onModel) {
    opt.push(h('label', {}, 'Pose'), chips(enabled(o.poses), s.pose, v => set('pose', v)));
    opt.push(h('label', {}, 'Framing'), chips(enabled(o.framings), s.framing, v => set('framing', v)));
    opt.push(h('label', {}, isClothing ? 'Rest of the outfit' : 'Model outfit'), chips(enabled(o.outfits), s.outfit, v => set('outfit', v)));
  }
  opt.push(h('label', {}, 'Size'), chips(enabled(o.sizes), s.size, v => set('size', v)));
  opt.push(h('label', {}, 'Number of variations'), chips([1, 2, 3, 4].map(i => ({ id: i, name: String(i) })), s.count, v => set('count', v)));
  if (enabled(o.engines).length > 1) opt.push(h('label', {}, 'AI engine'), chips(enabled(o.engines), s.engine, v => set('engine', v)));
  opt.push(h('label', {}, 'Extra notes (optional)'), h('input', { value: s.extra || '', placeholder: 'e.g. gold jewellery, warm afternoon light', oninput: e => (s.extra = e.target.value) }));
  parts.push(step(n(), 'Options', ...opt));

  // summary bar
  const cost = eng ? (eng.costPerImage || 0) * s.count : 0;
  const genBtn = h('button', { class: 'btn' }, 'Generate');
  genBtn.onclick = () => busy(genBtn, async () => {
    toast('Generating… this can take up to a minute.');
    const r = await generate({ ...s });
    S.results = [...r.images, ...S.results];
    if (r.errors.length) toast(`${r.errors.length} image(s) failed: ${r.errors[0]}`, true); else toast('Done!');
    renderResults();
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
  });
  const copyBtn = h('button', { class: 'btn ghost', onclick: () => busy(copyBtn, showCopyPrompt) }, 'Copy prompt');
  parts.push(h('div', { class: 'summary' },
    h('div', { class: 'grow' }, product ? product.name : 'Choose a product', ' · ', s.count, ' image(s)',
      eng && F().oneClickGenerate ? h('div', { style: 'font-size:13px;opacity:.85' }, `Estimated cost ≈ ${+cost.toFixed(4)} pollen (${eng.name})`) : null),
    F().copyPrompt ? copyBtn : null, F().oneClickGenerate ? genBtn : null));

  parts.push(h('div', { id: 'results' }));
  put(view, ...parts);
  renderResults();
}

function uploadProductForm(onDone) {
  const types = enabled(S.options.productTypes);
  const name = h('input', { placeholder: 'Product name, e.g. "Red crochet clutch"' });
  const type = h('select', {}, types.map(t => h('option', { value: t.id }, t.name)));
  const files = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const btn = h('button', { class: 'btn small' }, 'Upload product');
  btn.onclick = () => busy(btn, async () => {
    if (!files.files.length) throw new Error('Choose one or more photos first.');
    const images = [];
    for (const f of files.files) images.push(await saveFile(await readImage(f)));
    const p = { id: newId(), name: name.value || files.files[0].name, type: type.value, images, createdAt: new Date().toISOString() };
    S.products.push(p);
    await save('products');
    log('Uploaded product ' + p.name);
    toast('Product saved');
    onDone(p);
  });
  return h('details', { style: 'margin-top:12px' }, h('summary', { style: 'cursor:pointer;color:var(--red)' }, '+ Upload a new product'),
    h('label', {}, 'Name'), name, h('label', {}, 'Type'), type,
    h('label', {}, 'Photos (front, side, detail — same product). Plain background photos work best.'), files,
    h('div', { style: 'margin-top:10px' }, btn));
}

function renderResults() {
  const box = document.getElementById('results');
  if (!box) return;
  if (!S.results.length) return put(box);
  put(box, h('h2', { style: 'margin-top:24px' }, 'Results'), h('div', { class: 'grid big' }, S.results.map(resultCard)));
}

function resultCard(g) {
  const ai = g.engine !== 'manual' && F().oneClickGenerate;
  const editIn = h('input', { placeholder: 'e.g. make the background beige' });
  return h('div', { class: 'tile', style: 'cursor:default' },
    pic(g.file, { onclick: () => openImage(g), style: 'cursor:zoom-in' }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn small ghost', onclick: () => downloadFile(g.file, 'monsa-' + g.id) }, 'Download'),
      ai ? actionBtn('Regenerate', () => generate({ ...g.settings, count: 1 })) : null,
      ai && F().moreLikeThis ? actionBtn('More like this', () => generate({ ...g.settings, count: 1, likeImage: g.file })) : null),
    ai && F().editText ? h('div', { class: 'actions' }, editIn, actionBtn('Apply edit', () => editImage(g, editIn.value))) : null);

  function actionBtn(label, fn) {
    const b = h('button', { class: 'btn small ghost' }, label);
    b.onclick = () => busy(b, async () => {
      toast('Working… this can take up to a minute.');
      const r = await fn();
      if (r.errors.length) toast(r.errors[0], true); else toast('New image added');
      S.results = [...r.images, ...S.results];
      if (location.hash.startsWith('#gallery') || location.hash.startsWith('#admin')) { document.querySelectorAll('.modal').forEach(m => m.remove()); route(); }
      else renderResults();
    });
    return b;
  }
}

async function showCopyPrompt() {
  const job = buildJob({ ...S.sel });
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const up = h('button', { class: 'btn small' }, 'Save to my gallery');
  up.onclick = () => busy(up, async () => {
    if (!file.files.length) throw new Error('Choose the image(s) you made first.');
    for (const f of file.files) {
      const g = await addToGallery(await readImage(f, 2400), { ...S.sel }, job.prompt, { id: 'manual', name: 'Copy prompt (manual)' }, 0, job.style);
      S.results.unshift(g);
    }
    log('Saved a result made with Copy prompt');
    toast('Saved to gallery');
    m.remove();
    renderResults();
  });
  const m = modal(
    h('h2', {}, 'Copy prompt'),
    h('ol', { class: 'muted', style: 'padding-left:18px' },
      h('li', {}, 'Download the reference photos below (product first, then model).'),
      h('li', {}, 'Open ', h('a', { href: 'https://gemini.google.com/app', target: '_blank' }, 'Gemini'), ' or ',
        h('a', { href: 'https://chatgpt.com', target: '_blank' }, 'ChatGPT'), ', attach the photos and paste the prompt.'),
      h('li', {}, 'Download the image it makes and save it here, so it is kept with its settings.')),
    h('div', { class: 'row', style: 'margin:10px 0' }, job.refs.map((f, i) =>
      pic(f, { title: 'Download', onclick: () => downloadFile(f, `reference-${i + 1}`), style: 'width:80px;height:100px;object-fit:cover;border-radius:8px;margin:0;cursor:pointer' }))),
    h('textarea', { class: 'prompt-box', readonly: true, value: job.prompt }),
    h('div', { class: 'row', style: 'margin:10px 0 18px' },
      h('button', { class: 'btn small', onclick: () => { navigator.clipboard.writeText(job.prompt); toast('Prompt copied'); } }, 'Copy prompt'),
      h('button', { class: 'btn small ghost', onclick: () => m.remove() }, 'Close')),
    h('h3', {}, 'Save the result'), file, h('div', { style: 'margin-top:10px' }, up));
}

function openImage(g) {
  const prod = byId(S.products, g.productId), model = byId(S.models, g.modelId), style = byId(S.options.styles, g.style);
  const del = h('button', { class: 'btn small ghost' }, 'Delete');
  const m = modal(
    pic(g.file),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => downloadFile(g.file, 'monsa-' + g.id) }, 'Download'), del,
      h('button', { class: 'btn small ghost', onclick: () => m.remove() }, 'Close')),
    h('p', { class: 'muted' }, [prod && 'Product: ' + prod.name, model && 'Model: ' + model.name, style && 'Style: ' + style.name,
      'Engine: ' + (g.engineName || g.engine), new Date(g.createdAt).toLocaleString()].filter(Boolean).join(' · ')),
    g.settings && g.settings.instruction ? h('p', {}, 'Edit: ' + g.settings.instruction) : null,
    resultCard(g),
    h('details', {}, h('summary', { style: 'cursor:pointer' }, 'Prompt used'), h('pre', { style: 'white-space:pre-wrap;font-size:12px' }, g.prompt)));
  del.onclick = () => busy(del, async () => {
    if (!confirm('Delete this image?')) return;
    S.gallery = S.gallery.filter(x => x.id !== g.id);
    S.results = S.results.filter(x => x.id !== g.id);
    await save('gallery');
    await DB.delFile(g.file);
    log('Deleted an image');
    m.remove();
    route();
    toast('Deleted');
  });
}

// ---------- Products page ----------

function renderProducts() {
  put(view, h('h1', {}, 'Products'),
    h('div', { class: 'card' }, uploadProductForm(() => renderProducts())),
    S.products.length ? h('div', { class: 'grid' }, S.products.map(p => {
      const del = h('button', { class: 'btn small ghost' }, 'Delete');
      del.onclick = () => busy(del, async () => {
        if (!confirm('Delete "' + p.name + '"? Its generated images stay in the gallery.')) return;
        S.products = S.products.filter(x => x.id !== p.id);
        await save('products');
        for (const f of p.images) await DB.delFile(f);
        log('Deleted product ' + p.name);
        renderProducts();
      });
      return h('div', { class: 'tile', style: 'cursor:default' },
        pic(p.images[0], { loading: 'lazy' }),
        h('div', { class: 'cap' }, h('b', {}, p.name), `${(byId(S.options.productTypes, p.type) || {}).name || p.type} · ${p.images.length} photo(s)`),
        h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => { S.sel.productId = p.id; location.hash = 'create'; } }, 'Use'), del));
    })) : h('p', { class: 'muted' }, 'No products yet.'));
}

// ---------- Models page ----------

function renderModels() {
  const add = h('button', { class: 'btn', onclick: () => modelEditor({ name: '', description: '', images: [] }) }, '+ Create model');
  put(view, h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Model library'), add),
    h('p', { class: 'muted' }, 'Each model\'s reference images are sent with every generation, so she looks the same in all your photos.'),
    h('div', { class: 'grid' }, enabled(S.models).map(m =>
      h('div', { class: 'tile', onclick: () => modelEditor(m) },
        m.images.length ? pic(m.images[0], { loading: 'lazy' }) : h('div', { class: 'empty-img' }, 'No reference yet — tap to generate one'),
        h('div', { class: 'cap' }, h('b', {}, m.name), h('span', { class: 'muted' }, m.description.slice(0, 70) + (m.description.length > 70 ? '…' : '')))))));
}

const MODEL_PICKS = {
  'Skin tone': ['fair skin', 'light olive skin', 'warm brown skin', 'deep brown skin'],
  Hair: ['long dark hair', 'shoulder-length wavy hair', 'curly hair in a low bun', 'covered (hijab)'],
  Hijab: ['no hijab', 'neutral beige hijab', 'soft white hijab', 'black hijab'],
  Style: ['casual modern', 'modern modest', 'flowing linen abaya', 'elegant minimal'],
  Age: ['early 20s', 'mid 20s', 'around 30', 'around 40'],
  Body: ['slim', 'average build', 'curvy', 'tall and slim'],
};

function modelEditor(m) {
  const isNew = !m.id;
  const images = [...m.images];
  const name = h('input', { value: m.name, placeholder: 'e.g. Model A' });
  const desc = h('textarea', { value: m.description, placeholder: 'Describe her: age, skin tone, hair, hijab, style, body type…' });
  const picks = h('div', { class: 'row' }, Object.entries(MODEL_PICKS).map(([label, vals]) =>
    h('select', { style: 'width:auto', onchange: e => { if (e.target.value) desc.value = (desc.value ? desc.value.replace(/[,\s]+$/, '') + ', ' : '') + e.target.value; e.target.value = ''; } },
      h('option', { value: '' }, label + '…'), vals.map(v => h('option', { value: v }, v)))));
  const photos = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const consent = h('input', { type: 'checkbox' });
  const imgBox = h('div', { class: 'row', style: 'margin:10px 0' });
  const drawImages = () => put(imgBox, images.length ? images.map((f, i) => h('div', { style: 'position:relative' },
    pic(f, { style: 'width:120px;height:120px;object-fit:cover;border-radius:10px;margin:0' }),
    h('button', { class: 'btn small ghost', style: 'position:absolute;top:4px;right:4px;background:#fff', onclick: () => { images.splice(i, 1); drawImages(); } }, '✕'))) : h('span', { class: 'muted' }, 'No reference images yet.'));
  drawImages();
  const sheetPrompt = () => fill(S.prompts.modelSheet, { description: desc.value });

  const gen = h('button', { class: 'btn small' }, 'Generate reference sheet');
  gen.onclick = () => busy(gen, async () => {
    toast('Generating… this can take up to a minute.');
    const eng = engine(S.sel.engine);
    checkLimit(eng.costPerImage || 0);
    const refs = [];
    for (const f of photos.files) refs.push(await saveFile(await readImage(f)));
    const blob = await callEngine(eng, sheetPrompt(), refs, 1536, 1024, -1);
    images.unshift(await saveFile(blob));
    S.costs.push({ cost: eng.costPerImage || 0, what: 'Model sheet', createdAt: new Date().toISOString() });
    await save('costs');
    drawImages();
  });
  const copy = h('button', { class: 'btn small ghost', onclick: async () => {
    await navigator.clipboard.writeText(sheetPrompt());
    toast('Prompt copied — paste it into Gemini/ChatGPT, then add the result with the photo upload below.');
  } }, 'Copy prompt');
  const addPhotos = h('button', { class: 'btn small ghost' }, 'Add these photos as references');
  addPhotos.onclick = () => busy(addPhotos, async () => {
    if (!photos.files.length) throw new Error('Choose photos first.');
    if (!consent.checked) throw new Error('Please confirm she agreed (or that the image is AI-made).');
    for (const f of photos.files) images.push(await saveFile(await readImage(f)));
    photos.value = '';
    drawImages();
  });
  const saveBtn = h('button', { class: 'btn' }, 'Save model');
  saveBtn.onclick = () => busy(saveBtn, async () => {
    if (!name.value.trim()) throw new Error('Give her a name.');
    let target = byId(S.models, m.id);
    if (!target) { target = { id: 'model-' + newId(), enabled: true, default: false }; S.models.push(target); }
    Object.assign(target, { name: name.value.trim(), description: desc.value, images });
    await save('models');
    log('Saved model ' + target.name);
    toast('Model saved');
    mod.remove();
    renderModels();
  });

  const mod = modal(
    h('h2', {}, isNew ? 'Create model' : 'Edit ' + m.name),
    h('label', {}, 'Name'), name,
    h('label', {}, 'Quick picks (adds to the description)'), picks,
    h('label', {}, 'Description'), desc,
    h('h3', { style: 'margin-top:16px' }, 'Reference images'),
    h('p', { class: 'muted' }, 'The first image is her main picture. Keep only the ones you like; remove others with ✕. Press "Save model" to keep changes.'),
    imgBox,
    F().oneClickGenerate ? gen : null, ' ', F().copyPrompt ? copy : null,
    h('label', { style: 'margin-top:14px' }, 'Or upload photos (a real model who agreed, or images you made elsewhere). If you then press "Generate", they are also used as the face reference.'),
    photos, h('label', { class: 'check' }, consent, 'She agreed to be used / the image is AI-made'), addPhotos,
    h('div', { class: 'row', style: 'margin-top:18px' }, saveBtn, h('button', { class: 'btn ghost', onclick: () => mod.remove() }, 'Cancel')));
}

// ---------- Gallery page ----------

const galleryFilter = { product: '', model: '', style: '' };
function renderGallery() {
  const f = galleryFilter;
  const items = S.gallery.slice().reverse().filter(g => (!f.product || g.productId === f.product) && (!f.model || g.modelId === f.model) && (!f.style || g.style === f.style));
  const picked = new Set();
  const sel = (key, list) => h('select', { style: 'width:auto', onchange: e => { f[key] = e.target.value; renderGallery(); } },
    h('option', { value: '' }, 'All ' + key + 's'), list.map(x => h('option', { value: x.id, selected: f[key] === x.id }, x.name)));
  const zipBtn = h('button', { class: 'btn small' }, 'Download as zip');
  zipBtn.onclick = () => busy(zipBtn, async () => {
    const chosen = picked.size ? items.filter(i => picked.has(i.id)) : items;
    if (!chosen.length) throw new Error('Nothing to download.');
    const zip = new JSZip();
    for (const g of chosen) { const b = await DB.getFile(g.file); if (b) zip.file('monsa-' + g.id + extOf(b.type), b); }
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'monsa-images.zip');
  });
  put(view, h('h1', {}, 'Gallery'),
    h('div', { class: 'row', style: 'margin-bottom:14px' }, sel('product', S.products), sel('model', S.models), sel('style', S.options.styles),
      h('span', { class: 'grow muted' }, items.length + ' image(s) · tick images to zip only those'), F().zipDownload ? zipBtn : null),
    items.length ? h('div', { class: 'grid' }, items.map(g =>
      h('div', { class: 'tile', onclick: () => openImage(g) },
        h('input', { type: 'checkbox', class: 'pick', onclick: e => { e.stopPropagation(); e.target.checked ? picked.add(g.id) : picked.delete(g.id); } }),
        pic(g.file, { loading: 'lazy' }),
        h('div', { class: 'cap' }, h('b', {}, (byId(S.products, g.productId) || {}).name || 'Product'), (byId(S.options.styles, g.style) || {}).name || '')))) : h('p', { class: 'muted' }, 'No images yet.'));
}

// ---------- Admin ----------

const ADMIN_TABS = { dashboard: 'Dashboard', models: 'Models', features: 'Feature toggles', options: 'Options', prompts: 'Prompts', settings: 'Settings & backup', log: 'Activity log' };

function renderAdmin() {
  if (S.settings.adminHash && !sessionStorage.getItem('monsa-admin')) return renderAdminLock();
  const sub = location.hash.split('/')[1];
  if (ADMIN_TABS[sub]) S.adminTab = sub;
  const body = h('div', { id: 'adminBody' });
  put(view, h('h1', {}, 'Admin'),
    h('div', { class: 'tabs' }, Object.entries(ADMIN_TABS).map(([id, label]) =>
      h('button', { class: S.adminTab === id ? 'on' : '', onclick: () => { location.hash = 'admin/' + id; } }, label))),
    body);
  ({ dashboard: adminDashboard, models: adminModels, features: adminFeatures, options: adminOptions, prompts: adminPrompts,
    settings: adminSettings, log: adminLog })[S.adminTab](body);
}

function renderAdminLock() {
  const pass = h('input', { type: 'password', placeholder: 'Admin passcode' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Open Admin');
  put(view, h('form', { class: 'card auth', onsubmit: e => {
    e.preventDefault();
    busy(btn, async () => {
      if (await sha256(pass.value) !== S.settings.adminHash) throw new Error('Wrong passcode.');
      sessionStorage.setItem('monsa-admin', '1');
      route();
    });
  } }, h('h1', {}, 'Admin'), pass, h('div', { style: 'margin-top:16px' }, btn)));
  pass.focus();
}

function adminDashboard(body) {
  const today = new Date().toISOString().slice(0, 10), m = month();
  const ofMonth = S.gallery.filter(g => g.createdAt.startsWith(m));
  const u = usage();
  const top = (key, name) => {
    const counts = {};
    for (const g of S.gallery) if (g[key]) counts[g[key]] = (counts[g[key]] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count]) => ({ name: name(id) || '(deleted)', count }));
  };
  const list = (title, rows) => h('div', { class: 'card' }, h('h3', {}, title),
    rows.length ? h('table', {}, rows.map(r => h('tr', {}, h('td', {}, r.name), h('td', { style: 'text-align:right' }, r.count)))) : h('p', { class: 'muted' }, 'Nothing yet.'));
  put(body,
    u.near ? h('div', { class: 'notice' }, 'Warning: this month\'s cost is close to the limit you set.') : null,
    h('div', { class: 'stats', style: 'margin-bottom:16px' },
      h('div', { class: 'stat' }, h('b', {}, S.gallery.filter(g => g.createdAt.startsWith(today)).length), 'images today'),
      h('div', { class: 'stat' }, h('b', {}, ofMonth.length), 'images this month'),
      h('div', { class: 'stat' }, h('b', {}, +u.monthCost.toFixed(3)), 'pollen spent this month' + (u.limit ? ` (limit ${u.limit})` : ''))),
    h('div', { class: 'grid big' },
      list('Top products', top('productId', id => (byId(S.products, id) || {}).name)),
      list('Top models', top('modelId', id => (byId(S.models, id) || {}).name)),
      list('Top styles', top('style', id => (byId(S.options.styles, id) || {}).name))));
}

function adminFeatures(body) {
  const o = clone(S.options);
  o.features = o.features || {};
  const labels = { onModel: 'Mode: On model', productOnly: 'Mode: Product only', oneClickGenerate: 'One-click Generate (needs AI key)',
    copyPrompt: 'Copy prompt (manual, free)', editText: 'Edit results with text', moreLikeThis: '"More like this"', zipDownload: 'Zip download' };
  const saveBtn = h('button', { class: 'btn' }, 'Save');
  saveBtn.onclick = () => busy(saveBtn, async () => { S.options = o; await save('options'); log('Changed feature toggles'); toast('Saved'); });
  put(body, h('div', { class: 'card' },
    h('h3', {}, 'Features'), Object.keys(labels).map(k =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.features[k], onchange: e => (o.features[k] = e.target.checked) }), labels[k])),
    ['productTypes', 'styles', 'engines'].map(list => [h('h3', { style: 'margin-top:16px' }, OPTION_LISTS[list]), (o[list] || []).map(it =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.enabled !== false, onchange: e => (it.enabled = e.target.checked) }), it.name))]),
    h('p', { class: 'muted' }, 'Everything else (backgrounds, poses, scenes…) can be switched on/off under Options.'), saveBtn));
}

const OPTION_LISTS = { productTypes: 'Product types', styles: 'Styles', backgrounds: 'Backgrounds', scenes: 'Lifestyle scenes', poses: 'Poses',
  framings: 'Framings', outfits: 'Outfits', sizes: 'Sizes', engines: 'AI engines' };
const OPTION_FIELDS = {
  productTypes: ['name', 'id', 'enabled', 'prompt'],
  styles: ['name', 'id', 'enabled', 'usesBackground', 'usesScene', 'prompt'],
  backgrounds: ['name', 'id', 'color', 'enabled', 'default'],
  scenes: ['name', 'id', 'enabled', 'prompt'], poses: ['name', 'id', 'enabled', 'prompt'],
  framings: ['name', 'id', 'enabled', 'prompt'], outfits: ['name', 'id', 'enabled', 'prompt'],
  sizes: ['name', 'id', 'ratio', 'width', 'height', 'enabled', 'default'],
  engines: ['name', 'id', 'model', 'costPerImage', 'maxRefs', 'sizeRule', 'enabled', 'default'],
};
const FIELD_HELP = {
  usesBackground: 'Show background colours', usesScene: 'Show lifestyle scenes', default: 'Default', enabled: 'Enabled (visible on Create)',
  prompt: 'Text sent to the AI', model: 'Pollinations model name', costPerImage: 'Cost per image (pollen)', maxRefs: 'Max reference images',
  sizeRule: 'Size rule ("exact" or "openai")', id: 'ID (no spaces; used inside the app)',
};
const BOOL = new Set(['enabled', 'default', 'usesBackground', 'usesScene']);
const NUM = new Set(['width', 'height', 'costPerImage', 'maxRefs']);
const slug = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item-' + newId();

// A generic editor for any list of options: edit, add, reorder, enable/disable and delete.
function listEditor(items, fields) {
  const box = h('div');
  const draw = () => put(box, items.map((it, i) => h('div', { class: 'item' + (it.enabled === false ? ' off' : '') },
    h('div', { class: 'fields' }, fields.map(f => {
      if (BOOL.has(f)) return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f === 'enabled' ? it[f] !== false : !!it[f], onchange: e => {
        if (f === 'default' && e.target.checked) items.forEach(x => (x.default = false));
        it[f] = e.target.checked; draw();
      } }), FIELD_HELP[f]);
      const wide = f === 'prompt' || f === 'description';
      let input;
      if (wide) input = h('textarea', { value: it[f] || '' });
      else if (f === 'color') input = h('input', { type: 'color', value: it[f] || '#000000' });
      else input = h('input', { value: it[f] ?? '', type: NUM.has(f) ? 'number' : 'text', step: 'any' });
      input.oninput = e => { it[f] = NUM.has(f) ? Number(e.target.value) : e.target.value; if (f === 'name' && it._new) it.id = slug(e.target.value); };
      return h('div', { class: wide ? 'wide' : '' }, h('label', {}, FIELD_HELP[f] || f[0].toUpperCase() + f.slice(1)), input);
    })),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn small ghost', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } }, '↑'),
      h('button', { class: 'btn small ghost', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } }, '↓'),
      h('button', { class: 'btn small ghost', onclick: () => { if (confirm('Delete "' + (it.name || 'this item') + '"?')) { items.splice(i, 1); draw(); } } }, 'Delete')))));
  draw();
  return { el: box, redraw: draw };
}

function adminOptions(body) {
  const o = clone(S.options);
  const list = S.optTab;
  o[list] = o[list] || [];
  const editor = listEditor(o[list], OPTION_FIELDS[list]);
  const add = h('button', { class: 'btn small ghost', onclick: () => {
    const blank = { _new: true, id: '', name: '', enabled: true };
    OPTION_FIELDS[list].forEach(f => { if (!(f in blank)) blank[f] = BOOL.has(f) ? false : NUM.has(f) ? 0 : ''; });
    if (list === 'sizes') Object.assign(blank, { ratio: '4:5', width: 1024, height: 1280 });
    if (list === 'engines') Object.assign(blank, { sizeRule: 'exact', maxRefs: 10 });
    if (list === 'styles') blank.prompt = 'Describe the look here. You can use {background} or {scene}.';
    o[list].push(blank); editor.redraw();
  } }, '+ Add new');
  const saveBtn = h('button', { class: 'btn' }, 'Save');
  saveBtn.onclick = () => busy(saveBtn, async () => {
    for (const it of o[list]) { if (!it.id) it.id = slug(it.name); delete it._new; }
    S.options = o; await save('options'); log('Edited ' + OPTION_LISTS[list]); toast('Saved');
  });
  const reset = h('button', { class: 'btn ghost small' }, 'Reset all options to default');
  reset.onclick = () => busy(reset, async () => {
    if (!confirm('Reset ALL options and feature toggles to the original defaults?')) return;
    S.options = fallback('options'); await DB.del('options'); log('Reset options to default'); route(); toast('Reset done');
  });
  put(body,
    h('div', { class: 'tabs' }, Object.entries(OPTION_LISTS).map(([id, label]) =>
      h('button', { class: S.optTab === id ? 'on' : '', onclick: () => { S.optTab = id; route(); } }, label))),
    list === 'styles' ? h('p', { class: 'muted' }, 'New styles: write the prompt describing the look. Tick "Show background colours" or "Show lifestyle scenes" if the style needs them.') : null,
    list === 'engines' ? h('p', { class: 'muted' }, 'Model names come from Pollinations (gen.pollinations.ai/image/models). Use "openai" size rule for openai/ models.') : null,
    editor.el, h('div', { class: 'row summary' }, h('span', { class: 'grow' }, OPTION_LISTS[list]), add, saveBtn), h('p'), reset);
}

function adminModels(body) {
  const models = clone(S.models);
  const editor = listEditor(models, ['name', 'enabled', 'default', 'description']);
  const saveBtn = h('button', { class: 'btn' }, 'Save');
  saveBtn.onclick = () => busy(saveBtn, async () => { S.models = models; await save('models'); log('Edited model library'); toast('Saved'); });
  put(body,
    h('p', { class: 'muted' }, 'Rename, reorder, disable (hidden on Create but kept), set the default, or delete models. To change reference images, open the model on the Models page.'),
    editor.el, h('div', { class: 'row summary' }, h('span', { class: 'grow' }, 'Models'), h('a', { class: 'btn ghost', href: '#models' }, 'Open Models page'), saveBtn));
}

function adminPrompts(body) {
  const p = clone(S.prompts);
  const help = {
    productOnly: 'Product only mode', onModel: 'On model mode (bags & accessories)', clothingOnModel: 'On model mode, clothing (model wears it)',
    references: 'Explains which reference image is which', accuracy: 'Product accuracy rules (added to every image)', aspect: 'Image shape',
    modelSheet: 'Model reference sheet (Models page)', edit: '"Edit with text" on results', moreLikeThis: '"More like this" on results',
  };
  const saveBtn = h('button', { class: 'btn' }, 'Save');
  saveBtn.onclick = () => busy(saveBtn, async () => { S.prompts = clone(p); await save('prompts'); log('Edited prompts'); toast('Prompts saved'); });
  const reset = h('button', { class: 'btn ghost' }, 'Reset to default');
  reset.onclick = () => busy(reset, async () => {
    if (!confirm('Reset all prompts to the original wording?')) return;
    S.prompts = fallback('prompts'); await DB.del('prompts'); log('Reset prompts to default'); route(); toast('Prompts reset');
  });
  const test = h('button', { class: 'btn ghost' }, 'Test');
  test.onclick = () => busy(test, async () => {
    if (!S.products.length) throw new Error('Upload a product first to test.');
    defaults();
    const saved = S.prompts;
    S.prompts = p;
    try { modal(h('h2', {}, 'Test: full prompt for your current Create settings'), h('textarea', { class: 'prompt-box', readonly: true, value: buildJob({ ...S.sel }).prompt })); }
    finally { S.prompts = saved; }
  });
  put(body,
    h('p', { class: 'muted' }, 'Words in {curly brackets} are filled in automatically: {product_type}, {background}, {scene}, {pose}, {framing}, {outfit}, {ratio}, {product_count}, {model_part}, {description}, {instruction}. Style, pose, scene and product-type wording is edited under Options.'),
    Object.keys(p).map(k => h('div', { class: 'item' }, h('h3', {}, help[k] || k),
      h('textarea', { value: p[k], style: 'min-height:110px', oninput: e => (p[k] = e.target.value) }))),
    h('div', { class: 'row summary' }, h('span', { class: 'grow' }, 'Prompts'), test, reset, saveBtn));
}

function adminSettings(body) {
  const st = S.settings;
  const site = h('input', { value: st.siteName || 'Monsa Studio' });
  const key = h('input', { type: 'password', value: st.pollinationsKey || '', placeholder: 'Paste your key (starts with sk_ or pk_)', autocomplete: 'off' });
  const limit = h('input', { type: 'number', min: 0, step: 'any', value: st.monthlyCostLimit || 0 });
  const pass = h('input', { type: 'password', placeholder: st.adminHash ? 'New passcode (leave empty to keep)' : 'Set a passcode (optional)' });
  const saveBtn = h('button', { class: 'btn' }, 'Save settings');
  saveBtn.onclick = () => busy(saveBtn, async () => {
    Object.assign(st, { siteName: site.value.trim() || 'Monsa Studio', pollinationsKey: key.value.trim(), monthlyCostLimit: Number(limit.value) || 0 });
    if (pass.value) { st.adminHash = await sha256(pass.value); sessionStorage.setItem('monsa-admin', '1'); }
    await save('settings');
    log('Changed settings');
    toast('Settings saved');
    boot();
  });
  const removeLock = st.adminHash ? h('button', { class: 'btn ghost small', onclick: async () => {
    if (!confirm('Remove the Admin passcode?')) return;
    delete st.adminHash; await save('settings'); log('Removed admin passcode'); route();
  } }, 'Remove passcode') : null;

  const exportBtn = h('button', { class: 'btn small' }, 'Export backup');
  exportBtn.onclick = () => busy(exportBtn, async () => {
    const zip = new JSZip();
    const data = {};
    for (const name of LISTS) data[name] = S[name];
    data.settings = { ...S.settings, pollinationsKey: '' };
    zip.file('data.json', JSON.stringify(data));
    for (const id of await DB.fileIds()) zip.file('files/' + id, await DB.getFile(id));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `monsa-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    log('Exported a backup');
  });
  const importFile = h('input', { type: 'file', accept: '.zip' });
  const importBtn = h('button', { class: 'btn small ghost' }, 'Import backup');
  importBtn.onclick = () => busy(importBtn, async () => {
    if (!importFile.files.length) throw new Error('Choose a backup .zip first.');
    if (!confirm('Importing replaces everything in this browser with the backup. Continue?')) return;
    const zip = await JSZip.loadAsync(importFile.files[0]);
    const data = JSON.parse(await zip.file('data.json').async('string'));
    await DB.clear('files');
    for (const [path, entry] of Object.entries(zip.files)) {
      if (!path.startsWith('files/') || entry.dir) continue;
      const blob = await entry.async('blob');
      await DB.putFile(path.slice(6), blob);
    }
    data.settings = { ...data.settings, pollinationsKey: S.settings.pollinationsKey || '' };
    for (const name of LISTS) if (data[name] !== undefined) await DB.set(name, data[name]);
    for (const k of Object.keys(urlCache)) delete urlCache[k];
    toast('Backup imported');
    await boot();
  });
  const wipe = h('button', { class: 'btn ghost small' }, 'Delete everything in this browser');
  wipe.onclick = () => busy(wipe, async () => {
    if (!confirm('This deletes ALL products, models, images and settings in this browser. Export a backup first! Continue?')) return;
    await DB.clear('kv'); await DB.clear('files');
    sessionStorage.clear(); location.hash = ''; location.reload();
  });

  put(body,
    h('div', { class: 'card' },
      h('h3', {}, 'AI key (Pollinations)'),
      h('div', { class: st.pollinationsKey ? 'notice ok-notice' : 'notice' }, st.pollinationsKey ? 'A key is saved in this browser only. It is never put on GitHub.' : 'No key yet.'),
      h('ol', { class: 'muted', style: 'padding-left:18px' },
        h('li', {}, 'Go to ', h('a', { href: 'https://enter.pollinations.ai', target: '_blank' }, 'enter.pollinations.ai'), ' and sign up for free.'),
        h('li', {}, 'Create a key and copy it.'),
        h('li', {}, 'Paste it below and press Save. Do this once on each device you use.')),
      h('label', {}, 'Key'), key,
      h('label', {}, 'Monthly cost limit in pollen (0 = no limit). You get a warning at 80%.'), limit,
      h('h3', { style: 'margin-top:18px' }, 'Admin passcode'), pass, removeLock,
      h('h3', { style: 'margin-top:18px' }, 'Branding'),
      h('label', {}, 'Website name'), site,
      h('p', { class: 'muted' }, 'Colours are in style.css (the top lines).'),
      h('div', { style: 'margin-top:14px' }, saveBtn)),
    h('div', { class: 'card' },
      h('h3', {}, 'Backup'),
      h('p', { class: 'muted' }, 'Your work is saved only in this browser. Export a backup regularly, and use Import to move everything to another device (phone ↔ computer). The AI key is not included in backups.'),
      h('div', { class: 'row' }, exportBtn), h('label', {}, 'Restore from a backup file'), h('div', { class: 'row' }, h('div', { class: 'grow' }, importFile), importBtn),
      h('p'), wipe));
}

function adminLog(body) {
  put(body, h('div', { class: 'card', style: 'overflow-x:auto' },
    S.log.length ? h('table', {}, S.log.slice(0, 300).map(e => h('tr', {},
      h('td', { class: 'muted', style: 'white-space:nowrap' }, new Date(e.at).toLocaleString()), h('td', {}, e.what)))) : h('p', { class: 'muted' }, 'Nothing yet.')));
}

boot().catch(e => { console.error(e); toast(e.message, true); });
