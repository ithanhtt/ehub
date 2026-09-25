import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined'
import type { AppModule } from '..'

/**
 * Booking data — the KOC videos the team books, grouped in booking campaigns,
 * kept in the app in one standard form. The booking, video and cost reports
 * read it.
 *
 *   fields.ts          the standard: the fields, and how a typed row becomes a clean one
 *   campaigns.ts       a campaign's standard, the same way
 *   quick-entry.ts     the quick list: many bookings, one link or KOC per line
 *   spreadsheet.ts     reading and writing Excel/CSV files in the browser
 *   triage.ts          what needs a hand (overdue or late to air, aired without its video), where
 *                      a booking's airing stands ("Trạng thái air"), and the figures
 *   results.ts         reading each booked video's orders and revenue from TikTok Shop (offline-testable;
 *                      features/bookings/sync.ts runs it and writes the results)
 *   list.ts            the list's columns, filters, sorting and summary, worked out from the rows
 *   page.tsx           the page: campaign tabs, the summary of the rows shown, the filters, the list and its actions
 *   booking-table.tsx  the list itself: sortable columns, pinned code and headings; cards on a phone
 *   filter-bar.tsx     the search, month / air state / tier / date filters and their chips
 *   campaign-tabs.tsx  the campaigns as tabs, each with its count
 *   koc-drawer.tsx     one KOC beside the list: details, record, every booking of theirs
 *   campaign-form.tsx  creating or editing a campaign
 *   booking-form.tsx   adding bookings (one, or a list), or editing one
 *   form-parts.tsx     the sections and quick-pick chips both forms share
 *   import-dialog.tsx  importing a file or pasted cells, checked row by row
 *
 * Storage is core/db/schema/bookings.ts; writes go through
 * features/bookings/actions.ts and need `booking:edit` (the Booking role and up).
 * The results sync (features/bookings/sync.ts) runs on the server when the
 * page opens, when asked, and in the background rounds.
 */
/**
 * Not an entry of its own in the menu: the booking data is Booking & KOC's
 * second part (app/(app)/projects/[projectId]/booking-koc/data, under the
 * tabs of booking-koc/section-tabs.tsx); the old /bookings address redirects
 * there. Its manifest stays for the path and icon the tabs use.
 */
export const bookingsModule: AppModule = {
  id: 'bookings',
  nav: { key: 'bookings', path: 'booking-koc/data', icon: EditNoteOutlined },
}
