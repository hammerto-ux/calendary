// נקודת הכניסה: חיווט מסכים, מודאלים, ייבוא וחילוץ.
import * as db from './db.js';
import { CATEGORIES, CATEGORY_KEYS, labelFor, colorFor } from './categories.js';
import { normalizeEvent, toLocalInput, fromLocalInput, fmtRange } from './parse.js';
import { conflictsFor } from './conflicts.js';
import { initCalendar, refreshCalendar, gotoDate } from './calendar.js';
import { extractFromFile } from './extract.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------- Navigation ----------
function showScreen(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.screen === name));
  if (name === 'pending') renderPending();
  if (name === 'import') renderFiles();
  if (name === 'contacts') renderContacts();
  if (name === 'settings') loadSettings();
  if (name === 'calendar') refreshCalendar();
}

// ---------- Badges ----------
async function updateBadges() {
  const events = await db.allEvents();
  const pending = events.filter(e => e.status === 'proposed').length;
  const confirmed = events.filter(e => e.status === 'confirmed');
  // התנגשויות פעילות: אירועים מאושרים שיש להם התנגשות מול מאושרים אחרים
  let conflictCount = 0;
  const seen = new Set();
  for (const e of confirmed) {
    if (seen.has(e.id)) continue;
    const hits = conflictsFor(e, confirmed);
    if (hits.length) { conflictCount++; hits.forEach(h => seen.add(h.id)); seen.add(e.id); }
  }
  const pb = $('#pendingBadge'), cb = $('#conflictBadge');
  pb.textContent = pending; pb.classList.toggle('hidden', pending === 0);
  cb.textContent = conflictCount; cb.classList.toggle('hidden', conflictCount === 0);
}

// ---------- Legend + category selects ----------
function buildLegend() {
  const bar = $('#legendBar');
  bar.innerHTML = '';
  for (const key of CATEGORY_KEYS) {
    const c = CATEGORIES[key];
    const chip = document.createElement('span');
    chip.className = 'legend-chip';
    chip.innerHTML = `<span class="legend-dot" style="background:${c.color}"></span>${c.label}`;
    bar.appendChild(chip);
  }
  const sel = $('#ev-category');
  sel.innerHTML = CATEGORY_KEYS.map(k => `<option value="${k}">${CATEGORIES[k].label}</option>`).join('');
}

async function refreshAssigneeList() {
  const contacts = await db.allContacts();
  $('#assigneeCodes').innerHTML = contacts.map(c => `<option value="${c.code}">${c.name || ''}</option>`).join('');
}

// ---------- Event modal ----------
const modal = $('#eventModal');
function openEventModal(ev = null, presetDate = null) {
  $('#eventModalTitle').textContent = ev ? 'עריכת אירוע' : 'אירוע חדש';
  $('#ev-id').value = ev?.id ?? '';
  $('#ev-title').value = ev?.title ?? '';
  $('#ev-category').value = ev?.category ?? 'shift';
  $('#ev-allday').checked = !!ev?.allDay;
  $('#ev-location').value = ev?.location ?? '';
  $('#ev-assignee').value = ev?.assignee?.code ?? '';
  const now = presetDate ? new Date(presetDate + 'T09:00') : new Date();
  const end = presetDate ? new Date(presetDate + 'T10:00') : new Date(Date.now() + 3600e3);
  $('#ev-start').value = ev?.start ? toLocalInput(ev.start) : toLocalInput(now.toISOString());
  $('#ev-end').value = ev?.end ? toLocalInput(ev.end) : toLocalInput(end.toISOString());
  $('#ev-delete').classList.toggle('hidden', !ev);
  $('#ev-conflicts').classList.add('hidden');
  modal.classList.remove('hidden');
  checkConflictLive();
}
function closeEventModal() { modal.classList.add('hidden'); }

