// Shape of data/cruise.json. Everything in it is fictional demo data.

export type ShipCode = 'CV' | 'NP' | 'SO' | 'SL';
export type Region = 'Caribbean' | 'Mediterranean' | 'Greek Isles';
export type Currency = 'USD' | 'EUR';
export type CabinCategory = 'Inside' | 'Oceanview' | 'Balcony' | 'Suite';
export type LoyaltyTier = 'Blue' | 'Silver' | 'Gold' | 'Platinum';
export type BookingStatus = 'confirmed' | 'pending_payment' | 'cancelled' | 'waitlisted';
export type BookingChannel = 'direct' | 'travel_agent' | 'call_center';
export type ExcursionBookingStatus = 'confirmed' | 'requested' | 'waitlisted';
export type ActivityLevel = 'easy' | 'moderate' | 'strenuous';
export type SpecialRequestType = 'dietary' | 'mobility' | 'celebration' | 'medical';
export type MobilityNeed = 'wheelchair' | 'limited_walking';

export const CABIN_CATEGORIES: readonly CabinCategory[] = ['Inside', 'Oceanview', 'Balcony', 'Suite'];
export const LOYALTY_TIERS: readonly LoyaltyTier[] = ['Blue', 'Silver', 'Gold', 'Platinum'];
export const BOOKING_STATUSES: readonly BookingStatus[] = ['confirmed', 'pending_payment', 'cancelled', 'waitlisted'];

export interface CabinCategoryInfo {
  category: CabinCategory;
  cabins: number;
  maxOccupancy: number;
}

export interface Ship {
  id: ShipCode;
  name: string;
  yearBuilt: number;
  /** Lower-berth (double occupancy) capacity. */
  guestCapacity: number;
  cabinCategories: CabinCategoryInfo[];
}

export interface ItineraryDay {
  day: number;
  date: string;
  kind: 'embark' | 'port' | 'sea' | 'disembark';
  /** null on sea days. */
  port: string | null;
  arrival: string | null;
  departure: string | null;
  tender: boolean;
}

export interface Sailing {
  id: string;
  shipId: ShipCode;
  region: Region;
  name: string;
  departureDate: string;
  returnDate: string;
  nights: number;
  embarkPort: string;
  currency: Currency;
  itinerary: ItineraryDay[];
}

export interface Passport {
  status: 'on_file' | 'missing';
  number: string | null;
  expiryDate: string | null;
  issuingCountry: string | null;
}

export interface SpecialRequest {
  type: SpecialRequestType;
  detail: string;
  /** Only set for mobility requests. */
  mobilityNeed: MobilityNeed | null;
}

export interface Passenger {
  id: string;
  bookingId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  loyaltyTier: LoyaltyTier;
  loyaltyNumber: string;
  passport: Passport;
  specialRequests: SpecialRequest[];
}

export interface Booking {
  id: string;
  sailingId: string;
  status: BookingStatus;
  channel: BookingChannel;
  cabinCategory: CabinCategory;
  /** null for cancelled and waitlisted bookings (no cabin held). */
  cabinNumber: string | null;
  leadPassengerId: string;
  passengerIds: string[];
  bookedOn: string;
  currency: Currency;
  totalFare: number;
  amountPaid: number;
  /** Date the next (or last) payment was due: deposit for new holds, final balance otherwise. */
  paymentDueDate: string;
  cancelledOn: string | null;
  cancellationReason: string | null;
  /** Position on the cruise waitlist for the cabin category; waitlisted bookings only. */
  waitlistPosition: number | null;
}

export interface Excursion {
  id: string;
  sailingId: string;
  port: string;
  date: string;
  name: string;
  durationHours: number;
  pricePerGuest: number;
  currency: Currency;
  capacity: number;
  originalCapacity: number;
  capacityNote: string | null;
  activityLevel: ActivityLevel;
  wheelchairAccessible: boolean;
  /** Small-group tours the local operator must confirm individually. */
  requiresOperatorConfirmation: boolean;
}

export interface ExcursionBooking {
  id: string;
  excursionId: string;
  bookingId: string;
  passengerIds: string[];
  status: ExcursionBookingStatus;
  requestedOn: string;
  waitlistPosition: number | null;
}

export interface Dataset {
  meta: {
    name: string;
    fictional: true;
    schemaVersion: 1;
    seed: number;
    /** The "today" of the dataset. All relative dates (days to departure, overdue) use this. */
    asOf: string;
    generator: string;
  };
  ships: Ship[];
  sailings: Sailing[];
  bookings: Booking[];
  passengers: Passenger[];
  excursions: Excursion[];
  excursionBookings: ExcursionBooking[];
}
