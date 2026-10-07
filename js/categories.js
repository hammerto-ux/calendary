// קטגוריות פעילות: צבע, תווית, ומילות-מפתח לזיהוי אוטומטי.
// handover ("חפיפה") = מתלמד שמגיע לצל — אינו רלוונטי להתנגשויות ואינו אירוע עצמאי בלוח.

export const CATEGORIES = {
  shift:    { label: 'משמרת',  color: '#2563eb', conflict: true,
              keywords: ['משמרת', 'shift', 'HHO', 'YUU', 'RTT', 'NMZ', 'ETK', 'YUN', 'ZXD', 'OPN'] },
  class:    { label: 'שיעור',   color: '#16a34a', conflict: true,
              keywords: ['שיעור', 'הרצאה', 'תרגול', 'מבחן', 'קורס', 'class', 'lecture', 'lesson', 'exam'] },
  exam_lifeguard: { label: 'בחינת מצילים', color: '#db2777', conflict: true,
              keywords: ['בחינות מצילים', 'בחינת מצילים', 'מבחן מצילים', 'מצילים', 'lifeguard'] },
  reserve:  { label: 'מילואים', color: '#4d7c0f', conflict: true,
              keywords: ['מילואים', 'צו 8', 'צו8', 'reserve', 'miluim'] },
  course_pending: { label: 'קורס בהמתנה', color: '#0891b2', conflict: false,
              keywords: ['קורסים בהמתנה', 'קורס בהמתנה', 'בהמתנה', 'המתנה', 'waitlist', 'pending', 'tentative'] },
  hike:     { label: 'טיול',    color: '#0d9488', conflict: true,
              keywords: ['מטיילים', 'טיול', 'נאונים', 'סיור', 'hike', 'trip'] },
  holiday:  { label: 'חג/מועד', color: '#7c3aed', conflict: false,
              keywords: ['חג', 'ראש השנה', 'יום כיפור', 'כיפור', 'ערב', 'שבת', 'מועד', 'holiday', 'erev'] },
  handover: { label: 'חפיפה',   color: '#f59e0b', conflict: false,
              keywords: ['חפיפה', 'מתלמד', 'צל', 'handover', 'overlap', 'shadow'] },
  personal: { label: 'אישי',    color: '#64748b', conflict: true,
              keywords: ['אישי', 'פגישה', 'תור', 'personal'] },
  other:    { label: 'אחר',     color: '#475569', conflict: true, keywords: [] },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export function colorFor(category) {
  return (CATEGORIES[category] || CATEGORIES.other).color;
}

export function labelFor(category) {
  return (CATEGORIES[category] || CATEGORIES.other).label;
}

export function isConflictCategory(category) {
  const c = CATEGORIES[category] || CATEGORIES.other;
  return c.conflict;
}

// ניחוש קטגוריה מטקסט חופשי (fallback להזנה ידנית וכגיבוי לחילוץ).
export function classify(text) {
  if (!text) return 'other';
  const t = String(text).toLowerCase();
  // עדיפות לקטגוריות ספציפיות כדי לא להתבלבל עם משמרת/שיעור כלליים.
  if (CATEGORIES.handover.keywords.some(k => t.includes(k.toLowerCase()))) return 'handover';
  if (CATEGORIES.exam_lifeguard.keywords.some(k => t.includes(k.toLowerCase()))) return 'exam_lifeguard';
  for (const key of CATEGORY_KEYS) {
    if (key === 'handover' || key === 'exam_lifeguard' || key === 'other') continue;
    if (CATEGORIES[key].keywords.some(k => t.includes(k.toLowerCase()))) return key;
  }
  return 'other';
}
