export type RateSummaryDto = {
  /** Menor tarifa publicada, para o "a partir de" da vitrine. */
  fromCents: number | null;
  weekdays: { weekday: number; nightlyCents: number; minNightsOnArrival: number | null }[];
  periods: { name: string; startsOn: string; endsOn: string }[];
};

export type QuoteLineDto =
  | { kind: 'NIGHT'; date: string; label: string; amountCents: number }
  | { kind: 'PACKAGE'; label: string; nights: string[]; amountCents: number };

export type QuoteDto = {
  checkIn: string;
  checkOut: string;
  nights: number;
  minNights: number;
  lines: QuoteLineDto[];
  appliedPeriods: string[];
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  totalAmount: string;
  depositAmount: string;
  bookable: boolean;
  problems: { code: string; [key: string]: unknown }[];
};

export type QuoteResponseDto = {
  quote: QuoteDto;
  available: boolean;
  currency: string;
};

export type PublicPropertyDto = {
  id: string;
  name: string;
  slug: string;
  shortName: string;
  /** Cor da unidade no calendário (#RRGGBB). */
  color: string;
  locationName: string | null;
  locationUrl: string | null;
  description: string;
  currency: string;
  timezone: string;
  checkInTime: string;
  checkOutTime: string;
  nightlyRate: string;
  depositPercentage: string;
  minNights: number;
  maxGuests: number;
  bookingHorizonDays: number;
  holdMinutes: number;
  termsVersion: string;
  termsContent: string;
  heroImageUrl: string | null;
  amenities: string[];
  ratePublished: boolean;
  pixConfigured: boolean;
  rates: RateSummaryDto | null;
};

export type AvailabilityDto = {
  property: PublicPropertyDto;
  from: string;
  to: string;
  unavailable: string[];
};

export type ReservationDto = {
  id: string;
  property_id: string;
  unit_slug?: string;
  unit_name?: string;
  unit_color?: string | null;
  unit_location?: string | null;
  unit_location_url?: string | null;
  check_in: string;
  check_out: string;
  status: string;
  payment_status: string;
  guest_count: number;
  total_amount: string;
  deposit_amount: string;
  created_at: string;
  expires_at: string;
};

export type PaymentIntentDto = {
  payment: { id: string; reference: string; provider: string; amount: string; status: string };
  pix: { key: string; holderName: string; payload: string; instructions: string | null };
  reservation: {
    id: string;
    checkIn: string;
    checkOut: string;
    totalAmount: string;
    depositAmount: string;
    holdExpiresAt: string;
    unitName: string;
    unitColor: string | null;
    unitLocation: string | null;
  };
};

export type UserDto = {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: string;
  phone: string | null;
  document_number: string | null;
  avatar_url: string | null;
};

/** Unidade com a disponibilidade já resolvida pelo servidor. */
export type UnitDto = PublicPropertyDto & {
  unavailable: string[];
};

export type UnitCalendarDto = {
  from: string;
  to: string;
  units: UnitDto[];
};
