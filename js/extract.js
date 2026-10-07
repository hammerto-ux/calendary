// חילוץ אירועים מקבצים באמצעות Claude API (ראייה + טקסט).
// PDF -> רינדור עמודים לתמונות (pdf.js) + טקסט. DOCX -> טקסט (mammoth). תמונה -> ישירות.
import { getSetting, setSetting } from './db.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const PDF_JS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.min.mjs';
const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.min.mjs';
const MAX_PDF_PAGES = 8;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function pdfToImages(file) {
  const pdfjs = await import(PDF_JS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const images = [];
  let text = '';
  const n = Math.min(pdf.numPages, MAX_PDF_PAGES);
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/png').split(',')[1]);
    try {
      const tc = await page.getTextContent();
      text += tc.items.map(it => it.str).join(' ') + '\n';
    } catch { /* ignore text layer errors */ }
  }
  return { images, text, pages: pdf.numPages };
}

function buildPrompt(extraText, aliases = []) {
  const today = new Date().toISOString().slice(0, 10);
  const identity = aliases.length ? `

סינון אישי — חשוב מאוד:
- המשתמש מזוהה ע"י הקודים/שמות הבאים: ${aliases.map(a => `"${a}"`).join(', ')} (כולל וריאציות כתיב של השם, למשל סדר הפוך או עם/בלי פסיק).
- אם המסמך הוא סידור המשויך לכמה אנשים (לפי קודים/שמות בכל תא) — חלץ אך ורק את האירועים של המשתמש, והתעלם לחלוטין משיבוצים של אחרים.
- אם המסמך הוא מערכת כללית ללא שיוך אישי (למשל מערכת שעות של כיתה) — חלץ את כל האירועים.` : '';
  return `אתה מחלץ אירועי לוח-שנה מתוך מסמך לוח זמנים (משמרות / מערכת שעות / סידור).
התאריך היום: ${today}. אזור זמן: Asia/Jerusalem.${identity}

הפק אך ורק JSON תקין במבנה:
{
  "events": [
    {
      "title": "כותרת קצרה",
      "category": "shift|class|exam_lifeguard|reserve|course_pending|hike|holiday|handover|personal|other",
      "start": "YYYY-MM-DDTHH:MM:00",   // זמן מקומי, ללא אזור-זמן
      "end":   "YYYY-MM-DDTHH:MM:00",
      "allDay": false,
      "location": "אם מופיע",
      "assigneeCode": "קוד כמו HHO/RTT אם מופיע",
      "rawText": "הטקסט המקורי של התא",
      "confidence": 0.0-1.0
    }
  ],
  "contacts": [ { "code": "HHO", "name": "שם מלא", "phone": "טלפון" } ]
}

כללים:
- הסק את החודש/השנה מכותרת המסמך (למשל "September 2026" או "מחזור 6 שנה א 26-27"). אם השנה חסרה, השתמש בשנה הקרובה ביותר להיום.
- טווח שעות "09:00 - 14:00" => start ו-end באותו יום.
- כל תא יכול להכיל כמה פעילויות (שורות שונות) — הפק אירוע לכל אחת.
- "חפיפה" משמעותה מתלמד שמגיע לצל; סווג אותה category="handover".
- "מילואים" => category="reserve". "בחינת/בחינות מצילים" => category="exam_lifeguard". "קורס בהמתנה" => category="course_pending".
- חגים/מועדים (ראש השנה, יום כיפור, ערב חג, שבת) => category="holiday", allDay=true אם אין שעות.
- אם יש מקרא (טבלת קודים -> שם -> טלפון) הפק אותו למערך contacts.
- אל תמציא נתונים. אם שדה חסר, השמט אותו או הורד confidence.
- החזר JSON דחוס (minified) בלבד — בלי רווחים/שורות מיותרים, בלי טקסט נוסף ובלי code fences.${aliases.length ? '\n- חשוב לקיצור: אל תכלול כלל אירועים של אחרים — רק של המשתמש.' : ''}
${extraText ? `\nטקסט שחולץ מהמסמך (עזר):\n"""${extraText.slice(0, 6000)}"""` : ''}`;
}

