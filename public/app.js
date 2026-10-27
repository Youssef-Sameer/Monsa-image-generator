// Monsa Studio — all the pages of the website live in this one file.

const S = { user: null, options: null, models: [], products: [], sel: {}, results: [], adminTab: 'dashboard', optTab: 'productTypes' };
const view = document.getElementById('view');

// ---------- small helpers ----------

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { location.hash = ''; boot(); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

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
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = old; }
}

const fileUrl = f => '/files/' + f;
const enabled = list => (list || []).filter(x => x.enabled !== false);
const def = list => (list.find(x => x.default) || list[0] || {}).id;
const byId = (list, id) => (list || []).find(x => x.id === id);
const F = () => S.options.features || {};

// Shrinks a photo in the browser before upload (keeps it sharp, max 1600px).
function readImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.92));
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

// ---------- start-up & login ----------

async function boot() {
  const st = await api('GET', '/state');
  document.title = st.siteName;
  document.getElementById('brand').textContent = st.siteName;
  S.user = st.user;
  document.getElementById('top').hidden = !S.user;
  if (st.needsSetup) return renderAuth(true);
  if (!S.user) return renderAuth(false);
  document.getElementById('adminLink').hidden = S.user.role !== 'admin';
  await loadData();
  route();
}

async function loadData() {
  [S.options, S.models, S.products] = await Promise.all([api('GET', '/options'), api('GET', '/models'), api('GET', '/products')]);
}

function renderAuth(setup) {
  const name = h('input', { placeholder: 'Your name' });
  const email = h('input', { type: 'email', placeholder: 'Email' });
  const pass = h('input', { type: 'password', placeholder: setup ? 'Choose a password (6+ characters)' : 'Password' });
  const btn = h('button', { class: 'btn', type: 'submit' }, setup ? 'Create my admin account' : 'Log in');
  const form = h('form', { class: 'card auth', onsubmit: e => {
    e.preventDefault();
    busy(btn, async () => {
      await api('POST', setup ? '/setup' : '/login', { name: name.value, email: email.value, password: pass.value });
      boot();
    });
  } },
    h('h1', {}, setup ? 'Welcome to Monsa Studio' : 'Log in'),
    setup ? h('p', { class: 'muted' }, 'First time here: create the main admin account.') : null,
    setup ? name : null, h('label', {}, 'Email'), email, h('label', {}, 'Password'), pass, h('div', { style: 'margin-top:16px' }, btn));
  put(view, form);
}

document.getElementById('logoutBtn').onclick = async () => { await api('POST', '/logout'); location.hash = ''; boot(); };
document.getElementById('menuBtn').onclick = () => document.getElementById('nav').classList.toggle('open');
window.addEventListener('hashchange', () => S.user && route());

function route() {
  const page = (location.hash.slice(1) || 'create').split('/')[0];
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + page));
  document.getElementById('nav').classList.remove('open');
  const pages = { create: renderCreate, products: renderProducts, models: renderModels, gallery: renderGallery, admin: renderAdmin };
  (pages[page] || renderCreate)();
  window.scrollTo(0, 0);
}

// ---------- Create page ----------

