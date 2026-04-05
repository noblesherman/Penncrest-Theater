import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Download, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiUrl } from '../lib/api';

interface CalendarEvent {
  title: string;
  date: Date;
  end?: Date;
  description?: string;
  location?: string;
  type: string;
  time?: string;
}

const EVENT_STYLES: Record<string, string> = {
  event: 'bg-yellow-400 text-stone-900 border-yellow-500',
  show: 'bg-yellow-400 text-stone-900 border-yellow-500',
  meeting: 'bg-stone-200 text-stone-700 border-stone-300',
  audition: 'bg-pink-200 text-pink-800 border-pink-300',
  workshop: 'bg-blue-200 text-blue-800 border-blue-300',
};

type TheaterCalendarProps = {
  calendarUrl?: string;
};

function normalizeCalendarUrlForApi(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('webcal://')) {
    return `https://${trimmed.slice('webcal://'.length)}`;
  }
  return trimmed;
}

export default function TheaterCalendar({ calendarUrl }: TheaterCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const normalizedCalendarUrl = normalizeCalendarUrlForApi(calendarUrl ?? '');
    const endpoint = normalizedCalendarUrl
      ? apiUrl(`/api/calendar?url=${encodeURIComponent(normalizedCalendarUrl)}`)
      : apiUrl('/api/calendar');

    fetch(endpoint)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !Array.isArray(data)) {
          throw new Error(data?.error || 'Failed to fetch calendar');
        }
        const parsedEvents = data.map((e: any) => ({
          ...e,
          date: new Date(e.date),
          end: e.end ? new Date(e.end) : undefined,
          time: new Date(e.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        }));
        setEvents(parsedEvents);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch calendar", err);
        setLoading(false);
      });
  }, [calendarUrl]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const getDayEvents = (date: Date) => events.filter(e => isSameDay(e.date, date));

  const externalCalendarUrl = normalizeCalendarUrlForApi(calendarUrl ?? '');

  // Generate a simple .ics file content
  const generateIcs = () => {
    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Penncrest Theater//NONSGML v1.0//EN\n";
    events.forEach(event => {
      icsContent += `BEGIN:VEVENT\nUID:${event.date.getTime()}-${event.title.replace(/\s+/g, '')}@penncrest.edu\nDTSTAMP:${format(new Date(), "yyyyMMdd'T'HHmmss")}\nDTSTART;VALUE=DATE:${format(event.date, "yyyyMMdd")}\nSUMMARY:${event.title}\nEND:VEVENT\n`;
    });
    icsContent += "END:VCALENDAR";
    return `data:text/calendar;charset=utf8,${encodeURIComponent(icsContent)}`;
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-xl">
      {/* Header */}
      <div className="flex flex-col gap-4 bg-stone-900 p-4 text-white sm:p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="bg-yellow-400 p-3 rounded-xl text-stone-900">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black uppercase tracking-wide sm:text-2xl">Theater Schedule</h2>
            <p className="text-stone-400 text-sm">Rehearsals, Performances, and Events</p>
          </div>
        </div>
        
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {externalCalendarUrl ? (
            <a
              href={externalCalendarUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg bg-stone-800 px-4 py-2 text-sm font-bold transition-colors hover:bg-stone-700"
            >
              <ExternalLink className="w-4 h-4" /> Calendar
            </a>
          ) : null}
          <a 
            href={generateIcs()}
            download="theater-schedule.ics"
            className="flex items-center justify-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-bold text-stone-900 transition-colors hover:bg-yellow-500"
          >
            <Download className="w-4 h-4" /> iCal
          </a>
        </div>
      </div>

      {/* Calendar Controls */}
      <div className="flex items-center justify-between border-b border-stone-100 p-4 sm:p-6">
        <button onClick={prevMonth} className="p-2 hover:bg-stone-100 rounded-full transition-colors">
          <ChevronLeft className="w-6 h-6 text-stone-600" />
        </button>
        <h3 className="text-base font-bold uppercase tracking-widest text-stone-900 sm:text-xl">
          {format(currentDate, 'MMMM yyyy')}
        </h3>
        <button onClick={nextMonth} className="p-2 hover:bg-stone-100 rounded-full transition-colors">
          <ChevronRight className="w-6 h-6 text-stone-600" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="p-3 sm:p-6">
        <div className="grid grid-cols-7 mb-4">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="text-center text-[10px] font-bold uppercase tracking-wider text-stone-400 sm:text-xs">
              <span className="sm:hidden">{day.slice(0, 1)}</span>
              <span className="hidden sm:inline">{day}</span>
            </div>
          ))}
        </div>
        
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {calendarDays.map((day, idx) => {
            const dayEvents = getDayEvents(day);
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            const isTodayDate = isToday(day);

            return (
              <div 
                key={day.toISOString()} 
                onClick={() => setSelectedDate(day)}
                className={`
                  relative min-h-[66px] cursor-pointer rounded-lg border p-1.5 transition-all group sm:min-h-[80px] sm:rounded-xl sm:p-2 md:min-h-[100px]
                  ${isCurrentMonth ? 'bg-white border-stone-100' : 'bg-stone-50 border-transparent text-stone-300'}
                  ${isSelected ? 'ring-2 ring-stone-900 z-10' : 'hover:border-stone-300'}
                `}
              >
                <div className={`
                  mb-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold sm:h-6 sm:w-6 sm:text-sm
                  ${isTodayDate ? 'bg-stone-900 text-white' : 'text-stone-500'}
                `}>
                  {format(day, 'd')}
                </div>
                
                <div className="space-y-1 hidden sm:block">
                  {dayEvents.map((event, i) => (
                    <div 
                      key={i} 
                      className={`
                        text-[10px] md:text-xs px-1.5 py-0.5 rounded border truncate font-medium
                        ${EVENT_STYLES[event.type] || EVENT_STYLES.event}
                      `}
                      title={event.title}
                    >
                      {event.time && <span className="opacity-75 mr-1">{event.time.split(' ')[0]}</span>}
                      {event.title}
                    </div>
                  ))}
                </div>
                <div className="sm:hidden">
                  {dayEvents.length > 0 ? (
                    <div className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-700">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-500" />
                      {dayEvents.length}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Day Details */}
      <AnimatePresence>
        {selectedDate && getDayEvents(selectedDate).length > 0 && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-stone-50 border-t border-stone-200"
          >
            <div className="p-6">
              <h4 className="font-bold text-stone-900 mb-4 flex items-center gap-2">
                Events for {format(selectedDate, 'MMMM do')}
              </h4>
              <div className="space-y-3">
                {getDayEvents(selectedDate).map((event, i) => (
                  <div key={i} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:gap-4">
                    <div className={`w-2 h-12 rounded-full ${(EVENT_STYLES[event.type] || EVENT_STYLES.event).split(' ')[0]}`}></div>
                    <div>
                      <div className="font-bold text-stone-900 text-lg">{event.title}</div>
                      <div className="text-stone-500 text-sm font-medium flex items-center gap-2">
                        <span className="uppercase tracking-wider text-xs bg-stone-100 px-2 py-0.5 rounded">{event.type}</span>
                        • {event.time}
                      </div>
                      {event.description && <div className="text-stone-400 text-sm mt-1">{event.description}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
