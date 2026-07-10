// ─────────────────────────────────────────
// GIST CONFIG 
// ─────────────────────────────────────────
const GIST_ID   = 'https://gist.github.com/SerineGit/bd9be4e333493721652858e1fe341197';
const GIST_FILE = 'posts_db.json';
const GIST_URL  = 'https://api.github.com/gists/' + GIST_ID;

const OWNER_GITHUB_USERNAME = 'https://github.com/SerineGit';
function getToken() { return localStorage.getItem('ig_gist_token') || ''; }
function setToken(t) { localStorage.setItem('ig_gist_token', t); console.log('Токен сохранён. Обновите страницу.'); }
function clearToken() { localStorage.removeItem('ig_gist_token'); }
window.setToken = setToken; // вызывать из консоли браузера: setToken('твой_токен')

// Проверяет токен через GitHub API и возвращает логин владельца (или null, если токен нерабочий)
async function verifyToken(token) {
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.login || null;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────
// STATE
// ─────────────────────────────────────────
let db = { posts: [] };
let adminMode = false;
let lastSnapshot = '';
let saving = false;
let currentViewId = null; // id поста, открытого в модалке просмотра
let editingId = null;     // id поста, который сейчас редактируется в форме (null = добавление нового)

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
function uid() { return '_' + Math.random().toString(36).substr(2, 9); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function getPost(id) { return db.posts.find(p => p.id === id); }

// ─────────────────────────────────────────
// SAVE STATUS INDICATOR
// ─────────────────────────────────────────
function showSaveStatus(state) {
  let el = document.getElementById('save-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'save-status';
    document.body.appendChild(el);
  }
  const states = {
    saving: { text: '⟳ Сохранение…', bg: '#e8f4ff', color: '#0095f6' },
    ok:     { text: '✓ Сохранено',   bg: '#e6f9ee', color: '#2ecc71' },
    local:  { text: '⚠ Только локально', bg: '#fff4e6', color: '#e67e22' },
  };
  const s = states[state] || states.ok;
  el.textContent = s.text;
  el.style.background = s.bg;
  el.style.color = s.color;
  el.style.opacity = '1';
  if (state !== 'saving') {
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 2500);
  }
}

// ─────────────────────────────────────────
// GIST LOAD / SAVE
// ─────────────────────────────────────────
async function loadFromGist() {
  try {
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'token ' + token;

    const r = await fetch(GIST_URL, { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const content = j.files[GIST_FILE]?.content;
    if (!content) return false;
    const parsed = JSON.parse(content);
    if (!parsed.posts) return false;
    const snap = JSON.stringify(parsed);
    if (snap === lastSnapshot) return false;
    lastSnapshot = snap;
    db = parsed;
    return true;
  } catch (e) {
    console.warn('Gist load error:', e);
    return false;
  }
}

async function saveToGist() {
  if (saving) return;
  saving = true;
  showSaveStatus('saving');
  const body = JSON.stringify(db, null, 2);
  lastSnapshot = body;
  try { localStorage.setItem('ig_posts_backup', body); } catch (e) {}
  try {
    const token = getToken();
    if (!token) throw new Error('Нет токена');
    const r = await fetch(GIST_URL, {
      method: 'PATCH',
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ files: { [GIST_FILE]: { content: body } } })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    showSaveStatus('ok');
  } catch (e) {
    console.warn('Gist save error:', e);
    showSaveStatus('local');
  } finally {
    saving = false;
  }
}

async function poll() {
  if (!saving) {
    const changed = await loadFromGist();
    if (changed) renderGrid();
  }
  setTimeout(poll, 5000);
}

// ─────────────────────────────────────────
// ADMIN MODE
// ─────────────────────────────────────────
function toggleAdmin() {
  adminMode = !adminMode;
  document.body.classList.toggle('admin-mode', adminMode);
  const badge = document.getElementById('admin-badge');
  if (badge) {
    badge.textContent = adminMode ? '✏️ Редактирование ВКЛ' : '✏️ Редактирование ВЫКЛ';
    badge.classList.toggle('off', !adminMode);
  }
}

function createAdminBadge() {
  if (!getToken()) return; // без токена бейдж не появляется — обычные посетители его не видят
  const badge = document.createElement('div');
  badge.className = 'admin-badge off';
  badge.id = 'admin-badge';
  badge.textContent = '✏️ Редактирование ВЫКЛ';
  badge.addEventListener('click', toggleAdmin);
  document.body.appendChild(badge);
}

// Кнопка ☰ больше не открывает prompt для ввода токена — вход возможен только
// через консоль браузера (setToken('...')), как в календаре. Обычные посетители
// вообще не видят способа стать администратором.

// ─────────────────────────────────────────
// RENDER GRID
// ─────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  db.posts.forEach(post => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML = `
      ${post.image
        ? `<img src="${esc(post.image)}" alt="post" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
           <div class="placeholder-label" style="display:none;">картинка не загрузилась</div>`
        : `<div class="placeholder-label">пусто — добавь картинку</div>`}
      <div class="overlay">
        <span>♥ ${post.likes || 0}</span>
        <span>💬 0</span>
      </div>
      <button class="cell-edit-btn" title="Редактировать">✏️</button>
      <button class="cell-delete-btn" title="Удалить">✕</button>
    `;
    cell.addEventListener('click', (e) => {
      if (e.target.classList.contains('cell-edit-btn') || e.target.classList.contains('cell-delete-btn')) return;
      openViewModal(post.id);
    });
    cell.querySelector('.cell-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openPostForm(post.id);
    });
    cell.querySelector('.cell-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deletePost(post.id);
    });
    grid.appendChild(cell);
  });

  // ячейка-заглушка "добавить пост" — видна только в admin-режиме
  const addCell = document.createElement('div');
  addCell.className = 'add-cell';
  addCell.textContent = '+';
  addCell.addEventListener('click', () => openPostForm(null));
  grid.appendChild(addCell);

  document.getElementById('stat-posts').textContent = db.posts.length;
}

// ─────────────────────────────────────────
// VIEW MODAL (просмотр поста)
// ─────────────────────────────────────────
function openViewModal(id) {
  const post = getPost(id); if (!post) return;
  currentViewId = id;
  document.getElementById('viewModalMedia').innerHTML = post.image
    ? `<img src="${esc(post.image)}" alt="post">`
    : `пусто — добавь картинку`;
  document.getElementById('viewModalCaption').innerHTML =
    `<span class="name">SmithMildredActress</span>${esc(post.caption || '')}`;
  document.getElementById('viewModalLikes').textContent = `${post.likes || 0} likes`;
  document.getElementById('viewModalTime').textContent = post.time || '';
  document.getElementById('viewModalBackdrop').classList.add('open');
}
function closeViewModal() {
  document.getElementById('viewModalBackdrop').classList.remove('open');
  currentViewId = null;
}
document.getElementById('viewCloseBtn').addEventListener('click', closeViewModal);
document.getElementById('viewModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'viewModalBackdrop') closeViewModal();
});
document.getElementById('viewEditBtn').addEventListener('click', () => {
  if (!currentViewId) return;
  const id = currentViewId;
  closeViewModal();
  openPostForm(id);
});
document.getElementById('viewDeleteBtn').addEventListener('click', () => {
  if (!currentViewId) return;
  const id = currentViewId;
  closeViewModal();
  deletePost(id);
});

// ─────────────────────────────────────────
// POST FORM (добавление / редактирование)
// ─────────────────────────────────────────
function openPostForm(id) {
  editingId = id;
  const post = id ? getPost(id) : null;
  document.getElementById('pf-heading').textContent = post ? 'Редактировать пост' : 'Новый пост';
  document.getElementById('pf-image').value = post ? (post.image || '') : '';
  document.getElementById('pf-caption').value = post ? (post.caption || '') : '';
  document.getElementById('pf-likes').value = post ? (post.likes || '') : '';
  document.getElementById('pf-time').value = post ? (post.time || '') : '';
  updateImagePreview();
  document.getElementById('postFormModal').classList.add('open');
}
function closePostForm() {
  document.getElementById('postFormModal').classList.remove('open');
  editingId = null;
}
function updateImagePreview() {
  const url = document.getElementById('pf-image').value.trim();
  const prev = document.getElementById('pf-image-preview');
  prev.innerHTML = url
    ? `<img src="${esc(url)}" onerror="this.style.display='none'">`
    : '';
}
document.getElementById('pf-image').addEventListener('input', updateImagePreview);
document.getElementById('postFormCloseBtn').addEventListener('click', closePostForm);
document.getElementById('pf-cancel').addEventListener('click', closePostForm);
document.getElementById('postFormBackdrop').addEventListener('click', closePostForm);

document.getElementById('pf-submit').addEventListener('click', async () => {
  const image = document.getElementById('pf-image').value.trim();
  const caption = document.getElementById('pf-caption').value.trim();
  const likes = parseInt(document.getElementById('pf-likes').value, 10) || 0;
  const time = document.getElementById('pf-time').value.trim();

  if (editingId) {
    const post = getPost(editingId);
    if (post) {
      post.image = image;
      post.caption = caption;
      post.likes = likes;
      post.time = time;
    }
  } else {
    db.posts.unshift({ id: uid(), image, caption, likes, time });
  }
  await saveToGist();
  closePostForm();
  renderGrid();
});

async function deletePost(id) {
  if (!confirm('Удалить пост?')) return;
  db.posts = db.posts.filter(p => p.id !== id);
  await saveToGist();
  renderGrid();
}

// ─────────────────────────────────────────
// ADD-POST BUTTON (плюсик в шапке)
// ─────────────────────────────────────────
document.getElementById('add-post-btn').addEventListener('click', () => {
  if (!adminMode) return; // для обычных посетителей кнопка тихо ничего не делает
  openPostForm(null);
});

// ─────────────────────────────────────────
// KEYBOARD
// ─────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeViewModal(); closePostForm(); }
});

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
async function init() {
  // если в этом браузере уже лежит токен — проверяем, что он рабочий и принадлежит именно тебе.
  // если нет — тихо стираем его, бейдж администратора тогда не появится.
  const token = getToken();
  if (token) {
    const login = await verifyToken(token);
    if (!login || login.toLowerCase() !== OWNER_GITHUB_USERNAME.toLowerCase()) {
      clearToken();
    }
  }
  createAdminBadge();
  await loadFromGist();
  renderGrid();
  poll();
}
init();
