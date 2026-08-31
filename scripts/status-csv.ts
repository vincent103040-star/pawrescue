// Reading the animal-status batches the shelter's main system mails over.
//
// The transport is email because the other system cannot open an API to us --
// which means this side has to be careful about the three things email is bad
// at: a message can be delivered twice, a message can vanish, and nothing tells
// you which of those happened. Everything here exists to make those visible.
//
// It deliberately knows nothing about what an animal's status *means*. The
// observation vocabulary on the far side is still placeholder data and will be
// replaced, so anything that assumed particular status codes would have to be
// thrown away. A parser that only cares about the shape survives that.

/** One observation of one animal, as it arrives in the CSV. */
export interface StatusRow {
  shelterCode: string;
  animalId: string;
  shelterNumber: string;
  animalName: string;
  observedAt: string;
  categoryCode: string;
  optionCode: string;
  optionLabel: string;
}

export interface ParsedCsv {
  rows: StatusRow[];
  /** Problems worth a human's attention. Never thrown, never swallowed. */
  errors: string[];
}

/** What the subject line says this batch is: 「[StrayHub] 動物狀態 #142 <起> ~ <迄>」 */
export interface BatchHeader {
  sequence: number;
  periodStart: string;
  periodEnd: string;
}

const REQUIRED_COLUMNS = [
  'shelter_code',
  'animal_id',
  'shelter_number',
  'animal_name',
  'observed_at',
  'category_code',
  'option_code',
  'option_label'
] as const;

/**
 * Splits CSV text into rows of fields.
 *
 * Written out rather than reached for with `split(',')` because every field
 * here can legitimately contain a comma -- an animal called 「小黑, 二號」 is
 * not far-fetched -- and a naive split silently shifts every later column by
 * one. That failure has no symptom: the row parses, it just means something
 * else.
 *
 * Handles quoted fields, doubled quotes inside them, CRLF, and a leading BOM.
 */
export function splitCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }

  // A file that does not end in a newline still has one last row in hand.
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // A trailing newline produces one empty row; that is not a record.
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

/**
 * Turns one batch's CSV into rows, reporting everything it could not use.
 *
 * A row missing a required value is reported and skipped rather than stored
 * half-empty: a status record with no animal attached is worse than a gap,
 * because nothing downstream can tell it is broken.
 */
export function parseStatusCsv(text: string): ParsedCsv {
  const errors: string[] = [];
  const table = splitCsv(text);

  if (table.length === 0) return { rows: [], errors: ['CSV 是空的'] };

  const header = table[0].map(h => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter(c => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], errors: [`缺少必要欄位：${missing.join('、')}`] };
  }

  const at = (name: string) => header.indexOf(name);
  const index = {
    shelterCode: at('shelter_code'),
    animalId: at('animal_id'),
    shelterNumber: at('shelter_number'),
    animalName: at('animal_name'),
    observedAt: at('observed_at'),
    categoryCode: at('category_code'),
    optionCode: at('option_code'),
    optionLabel: at('option_label')
  };

  const rows: StatusRow[] = [];
  for (let line = 1; line < table.length; line++) {
    const cells = table[line];
    const value = (i: number) => (cells[i] ?? '').trim();

    const row: StatusRow = {
      shelterCode: value(index.shelterCode),
      animalId: value(index.animalId),
      shelterNumber: value(index.shelterNumber),
      animalName: value(index.animalName),
      observedAt: value(index.observedAt),
      categoryCode: value(index.categoryCode),
      optionCode: value(index.optionCode),
      optionLabel: value(index.optionLabel)
    };

    // The animal and the observation are what make a record meaningful. A name
    // or a label can be blank without making the row a lie.
    const empties = (['shelterCode', 'animalId', 'observedAt', 'optionCode'] as const)
      .filter(k => !row[k]);
    if (empties.length > 0) {
      errors.push(`第 ${line + 1} 列缺少 ${empties.join('、')}，已略過`);
      continue;
    }

    rows.push(row);
  }

  return { rows, errors };
}

/**
 * Reads the batch number and period out of the mail subject.
 *
 * The number is the only thing that can tell us a batch never arrived. Without
 * it a missing email is indistinguishable from a quiet six hours.
 */
export function parseBatchSubject(subject: string): BatchHeader | null {
  const match = String(subject || '').match(
    /#(\d+)\s+(\S+)\s*~\s*(\S+)/
  );
  if (!match) return null;
  return {
    sequence: Number(match[1]),
    periodStart: match[2],
    periodEnd: match[3]
  };
}

/**
 * Which batch numbers were never seen, given the ones that were.
 *
 * Only counts gaps below the incoming number: batches that have not been sent
 * yet are not missing. Returns them in order so a report reads naturally.
 */
export function findMissingSequences(seen: number[], incoming: number): number[] {
  const known = new Set(seen.filter(n => Number.isFinite(n)));
  if (known.size === 0) return [];
  const highest = Math.max(...known);
  if (incoming <= highest + 1) return [];

  const missing: number[] = [];
  for (let n = highest + 1; n < incoming; n++) {
    if (!known.has(n)) missing.push(n);
  }
  return missing;
}
