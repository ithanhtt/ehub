'use client'

import { BOOKING_FIELDS, columnsOf, TEMPLATE_HEADINGS, usableColumns, type BookingField, type DerivedColumn } from './fields'

/**
 * Reading and writing booking files in the browser, with SheetJS — loaded
 * only when a file is opened or saved, so the page itself stays light.
 *
 * Text formats (CSV, TSV, pasted cells) are read as text: SheetJS would
 * otherwise read "12/09/2026" the American way, month first. Workbooks keep
 * their typed cells — a date cell arrives as a date serial and a fee as a
 * number, whatever its display format — and fields.ts reads both.
 */

export type Table = { name: string; rows: unknown[][] }

const TEXT_FILE = /\.(csv|tsv|txt)$/i
const HEADER_SCAN_ROWS = 12

const xlsx = () => import('xlsx')

async function tablesOf(read: (lib: typeof import('xlsx')) => import('xlsx').WorkBook): Promise<Table[]> {
  const lib = await xlsx()
  const book = read(lib)
  return book.SheetNames.map((name) => ({
    name,
    rows: lib.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false }),
  })).filter((table) => table.rows.length > 0)
}

/**
 * A text file's characters: UTF-8 when it is valid UTF-8, else Windows-1258 —
 * what Excel in Vietnamese writes for a plain "CSV" save.
 */
export function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1258').decode(data)
  }
}

/** Every non-empty sheet of a workbook, CSV or text file. */
export async function readFile(file: File): Promise<Table[]> {
  const data = new Uint8Array(await file.arrayBuffer())
  if (TEXT_FILE.test(file.name)) {
    const text = decodeText(data)
    // A .tsv, or a .txt of pasted cells, is split on tabs; SheetJS guesses commas or semicolons for the rest.
    const tabbed = /\.tsv$/i.test(file.name) || (!/\.csv$/i.test(file.name) && text.split('\n', 1)[0].includes('\t'))
    return tablesOf((lib) => lib.read(text, { type: 'string', raw: true, ...(tabbed ? { FS: '\t' } : {}) }))
  }
  return tablesOf((lib) => lib.read(data, { type: 'array' }))
}

/** Cells pasted from Excel or Google Sheets: tab-separated lines. */
export async function readPasted(text: string): Promise<Table[]> {
  return tablesOf((lib) => lib.read(text.replace(/\r\n?/g, '\n'), { type: 'string', raw: true, FS: '\t' }))
}

/** The heading row of a table and the columns found in it — the first of its top rows that names a KOC or video and a date. */
export function findHeader(rows: unknown[][]): { index: number; columns: Partial<Record<BookingField, number>> } | null {
  for (let r = 0; r < Math.min(HEADER_SCAN_ROWS, rows.length); r++) {
    const columns = columnsOf(rows[r] ?? [])
    if (usableColumns(columns)) return { index: r, columns }
  }
  return null
}

function download(lib: typeof import('xlsx'), book: import('xlsx').WorkBook, filename: string) {
  lib.writeFile(book, filename, { compression: true })
}

const widths = (headings: string[]) => headings.map((heading) => ({ wch: Math.max(14, heading.length + 4) }))

/** The standard file: its headings, two sample rows, and a sheet explaining each field. */
export async function downloadTemplate(guide: Array<{ field: BookingField; required: boolean; description: string; example: string }>, labels: { sheet: string; guide: string; field: string; required: string; description: string; example: string; yes: string }) {
  const lib = await xlsx()
  const headings = BOOKING_FIELDS.map((field) => TEMPLATE_HEADINGS[field])
  const examples = BOOKING_FIELDS.map((field) => guide.find((g) => g.field === field)?.example ?? '')
  const sheet = lib.utils.aoa_to_sheet([headings, examples])
  sheet['!cols'] = widths(headings)
  const help = lib.utils.aoa_to_sheet([
    [labels.field, labels.required, labels.description, labels.example],
    ...guide.map((g) => [TEMPLATE_HEADINGS[g.field], g.required ? labels.yes : '', g.description, g.example]),
  ])
  help['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 80 }, { wch: 40 }]
  const book = lib.utils.book_new()
  lib.utils.book_append_sheet(book, sheet, labels.sheet)
  lib.utils.book_append_sheet(book, help, labels.guide)
  download(lib, book, 'booking-template.xlsx')
}

/**
 * Rows as a workbook in the standard layout (or `columns`, such as the list's
 * EXPORT_COLUMNS), so the file can be edited and imported back; `extra`
 * columns (such as what is wrong with a row) go last.
 */
export async function downloadRows(
  rows: Array<Partial<Record<BookingField | DerivedColumn, unknown>> & { extra?: string[] }>,
  filename: string,
  sheetName: string,
  extraHeadings: string[] = [],
  columns: ReadonlyArray<BookingField | DerivedColumn> = BOOKING_FIELDS,
) {
  const lib = await xlsx()
  const headings = [...columns.map((field) => TEMPLATE_HEADINGS[field]), ...extraHeadings]
  const sheet = lib.utils.aoa_to_sheet([headings, ...rows.map((row) => [...columns.map((field) => row[field] ?? ''), ...(row.extra ?? [])])])
  sheet['!cols'] = widths(headings)
  const book = lib.utils.book_new()
  lib.utils.book_append_sheet(book, sheet, sheetName)
  download(lib, book, filename)
}
