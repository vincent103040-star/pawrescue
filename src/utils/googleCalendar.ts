/**
 * Builds a real Google Calendar "add event" link (calendar.google.com/render).
 * No API key or OAuth needed — clicking it opens Google Calendar with the event
 * pre-filled, and the user adds it to their own calendar with one more click.
 */
export function buildGoogleCalendarLink(params: {
  title: string;
  date: string; // YYYY-MM-DD
  timeRange: string; // e.g. "10:00 - 13:00"
  location: string;
  details?: string;
}): string {
  const [startTime, endTime] = params.timeRange.split('-').map(s => s.trim());
  const compactDate = params.date.replace(/-/g, '');

  const toCompactDateTime = (time: string) => `${compactDate}T${time.replace(':', '')}00`;

  const start = toCompactDateTime(startTime || '09:00');
  const end = toCompactDateTime(endTime || startTime || '10:00');

  const qs = new URLSearchParams({
    action: 'TEMPLATE',
    text: params.title,
    dates: `${start}/${end}`,
    location: params.location,
    details: params.details || ''
  });

  return `https://calendar.google.com/calendar/render?${qs.toString()}`;
}
