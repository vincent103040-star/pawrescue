// Must come first: this module reads ADMIN_PASSWORD and ORGANIZATION_ID while
// deciding what to migrate, and both have to be in process.env by then.
import './env';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { VOLUNTEER_PROFILES, INITIAL_ATTENDANCE_RECORDS, INITIAL_SHIFTS, INITIAL_SHIFT_SIGNUPS, DEFAULT_SHELTER_LOCATION, DEFAULT_LINE_OFFICIAL_ACCOUNT } from './src/data/mockData';
import { RULEBOOK_CORPUS } from './src/data/rulebookCorpus';
// Shared with the duty form rather than reimplemented -- the first version had
// a copy in each and the same off-by-empty-string bug in both.
import { parseWeekdays, serializeWeekdays } from './src/utils/weekdays';
export { parseWeekdays, serializeWeekdays } from './src/utils/weekdays';
import type { VolunteerProfile, AttendanceRecord, PositionShift, ShiftSignup, SubstitutionRequest, SopContent, SopSection, SopDocument, SopVideo, PromotionRequest, ShiftTemplate, ShelterLocation, LineOfficialAccount } from './src/types';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'volunteers.db');
const db = new DatabaseSync(dbPath);

// WAL lets a reader carry on while a write is in progress, instead of the two
// blocking each other. node:sqlite's API is synchronous and runs on the event
// loop, so a write that waits is a whole server that waits -- the SSE stream
// and anyone mid-check-in included. busy_timeout covers the cases WAL doesn't
// (two writers): wait up to 5 seconds rather than failing the request outright.
// Switching journal mode needs a moment with no other connection to this file,
// so it can fail if a second copy of the server is already running. That is a
// reason to carry on in the old mode, not a reason to refuse to start.
try {
  db.exec('PRAGMA journal_mode = WAL');
} catch {
  console.warn('SQLite: could not switch to WAL (another process has the database open); continuing.');
}
db.exec('PRAGMA busy_timeout = 5000');
// WAL trades a little durability for speed by default; FULL puts it back, so a
// power cut can't lose an already-answered check-in.
db.exec('PRAGMA synchronous = FULL');

/**
 * Which shelter this deployment belongs to.
 *
 * The StrayHub CRM is multi-tenant: every row there carries an organization and
 * PostgreSQL enforces the separation. This system has no such concept -- one
 * shelter, one database, every query global. That asymmetry is fine as long as
 * the deployment boundary is the tenant boundary: one instance per shelter,
 * named here.
 *
 * Rows are stamped with it from now on. Not because anything filters on it yet
 * -- with a single value there would be nothing to filter -- but because the
 * moment data starts arriving from a tenant-scoped CRM, "which shelter is this
 * row about" has to be an answer the data already carries.
 */
export function currentOrganizationId(): string {
  return (process.env.ORGANIZATION_ID || 'pawrescue-local').trim();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS volunteers (
    email TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    lineId TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '',
    skills TEXT NOT NULL DEFAULT '[]',
    preferredZones TEXT NOT NULL DEFAULT '[]',
    totalHours INTEGER NOT NULL DEFAULT 0,
    completedShiftsCount INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT '新進志工',
    joinedDate TEXT NOT NULL,
    emergencyContact TEXT NOT NULL DEFAULT '',
    providers TEXT NOT NULL DEFAULT '[]',
    lastLoginAt TEXT NOT NULL
  )
`);

// Migration: add the lineUserId column for volunteers who have completed real LINE
// Login (as opposed to the human-typed "lineId" handle stored above). Safe to run
// every startup — SQLite errors on a duplicate column, which we just swallow.
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN lineUserId TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN lineDisplayName TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}

// ============================================================================
// Identity: a key that is not the person's email address
// ----------------------------------------------------------------------------
// Two problems, both of which only get more expensive the longer they wait.
//
// First, email is the primary key here, and `id` -- the column that ought to be
// the stable handle -- was being filled in with the email as well for anyone who
// arrived through Google login. So the same fact was the identity twice over: a
// volunteer who changes their address becomes a different person, and every
// cross-system message has to carry a personal detail just to say who it means.
//
// Second, the CRM identifies people by a UUID of its own. That mapping needs
// somewhere to live before the two systems can talk, and it must be a column
// this system can leave empty -- nobody is mapped yet, and the pairing will be
// a deliberate act by each volunteer rather than a guess made by matching
// addresses. Matching on email would quietly connect two different people who
// share a mailbox, and that mistake is invisible afterwards.
// ============================================================================
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN strayhubUserId TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN organizationId TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}

// One CRM user maps to at most one volunteer here. A partial index so the many
// rows that are legitimately unmapped don't all collide on the empty string.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_volunteers_strayhub_user
  ON volunteers (strayhubUserId) WHERE strayhubUserId <> ''
`);

// Backfill: replace any id that is really an email address, and stamp the
// shelter on rows that predate the column. Seeded ids like "vol-001" are left
// alone -- they are already opaque, already unique, and rewriting them would
// churn rows for nothing.
{
  const contaminated = db
    .prepare(`SELECT email FROM volunteers WHERE id LIKE '%@%'`)
    .all() as Array<{ email: string }>;
  for (const row of contaminated) {
    db.prepare('UPDATE volunteers SET id = ? WHERE email = ?').run(randomUUID(), row.email);
  }
  if (contaminated.length > 0) {
    console.log(`SQLite: 已為 ${contaminated.length} 位志工改用不含個資的識別碼`);
  }

  const stamped = db
    .prepare(`UPDATE volunteers SET organizationId = ? WHERE organizationId = ''`)
    .run(currentOrganizationId());
  if (stamped.changes > 0) {
    console.log(`SQLite: 已為 ${stamped.changes} 位志工標記所屬收容所`);
  }
}
// Migration: LINE notification preference toggles. These used to live only in the
// volunteer's own browser localStorage — which meant an admin's browser (editing a
// shift, approving a signup) had no way to know a given volunteer had turned a
// notification type off. Storing them here lets the backend enforce them for real.
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN linePreferences TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}

// Seed with the original mock roster on first run only
const seedCount = db.prepare('SELECT COUNT(*) AS c FROM volunteers').get() as { c: number };
if (seedCount.c === 0) {
  const insertSeed = db.prepare(`
    INSERT INTO volunteers
      (email, id, name, phone, lineId, avatar, skills, preferredZones, totalHours, completedShiftsCount, tier, joinedDate, emergencyContact, providers, status, lastLoginAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const nowIso = new Date().toISOString();
  for (const v of VOLUNTEER_PROFILES) {
    insertSeed.run(
      v.email.toLowerCase().trim(),
      v.id,
      v.name,
      v.phone,
      v.lineId,
      v.avatar,
      JSON.stringify(v.skills),
      JSON.stringify(v.preferredZones),
      v.totalHours,
      v.completedShiftsCount,
      v.tier,
      v.joinedDate,
      v.emergencyContact,
      JSON.stringify(['seed']),
      1,
      nowIso
    );
  }
}

function rowToProfile(row: any): VolunteerProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    lineId: row.lineId,
    avatar: row.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(row.name)}`,
    skills: JSON.parse(row.skills),
    preferredZones: JSON.parse(row.preferredZones),
    totalHours: row.totalHours,
    completedShiftsCount: row.completedShiftsCount,
    tier: row.tier,
    joinedDate: row.joinedDate,
    emergencyContact: row.emergencyContact,
    lineLinked: !!row.lineUserId,
    lineDisplayName: row.lineDisplayName || undefined,
    // Empty until this volunteer pairs their account with the CRM. Kept out of
    // the shape entirely rather than sent as '' so a caller cannot mistake
    // "not linked yet" for a real id.
    strayhubUserId: row.strayhubUserId || undefined,
    organizationId: row.organizationId || undefined,
    accountStatus: (row.accountStatus || 'active') as VolunteerProfile['accountStatus'],
    statusChangedAt: row.statusChangedAt || undefined,
    statusChangedBy: row.statusChangedBy || undefined,
    statusReason: row.statusReason || undefined,
    absencesResetAt: row.absencesResetAt || undefined
  };
}

// ============================================================================
// Volunteer account state
// ----------------------------------------------------------------------------
// The rulebook printed for volunteers says repeated unexplained absences cost
// somebody their booking rights. Until the roll call existed there was no
// absence count to act on; now there is, so the consequence needs somewhere to
// live.
//
// Three states, and the distance between them matters:
//
//   active     books shifts normally.
//   suspended  cannot book. Everything else still works -- they can sign in,
//              see their own history and their hours. A coordinator restores
//              them with one click.
//   inactive   hidden from the roster and from counts. Reached automatically
//              when a suspension goes unattended, or set by hand when somebody
//              stops volunteering.
//
// Nothing here deletes anything. Deleting a volunteer would destroy the service
// hours they may need for a certificate, and would orphan their attendance and
// signup rows, which reference them by name and email rather than by key. That
// is the same fault disabling was introduced to avoid for zones and duty items.
// Data retention -- actually erasing personal details after a long period, or
// on the volunteer's own request -- is a separate policy and is not implemented.
//
// A note on the old column: volunteers.status was an INTEGER defaulting to 1
// that nothing ever read. Two columns called status on one table is a trap, so
// the dead one goes rather than being pressed into service as a numeric state
// machine nobody can read at a glance.
// ============================================================================
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN accountStatus TEXT NOT NULL DEFAULT 'active'`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN statusChangedAt TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN statusChangedBy TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN statusReason TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec('ALTER TABLE volunteers DROP COLUMN status');
  console.log('SQLite: 已移除未使用的 volunteers.status（改用 accountStatus）');
} catch {
  // already dropped, or a fresh database that never had it
}

export type VolunteerAccountStatus = 'active' | 'suspended' | 'inactive';

/**
 * How many confirmed absences suspend a volunteer.
 *
 * Two, matching the rulebook handed to volunteers. The count only moves when a
 * coordinator confirms a no-show on the roll call, so this applies a published
 * rule to facts a person has already established -- it does not infer anything.
 *
 * Worth reconciling: the same rulebook says the suspension lasts thirty days,
 * while the process built here keeps it until a coordinator lifts it. One of
 * the two should change so the document and the software agree.
 */
export const ABSENCE_SUSPENSION_THRESHOLD = 2;

/**
 * How long a suspension may sit unattended before the account is filed away.
 *
 * Reaching this does not delete or punish further -- it hides the row from the
 * active roster so the list stays about people who are actually volunteering.
 * A coordinator can bring them back at any time.
 */
/**
 * How long a suspension lasts before it lifts on its own.
 *
 * The rulebook says thirty days, and it now means it. The first version left a
 * suspension in place until a coordinator removed it, which sounds stricter but
 * lands the burden on the volunteer least likely to carry it: somebody already
 * embarrassed about missing shifts has to ask to be let back in. The ones who
 * do not ask are not disciplined, they are quietly lost.
 *
 * A coordinator can still lift it the moment they have spoken to the person.
 * Thirty days is the ceiling, not a sentence to be served in full.
 */
export const SUSPENSION_DAYS = 30;

// Migration: when a volunteer's absence count last started over.
//
// Absences were counted over a volunteer's whole history and nothing ever reset
// them, so being reinstated put somebody permanently one absence from being
// suspended again -- and the coordinator pressing 恢復 had no way to know that
// is what they were restoring them into. "達 2 次" read like a penalty you
// serve; it behaved like a lifetime tally.
//
// The absences themselves are never deleted: the roll call and the record of
// what happened stay intact. Only what counts toward the rule moves.
try {
  db.exec(`ALTER TABLE volunteers ADD COLUMN absencesResetAt TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}

export function setVolunteerAccountStatus(
  email: string,
  status: VolunteerAccountStatus,
  changedBy: string,
  reason: string
): VolunteerProfile | null {
  const normalized = email.toLowerCase().trim();
  if (!db.prepare('SELECT email FROM volunteers WHERE email = ?').get(normalized)) return null;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE volunteers
    SET accountStatus = ?, statusChangedAt = ?, statusChangedBy = ?, statusReason = ?
    WHERE email = ?
  `).run(status, now, changedBy, reason, normalized);

  // Coming back to active starts the count again. Without this, the next single
  // absence takes the lifetime tally past the threshold and suspends them on
  // the spot -- so a reinstated volunteer would be on one strike forever.
  if (status === 'active') {
    db.prepare('UPDATE volunteers SET absencesResetAt = ? WHERE email = ?').run(now, normalized);
  }

  // A suspended account keeps its session: they should be able to sign in and
  // see why, and their own history. Only booking is blocked, at the point of
  // booking.
  return getVolunteerByEmail(normalized);
}

/**
 * Files away suspensions nobody has attended to.
 *
 * Runs on startup and once a day. Returns who was moved so the caller can log
 * it -- a state change nobody asked for should at least be visible.
 */
/**
 * Lifts suspensions that have served their thirty days.
 *
 * This replaced a sweep that moved a suspension to 'inactive' after fourteen
 * days. That sweep and the rulebook's thirty days could not both be true: the
 * account would have been filed away as departed a fortnight before the
 * suspension it was serving was due to end.
 *
 * 'inactive' still exists and a coordinator can still use it. It is now only
 * ever a decision somebody makes, never something that happens to a volunteer
 * because nobody got round to them.
 */
export function expireServedSuspensions(): Array<{ email: string; name: string; days: number }> {
  const cutoff = new Date(Date.now() - SUSPENSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const served = db.prepare(`
    SELECT email, name, statusChangedAt FROM volunteers
    WHERE accountStatus = 'suspended' AND statusChangedAt <> '' AND statusChangedAt < ?
  `).all(cutoff) as any[];

  const restored: Array<{ email: string; name: string; days: number }> = [];
  for (const row of served) {
    const days = Math.floor((Date.now() - new Date(row.statusChangedAt).getTime()) / 86400000);
    // Through setVolunteerAccountStatus so the absence count is reset the same
    // way a coordinator's reinstatement resets it -- one route, one behaviour.
    setVolunteerAccountStatus(
      row.email, 'active', 'system',
      `停權滿 ${SUSPENSION_DAYS} 天，依規章自動恢復（缺席次數重新計算）`
    );
    restored.push({ email: row.email, name: row.name, days });
  }
  return restored;
}

export function getAllVolunteers(): VolunteerProfile[] {
  const rows = db.prepare('SELECT * FROM volunteers ORDER BY totalHours DESC').all();
  return rows.map(rowToProfile);
}

export function getVolunteerByEmail(email: string): VolunteerProfile | null {
  const row = db.prepare('SELECT * FROM volunteers WHERE email = ?').get(email.toLowerCase().trim());
  return row ? rowToProfile(row) : null;
}

// Upsert triggered by Google login / profile self-edit. Only touches identity fields —
// tier, hours, skills, avatar etc. are left untouched on repeat logins so a volunteer's
// progression isn't reset just by signing back in.
export function upsertVolunteerFromLogin(params: {
  email: string;
  name: string;
  phone: string;
  lineId: string;
}): VolunteerProfile {
  const email = params.email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(email);
  const nowIso = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE volunteers SET name = ?, phone = ?, lineId = ?, providers = ?, lastLoginAt = ?
      WHERE email = ?
    `).run(params.name, params.phone, params.lineId, JSON.stringify(['google.com']), nowIso, email);
  } else {
    // The id is generated, not derived. It used to be the email address, which
    // made the address the identity -- so changing it would have made someone a
    // different person, and every reference to them had to carry their personal
    // details along with it.
    db.prepare(`
      INSERT INTO volunteers
        (email, id, organizationId, name, phone, lineId, avatar, skills, preferredZones, totalHours, completedShiftsCount, tier, joinedDate, emergencyContact, providers, lastLoginAt)
      VALUES (?, ?, ?, ?, ?, ?, '', '[]', '[]', 0, 0, '新進志工', ?, '', ?, ?)
    `).run(email, randomUUID(), currentOrganizationId(), params.name, params.phone, params.lineId, nowIso.split('T')[0], JSON.stringify(['google.com']), nowIso);
  }

  return getVolunteerByEmail(email)!;
}

