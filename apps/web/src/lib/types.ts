export type PublicPropertyDto = {
  id: string;
  name: string;
  slug: string;
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