function parseJson(text) {
  if (!text) throw new Error('תשובה ריקה מהמודל');
  let t = text.trim().replace(/^```(json)?/i, '').replace(/```$/,'').trim();
  const start = t.indexOf('{'); const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

// הצלת אירועים מתוך JSON שנקטע: אוסף אובייקטים שלמים מתוך מערך "events".
function extractBalancedObjects(s) {
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(s.slice(start, i + 1))); } catch {} start = -1; } }
  }
  return out;
}
function salvageEvents(text) {
  if (!text) return [];
  const key = text.indexOf('"events"');
  const arrStart = key >= 0 ? text.indexOf('[', key) : text.indexOf('[');
  if (arrStart < 0) return [];
  return extractBalancedObjects(text.slice(arrStart + 1))
    .filter(o => o && (o.title || o.start || o.rawText)); // רק אובייקטים שנראים כאירוע
}
// פענוח סובלני: מנסה פענוח מלא, ואם נכשל (תשובה חתוכה) — מציל אירועים שלמים.
function parseResult(text) {
  try { return { ...parseJson(text), _salvaged: false }; }
  catch (e) {
    const events = salvageEvents(text.replace(/^```(json)?/i, '').trim());
    if (events.length) return { events, contacts: [], _salvaged: true };
    throw e;
  }
}

const DEFAULT_MODEL = { claude: 'claude-sonnet-5', gemini: 'gemini-3.8-flash' };
// מודלים שהוצאו משימוש — יוחלפו אוטומטית בברירת המחדל העדכנית.
export const RETIRED_MODELS = new Set(['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash']);

// ממשק ראשי: מקבל File -> מחזיר { events:[], contacts:[], meta:{} }
export async function extractFromFile(file, onProgress = () => {}) {
  const provider = await getSetting('provider', 'gemini');
  const apiKey = await getSetting('apiKey', '');
  let model = await getSetting('model', '');
  if (!model || RETIRED_MODELS.has(model)) model = DEFAULT_MODEL[provider] || DEFAULT_MODEL.gemini;
  const proxyUrl = await getSetting('proxyUrl', '');
  const workspaceId = await getSetting('claudeWorkspaceId', '');
  const aliases = (await getSetting('myAliases', '')).split(',').map(s => s.trim()).filter(Boolean);
  if (!apiKey && !proxyUrl) {
    throw new Error('חסר מפתח API. הוסיפו אותו במסך ההגדרות.');
  }

  const type = file.type || '';
  let images = [], extraText = '';

  if (type.startsWith('image/')) {
    onProgress('מעבד תמונה…');
    const b64 = await fileToBase64(file);
    // ממירים ל-PNG אחיד ע"י שליחה כפי שהוא — הקוד מטה מצפה ל-image/png; לכן נעטוף.
    images = [b64];
  } else if (type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    onProgress('מרנדר עמודי PDF…');
    const r = await pdfToImages(file);
    images = r.images; extraText = r.text;
  } else if (file.name.toLowerCase().endsWith('.docx')) {
    onProgress('קורא DOCX…');
    const buf = await file.arrayBuffer();
    const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
    extraText = r.value || '';
  } else {
    throw new Error('סוג קובץ לא נתמך. נתמך: PDF, DOCX, תמונה.');
  }

  onProgress(`שולח ל-${provider === 'gemini' ? 'Gemini' : 'Claude'} לחילוץ…`);
  const prompt = buildPrompt(extraText, aliases);
  const mediaType = type.startsWith('image/') ? type : 'image/png';
  const rawText = provider === 'gemini'
    ? await callGemini({ apiKey, model, proxyUrl, mediaType, images, prompt, onProgress })
    : await callClaude({ apiKey, model, proxyUrl, workspaceId, mediaType, images, prompt, onProgress });
  const parsed = parseResult(rawText);
  if (parsed._salvaged) onProgress('התשובה נקטעה — חולצו האירועים השלמים בלבד');
  let events = Array.isArray(parsed.events) ? parsed.events : [];

  // רשת ביטחון: אם הוגדרה זהות אישית, סנן אירועים ששויכו במפורש למישהו אחר —
  // אך ורק כשנראה שזה סידור רב-אנשים (יותר מקוד/שם אחד). מערכת שעות כללית
  // (ללא שיוך, או קוד יחיד) נשארת במלואה.
  if (aliases.length) {
    const up = aliases.map(a => a.toUpperCase());
    const owners = new Set(events.map(e => (e.assigneeCode || '').trim().toUpperCase()).filter(Boolean));
    const looksLikeRoster = owners.size > 1;
    if (looksLikeRoster) {
      events = events.filter(ev => {
        const owner = (ev.assigneeCode || '').trim().toUpperCase();
        if (!owner) return true; // ללא שיוך -> נשאר
        return up.some(a => owner === a || owner.includes(a) || a.includes(owner));
      });
    }
  }

  return {
    events,
    contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
    meta: { pages: undefined },
  };
}

// POST עם ניסיון חוזר אוטומטי על עומסים זמניים (429/500/502/503/529 / UNAVAILABLE / OVERLOADED).
const TRANSIENT = new Set([429, 500, 502, 503, 529]);
async function postWithRetry(url, options, { label, onProgress = () => {}, retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (netErr) {
      if (attempt >= retries) throw new Error(`שגיאת רשת (${label}): ${netErr.message}`);
      await backoff(attempt, onProgress, label);
      continue;
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    const transient = TRANSIENT.has(res.status) || /UNAVAILABLE|OVERLOADED|high demand/i.test(body);
    if (!transient || attempt >= retries) {
      throw new Error(`שגיאת ${label} (${res.status}): ${body.slice(0, 300)}`);
    }
    await backoff(attempt, onProgress, label);
  }
}
function backoff(attempt, onProgress, label) {
  const waitMs = Math.min(10000, 1200 * Math.pow(2, attempt)) + Math.floor(Math.random() * 600);
  onProgress(`${label} עמוס — ניסיון חוזר בעוד ${Math.round(waitMs / 1000)} שנ'…`);
  return new Promise(r => setTimeout(r, waitMs));
}

// --- Claude (Anthropic) ---
async function callClaude({ apiKey, model, proxyUrl, workspaceId, mediaType, images, prompt, onProgress }) {
  const content = [];
  for (const b64 of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } });
  }
  content.push({ type: 'text', text: prompt });

  const url = proxyUrl && proxyUrl.trim() ? proxyUrl.trim() : ANTHROPIC_URL;
  const headers = { 'content-type': 'application/json' };
  if (!proxyUrl) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    if (workspaceId && workspaceId.trim()) headers['anthropic-workspace-id'] = workspaceId.trim();
  }
  const res = await postWithRetry(url, {
    method: 'POST', headers,
    body: JSON.stringify({ model, max_tokens: 8192, messages: [{ role: 'user', content }] }),
  }, { label: 'Claude', onProgress });
  const data = await res.json();
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (!text) {
    throw new Error(`Claude החזיר תשובה ריקה (stop_reason=${data.stop_reason || '?'}, model=${data.model || '?'}): ${JSON.stringify(data).slice(0, 250)}`);
  }
  return text;
}

