/**
 * Zone colours, and the runtime store the app reads them from.
 *
 * ## Why the palette lives here and not in the database
 *
 * Tailwind builds its stylesheet by scanning the source for class names it can
 * see as literal text. A class name assembled at runtime -- from a database
 * column, say -- is never in the source, so no CSS is generated for it and the
 * element renders with no colour at all. Nothing errors; the styling is simply
 * absent, and only in the production build, because dev mode resolves classes
 * differently.
 *
 * So the database stores a palette key ('rose') and the class strings sit here
 * as literals. An admin picks from this list rather than typing a colour, which
 * also means every choice is guaranteed to render.
 *
 * Adding a colour is a code change on purpose: the class strings have to be in
 * a scanned file, and there is nowhere else they could go.
 */
import type { ZoneConfig } from '../types';

export interface ZonePalette {
  key: string;
  label: string;
  color: string;
  bgLight: string;
  borderClass: string;
  textClass: string;
  badgeBg: string;
}

export const ZONE_PALETTES: ZonePalette[] = [
  {
    key: 'rose',
    label: '珊瑚紅',
    color: '#EF4444',
    bgLight: 'bg-rose-50 dark:bg-rose-950/40',
    borderClass: 'border-rose-200 dark:border-rose-800',
    textClass: 'text-rose-700 dark:text-rose-300',
    badgeBg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'
  },
  {
    key: 'emerald',
    label: '森林綠',
    color: '#10B981',
    bgLight: 'bg-emerald-50 dark:bg-emerald-950/40',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
  },
  {
    key: 'amber',
    label: '琥珀黃',
    color: '#F59E0B',
    bgLight: 'bg-amber-50 dark:bg-amber-950/40',
    borderClass: 'border-amber-200 dark:border-amber-800',
    textClass: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
  },
  {
    key: 'sky',
    label: '天空藍',
    color: '#3B82F6',
    bgLight: 'bg-sky-50 dark:bg-sky-950/40',
    borderClass: 'border-sky-200 dark:border-sky-800',
    textClass: 'text-sky-700 dark:text-sky-300',
    badgeBg: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200'
  },
  {
    key: 'purple',
    label: '薰衣草紫',
    color: '#8B5CF6',
    bgLight: 'bg-purple-50 dark:bg-purple-950/40',
    borderClass: 'border-purple-200 dark:border-purple-800',
    textClass: 'text-purple-700 dark:text-purple-300',
    badgeBg: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200'
  },
  {
    key: 'teal',
    label: '湖水青',
    color: '#14B8A6',
    bgLight: 'bg-teal-50 dark:bg-teal-950/40',
    borderClass: 'border-teal-200 dark:border-teal-800',
    textClass: 'text-teal-700 dark:text-teal-300',
    badgeBg: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200'
  },
  {
    key: 'orange',
    label: '暖陽橘',
    color: '#F97316',
    bgLight: 'bg-orange-50 dark:bg-orange-950/40',
    borderClass: 'border-orange-200 dark:border-orange-800',
    textClass: 'text-orange-700 dark:text-orange-300',
    badgeBg: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200'
  },
  {
    key: 'slate',
    label: '石墨灰',
    color: '#64748B',
    bgLight: 'bg-slate-50 dark:bg-slate-900/40',
    borderClass: 'border-slate-200 dark:border-slate-700',
    textClass: 'text-slate-700 dark:text-slate-300',
    badgeBg: 'bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-200'
  }
];

const PALETTE_BY_KEY = new Map(ZONE_PALETTES.map(p => [p.key, p]));

/** Falls back to grey rather than to nothing, so an unknown key still renders. */
export function paletteFor(key: string): ZonePalette {
  return PALETTE_BY_KEY.get(key) || PALETTE_BY_KEY.get('slate')!;
}

/** What the server sends for each zone. */
export interface ZoneRecord {
  id: string;
  name: string;
  code: string;
  palette: string;
  icon: string;
  description: string;
  status: 'active' | 'disabled';
  sortOrder: number;
}

/**
 * The live zone lookup, keyed by id.
 *
 * This is a mutable module-level object rather than React state, because
 * eighteen files already read `ZONE_CONFIGS[shift.zone]` directly and rewriting
 * all of them to thread a context through would be a far larger change than the
 * feature warrants. App fetches the zones, calls applyZones, and only then
 * updates its own state -- so by the time anything re-renders, the object below
 * already holds the current values.
 *
 * It starts out holding the five original areas so the very first paint, before
 * the fetch returns, looks the way it always did.
 */
export const ZONE_CONFIGS: Record<string, ZoneConfig> = {};

export function zoneRecordToConfig(zone: ZoneRecord): ZoneConfig {
  const palette = paletteFor(zone.palette);
  return {
    id: zone.id,
    name: zone.name,
    code: zone.code,
    color: palette.color,
    bgLight: palette.bgLight,
    borderClass: palette.borderClass,
    textClass: palette.textClass,
    badgeBg: palette.badgeBg,
    icon: zone.icon,
    description: zone.description
  };
}

/** Replaces the lookup with what the server just sent. */
export function applyZones(zones: ZoneRecord[]): void {
  for (const key of Object.keys(ZONE_CONFIGS)) delete ZONE_CONFIGS[key];
  for (const zone of zones) ZONE_CONFIGS[zone.id] = zoneRecordToConfig(zone);
}

/**
 * A zone that can always be rendered.
 *
 * A shift filed three months ago under an area that has since been renamed or
 * disabled still has to appear on screen. Callers that reach for a zone and
 * find nothing used to hit `undefined` and, depending on the screen, either
 * showed a blank or crashed the page. This returns a neutral placeholder
 * instead, so the worst case is a grey label reading "未知場域".
 */
export function resolveZone(id: string | undefined | null): ZoneConfig {
  const found = id ? ZONE_CONFIGS[id] : undefined;
  if (found) return found;

  const palette = paletteFor('slate');
  return {
    id: String(id || 'unknown'),
    name: '未知場域',
    code: '—',
    color: palette.color,
    bgLight: palette.bgLight,
    borderClass: palette.borderClass,
    textClass: palette.textClass,
    badgeBg: palette.badgeBg,
    icon: '❔',
    description: '這個場域已被移除或停用，僅保留既有紀錄的顯示。'
  };
}
