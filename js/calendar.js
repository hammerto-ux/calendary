// אתחול ותצוגת לוח השנה (FullCalendar, נטען גלובלית).
import { allEvents } from './db.js';
import { colorFor } from './categories.js';
import { buildConflictMap } from './conflicts.js';

let calendar = null;
let onEventClick = () => {};

export function initCalendar(el, handlers = {}) {
  onEventClick = handlers.onEventClick || (() => {});
  calendar = new FullCalendar.Calendar(el, {
    initialView: window.innerWidth < 720 ? 'listWeek' : 'dayGridMonth',
    locale: 'he',
    direction: 'rtl',
    firstDay: 0,
    height: 'auto',
    headerToolbar: {
      start: 'prev,next today',
      center: 'title',
      end: 'dayGridMonth,timeGridWeek,listWeek',
    },
    buttonText: { today: 'היום', month: 'חודש', week: 'שבוע', list: 'רשימה' },
    noEventsContent: 'אין אירועים להצגה',
    allDayText: 'כל היום',
    nowIndicator: true,
    eventClick: (info) => {
      const id = Number(info.event.id);
      onEventClick(id);
    },
    dateClick: (info) => {
      if (handlers.onDateClick) handlers.onDateClick(info.dateStr);
    },
  });
  calendar.render();
  return calendar;
}

export async function refreshCalendar() {
  if (!calendar) return;
  const events = await allEvents();
  const conflictMap = buildConflictMap(events);
  // מציגים מאושרים + מוצעים (מוצעים בסימון מקווקו)
  const visible = events.filter(e => e.status === 'confirmed' || e.status === 'proposed');
  const fcEvents = visible.map(e => {
    const conflicts = conflictMap.get(e.id) || [];
    const classNames = [];
    if (e.status === 'proposed') classNames.push('is-proposed');
    if (conflicts.length) classNames.push('has-conflict');
    return {
      id: String(e.id),
      title: e.title + (e.assignee?.code ? ` · ${e.assignee.code}` : ''),
      start: e.start,
      end: e.end,
      allDay: !!e.allDay,
      backgroundColor: colorFor(e.category),
      borderColor: colorFor(e.category),
      classNames,
    };
  });
  calendar.removeAllEvents();
  calendar.addEventSource(fcEvents);
}

export function gotoDate(dateStr) {
  if (calendar && dateStr) calendar.gotoDate(dateStr);
}