// --- Gemini (Google AI Studio) ---
// שולף את רשימת המודלים הזמינים בחשבון שתומכים ב-generateContent.
async function listGeminiModels(apiKey) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) throw new Error('list failed');
  const data = await res.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => (m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
}

async function callGemini({ apiKey, model, proxyUrl, mediaType, images, prompt, onProgress }) {
  const parts = [];
  for (const b64 of images) {
    parts.push({ inline_data: { mime_type: mediaType, data: b64 } });
  }
  parts.push({ text: prompt });
  const bodyStr = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' },
  });

  const tried = new Set();
  const attempt = async (m, retries) => {
    tried.add(m);
    const url = proxyUrl && proxyUrl.trim()
      ? proxyUrl.trim()
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
    const headers = { 'content-type': 'application/json' };
    if (!proxyUrl) headers['x-goog-api-key'] = apiKey; // המפתח בכותרת, לא ב-URL
    const res = await postWithRetry(url, { method: 'POST', headers, body: bodyStr },
      { label: `Gemini/${m}`, onProgress, retries });
    const data = await res.json();
    const cand = data.candidates && data.candidates[0];
    return (cand?.content?.parts || []).map(p => p.text || '').join('');
  };

  try {
    return await attempt(model, 3);
  } catch (firstErr) {
    if (proxyUrl && proxyUrl.trim()) throw firstErr; // דרך proxy אין גילוי מודלים
    onProgress('המודל עמוס/לא זמין — מחפש מודל חלופי…');
    let models = [];
    try { models = await listGeminiModels(apiKey); } catch { throw firstErr; }
    const candidates = models.filter(m => !tried.has(m) && /flash/i.test(m))
      .concat(models.filter(m => !tried.has(m) && !/flash/i.test(m)));
    for (const m of candidates.slice(0, 5)) {
      try {
        onProgress(`מנסה מודל ${m}…`);
        const out = await attempt(m, 1);
        try { await setSetting('model', m); } catch {} // נשמור את המודל שעבד להבא
        return out;
      } catch { /* נסה את הבא */ }
    }
    throw firstErr;
  }
}
