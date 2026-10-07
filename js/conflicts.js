// מנוע זיהוי התנגשויות.
// כלל: כל חפיפת זמנים אמיתית בין שני אירועים רלוונטיים = התנגשות.
// אירועים שאינם רלוונטיים (handover/חפיפה, חג/מועד) מדולגים.

import { isConflictCategory } from './categories.js';

function relevant(ev) {
  if (!ev) return false;
  if (ev.allDay) return false;               // יום-שלם אינו חוסם משבצות שעה
  if (ev.isConflictRelevant === false) return false;
  return isConflictCategory(ev.category);
}

function overlaps(a, b) {
  const aS = new Date(a.start).getTime(), aE = new Date(a.end).getTime();
  const bS = new Date(b.start).getTime(), bE = new Date(b.end).getTime();
  if ([aS, aE, bS, bE].some(n => Number.isNaN(n))) return false;
  return aS < bE && bS < aE; // חפיפה קפדנית (נגיעה בקצה אינה התנגשות)
}

// מחזיר את רשימת האירועים המתנגשים עם 'ev' מתוך 'pool' (מדלג על עצמו).
export function conflictsFor(ev, pool) {
  if (!relevant(ev)) return [];
  return pool.filter(o => o.id !== ev.id && relevant(o) && overlaps(ev, o));
}

// מסמן לכל אירוע ברשימה אם יש לו התנגשות (מול אירועים מאושרים).
// מחזיר Map: id -> [conflicting events]
export function buildConflictMap(events) {
  const relevantConfirmed = events.filter(e => e.status === 'confirmed' && relevant(e));
  const map = new Map();
  for (const ev of events) {
    if (!relevant(ev)) { map.set(ev.id, []); continue; }
    const hits = relevantConfirmed.filter(o => o.id !== ev.id && overlaps(ev, o));
    map.set(ev.id, hits);
  }
  return map;
}

export function hasConflict(ev, confirmedPool) {
  return conflictsFor(ev, confirmedPool).length > 0;
}
