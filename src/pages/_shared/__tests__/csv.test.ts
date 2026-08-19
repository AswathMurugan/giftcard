/**
 * CSV export.
 *
 * The three things that actually break a download in the field are Excel
 * concerns rather than parsing concerns: the encoding mark, the line ending,
 * and the fact that a spreadsheet will happily EXECUTE a cell that starts with
 * `=`. Destinations and tracking numbers are free text typed by suppliers, so
 * that last one is reachable by an outside party and is tested hardest.
 */
import { describe, it, expect } from 'vitest';
import { csvCell, toCsv, csvFilename, type CsvColumn } from '@/pages/_shared/csv';

interface Row { dest: string; qty: number; tracking?: string | null }

const COLS: CsvColumn<Row>[] = [
  { header: 'Destination', value: (r) => r.dest },
  { header: 'Qty', value: (r) => r.qty },
  { header: 'Tracking', value: (r) => r.tracking },
];

describe('csvCell', { tags: ['shipping', 'logic'] }, () => {
  it('quotes every value', { tags: ['smoke'] }, () => {
    expect(csvCell('Reno')).toBe('"Reno"');
    expect(csvCell(6000)).toBe('"6000"');
  });

  it('doubles embedded quotes', { tags: ['important'] }, () => {
    expect(csvCell('Sephora "West"')).toBe('"Sephora ""West"""');
  });

  it('survives commas and newlines inside a value', { tags: ['important'] }, () => {
    expect(csvCell('Reno, NV')).toBe('"Reno, NV"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders missing values as blank, not "null"', { tags: ['edge-case'] }, () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell('')).toBe('""');
  });

  /**
   * Quoting alone does NOT stop Excel executing a formula — the apostrophe
   * does. A supplier can type the destination, so this is reachable input.
   */
  it('defuses formula injection', { tags: ['important'] }, () => {
    expect(csvCell('=SUM(A1:A9)')).toBe('"\'=SUM(A1:A9)"');
    expect(csvCell('+1-555-0100')).toBe('"\'+1-555-0100"');
    expect(csvCell('-2')).toBe('"\'-2"');
    expect(csvCell('@import')).toBe('"\'@import"');
  });

  it('leaves an ordinary leading character alone', { tags: ['edge-case'] }, () => {
    expect(csvCell('Reno')).toBe('"Reno"');
    expect(csvCell('1600 Amphitheatre')).toBe('"1600 Amphitheatre"');
  });
});

describe('toCsv', { tags: ['shipping', 'important'] }, () => {
  const rows: Row[] = [
    { dest: 'Reno, NV', qty: 6000, tracking: 'FX779104552019' },
    { dest: 'Ontario, CA', qty: 2000, tracking: null },
  ];

  it('starts with a BOM so Excel reads UTF-8', () => {
    expect(toCsv(rows, COLS).startsWith('﻿')).toBe(true);
  });

  it('uses CRLF line endings', () => {
    const body = toCsv(rows, COLS);
    expect(body).toContain('\r\n');
    expect(body.endsWith('\r\n')).toBe(true);
  });

  it('writes a header row followed by one line per row', { tags: ['smoke'] }, () => {
    const lines = toCsv(rows, COLS).replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('"Destination","Qty","Tracking"');
    expect(lines[1]).toBe('"Reno, NV","6000","FX779104552019"');
  });

  it('leaves a missing tracking number blank', { tags: ['edge-case'] }, () => {
    const lines = toCsv(rows, COLS).replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[2]).toBe('"Ontario, CA","2000",""');
  });

  /** A header-only file reads as "nothing to export"; an empty one reads as broken. */
  it('still writes headers when there are no rows', { tags: ['edge-case'] }, () => {
    const lines = toCsv([], COLS).replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines).toEqual(['"Destination","Qty","Tracking"']);
  });
});

describe('csvFilename', { tags: ['shipping', 'logic'] }, () => {
  it('keeps an order code readable', { tags: ['smoke'] }, () => {
    expect(csvFilename('GC-1019 shipments', '2026-08-18')).toBe('GC-1019-shipments-2026-08-18.csv');
  });

  it('collapses unsafe runs rather than deleting them', { tags: ['edge-case'] }, () => {
    expect(csvFilename('GC-1019 / Reno: DC', '2026-08-18')).toBe('GC-1019-Reno-DC-2026-08-18.csv');
  });

  it('trims a full timestamp down to the day', { tags: ['edge-case'] }, () => {
    expect(csvFilename('x', '2026-08-18T14:10:30.000Z')).toBe('x-2026-08-18.csv');
  });

  it('falls back when the stem sanitises away entirely', { tags: ['edge-case'] }, () => {
    expect(csvFilename('///', '2026-08-18')).toBe('export-2026-08-18.csv');
  });
});