async function checkConflictLive() {
  const box = $('#ev-conflicts');
  const start = fromLocalInput($('#ev-start').value);
  const end = fromLocalInput($('#ev-end').value);
  if (!start || !end) { box.classList.add('hidden'); return; }
  const draft = {
    id: Number($('#ev-id').value) || -1,
    category: $('#ev-category').value,
    start, end, allDay: $('#ev-allday').checked,
    isConflictRelevant: undefined,
  };
  const confirmed = await db.confirmedEvents();
  const hits = conflictsFor(draft, confirmed);
  if (hits.length) {
    box.innerHTML = `⚠️ מתנגש עם: ` + hits.map(h => `<b>${h.title}</b> (${fmtRange(h)})`).join('، ');
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

async function saveEventFromForm(e) {
  e.preventDefault();
  const id = Number($('#ev-id').value) || null;
  const raw = {
    title: $('#ev-title').value.trim(),
    category: $('#ev-category').value,
    start: fromLocalInput($('#ev-start').value),
    end: fromLocalInput($('#ev-end').value),
    allDay: $('#ev-allday').checked,
    location: $('#ev-location').value.trim() || null,
    assigneeCode: $('#ev-assignee').value.trim() || null,
  };
  if (!raw.title || !raw.start || !raw.end) { toast('חסרים שדות חובה'); return; }
  if (new Date(raw.end) <= new Date(raw.start)) { toast('שעת הסיום חייבת להיות אחרי ההתחלה'); return; }
  const rec = await normalizeEvent(raw, { status: 'confirmed' });
  if (id) await db.updateEvent(id, rec); else await db.addEvent(rec);
  closeEventModal();
  await Promise.all([refreshCalendar(), updateBadges()]);
  toast('נשמר ✓');
}

async function deleteCurrentEvent() {
  const id = Number($('#ev-id').value);
  if (!id) return;
  if (!confirm('למחוק את האירוע?')) return;
  await db.deleteEvent(id);
  closeEventModal();
  await Promise.all([refreshCalendar(), updateBadges()]);
  toast('נמחק');
}

// ---------- Pending (approvals) ----------
async function renderPending() {
  const list = $('#pendingList');
  const items = await db.pendingEvents();
  const confirmed = await db.confirmedEvents();
  if (!items.length) { list.innerHTML = `<p class="hint">אין אירועים ממתינים. ייבאו קובץ במסך "ייבוא".</p>`; return; }
  list.innerHTML = '';
  for (const ev of items) {
    const hits = conflictsFor(ev, confirmed);
    const flagged = hits.length || (ev.flags || []).length;
    const card = document.createElement('div');
    card.className = 'card' + (flagged ? ' flagged' : '');
    const pills = [];
    if (ev.confidence != null) pills.push(`<span class="pill pill-conf">ביטחון ${Math.round(ev.confidence*100)}%</span>`);
    if (hits.length) pills.push(`<span class="pill pill-flag">התנגשות</span>`);
    (ev.flags||[]).forEach(f => pills.push(`<span class="pill pill-warn">${flagLabel(f)}</span>`));
    card.innerHTML = `
      <div class="card-title"><span class="cat-dot" style="background:${colorFor(ev.category)}"></span>${escapeHtml(ev.title)} ${pills.join(' ')}</div>
      <div class="card-meta">${fmtRange(ev)}${ev.location ? ' · '+escapeHtml(ev.location) : ''}${ev.assignee?.code ? ' · '+escapeHtml(ev.assignee.code)+(ev.assignee.name?' ('+escapeHtml(ev.assignee.name)+')':'') : ''}</div>
      ${hits.length ? `<div class="card-meta" style="color:var(--danger)">מתנגש עם: ${hits.map(h=>escapeHtml(h.title)+' ('+fmtRange(h)+')').join('، ')}</div>` : ''}
      ${ev.source?.rawText ? `<div class="card-src">מקור: ${escapeHtml(ev.source.rawText)}</div>` : ''}
      <div class="card-actions">
        <button class="btn btn-primary" data-act="approve">אישור</button>
        <button class="btn btn-ghost" data-act="edit">עריכה</button>
        <button class="btn btn-ghost btn-danger" data-act="reject">דחייה</button>
      </div>`;
    card.querySelector('[data-act=approve]').onclick = () => approveEvent(ev.id);
    card.querySelector('[data-act=reject]').onclick = () => rejectEvent(ev.id);
    card.querySelector('[data-act=edit]').onclick = () => editPending(ev);
    list.appendChild(card);
  }
}
function flagLabel(f){ return {low_confidence:'ביטחון נמוך', missing_field:'שדה חסר'}[f] || f; }

async function approveEvent(id) {
  await db.updateEvent(id, { status: 'confirmed' });
  await afterPendingChange('אושר ✓');
}
async function rejectEvent(id) {
  await db.updateEvent(id, { status: 'rejected' });
  await afterPendingChange('נדחה');
}
function editPending(ev) {
  // עריכה של אירוע מוצע: פותחים מודאל; שמירה תהפוך אותו למאושר.
  openEventModal(ev);
}
async function afterPendingChange(msg) {
  await Promise.all([renderPending(), refreshCalendar(), updateBadges(), renderFiles()]);
  toast(msg);
}

$('#btnApproveAll').onclick = async () => {
  const items = await db.pendingEvents();
  if (!items.length) return;
  if (!confirm(`לאשר ${items.length} אירועים?`)) return;
  await Promise.all(items.map(e => db.updateEvent(e.id, { status: 'confirmed' })));
  await afterPendingChange('כולם אושרו ✓');
};
$('#btnRejectAll').onclick = async () => {
  const items = await db.pendingEvents();
  if (!items.length) return;
  if (!confirm(`לדחות ${items.length} אירועים?`)) return;
  await Promise.all(items.map(e => db.updateEvent(e.id, { status: 'rejected' })));
  await afterPendingChange('כולם נדחו');
};

// ---------- Import & extraction ----------
async function handleFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  const status = $('#importStatus');
  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'import-row';
    row.innerHTML = `<span class="spinner"></span><span>${escapeHtml(file.name)} — מתחיל…</span>`;
    status.prepend(row);
    const setMsg = (m) => { row.lastChild.textContent = `${file.name} — ${m}`; };

    const fileId = await db.addFile({ name: file.name, type: file.type, size: file.size, status: 'processing' });
    try {
      const result = await extractFromFile(file, setMsg);
      // שמירת אנשי קשר שחולצו
      for (const c of result.contacts) {
        if (c.code) await db.upsertContact({ code: String(c.code).trim().toUpperCase(), name: c.name || '', phone: c.phone || '' });
      }
      // שמירת אירועים מוצעים
      let saved = 0;
      for (const raw of result.events) {
        const rec = await normalizeEvent(raw, { status: 'proposed', sourceFileId: fileId, sourceMeta: { fileName: file.name } });
        await db.addEvent(rec);
        saved++;
      }
      await db.updateFile(fileId, { status: 'processed', eventsCount: saved });
      row.querySelector('.spinner').outerHTML = '✅';
      setMsg(`חולצו ${saved} אירועים — עברו למסך "אישורים"`);
      toast(`${file.name}: ${saved} אירועים ממתינים לאישור`);
    } catch (err) {
      await db.updateFile(fileId, { status: 'error', note: err.message });
      row.querySelector('.spinner').outerHTML = '⚠️';
      setMsg(`שגיאה: ${err.message}`);
    }
  }
  await Promise.all([refreshAssigneeList(), renderFiles(), updateBadges()]);
}

