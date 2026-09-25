/**
 * Case- and accent-insensitive, so "sua rua mat" finds "Sữa rửa mặt".
 *
 * On its own, without the React hooks beside it in text.ts (which re-exports
 * it), so plain modules — the booking list's filters, checked offline by
 * scripts/check-plugins.ts — can fold text without pulling in next-intl.
 */
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
