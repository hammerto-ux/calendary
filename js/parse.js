// עזרי נרמול: תאריך/שעה, פענוח קודים מהמקרא, והכנה לשמירה.
import { classify, colorFor, isConflictCategory, CATEGORY_KEYS } from './categories.js';
import { getContact } from './db.js';

// המרה ל-ISO מקומי לשדה datetime-local
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// datetime-local -> ISO מלא
export function fromLocalInput(val) {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function fmtRange(ev) {
  const s = new Date(ev.start), e = new Date(ev.end);
  const day = s.toLocaleDateString('he-IL', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
  if (ev.allDay) return `${day} · יום שלם`;
  const t = d => d.toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' });
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay ? `${day} · ${t(s)}–${t(e)}` : `${day} ${t(s)} → ${e.toLocaleDateString('he-IL')} ${t(e)}`;
}

// נרמול אירוע גולמי (מהחילוץ או מהזנה ידנית) -> רשומת אירוע מוכנה לשמירה.
export async function normalizeEvent(raw, { status = 'proposed', sourceFileId = null, sourceMeta = {} } = {}) {
  let category = raw.category && CATEGORY_KEYS.includes(raw.category)
    ? raw.category
    : classify([raw.title, raw.rawText, raw.assigneeCode].filter(Boolean).join(' '));

  // פענוח קוד מהמקרא -> שם + טלפון
  let assignee = null;
  const code = (raw.assigneeCode || '').trim().toUpperCase();
  if (code) {
    const c = await getContact(code);
    assignee = { code, name: c?.name || null, phone: c?.phone || null };
  }

  const flags = Array.isArray(raw.flags) ? [...raw.flags] : [];
  if (typeof raw.confidence === 'number' && raw.confidence < 0.6 && !flags.includes('low_confidence')) {
    flags.push('low_confidence');
  }
  if (!raw.start || !raw.end) flags.push('missing_field');

  return {
    title: raw.title || 'ללא כותרת',
    category,
    color: colorFor(category),
    start: raw.start || null,
    end: raw.end || raw.start || null,
    allDay: !!raw.allDay,
    location: raw.location || null,
    assignee,
    status,
    isConflictRelevant: raw.isConflictRelevant != null ? !!raw.isConflictRelevant : isConflictCategory(category),
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    flags,
    sourceFileId,
    source: { rawText: raw.rawText || null, ...sourceMeta },
  };
}