// Update the volunteer-self-editable "extras" that upsertVolunteerFromLogin
// deliberately leaves alone (see its comment) -- emergency contact text and an
// uploaded avatar photo. Only touches the fields actually passed in, and only
// for a volunteer that already has a row (Google login must have happened once
// already to create one).
export function updateVolunteerProfileExtras(
  email: string,
  updates: { emergencyContact?: string; avatar?: string }
): VolunteerProfile | null {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(normalizedEmail);
  if (!existing) return null;

  if (updates.emergencyContact !== undefined) {
    db.prepare('UPDATE volunteers SET emergencyContact = ? WHERE email = ?')
      .run(updates.emergencyContact, normalizedEmail);
  }
  if (updates.avatar !== undefined) {
    db.prepare('UPDATE volunteers SET avatar = ? WHERE email = ?')
      .run(updates.avatar, normalizedEmail);
  }

  return getVolunteerByEmail(normalizedEmail);
}

// Admin-side edit of a volunteer's roster details. Deliberately covers only the
// fields a coordinator legitimately maintains -- skills, preferred zones,
// emergency contact, and contact details. Hours, shift count and tier are NOT
// here: those are earned through check-outs and the promotion review flow, and
// letting them be typed in by hand would make the roster's stats meaningless.
// The honour badges shown on each card aren't stored at all; they're derived
// from hours/shifts/skills, so they update themselves once these do.
export function updateVolunteerDetails(
  email: string,
  updates: {
    name?: string;
    phone?: string;
    lineId?: string;
    skills?: string[];
    preferredZones?: string[];
    emergencyContact?: string;
  }
): VolunteerProfile | null {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(normalizedEmail);
  if (!existing) return null;

  const setField = (column: string, value: string) => {
    db.prepare(`UPDATE volunteers SET ${column} = ? WHERE email = ?`).run(value, normalizedEmail);
  };

  if (updates.name !== undefined) setField('name', updates.name);
  if (updates.phone !== undefined) setField('phone', updates.phone);
  if (updates.lineId !== undefined) setField('lineId', updates.lineId);
  if (updates.emergencyContact !== undefined) setField('emergencyContact', updates.emergencyContact);
  if (updates.skills !== undefined) setField('skills', JSON.stringify(updates.skills));
  if (updates.preferredZones !== undefined) setField('preferredZones', JSON.stringify(updates.preferredZones));

  return getVolunteerByEmail(normalizedEmail);
}

// Removes a volunteer entirely, so the same person can go through first-time
// registration again from scratch (which is how the LINE-binding onboarding gets
// re-tested). Their pending promotion requests go too, since those are keyed by
// email and would otherwise linger in the admin review queue pointing at nobody.
//
// Attendance records are intentionally left alone: they're the shelter's service
// history, keyed by name rather than email, and silently erasing them would
// change the dashboard's totals. A re-registered volunteer starts at 0 hours
// regardless, because hours live on the volunteer row that was just deleted.
export function deleteVolunteer(email: string): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(normalizedEmail);
  if (!existing) return false;

  db.prepare('DELETE FROM promotion_requests WHERE volunteerEmail = ?').run(normalizedEmail);
  db.prepare('DELETE FROM volunteers WHERE email = ?').run(normalizedEmail);
  // Any session they still hold has to die with the account, otherwise a
  // deleted volunteer keeps a working token until it expires.
  db.prepare('DELETE FROM sessions WHERE identity = ?').run(normalizedEmail);
  return true;
}

// Update hours/shift count after a check-out (best-effort, matched by name today —
// see the App.tsx TODO about matching by email once attendance records carry it).
export function addCompletedShiftHours(name: string, hoursLogged: number) {
  db.prepare(`
    UPDATE volunteers SET totalHours = totalHours + ?, completedShiftsCount = completedShiftsCount + 1
    WHERE name = ?
  `).run(hoursLogged, name);
}