function defaults() {
  const o = S.options, s = S.sel;
  const modes = [F().onModel && 'onModel', F().productOnly && 'productOnly'].filter(Boolean);
  if (!modes.includes(s.mode)) s.mode = modes[0];
  for (const [key, list] of [['style', 'styles'], ['background', 'backgrounds'], ['scene', 'scenes'], ['pose', 'poses'],
    ['framing', 'framings'], ['outfit', 'outfits'], ['size', 'sizes'], ['engine', 'engines']])
    if (!byId(o[list], s[key])) s[key] = def(o[list]);
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
  const engine = byId(o.engines, s.engine);
  const n = (() => { let i = 0; return () => ++i; })();

  const parts = [h('h1', {}, 'Create images')];
  if (!o.hasKey && F().oneClickGenerate) parts.push(h('div', { class: 'notice' },
    'No AI key yet, so one-click Generate won\'t work. You can still use "Copy prompt" below. ',
    S.user.role === 'admin' ? h('a', { href: '#admin/settings', onclick: () => (S.adminTab = 'settings') }, 'Add the free Pollinations key') : 'Ask your admin to add the key.'));

  // 1. product
  parts.push(step(n(), 'Product',
    S.products.length ? h('div', { class: 'grid' }, S.products.map(p =>
      h('div', { class: 'tile' + (p.id === s.productId ? ' on' : ''), onclick: () => set('productId', p.id) },
        h('img', { src: fileUrl(p.images[0]), loading: 'lazy' }),
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
        m.images.length ? h('img', { src: fileUrl(m.images[0]), loading: 'lazy' }) : h('div', { class: 'empty-img' }, 'No reference image yet — make one on the Models page'),
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
  const cost = engine ? (engine.costPerImage || 0) * s.count : 0;
  const genBtn = h('button', { class: 'btn', onclick: () => generate(genBtn) }, 'Generate');
  const copyBtn = h('button', { class: 'btn ghost', onclick: () => busy(copyBtn, showCopyPrompt) }, 'Copy prompt');
  parts.push(h('div', { class: 'summary' },
    h('div', { class: 'grow' }, product ? product.name : 'Choose a product', ' · ', s.count, ' image(s)',
      engine && F().oneClickGenerate ? h('div', { style: 'font-size:13px;opacity:.85' }, `Estimated cost ≈ ${+cost.toFixed(4)} pollen (${engine.name})`) : null),
    F().copyPrompt ? copyBtn : null, F().oneClickGenerate ? genBtn : null));

  const results = h('div', { id: 'results' });
  parts.push(results);
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
    const images = await Promise.all([...files.files].map(f => readImage(f)));
    const p = await api('POST', '/products', { name: name.value || files.files[0].name, type: type.value, images });
    S.products.push(p);
    toast('Product saved');
    onDone(p);
  });
  return h('details', { style: 'margin-top:12px' }, h('summary', { style: 'cursor:pointer;color:var(--red)' }, '+ Upload a new product'),
    h('label', {}, 'Name'), name, h('label', {}, 'Type'), type,
    h('label', {}, 'Photos (front, side, detail — same product). Plain background photos work best.'), files,
    h('div', { style: 'margin-top:10px' }, btn));
}

function request(extra = {}) { return { ...S.sel, ...extra }; }

async function generate(btn, extra = {}) {
  if (!S.sel.productId) return toast('Choose a product first.', true);
  await busy(btn, async () => {
    toast('Generating… this can take up to a minute.');
    const r = await api('POST', '/generate', request(extra));
    S.results = [...r.images, ...S.results];
    if (r.errors.length) toast(`${r.errors.length} image(s) failed: ${r.errors[0]}`, true); else toast('Done!');
    renderResults();
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
  });
}

function renderResults() {
  const box = document.getElementById('results');
  if (!box) return;
  if (!S.results.length) return put(box, );
  put(box, h('h2', { style: 'margin-top:24px' }, 'Results'),
    h('div', { class: 'grid big' }, S.results.map(resultCard)));
}

function resultCard(g, onChange) {
  const editIn = h('input', { placeholder: 'e.g. make the background beige' });
  const card = h('div', { class: 'tile', style: 'cursor:default' },
    h('img', { src: fileUrl(g.file), onclick: () => openImage(g) , style: 'cursor:zoom-in' }),
    h('div', { class: 'actions' },
      h('a', { class: 'btn small ghost', href: fileUrl(g.file), download: 'monsa-' + g.id }, 'Download'),
      g.engine !== 'manual' && F().oneClickGenerate ? actionBtn('Regenerate', () => api('POST', '/generate', { ...g.settings, count: 1 })) : null,
      g.engine !== 'manual' && F().moreLikeThis && F().oneClickGenerate ? actionBtn('More like this', () => api('POST', '/generate', { ...g.settings, count: 1, likeImage: g.file })) : null),
    F().editText && F().oneClickGenerate ? h('div', { class: 'actions' }, editIn, actionBtn('Apply edit', async () => {
      const e = await api('POST', '/edit', { imageId: g.id, instruction: editIn.value });
      return { images: [e], errors: [] };
    })) : null);
  return card;

  function actionBtn(label, fn) {
    const b = h('button', { class: 'btn small ghost' }, label);
    b.onclick = () => busy(b, async () => {
      const r = await fn();
      if (r.errors && r.errors.length) toast(r.errors[0], true);
      S.results = [...r.images, ...S.results];
      if (onChange) onChange(r.images); else renderResults();
      toast('New image added');
    });
    return b;
  }
}

async function showCopyPrompt() {
  if (!S.sel.productId) throw new Error('Choose a product first.');
  const r = await api('POST', '/prompt', request());
  const box = h('textarea', { class: 'prompt-box', readonly: true }, r.prompt);
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const up = h('button', { class: 'btn small' }, 'Save to my gallery');
  up.onclick = () => busy(up, async () => {
    if (!file.files.length) throw new Error('Choose the image(s) you made first.');
    for (const f of file.files) {
      const g = await api('POST', '/gallery/upload', { image: await readImage(f, 2400), settings: request(), prompt: r.prompt });
      S.results.unshift(g);
    }
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
    h('div', { class: 'row', style: 'margin:10px 0' }, r.refs.map((f, i) =>
      h('a', { href: fileUrl(f), download: `reference-${i + 1}`, title: 'Download' }, h('img', { src: fileUrl(f), style: 'width:80px;height:100px;object-fit:cover;border-radius:8px;margin:0' })))),
    box,
    h('div', { class: 'row', style: 'margin:10px 0 18px' },
      h('button', { class: 'btn small', onclick: () => { navigator.clipboard.writeText(r.prompt); toast('Prompt copied'); } }, 'Copy prompt'),
      h('button', { class: 'btn small ghost', onclick: () => m.remove() }, 'Close')),
    h('h3', {}, 'Save the result'), file, h('div', { style: 'margin-top:10px' }, up));
}

function openImage(g, onDelete) {
  const prod = byId(S.products, g.productId), model = byId(S.models, g.modelId), style = byId(S.options.styles, g.style);
  const del = h('button', { class: 'btn small ghost' }, 'Delete');
  const m = modal(
    h('img', { src: fileUrl(g.file) }),
    h('div', { class: 'row' },
      h('a', { class: 'btn small', href: fileUrl(g.file), download: 'monsa-' + g.id }, 'Download'), del,
      h('button', { class: 'btn small ghost', onclick: () => m.remove() }, 'Close')),
    h('p', { class: 'muted' }, [prod && 'Product: ' + prod.name, model && 'Model: ' + model.name, style && 'Style: ' + style.name,
      'Engine: ' + (g.engineName || g.engine), 'By ' + g.userName, new Date(g.createdAt).toLocaleString()].filter(Boolean).join(' · ')),
    g.settings && g.settings.instruction ? h('p', {}, 'Edit: ' + g.settings.instruction) : null,
    h('details', {}, h('summary', { style: 'cursor:pointer' }, 'Prompt used'), h('pre', { style: 'white-space:pre-wrap;font-size:12px' }, g.prompt)));
  del.onclick = () => busy(del, async () => {
    if (!confirm('Delete this image?')) return;
    await api('POST', `/gallery/${g.id}/delete`);
    S.results = S.results.filter(x => x.id !== g.id);
    m.remove(); renderResults(); if (onDelete) onDelete();
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
        await api('POST', `/products/${p.id}/delete`);
        S.products = S.products.filter(x => x.id !== p.id);
        renderProducts();
      });
      return h('div', { class: 'tile', style: 'cursor:default' },
        h('img', { src: fileUrl(p.images[0]), loading: 'lazy' }),
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
        m.images.length ? h('img', { src: fileUrl(m.images[0]), loading: 'lazy' }) : h('div', { class: 'empty-img' }, 'No reference yet — tap to generate one'),
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
  let images = [...m.images];
  const name = h('input', { value: m.name, placeholder: 'e.g. Model A' });
  const desc = h('textarea', { value: m.description, placeholder: 'Describe her: age, skin tone, hair, hijab, style, body type…' });
  const picks = h('div', { class: 'row' }, Object.entries(MODEL_PICKS).map(([label, vals]) =>
    h('select', { style: 'width:auto', onchange: e => { if (e.target.value) desc.value = (desc.value ? desc.value.replace(/[,\s]+$/, '') + ', ' : '') + e.target.value; e.target.value = ''; } },
      h('option', { value: '' }, label + '…'), vals.map(v => h('option', { value: v }, v)))));
  const photos = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const consent = h('input', { type: 'checkbox' });
  const imgBox = h('div', { class: 'row', style: 'margin:10px 0' });
  const drawImages = () => put(imgBox, ...(images.length ? images.map((f, i) => h('div', { style: 'position:relative' },
    h('img', { src: f.startsWith('data:') ? f : fileUrl(f), style: 'width:120px;height:120px;object-fit:cover;border-radius:10px;margin:0' }),
    h('button', { class: 'btn small ghost', style: 'position:absolute;top:4px;right:4px;background:#fff', onclick: () => { images.splice(i, 1); drawImages(); } }, '✕'))) : [h('span', { class: 'muted' }, 'No reference images yet.')]));
  drawImages();

  const sheetPayload = async (promptOnly) => {
    const real = photos.files.length ? await Promise.all([...photos.files].map(f => readImage(f))) : [];
    return { description: desc.value, photos: real, promptOnly, engine: S.sel.engine };
  };
  const gen = h('button', { class: 'btn small' }, 'Generate reference sheet');
  gen.onclick = () => busy(gen, async () => {
    toast('Generating… this can take up to a minute.');
    const r = await api('POST', '/models/sheet', await sheetPayload(false));
    images.unshift(r.file); drawImages();
  });
  const copy = h('button', { class: 'btn small ghost' }, 'Copy prompt');
  copy.onclick = () => busy(copy, async () => {
    const r = await api('POST', '/models/sheet', await sheetPayload(true));
    await navigator.clipboard.writeText(r.prompt);
    toast('Prompt copied — paste it into Gemini/ChatGPT, then add the result with "Add photos" below.');
  });
  const addPhotos = h('button', { class: 'btn small ghost' }, 'Add these photos as references');
  addPhotos.onclick = () => busy(addPhotos, async () => {
    if (!photos.files.length) throw new Error('Choose photos first.');
    if (!consent.checked) throw new Error('Please confirm she agreed (or that the image is AI-made).');
    for (const f of photos.files) images.push(await readImage(f));
    photos.value = ''; drawImages();
  });
  const save = h('button', { class: 'btn' }, 'Save model');
  save.onclick = () => busy(save, async () => {
    if (!name.value.trim()) throw new Error('Give her a name.');
    const saved = await api('POST', '/models/save', { id: m.id, name: name.value, description: desc.value, images });
    S.models = await api('GET', '/models');
    toast('Model saved'); mod.remove(); renderModels();
    return saved;
  });

  const mod = modal(
    h('h2', {}, isNew ? 'Create model' : 'Edit ' + m.name),
    h('label', {}, 'Name'), name,
    h('label', {}, 'Quick picks (adds to the description)'), picks,
    h('label', {}, 'Description'), desc,
    h('h3', { style: 'margin-top:16px' }, 'Reference images'),
    h('p', { class: 'muted' }, 'The first image is used as her main picture. Keep only the ones you like. Remove images with ✕.'),
    imgBox,
    S.options.features.oneClickGenerate ? gen : null, ' ', S.options.features.copyPrompt ? copy : null,
    h('label', { style: 'margin-top:14px' }, 'Or upload photos (a real model who agreed, or images you made elsewhere). If you then press "Generate", they are also used as the face reference.'),
    photos, h('label', { class: 'check' }, consent, 'She agreed to be used / the image is AI-made'), addPhotos,
    h('div', { class: 'row', style: 'margin-top:18px' }, save, h('button', { class: 'btn ghost', onclick: () => mod.remove() }, 'Cancel')));
}

// ---------- Gallery page ----------

let galleryFilter = { product: '', model: '', style: '', all: '' };
async function renderGallery(adminMode) {
  const target = adminMode ? document.getElementById('adminBody') : view;
  if (adminMode) galleryFilter.all = '1'; else galleryFilter.all = '';
  const q = new URLSearchParams(galleryFilter).toString();
  const items = await api('GET', '/gallery?' + q);
  const picked = new Set();
  const sel = (key, list) => h('select', { style: 'width:auto', onchange: e => { galleryFilter[key] = e.target.value; renderGallery(adminMode); } },
    h('option', { value: '' }, 'All ' + key + 's'), list.map(x => h('option', { value: x.id, selected: galleryFilter[key] === x.id }, x.name)));
  const zipBtn = h('button', { class: 'btn small', onclick: () => {
    const ids = picked.size ? [...picked] : items.map(i => i.id);
    if (!ids.length) return toast('Nothing to download.', true);
    location.href = '/api/gallery/zip?ids=' + ids.join(',');
  } }, 'Download as zip');
  put(target, 
    adminMode ? h('h2', {}, 'All images (all users)') : h('h1', {}, 'Gallery'),
    h('div', { class: 'row', style: 'margin-bottom:14px' }, sel('product', S.products), sel('model', S.models), sel('style', S.options.styles),
      h('span', { class: 'grow muted' }, items.length + ' image(s) · tick images to zip only those'), F().zipDownload || S.user.role === 'admin' ? zipBtn : null),
    items.length ? h('div', { class: 'grid' }, items.map(g => {
      const box = h('input', { type: 'checkbox', class: 'pick', onclick: e => { e.stopPropagation(); e.target.checked ? picked.add(g.id) : picked.delete(g.id); } });
      return h('div', { class: 'tile', onclick: () => openImage(g, () => renderGallery(adminMode)) },
        box, h('img', { src: fileUrl(g.file), loading: 'lazy' }),
        h('div', { class: 'cap' }, h('b', {}, (byId(S.products, g.productId) || {}).name || 'Product'),
          [(byId(S.options.styles, g.style) || {}).name, adminMode ? g.userName : null].filter(Boolean).join(' · ')));
    })) : h('p', { class: 'muted' }, 'No images yet.'));
}

// ---------- Admin ----------

const ADMIN_TABS = { dashboard: 'Dashboard', models: 'Models', features: 'Feature toggles', options: 'Options', prompts: 'Prompts', users: 'Users', settings: 'Settings', gallery: 'All images', log: 'Activity log' };

function renderAdmin() {
  if (S.user.role !== 'admin') { location.hash = 'create'; return; }
  const sub = location.hash.split('/')[1];
  if (ADMIN_TABS[sub]) S.adminTab = sub;
  const body = h('div', { id: 'adminBody' });
  put(view, h('h1', {}, 'Admin'),
    h('div', { class: 'tabs' }, Object.entries(ADMIN_TABS).map(([id, label]) =>
      h('button', { class: S.adminTab === id ? 'on' : '', onclick: () => { location.hash = 'admin/' + id; } }, label))),
    body);
  const tabs = { dashboard: adminDashboard, models: adminModels, features: adminFeatures, options: adminOptions, prompts: adminPrompts,
    users: adminUsers, settings: adminSettings, gallery: () => renderGallery(true), log: adminLog };
  tabs[S.adminTab]().catch(e => toast(e.message, true));
}

async function adminDashboard() {
  const st = await api('GET', '/admin/stats');
  const list = (title, rows) => h('div', { class: 'card' }, h('h3', {}, title),
    rows.length ? h('table', {}, rows.map(r => h('tr', {}, h('td', {}, r.name), h('td', { style: 'text-align:right' }, r.count)))) : h('p', { class: 'muted' }, 'Nothing yet.'));
  put(document.getElementById('adminBody'), 
    st.costLimit && st.costMonth >= st.costLimit * 0.8 ? h('div', { class: 'notice' }, 'Warning: this month\'s cost is close to the limit you set.') : null,
    h('div', { class: 'stats', style: 'margin-bottom:16px' },
      h('div', { class: 'stat' }, h('b', {}, st.imagesToday), 'images today'),
      h('div', { class: 'stat' }, h('b', {}, st.imagesMonth), 'images this month'),
      h('div', { class: 'stat' }, h('b', {}, +st.costMonth.toFixed(3)), 'pollen spent this month' + (st.costLimit ? ` (limit ${st.costLimit})` : ''))),
    h('div', { class: 'grid big' }, list('Top products', st.topProducts), list('Top models', st.topModels), list('Top styles', st.topStyles)));
}

async function adminFeatures() {
  const o = await api('GET', '/admin/options');
  o.features = o.features || {};
  const labels = { onModel: 'Mode: On model', productOnly: 'Mode: Product only', oneClickGenerate: 'One-click Generate (needs AI key)',
    copyPrompt: 'Copy prompt (manual, free)', editText: 'Edit results with text', moreLikeThis: '"More like this"', zipDownload: 'Zip download' };
  const quick = ['productTypes', 'styles', 'engines'];
  const save = h('button', { class: 'btn', onclick: () => busy(save, async () => { await api('POST', '/admin/options', o); await loadData(); toast('Saved'); }) }, 'Save');
  put(document.getElementById('adminBody'), h('div', { class: 'card' },
    h('h3', {}, 'Features'), Object.keys(labels).map(k =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.features[k], onchange: e => (o.features[k] = e.target.checked) }), labels[k])),
    quick.map(list => [h('h3', { style: 'margin-top:16px' }, OPTION_LISTS[list]), (o[list] || []).map(it =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.enabled !== false, onchange: e => (it.enabled = e.target.checked) }), it.name))]),
    h('p', { class: 'muted' }, 'Everything else (backgrounds, poses, scenes…) can be switched on/off under Options.'), save));
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
  usesBackground: 'Show background colours', usesScene: 'Show lifestyle scenes', default: 'Default', enabled: 'Enabled (visible to users)',
  prompt: 'Text sent to the AI', model: 'Pollinations model name', costPerImage: 'Cost per image (pollen)', maxRefs: 'Max reference images',
  sizeRule: 'Size rule ("exact" or "openai")', id: 'ID (no spaces; used inside the app)',
};
const BOOL = new Set(['enabled', 'default', 'usesBackground', 'usesScene']);
const NUM = new Set(['width', 'height', 'costPerImage', 'maxRefs']);

