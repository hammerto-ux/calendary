// שכבת אחסון מקומי (offline-first) מעל IndexedDB דרך Dexie.
// Dexie נטען גלובלית מ-index.html.

const db = new Dexie('calendary');

db.version(1).stores({
  // אירועים: מזהה, סטטוס, טווח זמן לחיפוש התנגשויות, מקור
  events: '++id, status, category, start, end, sourceFileId',
  // קבצים שיובאו + סטטוס עיבוד (ל-Reconciliation)
  files: '++id, name, status, addedAt',
  // מקרא: קוד -> שם + טלפון
  contacts: 'code, name',
  // הגדרות key/value
  settings: 'key',
});

export { db };

// ---------- Settings ----------
export async function getSetting(key, def = null) {
  const row = await db.settings.get(key);
  return row ? row.value : def;
}
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

// ---------- Events ----------
export async function addEvent(ev) {
  const now = new Date().toISOString();
  return db.events.add({ createdAt: now, updatedAt: now, flags: [], ...ev });
}
export async function updateEvent(id, patch) {
  return db.events.update(id, { ...patch, updatedAt: new Date().toISOString() });
}
export async function deleteEvent(id) {
  return db.events.delete(id);
}
export async function getEvent(id) {
  return db.events.get(id);
}
export async function allEvents() {
  return db.events.toArray();
}
export async function eventsByStatus(status) {
  return db.events.where('status').equals(status).toArray();
}
export async function confirmedEvents() {
  return eventsByStatus('confirmed');
}
export async function pendingEvents() {
  return eventsByStatus('proposed');
}

// ---------- Files ----------
export async function addFile(f) {
  return db.files.add({ addedAt: new Date().toISOString(), status: 'pending', eventsCount: 0, ...f });
}
export async function updateFile(id, patch) {
  return db.files.update(id, patch);
}
export async function allFiles() {
  return db.files.orderBy('addedAt').reverse().toArray();
}

// ---------- Contacts (legend) ----------
export async function upsertContact(c) {
  return db.contacts.put(c); // code הוא המפתח
}
export async function deleteContact(code) {
  return db.contacts.delete(code);
}
export async function allContacts() {
  return db.contacts.toArray();
}
export async function getContact(code) {
  if (!code) return null;
  return db.contacts.get(String(code).trim().toUpperCase());
}

// ---------- Backup ----------
export async function exportAll() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    events: await db.events.toArray(),
    files: await db.files.toArray(),
    contacts: await db.contacts.toArray(),
    settings: (await db.settings.toArray()).filter(s => s.key !== 'apiKey'), // לא מייצאים מפתח
  };
}
export async function importAll(data) {
  await db.transaction('rw', db.events, db.files, db.contacts, async () => {
    if (data.events)   { await db.events.clear();   await db.events.bulkAdd(data.events.map(({id, ...e}) => e)); }
    if (data.contacts) { await db.contacts.clear(); await db.contacts.bulkPut(data.contacts); }
    if (data.files)    { await db.files.clear();    await db.files.bulkAdd(data.files.map(({id, ...f}) => f)); }
  });
}
export async function clearAll() {
  await db.transaction('rw', db.events, db.files, db.contacts, async () => {
    await db.events.clear(); await db.files.clear(); await db.contacts.clear();
  });
}