// Real LINE userId (from LINE Login), distinct from the human-typed "lineId" handle —
// only a userId obtained this way can actually be used with the Messaging API push endpoint.
// Upsert-safe: if the volunteer row doesn't exist yet (e.g. LINE Login happens before
// any Google login round-trip has persisted them), create a minimal row instead of
// silently updating zero rows.
export function setLineUserId(email: string, lineUserId: string, lineDisplayName: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT email FROM volunteers WHERE email = ?').get(normalizedEmail);

  if (existing) {
    db.prepare(`
      UPDATE volunteers SET lineUserId = ?, lineDisplayName = ? WHERE email = ?
    `).run(lineUserId, lineDisplayName, normalizedEmail);
  } else {
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO volunteers
        (email, id, name, phone, lineId, avatar, skills, preferredZones, totalHours, completedShiftsCount, tier, joinedDate, emergencyContact, providers, status, lastLoginAt, lineUserId, lineDisplayName)
      VALUES (?, ?, ?, '', '', '', '[]', '[]', 0, 0, '新進志工', ?, '', '["line.me"]', 1, ?, ?, ?)
    `).run(normalizedEmail, normalizedEmail, lineDisplayName || normalizedEmail, nowIso.split('T')[0], nowIso, lineUserId, lineDisplayName);
  }
}

export function getLineUserId(email: string): { lineUserId: string; lineDisplayName: string } | null {
  const row = db.prepare('SELECT lineUserId, lineDisplayName FROM volunteers WHERE email = ?')
    .get(email.toLowerCase().trim()) as { lineUserId: string; lineDisplayName: string } | undefined;
  if (!row || !row.lineUserId) return null;
  return row;
}

// Reverse of getLineUserId: resolves a LINE userId back to the volunteer who
// bound it. This is what makes "sign in with LINE alone" possible on later
// visits -- LINE Login only ever returns an opaque userId (its `email` scope
// needs separate approval from LINE and isn't enabled here), so the account can
// only be recognised if that userId was bound during Google onboarding first.
export function getVolunteerByLineUserId(lineUserId: string): VolunteerProfile | null {
  if (!lineUserId) return null;
  const row = db.prepare('SELECT * FROM volunteers WHERE lineUserId = ?').get(lineUserId);
  return row ? rowToProfile(row) : null;
}

// Same lookup as getLineUserId, but by name -- the check-out flow only has
// volunteerName on the attendance record (no email), so the post-checkout LINE
// reminder push has to match this way. Best-effort: if multiple volunteers share a
// name, or the name doesn't exactly match, this just returns null and the caller
// silently skips the push, same as the "not linked yet" case.
export function getLineUserIdByName(name: string): { lineUserId: string; lineDisplayName: string } | null {
  const row = db.prepare('SELECT lineUserId, lineDisplayName FROM volunteers WHERE name = ?')
    .get(name) as { lineUserId: string; lineDisplayName: string } | undefined;
  if (!row || !row.lineUserId) return null;
  return row;
}

export interface StoredLinePreferences {
  shiftChanges: boolean;
  urgentRecruitment: boolean;
  checkInReminder: boolean;
  /**
   * How many hours before a shift the reminder goes out.
   *
   * The settings panel has offered this choice since before there was anything
   * to read it: the value lived in the volunteer's browser and never reached
   * the server, so it was lost on a new device and no reminder ever consulted
   * it. Now it is stored beside the switch it belongs to.
   */
  reminderTimingHours: number;
}

/** What the dropdown offers. Anything else is clamped to the nearest of these. */
export const REMINDER_LEAD_CHOICES = [1, 2, 12, 24] as const;

const DEFAULT_LINE_PREFERENCES: StoredLinePreferences = {
  shiftChanges: true,
  urgentRecruitment: true,
  checkInReminder: true,
  reminderTimingHours: 1
};

/** Keeps a stored or submitted lead time to something the scheduler can honour. */
export function normalizeReminderLead(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LINE_PREFERENCES.reminderTimingHours;
  let best: number = REMINDER_LEAD_CHOICES[0];
  for (const choice of REMINDER_LEAD_CHOICES) {
    if (Math.abs(choice - n) < Math.abs(best - n)) best = choice;
  }
  return best;
}

export function setLinePreferences(email: string, prefs: StoredLinePreferences) {
  db.prepare(`UPDATE volunteers SET linePreferences = ? WHERE email = ?`)
    .run(JSON.stringify(prefs), email.toLowerCase().trim());
}

// Defaults to all-on (matching the Settings UI's own default) if the volunteer hasn't
// saved any preference yet, or doesn't exist in the DB at all — never silently block a
// real notification just because we lack an explicit preference record.
export function getLinePreferences(email: string): StoredLinePreferences {
  const row = db.prepare('SELECT linePreferences FROM volunteers WHERE email = ?')
    .get(email.toLowerCase().trim()) as { linePreferences: string } | undefined;
  if (!row || !row.linePreferences) return DEFAULT_LINE_PREFERENCES;
  try {
    const stored = { ...DEFAULT_LINE_PREFERENCES, ...JSON.parse(row.linePreferences) };
    // Records written before the lead time was stored have no such field, and a
    // hand-edited one could hold anything. The sweep divides by this, so it is
    // pinned to a real choice here rather than trusted.
    stored.reminderTimingHours = normalizeReminderLead(stored.reminderTimingHours);
    return stored;
  } catch {
    return DEFAULT_LINE_PREFERENCES;
  }
}

// ============================================================================
// Shift reminders
// ----------------------------------------------------------------------------
// The settings panel has had a "check-in reminder" switch, and a choice of how
// many hours' notice, since long before anything sent one. A volunteer could
// turn it on, pick an hour, and receive nothing -- which is worse than not
// offering it, because they stop watching for the shift themselves.
// ============================================================================

/**
 * One row per reminder actually delivered.
 *
 * The sweep runs every few minutes and the window it looks at is hours wide, so
 * without a record of what has gone out a volunteer would be messaged again on
 * every tick until their shift began. Keyed by the booking rather than by
 * volunteer and time, because the thing that must happen once is "this person
 * was reminded about this shift".
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS reminder_sends (
    signupId TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'check-in',
    sentAtUtc TEXT NOT NULL,
    PRIMARY KEY (signupId, kind)
  )
`);

/**
 * Bookings that could still need a reminder: confirmed, on a live shift, not
 * already reminded.
 *
 * Deliberately not filtered by how soon the shift is. Each volunteer's lead
 * time is inside their preferences JSON, which SQL here would have to parse;
 * the caller checks it against the clock instead. The row count is small -- it
 * is only ever the next couple of days of confirmed bookings.
 */
export function getReminderCandidates(fromDate: string): Array<{
  signupId: string; shiftId: string; volunteerEmail: string; volunteerName: string;
  title: string; date: string; timeRange: string; zone: string;
}> {
  return db.prepare(`
    SELECT g.id AS signupId, g.shiftId, g.volunteerEmail, g.volunteerName,
           s.title, s.date, s.timeRange, s.zone
    FROM shift_signups g
    JOIN shifts s ON s.id = g.shiftId
    WHERE g.status = 'approved'
      AND s.status <> 'cancelled'
      AND s.date >= ?
      AND TRIM(COALESCE(g.volunteerEmail, '')) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM reminder_sends r WHERE r.signupId = g.id AND r.kind = 'check-in'
      )
    ORDER BY s.date, s.timeRange
  `).all(fromDate) as any[];
}

/** Recorded only after a push actually succeeded -- see the sweep for why. */
export function markReminderSent(signupId: string, kind = 'check-in'): void {
  db.prepare('INSERT OR IGNORE INTO reminder_sends (signupId, kind, sentAtUtc) VALUES (?, ?, ?)')
    .run(signupId, kind, new Date().toISOString());
}

// Attendance records (check-in/check-out, feedback rating+comment, check-out photo).
// This used to live only in the browser's localStorage, so a different device/browser
// (e.g. a volunteer's phone via LIFF vs. an admin's desktop) never saw the same data.
// Storing it server-side fixes that.
db.exec(`
  CREATE TABLE IF NOT EXISTS attendance_records (
    id TEXT PRIMARY KEY,
    signupId TEXT,
    volunteerName TEXT NOT NULL,
    volunteerPhone TEXT,
    lineId TEXT,
    shiftId TEXT NOT NULL,
    shiftTitle TEXT NOT NULL,
    branchId TEXT NOT NULL,
    zone TEXT NOT NULL,
    date TEXT NOT NULL,
    checkInTime TEXT NOT NULL,
    checkOutTime TEXT,
    checkInAt TEXT NOT NULL DEFAULT '',
    checkOutAt TEXT NOT NULL DEFAULT '',
    organizationId TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    hoursLogged REAL,
    locationVerified INTEGER NOT NULL DEFAULT 0,
    distanceMeters REAL,
    qrCodeToken TEXT NOT NULL DEFAULT '',
    rating INTEGER,
    feedbackComment TEXT,
    feedbackSubmittedAt TEXT,
    feedbackAcknowledgedAt TEXT NOT NULL DEFAULT '',
    feedbackAcknowledgedBy TEXT NOT NULL DEFAULT '',
    lineReminderSent INTEGER NOT NULL DEFAULT 0,
    photoUrl TEXT
  )
`);

// Migration: how a check-in was actually proved. 'self' = the volunteer's own
// phone (GPS + on-site code, both verified server-side); 'staff' = a
// coordinator recorded it for someone without a usable phone. Kept explicit so
// a record's trustworthiness is visible rather than assumed.
try { db.exec("ALTER TABLE attendance_records ADD COLUMN checkInMethod TEXT NOT NULL DEFAULT 'staff'"); } catch { /* already added */ }

// Migration: the check-out "notification sent" flag used to be named smsSent from
// back when this was a simulated SMS feature -- it's now a real LINE push (see
// server.ts's /api/attendance/:id/check-out), so rename the column to match on any
// database created before this change. No-ops (and is safely swallowed) on a fresh
// database that was already created with the new column name above.
try {
  db.exec(`ALTER TABLE attendance_records RENAME COLUMN smsSent TO lineReminderSent`);
} catch {
  // already renamed, or this is a fresh install that never had the old column
}

// ============================================================================
// Attendance: an unambiguous instant alongside the readable local time
// ----------------------------------------------------------------------------
// checkInTime and checkOutTime are Taipei wall-clock strings ("2026-08-24
// 21:34:23") with nothing recording that they are Taipei. They read well and
// they are what the screens show, so they stay -- but they cannot be compared,
// subtracted, or handed to another system, because there is no way to know what
// instant they mean without already knowing the convention.
//
// checkInAt and checkOutAt hold the same moments as UTC instants. The CRM
// stores UTC and keeps a timezone per organization; when attendance starts
// crossing that boundary this is the column that can make the trip.
//
// Backfilling the existing rows is exact rather than approximate: Taiwan has
// observed no daylight saving since 1979, so its offset has been a flat +08:00
// for every row this database could hold. A country with DST would need the
// original date to decide, and some of those conversions would be ambiguous.
// ============================================================================
try {
  db.exec(`ALTER TABLE attendance_records ADD COLUMN checkInAt TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE attendance_records ADD COLUMN checkOutAt TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE attendance_records ADD COLUMN organizationId TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}

/**
 * "2026-08-24 21:34:23" (Taipei) -> "2026-08-24T13:34:23.000Z".
 * Returns '' for anything that isn't in that shape, so a malformed old row is
 * left without an instant rather than given a wrong one.
 */
function taipeiLocalToUtcIso(local: string): string {
  const match = String(local || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return '';
  const [, y, mo, d, h, mi, sec] = match;
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec || '00'}+08:00`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

{
  const pending = db
    .prepare(`SELECT id, checkInTime, checkOutTime FROM attendance_records WHERE checkInAt = ''`)
    .all() as Array<{ id: string; checkInTime: string; checkOutTime: string | null }>;
  let converted = 0;
  for (const row of pending) {
    const inAt = taipeiLocalToUtcIso(row.checkInTime);
    if (!inAt) continue;
    db.prepare('UPDATE attendance_records SET checkInAt = ?, checkOutAt = ? WHERE id = ?')
      .run(inAt, taipeiLocalToUtcIso(row.checkOutTime || ''), row.id);
    converted++;
  }
  if (converted > 0) {
    console.log(`SQLite: 已為 ${converted} 筆出勤紀錄補上 UTC 時間戳`);
  }

  const stamped = db
    .prepare(`UPDATE attendance_records SET organizationId = ? WHERE organizationId = ''`)
    .run(currentOrganizationId());
  if (stamped.changes > 0) {
    console.log(`SQLite: 已為 ${stamped.changes} 筆出勤紀錄標記所屬收容所`);
  }
}

// Migration: applicationId -> signupId, following volunteer_applications ->
// shift_signups. This one is easy to forget because nothing type-checks it: the
// column name only ever appears inside SQL strings, so the code and the schema
// can disagree silently until a query fails at runtime.
try {
  db.exec(`ALTER TABLE attendance_records RENAME COLUMN applicationId TO signupId`);
} catch {
  // already renamed, or this is a fresh install that never had the old column
}

// Migration: who acknowledged a volunteer's feedback, and when.
//
// The "標記為已參採" button used to be a useState array and nothing else. It
// turned green, showed a toast, and forgot everything on reload -- another
// coordinator saw nothing, and neither did the same coordinator on a different
// machine. That is worse than having no button: it tells a social worker their
// note was recorded when no record exists.
//
// Three columns rather than one flag, because "acknowledged" on its own cannot
// answer the question anyone would ask next -- who, and when.
try {
  db.exec(`ALTER TABLE attendance_records ADD COLUMN feedbackAcknowledgedAt TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE attendance_records ADD COLUMN feedbackAcknowledgedBy TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}

/**
 * Marks a volunteer's service feedback as taken up by the social work team, or
 * clears that mark.
 *
 * Returns null when the record does not exist, so the caller can answer 404
 * rather than silently succeeding.
 */
export function setFeedbackAcknowledged(
  id: string,
  acknowledged: boolean,
  actor: string
): AttendanceRecord | null {
  const existing = db.prepare('SELECT id FROM attendance_records WHERE id = ?').get(id);
  if (!existing) return null;

  db.prepare(`
    UPDATE attendance_records
    SET feedbackAcknowledgedAt = ?, feedbackAcknowledgedBy = ?
    WHERE id = ?
  `).run(
    acknowledged ? new Date().toISOString() : '',
    acknowledged ? actor : '',
    id
  );

  const row = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
  return row ? rowToAttendanceRecord(row) : null;
}

// Seed with the original mock attendance history on first run only, same pattern as
// the volunteers table above.
const attendanceSeedCount = db.prepare('SELECT COUNT(*) AS c FROM attendance_records').get() as { c: number };
if (attendanceSeedCount.c === 0) {
  const insertSeed = db.prepare(`
    INSERT INTO attendance_records
      (id, signupId, volunteerName, volunteerPhone, lineId, shiftId, shiftTitle, branchId, zone, date, checkInTime, checkOutTime, status, hoursLogged, locationVerified, distanceMeters, qrCodeToken, checkInMethod, rating, feedbackComment, feedbackSubmittedAt, lineReminderSent, photoUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of INITIAL_ATTENDANCE_RECORDS) {
    insertSeed.run(
      r.id, r.signupId || null, r.volunteerName, r.volunteerPhone || null, r.lineId || null,
      r.shiftId, r.shiftTitle, 'shelter', r.zone, r.date, r.checkInTime, r.checkOutTime || null,
      r.status, r.hoursLogged ?? null, r.locationVerified ? 1 : 0, r.distanceMeters ?? null,
      r.qrCodeToken, r.checkInMethod || 'staff', r.rating ?? null, r.feedbackComment || null, r.feedbackSubmittedAt || null,
      r.lineReminderSent ? 1 : 0, r.photoUrl || null
    );
  }
}

function rowToAttendanceRecord(row: any): AttendanceRecord {
  return {
    id: row.id,
    signupId: row.signupId || undefined,
    feedbackAcknowledgedAt: row.feedbackAcknowledgedAt || undefined,
    feedbackAcknowledgedBy: row.feedbackAcknowledgedBy || undefined,
    checkInAt: row.checkInAt || undefined,
    checkOutAt: row.checkOutAt || undefined,
    volunteerName: row.volunteerName,
    volunteerPhone: row.volunteerPhone || undefined,
    lineId: row.lineId || undefined,
    shiftId: row.shiftId,
    shiftTitle: row.shiftTitle,
    zone: row.zone,
    date: row.date,
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime || undefined,
    status: row.status,
    hoursLogged: row.hoursLogged ?? undefined,
    locationVerified: !!row.locationVerified,
    distanceMeters: row.distanceMeters ?? undefined,
    qrCodeToken: row.qrCodeToken,
    checkInMethod: row.checkInMethod === 'self' ? 'self' : 'staff',
    rating: row.rating ?? undefined,
    feedbackComment: row.feedbackComment || undefined,
    feedbackSubmittedAt: row.feedbackSubmittedAt || undefined,
    lineReminderSent: !!row.lineReminderSent,
    photoUrl: row.photoUrl || undefined
  };
}

export function getAllAttendanceRecords(): AttendanceRecord[] {
  const rows = db.prepare('SELECT * FROM attendance_records ORDER BY checkInTime DESC').all();
  return rows.map(rowToAttendanceRecord);
}

export function insertAttendanceRecord(r: AttendanceRecord): AttendanceRecord {
  db.prepare(`
    INSERT INTO attendance_records
      (id, signupId, volunteerName, volunteerPhone, lineId, shiftId, shiftTitle, branchId, zone, date, checkInTime, checkOutTime, checkInAt, checkOutAt, organizationId, status, hoursLogged, locationVerified, distanceMeters, qrCodeToken, rating, feedbackComment, feedbackSubmittedAt, lineReminderSent, photoUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    r.id, r.signupId || null, r.volunteerName, r.volunteerPhone || null, r.lineId || null,
    r.shiftId, r.shiftTitle, 'shelter', r.zone, r.date, r.checkInTime, r.checkOutTime || null,
    r.checkInAt || '', r.checkOutAt || '', currentOrganizationId(),
    r.status, r.hoursLogged ?? null, r.locationVerified ? 1 : 0, r.distanceMeters ?? null,
    r.qrCodeToken, r.rating ?? null, r.feedbackComment || null, r.feedbackSubmittedAt || null,
    r.lineReminderSent ? 1 : 0, r.photoUrl || null
  );
  return r;
}

export function updateAttendanceCheckout(
  id: string,
  updates: { checkOutTime: string; checkOutAt: string; hoursLogged: number; rating?: number; feedbackComment?: string; feedbackSubmittedAt: string; lineReminderSent: boolean; photoUrl?: string }
): AttendanceRecord | null {
  db.prepare(`
    UPDATE attendance_records
    SET checkOutTime = ?, checkOutAt = ?, hoursLogged = ?, status = 'completed', rating = ?, feedbackComment = ?, feedbackSubmittedAt = ?, lineReminderSent = ?, photoUrl = COALESCE(?, photoUrl)
    WHERE id = ?
  `).run(
    updates.checkOutTime, updates.checkOutAt, updates.hoursLogged, updates.rating ?? null, updates.feedbackComment || null,
    updates.feedbackSubmittedAt, updates.lineReminderSent ? 1 : 0, updates.photoUrl || null, id
  );
  const row = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
  return row ? rowToAttendanceRecord(row) : null;
}

// ============================================================================
// Volunteer rulebook / SOP content management (admin-editable) + RAG corpus
// ============================================================================
// This used to be two separate static, build-time things: the hardcoded JSX in
// VolunteerSopGuide.tsx, and a one-time-precomputed embeddings JSON file for
// /api/ai/rag-ask. Both now live here instead, so an admin editing the SOP
// content (or uploading a reference PDF) actually changes what volunteers see
// AND what the RAG Q&A answers from -- re-embedding happens on every save.

db.exec(`
  CREATE TABLE IF NOT EXISTS sop_content (
    id TEXT PRIMARY KEY,
    contentJson TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rag_chunks (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    sourceId TEXT NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sop_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    fileUrl TEXT NOT NULL,
    uploadedAt TEXT NOT NULL
  )
`);

// Byte size of the stored file, so the UI can label a download before someone
// taps it on mobile data. Backfilled from disk below for rows uploaded before
// this column existed.
try { db.exec('ALTER TABLE sop_documents ADD COLUMN fileSize INTEGER'); } catch { /* already added */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS sop_videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    fileUrl TEXT NOT NULL,
    uploadedAt TEXT NOT NULL
  )
`);

const DEFAULT_SOP_CONTENT: SopContent = {
  bannerTitle: '志工服務安全規範與毛孩照護 SOP 🐾',
  bannerSubtitle: '服務毛孩的第一原則是「安全第一」。請在每次出勤前複習相關場域規範，遇到特殊狀況立即通報值日社工或駐院獸醫。',
  sections: [
    {
      id: 'sop-dog-walk',
      icon: '🐕',
      colorTheme: 'emerald',
      title: '大狗運動場 & 放風散步 SOP',
      subtitle: 'B區大型犬戶外放電指導',
      items: [
        { label: '雙扣牽繩規範', text: '胸背帶與項圈必須使用雙頭安全扣，出舍前確認鎖緊。' },
        { label: '防爆衝距離', text: '放風時兩犬距離保持至少 3 公尺，嚴禁讓未社會化犬隻正面嗅聞接觸。' },
        { label: '高溫防燙爪', text: '夏季地面超過 35°C 時縮短柏油路行走，改至遮蔭草坪。' }
      ]
    },
    {
      id: 'sop-cat-room',
      icon: '🐱',
      colorTheme: 'rose',
      title: '貓舍區清消與陪伴 SOP',
      subtitle: 'A棟親人貓房與隔離舍規範',
      items: [
        { label: '進出雙道門', text: '進入貓舍必須「關一扇才能開下一扇」，嚴防貓咪奪門暴衝。' },
        { label: '分區清消不混用', text: '隔離房抹布與拖把不得跨房使用，每次接觸後使用次氯酸消毒手部。' },
        { label: '安撫觀察情緒', text: '若貓咪飛機耳或低吼，請暫停互動並通知資深隊長。' }
      ]
    },
    {
      id: 'sop-puppy-nursery',
      icon: '🍼',
      colorTheme: 'amber',
      title: '幼犬育幼與保暖 SOP',
      subtitle: 'C棟幼幼犬照護特別規範',
      items: [
        { label: '泡奶溫度測試', text: '代母乳泡製以 38°C 微溫為準，手背測試不燙方可餵食。' },
        { label: '定時排便刺激', text: '餵食後使用微濕溫棉花輕柔刺激肛門與尿道排泄。' },
        { label: '保暖燈監測', text: '確認保暖燈高度維持 45 公分，避免幼犬過熱或受寒。' }
      ]
    }
  ],
  emergencyTitle: '緊急事件處置與受傷第一道防線',
  emergencyText: '若不幸遭犬貓咬傷抓傷，請立即使用大量生理食鹽水沖洗 15 分鐘，並立即告知督導安排就醫破傷風評估。',
  emergencyPhone: '(02) 2211-8899 #108'
};

// Seed sop_content with the default (previously hardcoded) content on first run only.
const sopContentSeedCount = db.prepare('SELECT COUNT(*) AS c FROM sop_content').get() as { c: number };
if (sopContentSeedCount.c === 0) {
  db.prepare('INSERT INTO sop_content (id, contentJson, updatedAt) VALUES (?, ?, ?)')
    .run('default', JSON.stringify(DEFAULT_SOP_CONTENT), new Date().toISOString());
}

// Seed rag_chunks from the precomputed embeddings file (scripts/embed-rulebook.ts's
// output) on first run only -- reuses those existing vectors instead of spending
// Gemini embedding quota again just to reach the same starting state. Chunks whose
// id matches a default SOP section (or the emergency block) are tagged so future
// admin edits to that section correctly replace rather than duplicate them; every
// other chunk (the "how do I use the admin dashboard" background knowledge) is
// tagged 'static' and is never touched by the SOP content editor.
const ragChunksSeedCount = db.prepare('SELECT COUNT(*) AS c FROM rag_chunks').get() as { c: number };
if (ragChunksSeedCount.c === 0) {
  try {
    const precomputed = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'rulebook_embeddings.json'), 'utf-8')
    ) as { id: string; title: string; text: string; embedding: number[] }[];
    const sectionIds = new Set(DEFAULT_SOP_CONTENT.sections.map(s => s.id));
    const insertChunk = db.prepare(`
      INSERT INTO rag_chunks (id, source, sourceId, title, text, embedding, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const nowIso = new Date().toISOString();
    for (const chunk of precomputed) {
      const source = sectionIds.has(chunk.id) ? 'section' : chunk.id === 'emergency-protocol' ? 'emergency' : 'static';
      insertChunk.run(randomUUID(), source, chunk.id, chunk.title, chunk.text, JSON.stringify(chunk.embedding), nowIso);
    }
  } catch {
    // data/rulebook_embeddings.json not found (e.g. the offline embed script was
    // never run) -- RAG just starts empty and falls back to the keyword matcher
    // in server.ts until an admin saves SOP content or uploads a PDF.
  }
}

export function getSopContent(): SopContent {
  const row = db.prepare('SELECT contentJson FROM sop_content WHERE id = ?').get('default') as { contentJson: string } | undefined;
  return row ? JSON.parse(row.contentJson) : DEFAULT_SOP_CONTENT;
}

export function saveSopContent(content: SopContent): void {
  db.prepare('UPDATE sop_content SET contentJson = ?, updatedAt = ? WHERE id = ?')
    .run(JSON.stringify(content), new Date().toISOString(), 'default');
}

export interface RagChunkRow {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  text: string;
  embedding: number[];
}

export function getAllRagChunks(): RagChunkRow[] {
  const rows = db.prepare('SELECT * FROM rag_chunks').all() as any[];
  return rows.map(r => ({ id: r.id, source: r.source, sourceId: r.sourceId, title: r.title, text: r.text, embedding: JSON.parse(r.embedding) }));
}

// Replaces every chunk previously stored for this (source, sourceId) pair with a
// fresh set -- used both for a single-chunk SOP section re-embed and a
// multi-chunk PDF re-embed (a PDF's text gets split into several chunks).
export function replaceRagChunks(source: string, sourceId: string, chunks: { title: string; text: string; embedding: number[] }[]): void {
  db.prepare('DELETE FROM rag_chunks WHERE source = ? AND sourceId = ?').run(source, sourceId);
  const insertChunk = db.prepare(`
    INSERT INTO rag_chunks (id, source, sourceId, title, text, embedding, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const nowIso = new Date().toISOString();
  for (const c of chunks) {
    insertChunk.run(randomUUID(), source, sourceId, c.title, c.text, JSON.stringify(c.embedding), nowIso);
  }
}

export function deleteRagChunks(source: string, sourceId: string): void {
  db.prepare('DELETE FROM rag_chunks WHERE source = ? AND sourceId = ?').run(source, sourceId);
}

/**
 * Uploaded manuals, each flagged with whether it can be read online.
 *
 * hasText was declared on the type and documented as "true when the manual's
 * text was extracted at upload time" -- and nothing ever set it, so it was
 * always undefined. Anything gating a "read online" button on it would have
 * hidden that button forever, and anything ignoring it offers the reader for
 * scans that have no extracted text to show.
 *
 * It is derived rather than stored: the readable text is the document's rag
 * chunks, so their existence is the answer, and a stored copy of that answer
 * would be one more thing that can disagree with its source.
 */
export function getAllSopDocuments(): SopDocument[] {
  const rows = db.prepare(`
    SELECT d.*,
           EXISTS (
             SELECT 1 FROM rag_chunks c WHERE c.source = 'pdf' AND c.sourceId = d.id
           ) AS extracted
    FROM sop_documents d
    ORDER BY d.uploadedAt DESC
  `).all() as any[];
  return rows.map(row => {
    const { extracted, ...doc } = row;
    return { ...doc, hasText: !!extracted } as SopDocument;
  });
}

export function insertSopDocument(doc: SopDocument): void {
  db.prepare('INSERT INTO sop_documents (id, title, fileUrl, uploadedAt, fileSize) VALUES (?, ?, ?, ?, ?)')
    .run(doc.id, doc.title, doc.fileUrl, doc.uploadedAt, doc.fileSize ?? null);
}

/**
 * Fills in fileSize for documents stored before the column existed, by
 * stat-ing the file each row points at. Called once at startup; rows whose
 * file has since been removed are left null and simply render without a size.
 */
export function backfillSopDocumentSizes(sopDocsDir: string): void {
  const rows = db.prepare('SELECT id, fileUrl FROM sop_documents WHERE fileSize IS NULL').all() as any[];
  const update = db.prepare('UPDATE sop_documents SET fileSize = ? WHERE id = ?');
  for (const row of rows) {
    try {
      const name = path.basename(String(row.fileUrl));
      update.run(fs.statSync(path.join(sopDocsDir, name)).size, row.id);
    } catch { /* file is gone -- leave the size unknown */ }
  }
}

/**
 * Rebuilds a document's readable text from the chunks already indexed for RAG
 * at upload time. Lets a phone read a scanned 88MB manual as ~31KB of text
 * instead of downloading the images -- see /api/sop-documents/:id/text.
 */
export function getSopDocumentText(id: string): string | null {
  const rows = db.prepare(
    "SELECT text FROM rag_chunks WHERE source = 'pdf' AND sourceId = ? ORDER BY id"
  ).all(id) as any[];
  if (rows.length === 0) return null;
  return rows.map(r => String(r.text)).join('\n\n');
}

export function deleteSopDocument(id: string): void {
  db.prepare('DELETE FROM sop_documents WHERE id = ?').run(id);
}

export function getAllSopVideos(): SopVideo[] {
  return db.prepare('SELECT * FROM sop_videos ORDER BY uploadedAt DESC').all() as any[] as SopVideo[];
}

export function insertSopVideo(video: SopVideo): void {
  db.prepare('INSERT INTO sop_videos (id, title, description, fileUrl, uploadedAt) VALUES (?, ?, ?, ?, ?)')
    .run(video.id, video.title, video.description || null, video.fileUrl, video.uploadedAt);
}

export function deleteSopVideo(id: string): void {
  db.prepare('DELETE FROM sop_videos WHERE id = ?').run(id);
}

// ============================================================================
// Volunteer tier promotion requests
// ============================================================================
// The growth-checklist "通知管理員審核" button used to just fire a client-side
// toast styled to look like a real admin notification -- nothing was ever
// persisted, so there was genuinely nowhere for an admin to go review it. This
// table is the real record; VolunteerRoster.tsx's admin view lists pending ones.

db.exec(`
  CREATE TABLE IF NOT EXISTS promotion_requests (
    id TEXT PRIMARY KEY,
    volunteerEmail TEXT NOT NULL,
    volunteerName TEXT NOT NULL,
    currentTier TEXT NOT NULL,
    requestedTier TEXT NOT NULL,
    completedItems TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requestedAt TEXT NOT NULL,
    reviewedAt TEXT,
    reviewNote TEXT
  )
`);

function rowToPromotionRequest(row: any): PromotionRequest {
  return {
    id: row.id,
    volunteerEmail: row.volunteerEmail,
    volunteerName: row.volunteerName,
    currentTier: row.currentTier,
    requestedTier: row.requestedTier,
    completedItems: JSON.parse(row.completedItems),
    status: row.status,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt || undefined,
    reviewNote: row.reviewNote || undefined
  };
}

export function getAllPromotionRequests(): PromotionRequest[] {
  const rows = db.prepare('SELECT * FROM promotion_requests ORDER BY requestedAt DESC').all();
  return rows.map(rowToPromotionRequest);
}

// A volunteer re-clicking "通知管理員審核" (or re-triggering it via the checklist
// auto-notify) while they already have a pending request just refreshes that same
// row instead of piling up duplicates for the same promotion.
export function upsertPendingPromotionRequest(params: {
  volunteerEmail: string;
  volunteerName: string;
  currentTier: string;
  requestedTier: string;
  completedItems: string[];
}): PromotionRequest {
  const email = params.volunteerEmail.toLowerCase().trim();
  const existing = db.prepare(
    `SELECT id FROM promotion_requests WHERE volunteerEmail = ? AND requestedTier = ? AND status = 'pending'`
  ).get(email, params.requestedTier) as { id: string } | undefined;

  const nowIso = new Date().toISOString();

  if (existing) {
    db.prepare('UPDATE promotion_requests SET completedItems = ?, requestedAt = ? WHERE id = ?')
      .run(JSON.stringify(params.completedItems), nowIso, existing.id);
    return rowToPromotionRequest(db.prepare('SELECT * FROM promotion_requests WHERE id = ?').get(existing.id));
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO promotion_requests (id, volunteerEmail, volunteerName, currentTier, requestedTier, completedItems, status, requestedAt)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, email, params.volunteerName, params.currentTier, params.requestedTier, JSON.stringify(params.completedItems), nowIso);

  return rowToPromotionRequest(db.prepare('SELECT * FROM promotion_requests WHERE id = ?').get(id));
}

// Latest request for this volunteer (any status) -- lets the volunteer-facing UI
// show "審核中" / "已核准" / "已婉拒" instead of just a fire-and-forget button.
export function getLatestPromotionRequestForVolunteer(email: string): PromotionRequest | null {
  const row = db.prepare('SELECT * FROM promotion_requests WHERE volunteerEmail = ? ORDER BY requestedAt DESC LIMIT 1')
    .get(email.toLowerCase().trim());
  return row ? rowToPromotionRequest(row) : null;
}

export function reviewPromotionRequest(id: string, status: 'approved' | 'rejected', reviewNote?: string): PromotionRequest | null {
  db.prepare('UPDATE promotion_requests SET status = ?, reviewedAt = ?, reviewNote = ? WHERE id = ?')
    .run(status, new Date().toISOString(), reviewNote || null, id);
  const row = db.prepare('SELECT * FROM promotion_requests WHERE id = ?').get(id);
  return row ? rowToPromotionRequest(row) : null;
}

// Actually changes the volunteer's tier -- called when an admin approves a
// promotion request, so approval has a real effect instead of just flipping a
// status flag nothing else reads.
export function updateVolunteerTier(email: string, tier: string): void {
  db.prepare('UPDATE volunteers SET tier = ? WHERE email = ?').run(tier, email.toLowerCase().trim());
}

// ============================================================================
// Shift templates ("班次" cards) -- auto-synced every time an admin publishes
// a shift, so the create-shift form can offer "套用過去班次範本" without a
// separate manual template-authoring step. Deliberately its own table (not
// folded into sop_content's sections) since a shift's fields (branch/zone/
// date/quota/tasks/location) don't fit the rulebook's title+subtitle+items
// shape at all.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS shift_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    branchId TEXT NOT NULL,
    zone TEXT NOT NULL,
    timeRange TEXT NOT NULL,
    requiredCount INTEGER NOT NULL,
    skillRequired TEXT NOT NULL,
    description TEXT NOT NULL,
    tasks TEXT NOT NULL,
    locationDetails TEXT NOT NULL,
    attachmentUrl TEXT,
    updatedAt TEXT NOT NULL
  )
`);

function rowToShiftTemplate(row: any): ShiftTemplate {
  return {
    id: row.id,
    title: row.title,
    zone: row.zone,
    timeRange: row.timeRange,
    requiredCount: row.requiredCount,
    skillRequired: row.skillRequired,
    description: row.description,
    tasks: JSON.parse(row.tasks),
    locationDetails: row.locationDetails,
    attachmentUrl: row.attachmentUrl || undefined,
    updatedAt: row.updatedAt
  };
}

export function getAllShiftTemplates(): ShiftTemplate[] {
  const rows = db.prepare('SELECT * FROM shift_templates ORDER BY updatedAt DESC').all();
  return rows.map(rowToShiftTemplate);
}

// Upserts by normalized title -- republishing a recurring shift (e.g. the
// same "大狗運動場假日牽繩放風" every weekend) refreshes its one template
// instead of piling up near-duplicate cards in the dropdown.
export function upsertShiftTemplate(params: {
  title: string;
  zone: string;
  timeRange: string;
  requiredCount: number;
  skillRequired: string;
  description: string;
  tasks: string[];
  locationDetails: string;
  attachmentUrl?: string;
}): ShiftTemplate {
  const normalizedTitle = params.title.trim();
  const nowIso = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM shift_templates WHERE title = ?').get(normalizedTitle) as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE shift_templates
      SET zone = ?, timeRange = ?, requiredCount = ?, skillRequired = ?, description = ?, tasks = ?, locationDetails = ?, attachmentUrl = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      params.zone, params.timeRange, params.requiredCount, params.skillRequired,
      params.description, JSON.stringify(params.tasks), params.locationDetails, params.attachmentUrl || null, nowIso,
      existing.id
    );
    return rowToShiftTemplate(db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(existing.id));
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO shift_templates (id, title, branchId, zone, timeRange, requiredCount, skillRequired, description, tasks, locationDetails, attachmentUrl, updatedAt)
    VALUES (?, ?, 'shelter', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, normalizedTitle, params.zone, params.timeRange, params.requiredCount, params.skillRequired,
    params.description, JSON.stringify(params.tasks), params.locationDetails, params.attachmentUrl || null, nowIso
  );
  return rowToShiftTemplate(db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(id));
}

export function deleteShiftTemplate(id: string): void {
  db.prepare('DELETE FROM shift_templates WHERE id = ?').run(id);
}

// ============================================================================
// Shelter location -- the shelter's single physical location (previously a
// hardcoded array of 3 fixed "branches" -- that architecture was removed
// since the org only ever operates from one place). Single-row table, same
// pattern as sop_content. The admin edits name/address/openHours; lat/lng/
// googleMapsUrl are refreshed by server-side geocoding (see server.ts).
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS shelter_location (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    googleMapsUrl TEXT NOT NULL,
    openHours TEXT NOT NULL,
    image TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    geocoded INTEGER NOT NULL DEFAULT 0
  )
`);

const shelterLocationSeedCount = db.prepare('SELECT COUNT(*) AS c FROM shelter_location').get() as { c: number };
if (shelterLocationSeedCount.c === 0) {
  db.prepare(`
    INSERT INTO shelter_location (id, name, address, googleMapsUrl, openHours, image, lat, lng, geocoded)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    DEFAULT_SHELTER_LOCATION.name, DEFAULT_SHELTER_LOCATION.address, DEFAULT_SHELTER_LOCATION.googleMapsUrl,
    DEFAULT_SHELTER_LOCATION.openHours, DEFAULT_SHELTER_LOCATION.image,
    DEFAULT_SHELTER_LOCATION.lat, DEFAULT_SHELTER_LOCATION.lng, DEFAULT_SHELTER_LOCATION.geocoded ? 1 : 0
  );
}

function rowToShelterLocation(row: any): ShelterLocation {
  return {
    name: row.name,
    address: row.address,
    googleMapsUrl: row.googleMapsUrl,
    openHours: row.openHours,
    image: row.image,
    lat: row.lat,
    lng: row.lng,
    geocoded: !!row.geocoded
  };
}

export function getShelterLocation(): ShelterLocation {
  const row = db.prepare('SELECT * FROM shelter_location WHERE id = 1').get();
  return rowToShelterLocation(row);
}

export function updateShelterLocation(updates: {
  name: string;
  address: string;
  openHours: string;
  googleMapsUrl?: string;
  lat?: number;
  lng?: number;
  geocoded?: boolean;
}): ShelterLocation {
  const current = getShelterLocation();
  const next = {
    name: updates.name,
    address: updates.address,
    openHours: updates.openHours,
    googleMapsUrl: updates.googleMapsUrl ?? current.googleMapsUrl,
    lat: updates.lat ?? current.lat,
    lng: updates.lng ?? current.lng,
    geocoded: updates.geocoded ?? current.geocoded
  };
  db.prepare(`
    UPDATE shelter_location
    SET name = ?, address = ?, openHours = ?, googleMapsUrl = ?, lat = ?, lng = ?, geocoded = ?
    WHERE id = 1
  `).run(next.name, next.address, next.openHours, next.googleMapsUrl, next.lat, next.lng, next.geocoded ? 1 : 0);
  return getShelterLocation();
}

/**
 * An open (not yet checked out) record for this volunteer on this shift, if any.
 * Used to reject a duplicate check-in server-side rather than trusting the page
 * to have noticed.
 */
export function getOpenAttendanceFor(volunteerName: string, shiftId: string): AttendanceRecord | null {
  const row = db.prepare(
    "SELECT * FROM attendance_records WHERE volunteerName = ? AND shiftId = ? AND status = 'checked_in'"
  ).get(volunteerName, shiftId);
  return row ? rowToAttendanceRecord(row) : null;
}

// ============================================================================
// Small key/value store for server-side secrets that must survive a restart.
// ----------------------------------------------------------------------------
// The on-site check-in code is an HMAC of the current time window, so the
// secret behind it has to be stable -- otherwise every deploy would invalidate
// codes people are looking at. Generated once, never leaves the server.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

export function getAppSecret(name: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(name) as any;
  if (row) return row.value;
  const generated = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(name, generated);
  return generated;
}

// ============================================================================
// LINE official account (Messaging API channel volunteers add as a friend)
// ----------------------------------------------------------------------------
// Same single-row pattern as shelter_location. Was previously a hardcoded
// mention in the UI text with no actual account behind it; now admin-editable
// so the ID shown always matches whichever channel LINE_CHANNEL_ACCESS_TOKEN
// in .env.local actually points at.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS line_official_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    basicId TEXT NOT NULL,
    displayName TEXT NOT NULL,
    avatarUrl TEXT NOT NULL DEFAULT ''
  )
`);

const lineOaSeedCount = db.prepare('SELECT COUNT(*) AS c FROM line_official_account').get() as { c: number };
if (lineOaSeedCount.c === 0) {
  db.prepare('INSERT INTO line_official_account (id, basicId, displayName, avatarUrl) VALUES (1, ?, ?, ?)')
    .run(DEFAULT_LINE_OFFICIAL_ACCOUNT.basicId, DEFAULT_LINE_OFFICIAL_ACCOUNT.displayName, DEFAULT_LINE_OFFICIAL_ACCOUNT.avatarUrl);
}

export function getLineOfficialAccount(): LineOfficialAccount {
  const row = db.prepare('SELECT * FROM line_official_account WHERE id = 1').get() as any;
  return { basicId: row.basicId, displayName: row.displayName, avatarUrl: row.avatarUrl };
}

export function updateLineOfficialAccount(updates: { basicId: string; displayName: string; avatarUrl?: string }): LineOfficialAccount {
  db.prepare('UPDATE line_official_account SET basicId = ?, displayName = ?, avatarUrl = ? WHERE id = 1')
    .run(updates.basicId, updates.displayName, updates.avatarUrl ?? '');
  return getLineOfficialAccount();
}

// ============================================================================
// Zones -- the shelter's own areas, editable rather than compiled in
// ----------------------------------------------------------------------------
// These were five values in a TypeScript union: cat, dog, puppy, medical,
// logistics. That is fine for one shelter that happens to have exactly those
// five areas and wrong for everyone else -- a shelter with an aviary, or
// without a puppy nursery, could not describe itself without a code change.
// Per-area care workload is also the input the whole roster calculation starts
// from, and workload cannot be configured for areas that only exist as a type.
//
// Two decisions here are load-bearing.
//
// Colours are stored as a palette key ('rose'), never as CSS classes. Tailwind
// generates styles only for class names it can see in the source at build time,
// so a class name assembled from database content produces no CSS at all --
// silently, with the element rendering unstyled. The key maps to class strings
// that are literals in src/data/zones.ts, where the scanner finds them.
//
// Zones are disabled, never deleted. Three tables store a zone on every row
// (shifts, shift_signups, attendance_records), so deleting one would leave
// every historical record pointing at something that no longer exists. A
// disabled zone stops being offered for new shifts while old records still
// render. The CRM reached the same conclusion for its observation options,
// which have disable, restore and archive, and no delete at all.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    palette TEXT NOT NULL DEFAULT 'slate',
    icon TEXT NOT NULL DEFAULT '📍',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    sortOrder INTEGER NOT NULL DEFAULT 0,
    organizationId TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);

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

function rowToZone(row: any): ZoneRecord {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    palette: row.palette,
    icon: row.icon,
    description: row.description,
    status: row.status,
    sortOrder: row.sortOrder
  };
}

// Seed the five areas this shelter already had, so nothing on screen changes on
// the first run after this table appears. The ids are kept exactly as they were
// -- every existing shift, signup and attendance row already stores one of
// them, and new ids would orphan all of that history.
const zoneSeedCount = db.prepare('SELECT COUNT(*) AS c FROM zones').get() as { c: number };
if (zoneSeedCount.c === 0) {
  const seed: Array<[string, string, string, string, string, string]> = [
    ['cat', '貓舍區 (A棟)', 'CAT', 'rose', '🐱',
     '負責貓咪餵食、鏟貓砂、貓房清潔、親人社會化訓練與陪伴。'],
    ['dog', '大狗運動場 (B區)', 'DOG', 'emerald', '🐕',
     '負責大型犬牽繩放風散步、洗澡吹乾、戶外大運動場放電與體能訓練。'],
    ['puppy', '幼犬育幼區 (C棟)', 'PUPPY', 'amber', '🐾',
     '負責幼犬泡奶泡泡糧、定時陪伴、保暖監測與基礎衛教。'],
    ['medical', '醫療與隔離區 (M棟)', 'MED', 'sky', '🏥',
     '協助駐院獸醫餵藥、術後照護記錄、深度環境消毒（需資深志工）。'],
    ['logistics', '物資與行政導覽 (L區)', 'LOG', 'purple', '📦',
     '民眾捐贈罐頭飼料拆箱分類、參訪導覽解說與義賣現場協助。']
  ];
  const seededAt = new Date().toISOString();
  seed.forEach(([id, name, code, palette, icon, description], index) => {
    db.prepare(`
      INSERT INTO zones (id, name, code, palette, icon, description, status, sortOrder, organizationId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(id, name, code, palette, icon, description, index, currentOrganizationId(), seededAt, seededAt);
  });
  console.log(`SQLite: 已建立 ${seed.length} 個預設場域`);
}

/** Every zone, disabled ones included -- what the management screen lists. */
export function getAllZones(): ZoneRecord[] {
  return (db.prepare('SELECT * FROM zones ORDER BY sortOrder, name').all() as any[]).map(rowToZone);
}

/** Only the zones a new shift may be filed under. */
export function getActiveZones(): ZoneRecord[] {
  return (db.prepare(`SELECT * FROM zones WHERE status = 'active' ORDER BY sortOrder, name`).all() as any[]).map(rowToZone);
}

export function getZone(id: string): ZoneRecord | null {
  const row = db.prepare('SELECT * FROM zones WHERE id = ?').get(id);
  return row ? rowToZone(row) : null;
}

/**
 * Turns a display name into an id. Latin text becomes a slug; anything else --
 * Chinese, for instance -- has no useful slug, so it falls back to a numbered
 * generic one. Nobody ever sees this value; it only has to be stable and
 * unique, because rows in three other tables will point at it indefinitely.
 */
function makeZoneId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const base = slug || 'zone';
  let candidate = base;
  let attempt = 1;
  while (db.prepare('SELECT id FROM zones WHERE id = ?').get(candidate)) {
    candidate = `${base}-${++attempt}`;
  }
  return candidate;
}

export function createZone(input: {
  name: string; code: string; palette: string; icon: string; description: string;
}): ZoneRecord {
  const now = new Date().toISOString();
  const id = makeZoneId(input.name);
  const next = db.prepare('SELECT COALESCE(MAX(sortOrder), -1) + 1 AS n FROM zones').get() as { n: number };
  db.prepare(`
    INSERT INTO zones (id, name, code, palette, icon, description, status, sortOrder, organizationId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(id, input.name, input.code, input.palette, input.icon, input.description, next.n, currentOrganizationId(), now, now);
  return getZone(id)!;
}

export function updateZone(id: string, updates: {
  name?: string; code?: string; palette?: string; icon?: string; description?: string;
}): ZoneRecord | null {
  const existing = getZone(id);
  if (!existing) return null;
  db.prepare(`
    UPDATE zones SET name = ?, code = ?, palette = ?, icon = ?, description = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    updates.name ?? existing.name,
    updates.code ?? existing.code,
    updates.palette ?? existing.palette,
    updates.icon ?? existing.icon,
    updates.description ?? existing.description,
    new Date().toISOString(),
    id
  );
  return getZone(id);
}

/**
 * Disable rather than delete. Historical shifts, signups and attendance rows
 * keep pointing here and keep rendering; the zone just stops being offered for
 * anything new.
 */
export function setZoneStatus(id: string, status: 'active' | 'disabled'): ZoneRecord | null {
  if (!getZone(id)) return null;
  db.prepare('UPDATE zones SET status = ?, updatedAt = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
  return getZone(id);
}

/** How many existing records already reference a zone -- shown before disabling it. */
export function countZoneUsage(id: string): { shifts: number; signups: number; attendance: number } {
  const one = (sql: string) => (db.prepare(sql).get(id) as { c: number }).c;
  return {
    shifts: one('SELECT COUNT(*) AS c FROM shifts WHERE zone = ?'),
    signups: one('SELECT COUNT(*) AS c FROM shift_signups WHERE appliedZone = ?'),
    attendance: one('SELECT COUNT(*) AS c FROM attendance_records WHERE zone = ?')
  };
}

// ============================================================================
// Duty items, and the record of completing them
// ----------------------------------------------------------------------------
// "SOP" was one word doing three jobs, which is why it was never clear whose
// data this was. Separated:
//
//   SOP 規範        the written standard. Read, searched, taught. Never
//                   "completed". Already lives in sop_content and friends.
//   勤務項目        this table. The definition of a job: where, when, who is
//                   responsible, how many people, how long. Never completed
//                   either -- instances of it are.
//   勤務完成紀錄     duty_completions. One row per person per occurrence.
//
// The old DailyDutyTaskboard held both of the latter two in one hardcoded
// useState array, mixing title and description (a definition) with isCompleted
// and completedBy (an event). That is why nothing could be saved: storing it
// would have copied the definition text on every tick, and editing a definition
// would have rewritten history.
//
// requiredPeople and estimatedMinutes are here for a second reason. They are
// also the per-area care workload the roster calculation needs -- "the cattery
// needs 2 people for 90 minutes a day" is simultaneously a duty list and the
// input to working out how many volunteers a fortnight requires. One table,
// two purposes, rather than asking the shelter to describe its work twice.
//
// Note the column is triggerType, not trigger: TRIGGER is a SQLite keyword and
// a column of that name is a quoting accident waiting to happen.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS duty_items (
    id TEXT PRIMARY KEY,
    zoneId TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    triggerType TEXT NOT NULL DEFAULT 'daily',
    shiftId TEXT NOT NULL DEFAULT '',
    responsibleRole TEXT NOT NULL DEFAULT 'volunteer',
    requiredPeople INTEGER NOT NULL DEFAULT 1,
    estimatedMinutes INTEGER NOT NULL DEFAULT 30,
    timeWindow TEXT NOT NULL DEFAULT '',
    weekdays TEXT NOT NULL DEFAULT '',
    startTime TEXT NOT NULL DEFAULT '',
    endTime TEXT NOT NULL DEFAULT '',
    isRequired INTEGER NOT NULL DEFAULT 1,
    sopSectionId TEXT NOT NULL DEFAULT '',
    sopVideoId TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    sortOrder INTEGER NOT NULL DEFAULT 0,
    organizationId TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS duty_completions (
    id TEXT PRIMARY KEY,
    dutyItemId TEXT NOT NULL,
    date TEXT NOT NULL,
    shiftId TEXT NOT NULL DEFAULT '',
    completedBy TEXT NOT NULL,
    completedAt TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'self',
    note TEXT NOT NULL DEFAULT '',
    organizationId TEXT NOT NULL DEFAULT ''
  )
`);

// One completion per item per day per shift. shiftId defaults to '' rather than
// NULL precisely so this constraint works -- SQLite treats NULLs as distinct,
// so a nullable column would let the same duty be completed any number of times.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_duty_completion_once
  ON duty_completions (dutyItemId, date, shiftId)
`);

export type DutyTrigger = 'daily' | 'zone_shift' | 'specific_shift';
export type DutyRole = 'staff' | 'volunteer';

export interface DutyItem {
  id: string;
  zoneId: string;
  title: string;
  description: string;
  category: string;
  triggerType: DutyTrigger;
  shiftId: string;
  responsibleRole: DutyRole;
  requiredPeople: number;
  estimatedMinutes: number;
  /** "HH:MM", empty when the shelter has not pinned the duty to a time yet. */
  startTime: string;
  endTime: string;
  /**
   * Which days it runs, as "0,6" (0 = Sunday). Empty means every day.
   *
   * Empty has to mean "no restriction": every row that existed before this
   * column did is empty, and the other reading would have emptied the roster.
   */
  weekdays: string;
  /** Derived from startTime/endTime for display. Never stored -- see the migration. */
  timeWindow: string;
  isRequired: boolean;
  sopSectionId: string;
  sopVideoId: string;
  status: 'active' | 'disabled';
  sortOrder: number;
}

export interface DutyCompletion {
  id: string;
  dutyItemId: string;
  date: string;
  shiftId: string;
  completedBy: string;
  completedAt: string;
  method: 'self' | 'staff';
  note: string;
}

function rowToDutyItem(row: any): DutyItem {
  return {
    id: row.id,
    zoneId: row.zoneId,
    title: row.title,
    description: row.description,
    category: row.category,
    triggerType: row.triggerType,
    shiftId: row.shiftId,
    responsibleRole: row.responsibleRole,
    requiredPeople: row.requiredPeople,
    estimatedMinutes: row.estimatedMinutes,
    startTime: row.startTime || '',
    endTime: row.endTime || '',
    weekdays: row.weekdays || '',
    // Composed here rather than stored, so the two spellings of the same fact
    // cannot disagree. The daily task board reads this to show the window.
    timeWindow: row.startTime && row.endTime ? `${row.startTime} - ${row.endTime}` : '',
    isRequired: !!row.isRequired,
    sopSectionId: row.sopSectionId,
    sopVideoId: row.sopVideoId,
    status: row.status,
    sortOrder: row.sortOrder
  };
}

function rowToDutyCompletion(row: any): DutyCompletion {
  return {
    id: row.id,
    dutyItemId: row.dutyItemId,
    date: row.date,
    shiftId: row.shiftId,
    completedBy: row.completedBy,
    completedAt: row.completedAt,
    method: row.method,
    note: row.note
  };
}

// Seed from the list that was hardcoded in DailyDutyTaskboard, so the board
// looks the same on the first run after this table appears. requiredPeople
// defaults to 1 because the old data never recorded it -- the shelter has to
// supply the real figures, and until it does the workload totals are a floor
// rather than an estimate. The management screen says so.
const dutySeedCount = db.prepare('SELECT COUNT(*) AS c FROM duty_items').get() as { c: number };
if (dutySeedCount.c === 0) {
  const seed: Array<[string, string, string, string, number]> = [
    ['dog', '🐶 大狗放風與防護', '檢視胸背帶與雙扣牽繩牢固度', '09:00 - 09:30', 30],
    ['dog', '🐶 大狗放風與防護', '草地放風便便清除與水份補充', '09:30 - 11:30', 120],
    ['dog', '🐶 大狗放風與防護', '歸房體表檢查與趾縫清潔', '11:30 - 12:00', 30],
    ['cat', '🐱 貓房照護與親人訓練', '貓砂盆與貓房地板深層清理', '13:30 - 14:30', 60],
    ['cat', '🐱 貓房照護與親人訓練', '膽小貓肉泥互動與梳毛減壓', '14:30 - 16:00', 90],
    ['medical', '🏥 醫療觀察與處方紀錄', '術後犬貓伊莉莎白圈與傷口檢查', '10:00 - 10:30', 30],
    ['medical', '🏥 醫療觀察與處方紀錄', '口服處方藥物與高營養罐頭發放', '11:00 - 12:00', 60],
    ['puppy', '🍼 幼犬育幼與溫室清消', '幼犬體重測量與配方奶粉餵食', '08:30 - 09:30', 60]
  ];
  const optional = new Set(['膽小貓肉泥互動與梳毛減壓']);
  const seededAt = new Date().toISOString();
  seed.forEach(([zoneId, category, title, timeWindow, minutes], index) => {
    db.prepare(`
      INSERT INTO duty_items
        (id, zoneId, title, description, category, triggerType, shiftId, responsibleRole,
         requiredPeople, estimatedMinutes, timeWindow, startTime, endTime, weekdays,
         isRequired, sopSectionId, sopVideoId,
         status, sortOrder, organizationId, createdAt, updatedAt)
      VALUES (?, ?, ?, '', ?, 'daily', '', 'volunteer', 1, ?, '', ?, ?, '', ?, '', '', 'active', ?, ?, ?, ?)
    `).run(
      `duty-${index + 1}`, zoneId, title, category, minutes,
      String(timeWindow).split('-')[0].trim(), String(timeWindow).split('-')[1].trim(),
      optional.has(title) ? 0 : 1, index, currentOrganizationId(), seededAt, seededAt
    );
  });
  console.log(`SQLite: 已建立 ${seed.length} 個預設勤務項目`);
}

export function getAllDutyItems(): DutyItem[] {
  return (db.prepare('SELECT * FROM duty_items ORDER BY sortOrder, title').all() as any[]).map(rowToDutyItem);
}

export function getActiveDutyItems(): DutyItem[] {
  return (db.prepare(`SELECT * FROM duty_items WHERE status = 'active' ORDER BY sortOrder, title`).all() as any[])
    .map(rowToDutyItem);
}

export function getDutyItem(id: string): DutyItem | null {
  const row = db.prepare('SELECT * FROM duty_items WHERE id = ?').get(id);
  return row ? rowToDutyItem(row) : null;
}

export function createDutyItem(input: Omit<DutyItem, 'id' | 'status' | 'sortOrder'>): DutyItem {
  const now = new Date().toISOString();
  const id = `duty-${randomUUID().slice(0, 8)}`;
  const next = db.prepare('SELECT COALESCE(MAX(sortOrder), -1) + 1 AS n FROM duty_items').get() as { n: number };
  db.prepare(`
    INSERT INTO duty_items
      (id, zoneId, title, description, category, triggerType, shiftId, responsibleRole,
       requiredPeople, estimatedMinutes, timeWindow, startTime, endTime, weekdays,
       isRequired, sopSectionId, sopVideoId,
       status, sortOrder, organizationId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(
    id, input.zoneId, input.title, input.description, input.category, input.triggerType,
    input.shiftId, input.responsibleRole, input.requiredPeople, input.estimatedMinutes,
    normalizeClock(input.startTime), normalizeClock(input.endTime), serializeWeekdays(input.weekdays),
    input.isRequired ? 1 : 0, input.sopSectionId, input.sopVideoId,
    next.n, currentOrganizationId(), now, now
  );
  return getDutyItem(id)!;
}

export function updateDutyItem(id: string, updates: Partial<DutyItem>): DutyItem | null {
  const existing = getDutyItem(id);
  if (!existing) return null;
  const merged = { ...existing, ...updates };
  db.prepare(`
    UPDATE duty_items SET
      zoneId = ?, title = ?, description = ?, category = ?, triggerType = ?, shiftId = ?,
      responsibleRole = ?, requiredPeople = ?, estimatedMinutes = ?,
      startTime = ?, endTime = ?, weekdays = ?,
      isRequired = ?, sopSectionId = ?, sopVideoId = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    merged.zoneId, merged.title, merged.description, merged.category, merged.triggerType,
    merged.shiftId, merged.responsibleRole, merged.requiredPeople, merged.estimatedMinutes,
    normalizeClock(merged.startTime), normalizeClock(merged.endTime), serializeWeekdays(merged.weekdays),
    merged.isRequired ? 1 : 0, merged.sopSectionId, merged.sopVideoId,
    new Date().toISOString(), id
  );
  return getDutyItem(id);
}

/** Disabled, never deleted -- completions point here and must keep resolving. */
export function setDutyItemStatus(id: string, status: 'active' | 'disabled'): DutyItem | null {
  if (!getDutyItem(id)) return null;
  db.prepare('UPDATE duty_items SET status = ?, updatedAt = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
  return getDutyItem(id);
}

export function countDutyCompletions(dutyItemId: string): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM duty_completions WHERE dutyItemId = ?')
    .get(dutyItemId) as { c: number }).c;
}

export function getDutyCompletionsForDate(date: string): DutyCompletion[] {
  return (db.prepare('SELECT * FROM duty_completions WHERE date = ?').all(date) as any[])
    .map(rowToDutyCompletion);
}

/**
 * Records that someone completed a duty. Idempotent: completing the same duty
 * twice on the same day keeps the first record rather than erroring, because a
 * double tap on a phone should not be a failure.
 */
export function completeDuty(input: {
  dutyItemId: string; date: string; shiftId: string;
  completedBy: string; method: 'self' | 'staff'; note: string;
}): DutyCompletion | null {
  if (!getDutyItem(input.dutyItemId)) return null;

  const already = db.prepare(
    'SELECT * FROM duty_completions WHERE dutyItemId = ? AND date = ? AND shiftId = ?'
  ).get(input.dutyItemId, input.date, input.shiftId);
  if (already) return rowToDutyCompletion(already);

  const id = `dc-${randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO duty_completions
      (id, dutyItemId, date, shiftId, completedBy, completedAt, method, note, organizationId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.dutyItemId, input.date, input.shiftId, input.completedBy,
    new Date().toISOString(), input.method, input.note, currentOrganizationId()
  );
  const row = db.prepare('SELECT * FROM duty_completions WHERE id = ?').get(id);
  return row ? rowToDutyCompletion(row) : null;
}

export function uncompleteDuty(dutyItemId: string, date: string, shiftId: string): boolean {
  const result = db.prepare(
    'DELETE FROM duty_completions WHERE dutyItemId = ? AND date = ? AND shiftId = ?'
  ).run(dutyItemId, date, shiftId);
  return result.changes > 0;
}

/**
 * Daily care workload per area, derived from the duty items rather than stored
 * separately -- the same reason the report counts signups instead of reading a
 * counter. A figure that can be derived should not be able to disagree with
 * what it came from.
 *
 * personSlots is how many volunteer places a day of that area needs;
 * personHours is what those places add up to in time.
 */
// Migration: which weekdays a duty runs, and its window as two real times.
//
// Both are correctness fixes rather than conveniences.
//
// Without weekdays every duty counted as daily. The shelter's adoption event
// runs on Saturdays, so registering it made the workload panel report five
// volunteers for eight hours every single day -- 560 of the fortnight's 672
// hours were work nobody was ever going to do, and the roster would have opened
// a shift for it on all fourteen days.
//
// The window was one free-text field ("09:00 - 09:30") that the roster had to
// parse with a regex, so a space or a full-width colon in the wrong place meant
// the duty silently vanished from the schedule with nothing reported.
try {
  db.exec(`ALTER TABLE duty_items ADD COLUMN weekdays TEXT NOT NULL DEFAULT ''`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE duty_items ADD COLUMN startTime TEXT NOT NULL DEFAULT ''`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE duty_items ADD COLUMN endTime TEXT NOT NULL DEFAULT ''`);
} catch { /* column already exists */ }

try {
  const needsSplit = db.prepare(`
    SELECT id, timeWindow FROM duty_items
    WHERE TRIM(COALESCE(timeWindow, '')) <> '' AND TRIM(COALESCE(startTime, '')) = ''
  `).all() as any[];
  if (needsSplit.length > 0) {
    const setTimes = db.prepare('UPDATE duty_items SET startTime = ?, endTime = ? WHERE id = ?');
    let moved = 0;
    for (const row of needsSplit) {
      const m = String(row.timeWindow).match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~–—到至]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
      if (!m) continue;
      const pad = (h: string, mm: string) => `${h.padStart(2, '0')}:${mm}`;
      setTimes.run(pad(m[1], m[2]), pad(m[3], m[4]), row.id);
      moved++;
    }
    if (moved > 0) console.log(`SQLite: 已將 ${moved} 筆勤務的時間範圍拆成起訖兩欄`);
  }
} catch (error: any) {
  console.warn('SQLite: 勤務時間拆欄失敗，維持原樣：', error?.message || error);
}

/**
 * Accepts what a time input sends and stores "HH:MM", or "" for no time.
 *
 * The window used to be one free-text field, so a stray space or a full-width
 * colon made the roster's regex miss the duty entirely with nothing reported.
 */
export function normalizeClock(value: unknown): string {
  const m = String(value || '').trim().match(/^(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!m) return '';
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Taiwan-local day of week for a YYYY-MM-DD. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00+08:00`).getDay();
}

export function dutyRunsOn(weekdays: unknown, date: string): boolean {
  const days = parseWeekdays(weekdays);
  return days.length === 0 || days.includes(weekdayOf(date));
}

export function getZoneWorkload(): Array<{
  zoneId: string; items: number; personSlots: number; personHours: number;
}> {
  // Walked day by day rather than multiplied by fourteen, because a duty that
  // only runs on Saturdays contributes on two of those days and not the other
  // twelve. Multiplying a daily figure was what reported an adoption event as
  // forty hours every day of the week.
  const duties = db.prepare(`
    SELECT zoneId, weekdays, requiredPeople, estimatedMinutes
    FROM duty_items
    WHERE status = 'active' AND triggerType = 'daily'
  `).all() as any[];

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const start = new Date(`${today}T12:00:00+08:00`);
  const dates: string[] = [];
  for (let i = 0; i < 14; i++) {
    dates.push(new Date(start.getTime() + i * 86400000)
      .toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }));
  }

  const byZone = new Map<string, { items: number; slots: number; minutes: number }>();
  for (const duty of duties) {
    const entry = byZone.get(duty.zoneId) || { items: 0, slots: 0, minutes: 0 };
    entry.items += 1;
    const runs = dates.filter(date => dutyRunsOn(duty.weekdays, date)).length;
    const people = Math.max(1, Number(duty.requiredPeople) || 1);
    entry.slots += people * runs;
    entry.minutes += people * (Number(duty.estimatedMinutes) || 0) * runs;
    byZone.set(duty.zoneId, entry);
  }

  return [...byZone.entries()].map(([zoneId, entry]) => ({
    zoneId,
    items: entry.items,
    personSlots: entry.slots,
    personHours: Math.round((entry.minutes / 60) * 10) / 10
  }));
}

// ============================================================================
// Shifts & shift signups
// ----------------------------------------------------------------------------
// These two lived in the browser's localStorage until now, which meant a shift
// published on the coordinator's desktop simply did not exist for a volunteer
// on their phone -- the single biggest correctness gap in a scheduling system.
// Moving them here makes the server the one source of truth, matching how
// volunteers / attendance / SOP content already work.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    zone TEXT NOT NULL,
    date TEXT NOT NULL,
    timeRange TEXT NOT NULL,
    shiftType TEXT NOT NULL,
    requiredCount INTEGER NOT NULL,
    skillRequired TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tasks TEXT NOT NULL DEFAULT '[]',
    locationDetails TEXT NOT NULL DEFAULT '',
    attachmentUrl TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL
  )
`);

// Migration: volunteer_applications -> shift_signups.
//
// This table records "X signed up for shift Y". The StrayHub CRM has a table of
// its own called volunteer_applications, and there it means "X applied to
// become a volunteer at this shelter" -- an approval that grants access, valid
// for a fixed period. Two tables, the same name, opposite meanings, about to
// exchange data with each other. Renaming ours is much cheaper now than
// untangling a mix-up later.
//
// Runs before the CREATE below: the other order would leave CREATE IF NOT
// EXISTS making an empty shift_signups, and the rename would then fail with
// every real signup still stranded in the old table.
{
  const tableNames = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('volunteer_applications', 'shift_signups')`)
    .all()
    .map((row: any) => row.name);
  if (tableNames.includes('volunteer_applications') && !tableNames.includes('shift_signups')) {
    db.exec('ALTER TABLE volunteer_applications RENAME TO shift_signups');
    console.log('SQLite: volunteer_applications 已更名為 shift_signups');
  }
}

// Migration: drop shifts.currentCount.
//
// It was a stored counter kept in step by hand -- incremented on signup,
// decremented on withdrawal -- and it had drifted badly: five of the seven
// shifts on the deployed database disagreed with their own signups, and one
// read "full" while still needing three people, which tells volunteers not to
// sign up for a shift that is short-staffed.
//
// The count is derived now (see HEADCOUNT_SQL), so the column has no readers.
// Removing it rather than leaving it is the point: a stale column that still
// looks authoritative is exactly how the next person reintroduces the bug.
try {
  db.exec('ALTER TABLE shifts DROP COLUMN currentCount');
  console.log('SQLite: 已移除 shifts.currentCount（改為從報名紀錄推導）');
} catch {
  // already dropped, or a fresh database that never had it
}

// Migration: no stored 'full'.
//
// 'full' is worked out from the headcount on the way out (shiftStatusFrom), so
// it should never be a value in this column. insertShift normalises it now, but
// that normalisation was added later than the seed data -- and INITIAL_SHIFTS
// carries a shift marked 'full' -- so databases seeded before it kept the
// stored copy.
//
// It causes no wrong answer today, because the derived value is what callers
// see. It is cleaned up because it is the same shape as the currentCount bug:
// a derived value written down, sitting there looking authoritative until
// somebody trusts it.
try {
  const stale = db.prepare(
    "SELECT COUNT(*) AS c FROM shifts WHERE status NOT IN ('active', 'cancelled', 'draft')"
  ).get() as { c: number };
  if (stale.c > 0) {
    db.exec("UPDATE shifts SET status = 'active' WHERE status NOT IN ('active', 'cancelled', 'draft')");
    console.log(`SQLite: 已將 ${stale.c} 筆班次的儲存狀態正規化（full 應為推導值，不該存檔）`);
  }
} catch {
  // fresh database -- the shifts table is created above, so this cannot fail
  // for a missing table, but a locked one should not stop the server booting
}

db.exec(`
  CREATE TABLE IF NOT EXISTS shift_signups (
    id TEXT PRIMARY KEY,
    shiftId TEXT NOT NULL,
    volunteerName TEXT NOT NULL,
    volunteerEmail TEXT NOT NULL DEFAULT '',
    volunteerPhone TEXT NOT NULL DEFAULT '',
    lineId TEXT NOT NULL DEFAULT '',
    experienceLevel TEXT NOT NULL DEFAULT 'beginner',
    appliedZone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    appliedAt TEXT NOT NULL,
    notes TEXT,
    reviewNotes TEXT,
    reviewedAt TEXT,
    syncToCalendar INTEGER NOT NULL DEFAULT 1,
    syncToLine INTEGER NOT NULL DEFAULT 1,
    situationalQuestion TEXT,
    situationalAnswer TEXT,
    aiReadinessAssessment TEXT
  )
`);

/**
 * Substitution requests: "I cannot make my shift, please could someone take it."
 *
 * The rulebook promises volunteers this route -- raise a request at least 24
 * hours before the shift -- and there was nowhere to raise one. The only way
 * out of a booking was to cancel it, which deleted the row, so the shelter lost
 * both the place and any record that the person had tried to do the right
 * thing.
 *
 * The request is a record in its own right rather than a flag on the signup,
 * because it outlives the signup it came from: once somebody takes it, the
 * original booking becomes 'substituted' and a new one appears under the
 * substitute, and the trail from one to the other is the thing a coordinator
 * needs when they are looking at who was actually meant to be there.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS substitution_requests (
    id TEXT PRIMARY KEY,
    signupId TEXT NOT NULL,
    shiftId TEXT NOT NULL,
    requesterEmail TEXT NOT NULL DEFAULT '',
    requesterName TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    raisedLate INTEGER NOT NULL DEFAULT 0,
    createdAtUtc TEXT NOT NULL,
    takenByEmail TEXT,
    takenByName TEXT,
    takenAtUtc TEXT,
    closedAtUtc TEXT
  )
`);

// One live request per booking. Without this, a double-click or two tabs open
// produces two open requests for the same place, and two volunteers can each
// believe they have covered it. Partial index, so the closed ones -- which are
// history and may pile up for the same signup -- are unaffected.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS substitution_one_open_per_signup
  ON substitution_requests(signupId) WHERE status = 'open'
`);

/**
 * How many places a shift is currently holding.
 *
 * Occupying means everything except a place nobody is standing in: pending is
 * a place the coordinator is still considering, approved is a place counted on,
 * attended is a place that was used. Turned down, no-show, cancelled and handed
 * to a substitute are all places that are free again -- and the last two matter
 * especially, because a cancelled booking now stays in the table instead of
 * being deleted, and a handed-over one is counted under the person who took it.
 * Leave either of them in and every substitution would silently fill a shift
 * twice.
 */
const HEADCOUNT_SQL = `(
  SELECT COUNT(*) FROM shift_signups g
  WHERE g.shiftId = shifts.id
    AND g.status NOT IN ('rejected', 'absent', 'cancelled', 'substituted')
)`;

/**
 * Whether the shift is full, open, or called off.
 *
 * Cancelled is a decision somebody made and is stored. Full and active are not
 * decisions -- they are what the numbers say -- so they are worked out here
 * rather than written down and hoped to stay true.
 */
function shiftStatusFrom(row: any, headcount: number): PositionShift['status'] {
  if (row.status === 'cancelled') return 'cancelled';
  // A draft has not been published, so "full" is not a question that applies to
  // it yet -- and reporting it as active is what would leak it to volunteers.
  if (row.status === 'draft') return 'draft';
  return headcount >= row.requiredCount ? 'full' : 'active';
}

function rowToShift(row: any): PositionShift {
  // Queries that select from `shifts` get headcount computed alongside; the few
  // that do not fall back to zero rather than to a stale stored number.
  const headcount = typeof row.headcount === 'number' ? row.headcount : 0;
  return {
    id: row.id,
    title: row.title,
    zone: row.zone,
    date: row.date,
    timeRange: row.timeRange,
    shiftType: row.shiftType,
    requiredCount: row.requiredCount,
    currentCount: headcount,
    skillRequired: row.skillRequired,
    description: row.description,
    tasks: JSON.parse(row.tasks),
    locationDetails: row.locationDetails,
    attachmentUrl: row.attachmentUrl || undefined,
    status: shiftStatusFrom(row, headcount),
    createdAt: row.createdAt
  };
}

function rowToShiftSignup(row: any): ShiftSignup {
  return {
    id: row.id,
    shiftId: row.shiftId,
    volunteerName: row.volunteerName,
    volunteerEmail: row.volunteerEmail,
    volunteerPhone: row.volunteerPhone,
    lineId: row.lineId,
    experienceLevel: row.experienceLevel,
    appliedZone: row.appliedZone,
    status: row.status,
    appliedAt: row.appliedAt,
    notes: row.notes || undefined,
    reviewNotes: row.reviewNotes || undefined,
    reviewedAt: row.reviewedAt || undefined,
    reviewedBy: row.reviewedBy || undefined,
    reviewedAtUtc: row.reviewedAtUtc || undefined,
    syncToCalendar: !!row.syncToCalendar,
    syncToLine: !!row.syncToLine,
    situationalQuestion: row.situationalQuestion || undefined,
    situationalAnswer: row.situationalAnswer || undefined,
    aiReadinessAssessment: row.aiReadinessAssessment ? JSON.parse(row.aiReadinessAssessment) : undefined
  };
}

export function getAllShifts(): PositionShift[] {
  const rows = db.prepare(`SELECT *, ${HEADCOUNT_SQL} AS headcount FROM shifts ORDER BY date ASC, timeRange ASC`).all();
  return rows.map(rowToShift);
}

export function insertShift(s: PositionShift): PositionShift {
  db.prepare(`
    INSERT INTO shifts (id, title, zone, date, timeRange, shiftType, requiredCount, skillRequired, description, tasks, locationDetails, attachmentUrl, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    s.id, s.title, s.zone, s.date, s.timeRange, s.shiftType, s.requiredCount,
    s.skillRequired, s.description, JSON.stringify(s.tasks), s.locationDetails,
    s.attachmentUrl || null, storableShiftStatus(s.status), s.createdAt
  );
  return getShift(s.id) || s;
}

export function updateShift(s: PositionShift): PositionShift | null {
  const existing = db.prepare('SELECT id FROM shifts WHERE id = ?').get(s.id);
  if (!existing) return null;
  db.prepare(`
    UPDATE shifts SET title = ?, zone = ?, date = ?, timeRange = ?, shiftType = ?, requiredCount = ?,
      skillRequired = ?, description = ?, tasks = ?, locationDetails = ?,
      attachmentUrl = ?, status = ? WHERE id = ?
  `).run(
    s.title, s.zone, s.date, s.timeRange, s.shiftType, s.requiredCount,
    s.skillRequired, s.description, JSON.stringify(s.tasks), s.locationDetails,
    s.attachmentUrl || null, storableShiftStatus(s.status), s.id
  );
  const row = db.prepare(`SELECT *, ${HEADCOUNT_SQL} AS headcount FROM shifts WHERE id = ?`).get(s.id);
  return row ? rowToShift(row) : null;
}

// Deleting a shift takes its signups with it -- a signup pointing at
// a shift that no longer exists would surface as a blank row in the review queue.
export function deleteShift(id: string): boolean {
  const existing = db.prepare('SELECT id FROM shifts WHERE id = ?').get(id);
  if (!existing) return false;
  db.prepare('DELETE FROM shift_signups WHERE shiftId = ?').run(id);
  db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
  return true;
}

// Adjusts a shift's filled headcount, clamped so it can never fall below zero,
// and keeps the active/full status in step with it.
/**
 * Returns a shift as it now stands.
 *
 * This replaces adjustShiftCount, which used to add or subtract one from a
 * stored counter whenever a signup appeared or went away. That counter drifted:
 * on the deployed database five of seven shifts disagreed with their own
 * signups, and one showed "full" while needing three more people -- which tells
 * volunteers not to sign up for a shift that is short-staffed.
 *
 * Nothing needs adjusting now. The count is read from the signups, so callers
 * that used to nudge it just ask for the shift again.
 */
export function getShift(shiftId: string): PositionShift | null {
  const row = db.prepare(`SELECT *, ${HEADCOUNT_SQL} AS headcount FROM shifts WHERE id = ?`).get(shiftId);
  return row ? rowToShift(row) : null;
}

/**
 * The three states a shift is actually stored in.
 *
 * 'full' never reaches the database -- it is worked out from the headcount on
 * the way out (see shiftStatusFrom), and writing it down would be the same
 * stored-vs-derived mistake that currentCount was.
 */
function storableShiftStatus(status: unknown): 'active' | 'cancelled' | 'draft' {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'draft') return 'draft';
  return 'active';
}

// ============================================================================
// Generating a period's draft roster from the shelter's care workload
// ----------------------------------------------------------------------------
// The plan calls this the main source of relief: instead of filling in a form
// per shift per day, the coordinator states each zone's daily care work once,
// and a fortnight of shifts falls out of it.
//
// The duty items already carry everything needed -- which zone, what time
// window, how many people -- so they are the single input. Shift templates are
// deliberately not consulted: two sources for the same number eventually
// disagree, and nothing reports it when they do.
// ============================================================================

/** Duty windows this far apart or closer become one shift. */
export const SHIFT_MERGE_GAP_MINUTES = 60;

/** "09:30 - 11:30" -> [570, 690]. Returns null for anything unparseable. */
function parseWindow(window: string): [number, number] | null {
  const match = String(window || '').match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~–—到至]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  if (!(end > start)) return null;
  return [start, end];
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * How many people the shelter needs on site at the busiest moment of a block.
 *
 * Not the sum. Three duties of one person each, run one after another, need one
 * volunteer for three hours -- summing would open a shift for three people and
 * report a shortage of two that does not exist. Two duties that overlap do need
 * two people, and a sweep over the window boundaries is what tells them apart.
 */
function peakConcurrent(items: Array<{ start: number; end: number; people: number }>): number {
  const edges: Array<[number, number]> = [];
  for (const item of items) {
    edges.push([item.start, item.people]);
    edges.push([item.end, -item.people]);
  }
  // Ends before starts at the same instant: a duty finishing at 11:30 frees its
  // volunteer for one starting at 11:30.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let running = 0;
  let peak = 0;
  for (const [, delta] of edges) {
    running += delta;
    if (running > peak) peak = running;
  }
  return Math.max(1, peak);
}

export interface PlannedShift {
  zoneId: string;
  zoneName: string;
  date: string;
  timeRange: string;
  requiredCount: number;
  tasks: string[];
  /** Person-hours the duties in this block actually add up to. */
  personHours: number;
}

/**
 * What a period's roster would look like, without writing anything.
 *
 * Split out from the write so the same rule produces both the preview and the
 * saved drafts -- a preview computed separately is a preview that can disagree
 * with what you get.
 */
export function planShiftsForRange(startDate: string, days: number): PlannedShift[] {
  const zones = getActiveZones();
  const duties = db.prepare(`
    SELECT zoneId, title, startTime, endTime, weekdays, requiredPeople, estimatedMinutes
    FROM duty_items
    WHERE status = 'active' AND triggerType = 'daily'
  `).all() as any[];

  const byZone = new Map<string, Array<{
    start: number; end: number; people: number; title: string; minutes: number; weekdays: string;
  }>>();
  for (const duty of duties) {
    const window = parseWindow(`${duty.startTime}-${duty.endTime}`);
    if (!window) continue; // no usable times -- nothing to schedule it into
    const list = byZone.get(duty.zoneId) || [];
    list.push({
      start: window[0], end: window[1],
      people: Math.max(1, Number(duty.requiredPeople) || 1),
      title: duty.title,
      minutes: Math.max(0, Number(duty.estimatedMinutes) || 0),
      weekdays: String(duty.weekdays || '')
    });
    byZone.set(duty.zoneId, list);
  }

  const planned: PlannedShift[] = [];
  const start = new Date(`${startDate}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) return planned;

  for (let day = 0; day < days; day++) {
    const date = new Date(start.getTime() + day * 86400000)
      .toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

    for (const zone of zones) {
      // Only the duties that actually run on this weekday. Without this the
      // Saturday adoption event would open a shift on all fourteen days.
      const items = (byZone.get(zone.id) || [])
        .filter(item => dutyRunsOn(item.weekdays, date))
        .slice()
        .sort((a, b) => a.start - b.start);
      if (items.length === 0) continue;

      // Merge into blocks. A short gap stays inside one shift: a volunteer who
      // is already on site does not go home for thirty minutes and come back.
      let block: typeof items = [];
      let blockEnd = -1;
      const flush = () => {
        if (block.length === 0) return;
        const from = Math.min(...block.map(i => i.start));
        const to = Math.max(...block.map(i => i.end));
        planned.push({
          zoneId: zone.id,
          zoneName: zone.name,
          date,
          timeRange: `${hhmm(from)}-${hhmm(to)}`,
          requiredCount: peakConcurrent(block),
          tasks: block.map(i => i.title),
          personHours: Math.round(block.reduce((n, i) => n + i.people * i.minutes, 0) / 6) / 10
        });
        block = [];
      };

      for (const item of items) {
        if (block.length > 0 && item.start - blockEnd > SHIFT_MERGE_GAP_MINUTES) flush();
        block.push(item);
        blockEnd = Math.max(blockEnd, item.end);
      }
      flush();
    }
  }
  return planned;
}

/**
 * Writes the plan as drafts, and says what it did.
 *
 * Only ever inserts. An existing shift at the same zone, date and start time is
 * left exactly as it is -- published or not, booked or not -- because the
 * coordinator may have adjusted it, and regenerating a period should never be
 * able to undo that or to double-book a day.
 */
export function generateDraftShifts(startDate: string, days: number): {
  created: PlannedShift[]; skipped: PlannedShift[];
} {
  const created: PlannedShift[] = [];
  const skipped: PlannedShift[] = [];

  for (const plan of planShiftsForRange(startDate, days)) {
    const id = `auto-${plan.zoneId}-${plan.date}-${plan.timeRange.slice(0, 5).replace(':', '')}`;
    const clash = db.prepare(
      'SELECT id FROM shifts WHERE id = ? OR (zone = ? AND date = ? AND timeRange = ?)'
    ).get(id, plan.zoneId, plan.date, plan.timeRange);
    if (clash) { skipped.push(plan); continue; }

    insertShift({
      id,
      title: `${plan.zoneName}日常照護`,
      zone: plan.zoneId as any,
      date: plan.date,
      timeRange: plan.timeRange,
      shiftType: 'regular' as any,
      requiredCount: plan.requiredCount,
      skillRequired: '' as any,
      description: `依「${plan.zoneName}」的每日勤務項目自動產生，發布前可調整。`,
      tasks: plan.tasks,
      locationDetails: '',
      status: 'draft',
      createdAt: new Date().toISOString()
    } as any);
    created.push(plan);
  }
  return { created, skipped };
}

/** Publishes every draft in a date range. Returns how many went live. */
export function publishDraftShifts(startDate: string, endDate: string): number {
  const result = db.prepare(
    "UPDATE shifts SET status = 'active' WHERE status = 'draft' AND date >= ? AND date <= ?"
  ).run(startDate, endDate);
  return Number(result.changes || 0);
}

/** Throws away unpublished drafts in a range, so a period can be regenerated. */
export function discardDraftShifts(startDate: string, endDate: string): number {
  const result = db.prepare(
    "DELETE FROM shifts WHERE status = 'draft' AND date >= ? AND date <= ?"
  ).run(startDate, endDate);
  return Number(result.changes || 0);
}

export function getAllShiftSignups(): ShiftSignup[] {
  const rows = db.prepare('SELECT * FROM shift_signups ORDER BY appliedAt DESC').all();
  return rows.map(rowToShiftSignup);
}

export function insertShiftSignup(a: ShiftSignup): ShiftSignup {
  db.prepare(`
    INSERT INTO shift_signups (id, shiftId, volunteerName, volunteerEmail, volunteerPhone, lineId, experienceLevel, appliedZone, status, appliedAt, notes, reviewNotes, reviewedAt, syncToCalendar, syncToLine, situationalQuestion, situationalAnswer, aiReadinessAssessment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    a.id, a.shiftId, a.volunteerName, (a.volunteerEmail || '').trim().toLowerCase(), a.volunteerPhone || '', a.lineId || '',
    a.experienceLevel, a.appliedZone, a.status, a.appliedAt, a.notes || null, a.reviewNotes || null,
    a.reviewedAt || null, a.syncToCalendar ? 1 : 0, a.syncToLine ? 1 : 0,
    a.situationalQuestion || null, a.situationalAnswer || null,
    a.aiReadinessAssessment ? JSON.stringify(a.aiReadinessAssessment) : null
  );
  return a;
}

// Applications used to store whatever the sign-up form put in the email field,
// verbatim. A leading space or a capital letter was enough to stop the owner
// from being recognised as the owner, so cancelling their own booking came back
// 403 -- and the page, which re-fetched afterwards, simply put the row back.
// Normalise the existing rows once so old bookings behave like new ones.
db.exec("UPDATE shift_signups SET volunteerEmail = LOWER(TRIM(volunteerEmail)) WHERE volunteerEmail <> LOWER(TRIM(volunteerEmail))");

export function updateShiftSignupStatus(
  id: string,
  status: string,
  reviewNotes?: string,
  reviewedBy = ''
): ShiftSignup | null {
  const existing = db.prepare('SELECT id FROM shift_signups WHERE id = ?').get(id);
  if (!existing) return null;
  const now = new Date();
  db.prepare(`
    UPDATE shift_signups
    SET status = ?, reviewNotes = ?, reviewedAt = ?, reviewedBy = ?, reviewedAtUtc = ?
    WHERE id = ?
  `).run(
    status, reviewNotes || null,
    now.toLocaleString('zh-TW', { hour12: false }),
    reviewedBy, now.toISOString(), id
  );
  const row = db.prepare('SELECT * FROM shift_signups WHERE id = ?').get(id);
  return row ? rowToShiftSignup(row) : null;
}

// Migration: who decided a signup's outcome, and when, unambiguously.
//
// reviewedAt held a localised string ("2026/8/25 下午3:20:14") with no timezone
// and no author. That was tolerable while the field only recorded an approval.
// It is not tolerable now: marking someone absent is the first step of a rule
// that ends in losing their place at the shelter, so the record has to say who
// made the call and at what instant -- the same reason attendance keeps a UTC
// column beside its readable one.
try {
  db.exec(`ALTER TABLE shift_signups ADD COLUMN reviewedBy TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
try {
  db.exec(`ALTER TABLE shift_signups ADD COLUMN reviewedAtUtc TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}

/**
 * The day's roll call: who was expected, and who actually arrived.
 *
 * The shelter's rulebook says a volunteer who fails to appear twice loses their
 * booking rights for thirty days. Nothing had ever set the 'absent' status, so
 * that count was always zero and the rule could not be applied to anybody.
 *
 * This deliberately reports rather than decides. A missing attendance row is
 * evidence someone did not check in, which is not the same as evidence they did
 * not come -- phones lose signal inside kennel buildings, and people forget. A
 * coordinator confirms; the system only says who to look at. Getting that wrong
 * costs an unpaid volunteer their place, which is worth a click to avoid.
 */
export function getRollCall(date: string): Array<{
  shiftId: string;
  shiftTitle: string;
  zoneId: string;
  timeRange: string;
  expected: Array<{
    signupId: string;
    volunteerName: string;
    volunteerEmail: string;
    status: string;
    checkedIn: boolean;
    checkInTime?: string;
    reviewedBy?: string;
    /**
     * Set when this person asked for a substitute and nobody took it.
     *
     * Someone who gave notice and could not find cover is not in the same
     * position as someone who simply did not appear, and the coordinator
     * deciding whether to record an absence is the one who needs to know that.
     */
    unfilledRequest?: { reason: string; raisedLate: boolean; createdAtUtc: string };
  }>;
}> {
  const shifts = db
    .prepare('SELECT * FROM shifts WHERE date = ? ORDER BY timeRange')
    .all(date) as any[];

  const requests = getSubstitutionsByDate(date);

  return shifts.map(shift => {
    // Everyone still holding a place when the shift came round: approved is the
    // commitment, attended and absent are outcomes already recorded. Pending is
    // excluded -- nobody promised them a place, so they cannot have missed it.
    const signups = db.prepare(`
      SELECT * FROM shift_signups
      WHERE shiftId = ? AND status IN ('approved', 'attended', 'absent')
      ORDER BY volunteerName
    `).all(shift.id) as any[];

    const attendance = db.prepare(
      'SELECT volunteerName, checkInTime FROM attendance_records WHERE shiftId = ? AND date = ?'
    ).all(shift.id, date) as any[];
    const arrived = new Map(attendance.map(record => [record.volunteerName, record.checkInTime]));

    return {
      shiftId: shift.id,
      shiftTitle: shift.title,
      zoneId: shift.zone,
      timeRange: shift.timeRange,
      expected: signups.map(signup => {
        // Only a request still open counts as unfilled: a taken one has already
        // moved this place to somebody else, and this row would be theirs.
        const request = requests.get(signup.id);
        return {
          signupId: signup.id,
          volunteerName: signup.volunteerName,
          volunteerEmail: signup.volunteerEmail || '',
          status: signup.status,
          checkedIn: arrived.has(signup.volunteerName),
          checkInTime: arrived.get(signup.volunteerName) || undefined,
          reviewedBy: signup.reviewedBy || undefined,
          unfilledRequest: request && (request.status === 'open' || request.status === 'expired')
            ? {
                reason: request.reason,
                raisedLate: request.raisedLate,
                createdAtUtc: request.createdAtUtc
              }
            : undefined
        };
      })
    };
  });
}

/**
 * How many shifts a volunteer has been recorded as missing.
 *
 * Counted from the signups rather than stored on the volunteer, for the same
 * reason a shift's headcount is: a tally kept alongside the thing it counts
 * eventually disagrees with it, and nothing reports that it has.
 */
/**
 * Absences that count toward the rulebook's threshold.
 *
 * Only the ones since the volunteer's count was last reset -- which happens
 * when a suspension is lifted, whether by a coordinator or by the thirty days
 * running out. The older absences are still in the table and still visible in
 * the record; they have simply been answered for.
 *
 * Counted from the signups rather than stored on the volunteer, for the same
 * reason a shift's headcount is: a tally kept alongside the thing it counts
 * eventually disagrees with it, and nothing reports that it has.
 */
export function getAbsenceCounts(): Map<string, number> {
  const rows = db.prepare(`
    SELECT g.volunteerEmail, COUNT(*) AS c
    FROM shift_signups g
    LEFT JOIN volunteers v ON LOWER(TRIM(v.email)) = LOWER(TRIM(g.volunteerEmail))
    WHERE g.status = 'absent'
      AND TRIM(COALESCE(g.volunteerEmail, '')) <> ''
      AND (
        COALESCE(v.absencesResetAt, '') = ''
        OR COALESCE(g.reviewedAtUtc, '') = ''
        OR g.reviewedAtUtc > v.absencesResetAt
      )
    GROUP BY g.volunteerEmail
  `).all() as any[];
  return new Map(rows.map(row => [String(row.volunteerEmail).toLowerCase(), row.c]));
}

/**
 * Cancelling a booking keeps the row.
 *
 * This used to be a DELETE. The place came free, which was the point, but the
 * fact that somebody had booked it and dropped out left no trace -- so the
 * rulebook's other promise, that cancelling three times in a month costs a
 * volunteer their booking rights, had nothing to count and could never be
 * applied. It also meant a coordinator looking at a thin shift could not tell
 * "nobody ever signed up" from "four people signed up and all pulled out".
 *
 * The place is freed by the status, not by the row's absence: HEADCOUNT_SQL
 * excludes 'cancelled', so the shift reopens exactly as it did before.
 */
export function cancelShiftSignup(id: string, cancelledBy = ''): ShiftSignup | null {
  const row = db.prepare('SELECT * FROM shift_signups WHERE id = ?').get(id);
  if (!row) return null;
  const now = new Date();
  db.prepare(`
    UPDATE shift_signups
    SET status = 'cancelled', reviewedAt = ?, reviewedBy = ?, reviewedAtUtc = ?
    WHERE id = ?
  `).run(now.toLocaleString('zh-TW', { hour12: false }), cancelledBy, now.toISOString(), id);

  // A booking that is gone cannot still be asking for a substitute.
  db.prepare(`
    UPDATE substitution_requests
    SET status = 'withdrawn', closedAtUtc = ?
    WHERE signupId = ? AND status = 'open'
  `).run(now.toISOString(), id);

  const updated = db.prepare('SELECT * FROM shift_signups WHERE id = ?').get(id);
  return updated ? rowToShiftSignup(updated) : null;
}

// ============================================================================
// Substitution requests
// ============================================================================

/** How much notice the rulebook asks for before a shift. */
export const SUBSTITUTION_NOTICE_HOURS = 24;

/**
 * Hours between now and the moment a shift starts.
 *
 * Shifts store a Taiwan-local date and a "09:00-11:00" range with no timezone,
 * because that is how the shelter writes them on the wall. Taiwan has had no
 * daylight saving since 1979, so pinning +08:00 turns that back into a real
 * instant without pulling in a timezone library. Returns null when the shift is
 * missing or its time cannot be read, and every caller treats null as "cannot
 * tell" rather than guessing.
 */
export function hoursUntilShift(shiftId: string): number | null {
  const row = db.prepare('SELECT date, timeRange FROM shifts WHERE id = ?').get(shiftId) as any;
  if (!row) return null;
  const start = String(row.timeRange || '').split('-')[0].trim();
  if (!/^\d{1,2}:\d{2}$/.test(start)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ''))) return null;
  const startsAt = new Date(`${row.date}T${start.padStart(5, '0')}:00+08:00`);
  if (Number.isNaN(startsAt.getTime())) return null;
  return (startsAt.getTime() - Date.now()) / 3_600_000;
}

function rowToSubstitution(row: any): SubstitutionRequest {
  return {
    id: row.id,
    signupId: row.signupId,
    shiftId: row.shiftId,
    requesterEmail: row.requesterEmail || '',
    requesterName: row.requesterName || '',
    reason: row.reason || '',
    status: row.status,
    raisedLate: !!row.raisedLate,
    createdAtUtc: row.createdAtUtc,
    takenByEmail: row.takenByEmail || undefined,
    takenByName: row.takenByName || undefined,
    takenAtUtc: row.takenAtUtc || undefined,
    closedAtUtc: row.closedAtUtc || undefined
  };
}

export function getSubstitutionRequest(id: string): SubstitutionRequest | null {
  const row = db.prepare('SELECT * FROM substitution_requests WHERE id = ?').get(id);
  return row ? rowToSubstitution(row) : null;
}

export function getOpenSubstitutionForSignup(signupId: string): SubstitutionRequest | null {
  const row = db
    .prepare("SELECT * FROM substitution_requests WHERE signupId = ? AND status = 'open'")
    .get(signupId);
  return row ? rowToSubstitution(row) : null;
}

/** Every request still waiting for somebody, newest first. */
export function getOpenSubstitutions(): SubstitutionRequest[] {
  const rows = db
    .prepare("SELECT * FROM substitution_requests WHERE status = 'open' ORDER BY createdAtUtc DESC")
    .all() as any[];
  return rows.map(rowToSubstitution);
}

/** Every request attached to a given day's shifts, keyed by the signup it came from. */
export function getSubstitutionsByDate(date: string): Map<string, SubstitutionRequest> {
  const rows = db.prepare(`
    SELECT r.* FROM substitution_requests r
    JOIN shifts s ON s.id = r.shiftId
    WHERE s.date = ?
  `).all(date) as any[];
  return new Map(rows.map(row => [row.signupId, rowToSubstitution(row)]));
}

export function createSubstitutionRequest(input: {
  signupId: string;
  shiftId: string;
  requesterEmail: string;
  requesterName: string;
  reason?: string;
}): SubstitutionRequest {
  const hours = hoursUntilShift(input.shiftId);
  // Recorded, not enforced. Refusing a late request would leave the volunteer
  // with no route except silence, and a shift nobody has been warned about is
  // worse for the animals than a late warning.
  const raisedLate = hours !== null && hours < SUBSTITUTION_NOTICE_HOURS;
  const id = randomUUID();
  db.prepare(`
    INSERT INTO substitution_requests
      (id, signupId, shiftId, requesterEmail, requesterName, reason, status, raisedLate, createdAtUtc)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    id, input.signupId, input.shiftId,
    input.requesterEmail.trim().toLowerCase(), input.requesterName,
    input.reason || '', raisedLate ? 1 : 0, new Date().toISOString()
  );
  return getSubstitutionRequest(id)!;
}

export function withdrawSubstitutionRequest(id: string): SubstitutionRequest | null {
  const existing = getSubstitutionRequest(id);
  if (!existing || existing.status !== 'open') return null;
  db.prepare("UPDATE substitution_requests SET status = 'withdrawn', closedAtUtc = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  return getSubstitutionRequest(id);
}

/**
 * Hand a booking over to whoever offered to cover it.
 *
 * Three writes that have to happen together: the request closes, the original
 * booking steps aside, and the substitute gets a place of their own. Half of
 * this applied would either leave two people holding one place or leave the
 * shift a person short with nobody aware of it, so it runs in a transaction.
 *
 * The original signup is kept as 'substituted' rather than edited to name the
 * new person, because on the day it matters who was expected and who actually
 * came -- and because the requester should not later look like they simply
 * never turned up.
 */
export function takeSubstitutionRequest(
  id: string,
  taker: { email: string; name: string; phone?: string; lineId?: string }
): { request: SubstitutionRequest; signup: ShiftSignup } | { error: string } {
  const request = getSubstitutionRequest(id);
  if (!request) return { error: '找不到這筆代班請求' };
  if (request.status !== 'open') {
    return { error: request.status === 'taken' ? '這個班已經有人接手了' : '這筆代班請求已經結束' };
  }

  const email = taker.email.trim().toLowerCase();
  if (email && email === request.requesterEmail) {
    return { error: '不能接手自己發起的代班請求' };
  }

  const original = db.prepare('SELECT * FROM shift_signups WHERE id = ?').get(request.signupId) as any;
  if (!original) return { error: '原本的報名紀錄已不存在' };

  // Somebody already on this shift cannot cover it as well -- they would be
  // counted twice and the shift would look staffed when it is not.
  const clash = db.prepare(`
    SELECT id FROM shift_signups
    WHERE shiftId = ? AND LOWER(TRIM(volunteerEmail)) = ?
      AND status NOT IN ('rejected', 'cancelled', 'substituted', 'absent')
  `).get(request.shiftId, email);
  if (clash) return { error: '您已經報名這個班次了' };

  const now = new Date().toISOString();
  const newSignupId = randomUUID();

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE substitution_requests
      SET status = 'taken', takenByEmail = ?, takenByName = ?, takenAtUtc = ?, closedAtUtc = ?
      WHERE id = ?
    `).run(email, taker.name, now, now, id);

    db.prepare(`
      UPDATE shift_signups
      SET status = 'substituted', reviewedAt = ?, reviewedBy = ?, reviewedAtUtc = ?
      WHERE id = ?
    `).run(
      new Date().toLocaleString('zh-TW', { hour12: false }),
      `代班：${taker.name}`, now, request.signupId
    );

    db.prepare(`
      INSERT INTO shift_signups
        (id, shiftId, volunteerName, volunteerEmail, volunteerPhone, lineId, experienceLevel,
         appliedZone, status, appliedAt, notes, reviewNotes, reviewedAt, syncToCalendar, syncToLine,
         situationalQuestion, situationalAnswer, aiReadinessAssessment, reviewedBy, reviewedAtUtc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, 1, 1, NULL, NULL, NULL, ?, ?)
    `).run(
      newSignupId, request.shiftId, taker.name, email, taker.phone || '', taker.lineId || '',
      original.experienceLevel, original.appliedZone, now,
      `代 ${request.requesterName} 的班`, '代班接手，自動錄取',
      new Date().toLocaleString('zh-TW', { hour12: false }),
      '系統（代班接手）', now
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const signup = db.prepare('SELECT * FROM shift_signups WHERE id = ?').get(newSignupId);
  return { request: getSubstitutionRequest(id)!, signup: rowToShiftSignup(signup) };
}

/**
 * Close requests for shifts that have already happened.
 *
 * An open request for last Tuesday is not a request any more, it is a record
 * that nobody came forward. Leaving it open would keep offering volunteers a
 * shift they cannot take, and would make the roll call read as though the
 * matter were still unresolved.
 */
export function expireStaleSubstitutions(): number {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const result = db.prepare(`
    UPDATE substitution_requests
    SET status = 'expired', closedAtUtc = ?
    WHERE status = 'open'
      AND shiftId IN (SELECT id FROM shifts WHERE date < ?)
  `).run(new Date().toISOString(), today);
  return Number(result.changes || 0);
}

// Seeded from the original mock data on first run only, same pattern as the
// volunteers and attendance tables. Placed after the insert helpers so they're
// defined by the time this runs.
const shiftSeedCount = db.prepare('SELECT COUNT(*) AS c FROM shifts').get() as { c: number };
if (shiftSeedCount.c === 0) {
  for (const s of INITIAL_SHIFTS) insertShift(s);
}
const signupSeedCount = db.prepare('SELECT COUNT(*) AS c FROM shift_signups').get() as { c: number };
if (signupSeedCount.c === 0) {
  for (const a of INITIAL_SHIFT_SIGNUPS) insertShiftSignup(a);
}

// ============================================================================
// Authentication: admin accounts + server-side sessions
// ----------------------------------------------------------------------------
// Until now "auth" was decorative: the admin password was compared in the
// browser, the signed-in role lived only in localStorage, and every
// /api/admin/* endpoint answered anyone who knew the URL. Anybody could edit
// the rulebook, delete volunteers or approve promotions straight from a
// console. These two tables make the server the authority instead.
//
// Passwords are stored as scrypt hashes with a per-account salt -- never in
// clear text, and never reversible -- using only node:crypto so this adds no
// dependency to a 1GB VM that has OOM-ed during npm install before.
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    username TEXT PRIMARY KEY,
    passwordSalt TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    roleTitle TEXT NOT NULL DEFAULT '系統管理員',
    email TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    identity TEXT NOT NULL,
    displayName TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  )
`);

export function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const useSalt = salt || randomBytes(16).toString('hex');
  const hash = scryptSync(password, useSalt, 64).toString('hex');
  return { salt: useSalt, hash };
}

/** Constant-time comparison so a wrong password can't be found by timing. */
function passwordMatches(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// The administrator account.
//
// There is deliberately no default password any more. This used to seed "0000",
// which meant every copy of this project that never changed it -- including any
// that ended up reachable from the internet -- had a four-digit admin login that
// was written down in the repository.
//
// ADMIN_PASSWORD sets it. With nothing set, a strong random one is generated and
// printed to the server log once, so a fresh clone still works out of the box
// without shipping a credential that everyone already knows.
function seedOrRepairAdmin(): void {
  const envPassword = (process.env.ADMIN_PASSWORD || '').trim();
  const existing = db.prepare('SELECT * FROM admin_users WHERE username = ?').get('Admin') as any;

  const announce = (password: string, reason: string) => {
    console.warn(
      `\n${'='.repeat(64)}\n` +
      `${reason}\n\n` +
      `  帳號：Admin\n` +
      `  密碼：${password}\n\n` +
      `這組密碼只會顯示這一次。請登入後立刻更改，或在 .env.local\n` +
      `設定 ADMIN_PASSWORD 之後重新啟動。\n` +
      `${'='.repeat(64)}\n`
    );
  };

  if (!existing) {
    const password = envPassword || randomBytes(9).toString('base64url');
    const { salt, hash } = hashPassword(password);
    db.prepare(`
      INSERT INTO admin_users (username, passwordSalt, passwordHash, roleTitle, email, createdAt)
      VALUES (?, ?, ?, '系統管理員', 'admin@pawrescue.org.tw', ?)
    `).run('Admin', salt, hash, new Date().toISOString());
    if (!envPassword) announce(password, '已建立管理員帳號（未設定 ADMIN_PASSWORD，本次自動產生密碼）');
    return;
  }

  // When ADMIN_PASSWORD is set it wins, every boot. Applying it only to a
  // brand-new database would mean setting it on an existing one silently did
  // nothing -- the kind of surprise that ends with someone assuming they have
  // changed a password they haven't.
  if (envPassword) {
    if (passwordMatches(envPassword, existing.passwordSalt, existing.passwordHash)) return;
    const { salt, hash } = hashPassword(envPassword);
    db.prepare('UPDATE admin_users SET passwordSalt = ?, passwordHash = ? WHERE username = ?')
      .run(salt, hash, 'Admin');
    db.prepare(`DELETE FROM sessions WHERE role = 'admin'`).run();
    console.warn('管理員密碼已依 ADMIN_PASSWORD 更新，既有的管理者登入階段已失效。');
    return;
  }

  // Databases created before this change already contain the "0000" hash, and
  // deleting the seed above does nothing for them -- which is precisely the
  // case that matters, since those are the ones that have been running. Detect
  // the known-weak values and rotate them.
  const knownWeak = ['0000', '1234', '123456', 'admin', 'password'];
  const usesWeakPassword = knownWeak.some(candidate =>
    passwordMatches(candidate, existing.passwordSalt, existing.passwordHash)
  );
  if (!usesWeakPassword) return;

  const password = randomBytes(9).toString('base64url');
  const { salt, hash } = hashPassword(password);
  db.prepare('UPDATE admin_users SET passwordSalt = ?, passwordHash = ? WHERE username = ?')
    .run(salt, hash, 'Admin');
  // Anyone signed in with the weak password loses their session too.
  db.prepare(`DELETE FROM sessions WHERE role = 'admin'`).run();
  announce(password, '偵測到管理員仍在使用預設弱密碼，已強制更換');
}
seedOrRepairAdmin();

/**
 * Writes a consistent snapshot to data/backups/ and prunes old ones.
 *
 * VACUUM INTO rather than copying volunteers.db: with WAL enabled the file on
 * disk is only half the story, and copying it while a write is in flight can
 * capture a torn page. This asks SQLite for the snapshot instead, which is safe
 * to run against a live database.
 */
export function backupDatabase(keep = 14): { file: string; bytes: number } {
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `volunteers-${stamp}.db`);
  // VACUUM INTO takes a literal, not a bound parameter.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const snapshots = fs.readdirSync(backupDir)
    .filter(name => name.startsWith('volunteers-') && name.endsWith('.db'))
    .sort();
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - keep))) {
    try {
      fs.unlinkSync(path.join(backupDir, stale));
    } catch {
      /* a backup we can't delete is not worth failing the backup over */
    }
  }

  return { file: target, bytes: fs.statSync(target).size };
}

export function verifyAdminCredentials(
  username: string,
  password: string
): { username: string; roleTitle: string; email: string } | null {
  const row = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(String(username || '').trim()) as any;
  if (!row) return null;
  if (!passwordMatches(String(password || ''), row.passwordSalt, row.passwordHash)) return null;
  return { username: row.username, roleTitle: row.roleTitle, email: row.email };
}

export function changeAdminPassword(username: string, newPassword: string): boolean {
  const row = db.prepare('SELECT username FROM admin_users WHERE username = ?').get(username);
  if (!row) return false;
  const { salt, hash } = hashPassword(newPassword);
  db.prepare('UPDATE admin_users SET passwordSalt = ?, passwordHash = ? WHERE username = ?')
    .run(salt, hash, username);
  // Every existing session for this account is dropped, so a password change
  // actually locks out whoever was already signed in with the old one.
  db.prepare(`DELETE FROM sessions WHERE role = 'admin' AND identity = ?`).run(username);
  return true;
}

export interface SessionRecord {
  token: string;
  role: 'admin' | 'volunteer';
  identity: string;     // admin username, or volunteer email
  displayName: string;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createSession(role: 'admin' | 'volunteer', identity: string, displayName: string): string {
  // Opportunistic cleanup so expired rows don't accumulate forever.
  db.prepare('DELETE FROM sessions WHERE expiresAt < ?').run(Date.now());

  const token = randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO sessions (token, role, identity, displayName, createdAt, expiresAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, role, identity, displayName || '', new Date().toISOString(), Date.now() + SESSION_TTL_MS);
  return token;
}

export function getSession(token: string): SessionRecord | null {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as any;
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { token: row.token, role: row.role, identity: row.identity, displayName: row.displayName };
}

export function destroySession(token: string): void {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Drops every session belonging to a volunteer -- used when they're deleted. */
export function destroySessionsForIdentity(identity: string): void {
  db.prepare('DELETE FROM sessions WHERE identity = ?').run(identity.toLowerCase().trim());
}