// A generic editor for any list of options: edit, add, reorder, enable/disable and delete.
function listEditor(items, fields, onChange) {
  const box = h('div');
  const draw = () => put(box, ...items.map((it, i) => h('div', { class: 'item' + (it.enabled === false ? ' off' : '') },
    h('div', { class: 'fields' }, fields.map(f => {
      const wide = f === 'prompt' || f === 'description';
      let input;
      if (BOOL.has(f)) return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f === 'enabled' ? it[f] !== false : !!it[f], onchange: e => {
        if (f === 'default' && e.target.checked) items.forEach(x => (x.default = false));
        it[f] = e.target.checked; draw(); onChange && onChange();
      } }), FIELD_HELP[f]);
      if (f === 'prompt' || f === 'description') input = h('textarea', { value: it[f] || '' });
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
const slug = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item-' + Date.now();

async function adminOptions() {
  const o = await api('GET', '/admin/options');
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
  const save = h('button', { class: 'btn', onclick: () => busy(save, async () => {
    for (const it of o[list]) { if (!it.id) it.id = slug(it.name); delete it._new; }
    await api('POST', '/admin/options', o); await loadData(); toast('Saved — users see it right away.');
  }) }, 'Save');
  const reset = h('button', { class: 'btn ghost small', onclick: () => busy(reset, async () => {
    if (!confirm('Reset ALL options and feature toggles to the original defaults?')) return;
    await api('POST', '/admin/options/reset'); await loadData(); adminOptions(); toast('Reset done');
  }) }, 'Reset all options to default');
  put(document.getElementById('adminBody'), 
    h('div', { class: 'tabs' }, Object.entries(OPTION_LISTS).map(([id, label]) =>
      h('button', { class: S.optTab === id ? 'on' : '', onclick: () => { S.optTab = id; adminOptions(); } }, label))),
    list === 'styles' ? h('p', { class: 'muted' }, 'New styles: write the prompt describing the look. Tick "Show background colours" or "Show lifestyle scenes" if the style needs them.') : null,
    list === 'engines' ? h('p', { class: 'muted' }, 'Model names come from Pollinations (gen.pollinations.ai/image/models). Use "openai" size rule for openai/ models.') : null,
    editor.el, h('div', { class: 'row summary' }, h('span', { class: 'grow' }, OPTION_LISTS[list]), add, save), h('p'), reset);
}

async function adminModels() {
  const models = await api('GET', '/models');
  const editor = listEditor(models, ['name', 'enabled', 'default', 'description']);
  const save = h('button', { class: 'btn', onclick: () => busy(save, async () => {
    await api('POST', '/admin/models', { models }); await loadData(); toast('Saved');
  }) }, 'Save');
  put(document.getElementById('adminBody'), 
    h('p', { class: 'muted' }, 'Rename, reorder, disable (hidden from users but kept), set the default, or delete models. To change reference images, open the model on the Models page.'),
    h('div', { class: 'row', style: 'margin-bottom:10px' }, models.map(m =>
      m.images[0] ? h('img', { src: fileUrl(m.images[0]), title: m.name, style: 'width:60px;height:75px;object-fit:cover;border-radius:8px' }) : null)),
    editor.el, h('div', { class: 'row summary' }, h('span', { class: 'grow' }, 'Models'),
      h('a', { class: 'btn ghost', href: '#models' }, 'Open Models page'), save));
}

async function adminPrompts() {
  const p = await api('GET', '/admin/prompts');
  const help = {
    productOnly: 'Product only mode', onModel: 'On model mode (bags & accessories)', clothingOnModel: 'On model mode, clothing (model wears it)',
    references: 'Explains which reference image is which', accuracy: 'Product accuracy rules (added to every image)', aspect: 'Image shape',
    modelSheet: 'Model reference sheet (Models page)', edit: '"Edit with text" on results', moreLikeThis: '"More like this" on results',
  };
  const boxes = Object.keys(p).filter(k => !k.startsWith('_')).map(k => {
    const t = h('textarea', { value: p[k], style: 'min-height:110px', oninput: e => (p[k] = e.target.value) });
    return h('div', { class: 'item' }, h('h3', {}, help[k] || k), t);
  });
  const save = h('button', { class: 'btn', onclick: () => busy(save, async () => { await api('POST', '/admin/prompts', p); toast('Prompts saved'); }) }, 'Save');
  const reset = h('button', { class: 'btn ghost', onclick: () => busy(reset, async () => {
    if (!confirm('Reset all prompts to the original wording?')) return;
    await api('POST', '/admin/prompts/reset'); adminPrompts(); toast('Prompts reset');
  }) }, 'Reset to default');
  const test = h('button', { class: 'btn ghost', onclick: () => busy(test, async () => {
    await api('POST', '/admin/prompts', p);
    if (!S.sel.productId) S.sel.productId = (S.products[0] || {}).id;
    if (!S.sel.productId) throw new Error('Upload a product first to test.');
    defaults();
    const r = await api('POST', '/prompt', request());
    modal(h('h2', {}, 'Test: full prompt for your current Create settings'), h('textarea', { class: 'prompt-box', readonly: true, value: r.prompt }));
  }) }, 'Test');
  put(document.getElementById('adminBody'), 
    h('p', { class: 'muted' }, 'Words in {curly brackets} are filled in automatically: {product_type}, {background}, {scene}, {pose}, {framing}, {outfit}, {ratio}, {product_count}, {model_part}, {description}, {instruction}. Style, pose, scene and product-type wording is edited under Options.'),
    ...boxes, h('div', { class: 'row summary' }, h('span', { class: 'grow' }, 'Prompts'), test, reset, save));
}

async function adminUsers() {
  const users = await api('GET', '/admin/users');
  const name = h('input', { placeholder: 'Name' }), email = h('input', { placeholder: 'Email' }), pass = h('input', { placeholder: 'Password (6+)' });
  const role = h('select', {}, h('option', { value: 'user' }, 'User'), h('option', { value: 'admin' }, 'Admin'));
  const add = h('button', { class: 'btn small', onclick: () => busy(add, async () => {
    await api('POST', '/admin/users', { name: name.value, email: email.value, password: pass.value, role: role.value }); adminUsers(); toast('User added');
  }) }, 'Add user');
  const upd = (u, patch) => api('POST', '/admin/users', { id: u.id, ...patch }).then(() => { toast('Saved'); adminUsers(); }).catch(e => toast(e.message, true));
  put(document.getElementById('adminBody'), 
    h('div', { class: 'card' }, h('h3', {}, 'Add user'), h('div', { class: 'row' }, name, email, pass, role, add)),
    h('div', { class: 'card', style: 'overflow-x:auto' }, h('table', {},
      h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}, 'Images / month'), h('th', {}, 'Active'), h('th', {}, '')),
      users.map(u => h('tr', {},
        h('td', {}, u.name), h('td', {}, u.email),
        h('td', {}, h('select', { style: 'width:auto', onchange: e => upd(u, { role: e.target.value }) },
          h('option', { value: 'user', selected: u.role === 'user' }, 'User'), h('option', { value: 'admin', selected: u.role === 'admin' }, 'Admin'))),
        h('td', {}, h('input', { type: 'number', min: 0, value: u.monthlyLimit || 0, style: 'width:80px', title: '0 = no limit', onchange: e => upd(u, { monthlyLimit: Number(e.target.value) }) })),
        h('td', {}, h('input', { type: 'checkbox', checked: !u.disabled, onchange: e => upd(u, { disabled: !e.target.checked }) })),
        h('td', {}, h('button', { class: 'btn small ghost', onclick: () => { const p = prompt('New password for ' + u.email + ' (6+ characters):'); if (p) upd(u, { password: p }); } }, 'Reset password'), ' ',
          u.id !== S.user.id ? h('button', { class: 'btn small ghost', onclick: () => confirm('Delete ' + u.email + '?') && upd(u, { delete: true }) }, 'Delete') : null))))),
    h('p', { class: 'muted' }, 'Images / month: 0 means no limit.'));
}

async function adminSettings() {
  const s = await api('GET', '/admin/settings');
  const site = h('input', { value: s.siteName || 'Monsa Studio' });
  const key = h('input', { value: s.pollinationsKey || '', placeholder: 'Paste your key (starts with sk_)' });
  const limit = h('input', { type: 'number', min: 0, step: 'any', value: s.monthlyCostLimit || 0 });
  const save = h('button', { class: 'btn', onclick: () => busy(save, async () => {
    await api('POST', '/admin/settings', { siteName: site.value, pollinationsKey: key.value, monthlyCostLimit: Number(limit.value) });
    await loadData(); toast('Settings saved'); boot();
  }) }, 'Save settings');
  const clear = h('button', { class: 'btn ghost small', onclick: () => busy(clear, async () => {
    if (!confirm('Remove the saved AI key?')) return;
    await api('POST', '/admin/settings', { clearKey: true }); adminSettings(); toast('Key removed');
  }) }, 'Remove key');
  put(document.getElementById('adminBody'), h('div', { class: 'card' },
    h('h3', {}, 'AI key (Pollinations)'),
    h('div', { class: s.hasKey ? 'notice ok-notice' : 'notice' }, s.hasKey ? 'A key is saved. It is stored only on this computer (data/settings.json) and never shown in full.' : 'No key yet.'),
    h('ol', { class: 'muted', style: 'padding-left:18px' },
      h('li', {}, 'Go to ', h('a', { href: 'https://enter.pollinations.ai', target: '_blank' }, 'enter.pollinations.ai'), ' and sign up for free (GitHub or email).'),
      h('li', {}, 'Open "Keys", create a secret key (starts with sk_) and copy it.'),
      h('li', {}, 'Paste it below and press Save.')),
    h('label', {}, 'Key'), h('div', { class: 'row' }, h('div', { class: 'grow' }, key), s.hasKey ? clear : null),
    h('label', {}, 'Monthly cost limit in pollen (0 = no limit). You get a warning at 80%.'), limit,
    h('h3', { style: 'margin-top:18px' }, 'Branding'),
    h('label', {}, 'Website name'), site,
    h('p', { class: 'muted' }, 'Colours are in public/style.css (the top lines).'),
    h('div', { style: 'margin-top:14px' }, save)));
}

async function adminLog() {
  const log = await api('GET', '/admin/log');
  put(document.getElementById('adminBody'), h('div', { class: 'card', style: 'overflow-x:auto' },
    log.length ? h('table', {}, log.slice(0, 300).map(e => h('tr', {},
      h('td', { class: 'muted', style: 'white-space:nowrap' }, new Date(e.at).toLocaleString()), h('td', {}, e.user), h('td', {}, e.what)))) : h('p', { class: 'muted' }, 'Nothing yet.')));
}

boot().catch(e => toast(e.message, true));