async function renderFiles() {
  const list = $('#filesList');
  const files = await db.allFiles();
  if (!files.length) { list.innerHTML = `<p class="hint">עדיין לא יובאו קבצים.</p>`; return; }
  const events = await db.allEvents();
  list.innerHTML = '';
  for (const f of files) {
    const fromFile = events.filter(e => e.sourceFileId === f.id);
    const pendingCount = fromFile.filter(e => e.status === 'proposed').length;
    const okCount = fromFile.filter(e => e.status === 'confirmed').length;
    const statusPill = f.status === 'processed'
      ? (pendingCount === 0 ? `<span class="pill pill-ok">טופל במלואו</span>` : `<span class="pill pill-warn">${pendingCount} ממתינים</span>`)
      : f.status === 'error' ? `<span class="pill pill-flag">שגיאה</span>`
      : `<span class="pill pill-conf">בעיבוד…</span>`;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title">📄 ${escapeHtml(f.name)} ${statusPill}</div>
      <div class="card-meta">${new Date(f.addedAt).toLocaleString('he-IL')}${f.eventsCount!=null?` · חולצו ${f.eventsCount}`:''} · אושרו ${okCount}${f.note?` · ${escapeHtml(f.note)}`:''}</div>`;
    list.appendChild(card);
  }
}

// ---------- Contacts (legend) ----------
async function renderContacts() {
  const list = $('#contactsList');
  const contacts = await db.allContacts();
  if (!contacts.length) { list.innerHTML = `<p class="hint">אין קודים עדיין. הם ייווצרו אוטומטית בעת ייבוא, או הוסיפו ידנית.</p>`; return; }
  list.innerHTML = '';
  for (const c of contacts.sort((a,b)=>a.code.localeCompare(b.code))) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title">🏷️ ${escapeHtml(c.code)}</div>
      <div class="card-meta">${escapeHtml(c.name||'—')}${c.phone?' · '+escapeHtml(c.phone):''}</div>
      <div class="card-actions">
        <button class="btn btn-ghost" data-act="edit">עריכה</button>
        <button class="btn btn-ghost btn-danger" data-act="del">מחיקה</button>
      </div>`;
    card.querySelector('[data-act=edit]').onclick = () => editContact(c);
    card.querySelector('[data-act=del]').onclick = async () => {
      if (confirm(`למחוק את הקוד ${c.code}?`)) { await db.deleteContact(c.code); renderContacts(); refreshAssigneeList(); }
    };
    list.appendChild(card);
  }
}
async function editContact(c = null) {
  const code = prompt('קוד (למשל HHO):', c?.code || '');
  if (!code) return;
  const name = prompt('שם מלא:', c?.name || '') || '';
  const phone = prompt('טלפון:', c?.phone || '') || '';
  await db.upsertContact({ code: code.trim().toUpperCase(), name: name.trim(), phone: phone.trim() });
  renderContacts(); refreshAssigneeList();
  toast('נשמר ✓');
}

