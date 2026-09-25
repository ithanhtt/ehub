'use client'

import { useReport } from '@/modules/analytics/context'
import type { BookingKocData } from './types'

/** The module's answer, for its widgets. */
export const useBookingKoc = () => useReport<BookingKocData>()