// ---------- Settings ----------
const MODELS = {
  gemini: [['gemini-3.8-flash','gemini-3.8-flash (מומלץ)'], ['gemini-3.8-pro','gemini-3.8-pro (מדויק יותר)']],
  claude: [['claude-sonnet-5','claude-sonnet-5 (מומלץ)'], ['claude-opus-5','claude-opus-5'], ['claude-haiku-4-5','claude-haiku-4-5']],
};
const RETIRED_MODELS = new Set(['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash']);
const KEY_HINT = {
  gemini: 'מפתח חינמי מ-aistudio.google.com (Get API key) — שונה מאפליקציית Gemini. נשמר מקומית בלבד.',
  claude: 'מפתח מ-console.anthropic.com. נשמר מקומית בלבד.',
};
function populateModels(provider, selected) {
  const opts = MODELS[provider] || MODELS.gemini;
  $('#modelList').innerHTML = opts.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  const input = $('#setModel');
  input.value = (selected && !RETIRED_MODELS.has(selected)) ? selected : opts[0][0];
  input.placeholder = opts[0][0];
  $('#apiKeyHint').textContent = KEY_HINT[provider] || KEY_HINT.gemini;
}
async function loadSettings() {
  const provider = await db.getSetting('provider', 'gemini');
  $('#setProvider').value = provider;
  populateModels(provider, await db.getSetting('model', ''));
  $('#setApiKey').value = await db.getSetting('apiKey', '');
  $('#setProxy').value = await db.getSetting('proxyUrl', '');
}
$('#setProvider').addEventListener('change', () => populateModels($('#setProvider').value));
$('#btnSaveSettings').onclick = async () => {
  await db.setSetting('provider', $('#setProvider').value);
  await db.setSetting('apiKey', $('#setApiKey').value.trim());
  await db.setSetting('model', $('#setModel').value.trim());
  await db.setSetting('proxyUrl', $('#setProxy').value.trim());
  const m = $('#settingsSaved'); m.classList.remove('hidden'); setTimeout(()=>m.classList.add('hidden'), 1800);
};
$('#btnExport').onclick = async () => {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calendary-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#importBackup').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm('ייבוא גיבוי יחליף את הנתונים הקיימים. להמשיך?')) return;
    await db.importAll(data);
    await refreshAll();
    toast('גיבוי יובא ✓');
  } catch (err) { toast('קובץ גיבוי לא תקין'); }
  e.target.value = '';
};
$('#btnClearAll').onclick = async () => {
  if (!confirm('למחוק את כל האירועים, הקבצים והמקרא? פעולה בלתי הפיכה.')) return;
  await db.clearAll();
  await refreshAll();
  toast('הכל נמחק');
};

// ---------- helpers ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
async function refreshAll() {
  await Promise.all([refreshCalendar(), updateBadges(), renderPending(), renderFiles(), renderContacts(), refreshAssigneeList()]);
}

// ---------- Share Target (קבצים משותפים מהטלפון) ----------
async function consumeSharedFiles() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('shared-files');
    const reqs = await cache.keys();
    const files = [];
    for (const req of reqs) {
      const res = await cache.match(req);
      if (!res) continue;
      const blob = await res.blob();
      const name = decodeURIComponent(req.url.split('/').pop()) || 'shared';
      files.push(new File([blob], name, { type: blob.type }));
      await cache.delete(req);
    }
    if (files.length) {
      showScreen('import');
      await handleFiles(files);
    }
  } catch { /* ignore */ }
}

// ---------- Boot ----------
function wire() {
  $$('.tab').forEach(t => t.onclick = () => showScreen(t.dataset.screen));
  $('#btnAddEvent').onclick = () => openEventModal();
  $('#eventModalClose').onclick = closeEventModal;
  modal.onclick = (e) => { if (e.target === modal) closeEventModal(); };
  $('#eventForm').onsubmit = saveEventFromForm;
  $('#ev-delete').onclick = deleteCurrentEvent;
  ['#ev-start','#ev-end','#ev-category','#ev-allday'].forEach(s => $(s).addEventListener('change', checkConflictLive));
  $('#btnAddContact').onclick = () => editContact();

  const fi = $('#fileInput');
  fi.onchange = () => { handleFiles(fi.files); fi.value=''; };
  const dz = $('#dropzone');
  ['dragover','dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
}

async function boot() {
  buildLegend();
  wire();
  initCalendar($('#calendar'), {
    onEventClick: async (id) => { const ev = await db.getEvent(id); if (ev) openEventModal(ev); },
    onDateClick: (dateStr) => openEventModal(null, dateStr),
  });
  await refreshAll();

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch {}
  }
  const params = new URLSearchParams(location.search);
  if (params.get('shared')) { history.replaceState({}, '', location.pathname); consumeSharedFiles(); }
}

document.addEventListener('DOMContentLoaded', boot);
