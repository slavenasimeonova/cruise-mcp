// Deterministic generator for the Azure Horizon Cruises demo dataset.
// Uses a seeded PRNG and a fixed "as of" date only: no Math.random, no wall clock, no locale APIs,
// so the output is byte-identical on every run and every machine.
import type {
  ActivityLevel,
  Booking,
  BookingChannel,
  BookingStatus,
  CabinCategory,
  Currency,
  Dataset,
  Excursion,
  ExcursionBooking,
  ItineraryDay,
  LoyaltyTier,
  MobilityNeed,
  Passenger,
  Region,
  Sailing,
  Ship,
  ShipCode,
  SpecialRequest,
} from '../src/data/types.js';
import { addDays, daysBetween } from '../src/lib/dates.js';

export const SEED = 20261101;
export const AS_OF = '2026-11-01';

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('pick() on empty list');
    return item;
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items[items.length - 1]![0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Fleet and routes
// ---------------------------------------------------------------------------

const SHIPS: Ship[] = [
  {
    id: 'CV',
    name: 'Coral Vista',
    yearBuilt: 2019,
    guestCapacity: 240,
    cabinCategories: [
      { category: 'Inside', cabins: 24, maxOccupancy: 3 },
      { category: 'Oceanview', cabins: 30, maxOccupancy: 4 },
      { category: 'Balcony', cabins: 52, maxOccupancy: 3 },
      { category: 'Suite', cabins: 14, maxOccupancy: 4 },
    ],
  },
  {
    id: 'NP',
    name: 'Northern Pearl',
    yearBuilt: 2016,
    guestCapacity: 220,
    cabinCategories: [
      { category: 'Inside', cabins: 20, maxOccupancy: 3 },
      { category: 'Oceanview', cabins: 26, maxOccupancy: 4 },
      { category: 'Balcony', cabins: 52, maxOccupancy: 3 },
      { category: 'Suite', cabins: 12, maxOccupancy: 4 },
    ],
  },
  {
    id: 'SO',
    name: 'Solenne',
    yearBuilt: 2022,
    guestCapacity: 180,
    cabinCategories: [
      { category: 'Inside', cabins: 10, maxOccupancy: 2 },
      { category: 'Oceanview', cabins: 20, maxOccupancy: 3 },
      { category: 'Balcony', cabins: 46, maxOccupancy: 3 },
      { category: 'Suite', cabins: 14, maxOccupancy: 4 },
    ],
  },
  {
    id: 'SL',
    name: 'Sea Lyra',
    yearBuilt: 2018,
    guestCapacity: 260,
    cabinCategories: [
      { category: 'Inside', cabins: 30, maxOccupancy: 3 },
      { category: 'Oceanview', cabins: 34, maxOccupancy: 4 },
      { category: 'Balcony', cabins: 52, maxOccupancy: 3 },
      { category: 'Suite', cabins: 14, maxOccupancy: 4 },
    ],
  },
];

const CABIN_LAYOUT: Record<CabinCategory, { decks: readonly number[]; firstNumber: number }> = {
  Inside: { decks: [4, 5], firstNumber: 100 },
  Oceanview: { decks: [4, 5], firstNumber: 300 },
  Balcony: { decks: [6, 7, 8], firstNumber: 100 },
  Suite: { decks: [9], firstNumber: 100 },
};

interface PortStop {
  port: string;
  arrival: string;
  departure: string;
  tender?: boolean;
}

interface Route {
  region: Region;
  name: string;
  embarkPort: string;
  currency: Currency;
  firstDeparture: string;
  /** Days 2..7 of a 7-night sailing. */
  days: readonly (PortStop | 'sea')[];
}

const ROUTES: Record<ShipCode, Route> = {
  CV: {
    region: 'Caribbean',
    name: '7-Night Western Caribbean from Miami',
    embarkPort: 'Miami',
    currency: 'USD',
    firstDeparture: '2026-11-07',
    days: [
      'sea',
      { port: 'Cozumel', arrival: '08:00', departure: '17:00' },
      { port: 'Roatán', arrival: '08:00', departure: '16:00' },
      { port: 'Belize City', arrival: '07:30', departure: '16:30', tender: true },
      { port: 'George Town (Grand Cayman)', arrival: '07:00', departure: '15:00', tender: true },
      'sea',
    ],
  },
  SL: {
    region: 'Caribbean',
    name: '7-Night Eastern Caribbean from Fort Lauderdale',
    embarkPort: 'Fort Lauderdale',
    currency: 'USD',
    firstDeparture: '2026-11-14',
    days: [
      { port: 'Nassau', arrival: '08:00', departure: '17:00' },
      'sea',
      { port: 'St. Maarten', arrival: '08:00', departure: '18:00' },
      { port: 'St. Thomas', arrival: '07:00', departure: '16:00' },
      { port: 'San Juan', arrival: '13:00', departure: '23:00' },
      'sea',
    ],
  },
  NP: {
    region: 'Mediterranean',
    name: '7-Night Western Mediterranean from Barcelona',
    embarkPort: 'Barcelona',
    currency: 'EUR',
    firstDeparture: '2026-11-04',
    days: [
      { port: 'Marseille', arrival: '08:00', departure: '18:00' },
      { port: 'La Spezia', arrival: '07:00', departure: '19:00' },
      { port: 'Civitavecchia (Rome)', arrival: '07:00', departure: '19:00' },
      { port: 'Naples', arrival: '08:00', departure: '18:00' },
      'sea',
      { port: 'Palma de Mallorca', arrival: '08:00', departure: '17:00' },
    ],
  },
  SO: {
    region: 'Greek Isles',
    name: '7-Night Greek Isles from Athens',
    embarkPort: 'Piraeus (Athens)',
    currency: 'EUR',
    firstDeparture: '2026-11-10',
    days: [
      { port: 'Mykonos', arrival: '08:00', departure: '23:00' },
      { port: 'Santorini', arrival: '07:00', departure: '16:00', tender: true },
      { port: 'Rhodes', arrival: '08:00', departure: '18:00' },
      { port: 'Heraklion', arrival: '07:00', departure: '17:00' },
      'sea',
      { port: 'Nafplio', arrival: '08:00', departure: '17:00', tender: true },
    ],
  },
};

const SAILINGS_PER_SHIP = 6;
const DAYS_BETWEEN_SAILINGS = 28;

// ---------------------------------------------------------------------------
// Excursion catalogue: [name, hours, price, capacity, activity, wheelchair, operatorConfirm, popularity]
// ---------------------------------------------------------------------------

type ExcursionTemplate = readonly [string, number, number, number, ActivityLevel, boolean, boolean, number];

const EXCURSIONS: Record<string, readonly ExcursionTemplate[]> = {
  Cozumel: [
    ['Palancar Reef Snorkel', 3.5, 79, 40, 'moderate', false, false, 5],
    ['San Gervasio Maya Ruins', 4, 89, 35, 'moderate', false, false, 3],
    ['Beach Club Day Pass', 5, 65, 60, 'easy', true, false, 3],
  ],
  'Roatán': [
    ['West Bay Beach & Snorkel', 4, 69, 45, 'moderate', false, false, 4],
    ['Jungle Zipline Canopy', 3, 99, 20, 'strenuous', false, true, 4],
    ['Sloth & Parrot Sanctuary', 3, 75, 30, 'easy', true, false, 3],
  ],
  'Belize City': [
    ['Cave Tubing Expedition', 6, 139, 30, 'strenuous', false, true, 5],
    ['Altun Ha Maya Temples', 5, 109, 35, 'moderate', false, false, 3],
    ['Barrier Reef Snorkel', 4, 95, 30, 'moderate', false, false, 3],
  ],
  'George Town (Grand Cayman)': [
    ['Stingray Sandbar Encounter', 3, 89, 50, 'moderate', false, false, 6],
    ['Seven Mile Beach Break', 4, 55, 60, 'easy', true, false, 3],
    ['Reef Submarine Dive', 2, 129, 24, 'easy', false, true, 3],
  ],
  Nassau: [
    ['Glass-Bottom Boat & Reef', 2.5, 59, 40, 'easy', true, false, 3],
    ['Historic Nassau Walking Tour', 2.5, 45, 30, 'moderate', false, false, 2],
    ['Rose Island Beach Escape', 5, 95, 40, 'easy', false, false, 5],
  ],
  'St. Maarten': [
    ['Maho Beach & Marigot Tour', 4, 69, 40, 'easy', true, false, 4],
    ['12-Metre Yacht Race', 3, 119, 24, 'strenuous', false, true, 4],
    ['Pinel Island Kayak', 4, 89, 24, 'strenuous', false, false, 2],
  ],
  'St. Thomas': [
    ['Magens Bay Beach Transfer', 4, 49, 60, 'easy', true, false, 4],
    ['St. John Catamaran Snorkel', 6, 149, 36, 'moderate', false, true, 5],
    ['Island Scenic Drive', 3, 59, 40, 'easy', true, false, 2],
  ],
  'San Juan': [
    ['Old San Juan Walking Tour', 3, 49, 35, 'moderate', false, false, 4],
    ['El Yunque Rainforest Hike', 5, 99, 30, 'strenuous', false, false, 3],
    ['Bioluminescent Bay Kayak', 4, 129, 20, 'strenuous', false, true, 5],
  ],
  Marseille: [
    ['Calanques Boat Cruise', 3, 69, 45, 'easy', false, false, 4],
    ['Aix-en-Provence Half Day', 5, 79, 40, 'moderate', true, false, 4],
    ['Old Port & Notre-Dame de la Garde', 3.5, 49, 40, 'moderate', false, false, 3],
  ],
  'La Spezia': [
    ['Cinque Terre by Train', 7, 119, 40, 'strenuous', false, false, 6],
    ['Pisa & Lucca', 8, 99, 45, 'moderate', true, false, 4],
    ['Portovenere Boat Trip', 4, 69, 35, 'easy', false, false, 2],
  ],
  'Civitavecchia (Rome)': [
    ['Rome Highlights', 9, 129, 50, 'moderate', true, false, 6],
    ['Vatican Museums Early Entry', 9, 159, 30, 'moderate', false, true, 5],
    ['Tarquinia Etruscan Tombs', 4, 69, 25, 'moderate', false, false, 1],
  ],
  Naples: [
    ['Pompeii Guided Tour', 5, 89, 45, 'moderate', false, false, 6],
    ['Amalfi Coast Drive', 8, 139, 35, 'easy', true, false, 4],
    ['Capri & Blue Grotto', 8, 149, 24, 'strenuous', false, true, 5],
  ],
  'Palma de Mallorca': [
    ['Palma Cathedral & Old Town', 3, 49, 40, 'moderate', true, false, 4],
    ['Valldemossa & Sóller Train', 6, 99, 35, 'moderate', false, false, 4],
    ['Caves of Drach', 5, 79, 45, 'strenuous', false, false, 3],
  ],
  Mykonos: [
    ['Delos Archaeological Site', 4, 89, 35, 'strenuous', false, false, 4],
    ['Little Venice & Windmills Walk', 2.5, 45, 30, 'moderate', false, false, 4],
    ['South Coast Beach Hop', 5, 75, 40, 'easy', true, false, 3],
  ],
  Santorini: [
    ['Oia Sunset & Village', 5, 99, 40, 'moderate', false, false, 6],
    ['Caldera Catamaran Cruise', 5, 129, 24, 'moderate', false, true, 5],
    ['Akrotiri Excavations', 3.5, 79, 35, 'easy', true, false, 2],
  ],
  Rhodes: [
    ['Lindos Acropolis', 5, 85, 45, 'strenuous', false, false, 5],
    ['Medieval Old Town Walk', 3, 49, 35, 'moderate', false, false, 4],
    ['Symi Island Boat Trip', 7, 109, 30, 'easy', false, true, 3],
  ],
  Heraklion: [
    ['Knossos Palace', 4, 79, 45, 'moderate', true, false, 6],
    ['Cretan Village & Olive Oil Tasting', 5, 85, 30, 'easy', true, false, 3],
    ['Spinalonga Island', 7, 99, 30, 'moderate', false, true, 3],
  ],
  Nafplio: [
    ['Mycenae & Epidaurus', 6, 99, 40, 'moderate', false, false, 5],
    ['Palamidi Fortress Climb', 3, 45, 25, 'strenuous', false, false, 2],
    ['Nafplio Old Town & Wine Tasting', 4, 69, 30, 'easy', true, true, 3],
  ],
};

const CAPACITY_CUT_REASONS = [
  'smaller coach assigned',
  'vessel substitution by operator',
  'guide shortage',
  'site visitor limit set by local authority',
];

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const FIRST_NAMES: Record<string, readonly string[]> = {
  US: ['Avery', 'Jordan', 'Megan', 'Tyler', 'Danielle', 'Marcus', 'Hannah', 'Brandon', 'Kayla', 'Derek', 'Lauren', 'Caleb', 'Brooke', 'Trevor', 'Jasmine', 'Wesley'],
  CA: ['Liam', 'Chloe', 'Nathan', 'Sophie', 'Owen', 'Maya', 'Ethan', 'Claire'],
  GB: ['Oliver', 'Amelia', 'Harry', 'Imogen', 'George', 'Poppy', 'Alfie', 'Eleanor', 'Rhys', 'Freya'],
  IE: ['Cian', 'Aoife', 'Darragh', 'Niamh', 'Ronan', 'Saoirse'],
  DE: ['Lukas', 'Hanna', 'Jonas', 'Lea', 'Felix', 'Marie', 'Tobias', 'Annika'],
  ES: ['Javier', 'Lucía', 'Pablo', 'Carmen', 'Diego', 'Elena', 'Álvaro', 'Marta'],
  IT: ['Matteo', 'Giulia', 'Lorenzo', 'Chiara', 'Andrea', 'Francesca', 'Davide', 'Elisa'],
  FR: ['Hugo', 'Camille', 'Louis', 'Manon', 'Théo', 'Inès', 'Julien', 'Léa'],
  NL: ['Daan', 'Sanne', 'Bram', 'Fleur', 'Thijs', 'Lotte'],
  AU: ['Jack', 'Isla', 'Cooper', 'Matilda', 'Riley', 'Zoe'],
  MX: ['Santiago', 'Valentina', 'Emiliano', 'Ximena', 'Mateo', 'Regina'],
  BR: ['Gabriel', 'Beatriz', 'Rafael', 'Larissa', 'Thiago', 'Camila'],
  GR: ['Nikos', 'Eleni', 'Giorgos', 'Katerina', 'Dimitris', 'Sofia'],
};

const LAST_NAMES: Record<string, readonly string[]> = {
  US: ['Whitfield', 'Callahan', 'Brennan', 'Holloway', 'Prescott', 'Delgado', 'Navarro', 'Merritt', 'Langford', 'Okafor', 'Castellano', 'Pruitt', 'Ashby', 'Vance', 'Kimura', 'Rowland'],
  CA: ['Tremblay', 'Gagnon', 'MacLeod', 'Bouchard', 'Fraser', 'Côté'],
  GB: ['Pemberton', 'Ashworth', 'Hargreaves', 'Thornbury', 'Fairclough', 'Wainwright', 'Blackwood', 'Cartwright'],
  IE: ["O'Rourke", 'Gallagher', 'Brennan', 'Kinsella', 'Mulcahy'],
  DE: ['Brandt', 'Vogel', 'Hartmann', 'Lindqvist', 'Krause', 'Engel', 'Weiss'],
  ES: ['Montoya', 'Ferrer', 'Ibarra', 'Castaño', 'Quintero', 'Soler'],
  IT: ['Bellandi', 'Ferraro', 'Castiglione', 'Marchetti', 'Rinaldi', 'Moretti'],
  FR: ['Lefebvre', 'Moreau', 'Delacroix', 'Girard', 'Fontaine', 'Rousseau'],
  NL: ['de Vries', 'Bakker', 'van Dijk', 'Visser', 'Smit'],
  AU: ['Fitzgerald', 'Harrington', 'McAllister', 'Doyle', 'Kensington'],
  MX: ['Villarreal', 'Ortega', 'Salazar', 'Cervantes', 'Ruelas'],
  BR: ['Moreira', 'Carvalho', 'Teixeira', 'Albuquerque', 'Nogueira'],
  GR: ['Papadakis', 'Konstantinou', 'Alexiou', 'Markou', 'Vlachos'],
};

const NATIONALITIES: Record<Region, readonly (readonly [string, number])[]> = {
  Caribbean: [['US', 58], ['CA', 15], ['GB', 10], ['MX', 5], ['DE', 4], ['BR', 4], ['AU', 4]],
  Mediterranean: [['GB', 20], ['US', 20], ['DE', 14], ['ES', 10], ['IT', 8], ['FR', 8], ['NL', 6], ['CA', 5], ['AU', 5], ['IE', 4]],
  'Greek Isles': [['US', 22], ['GB', 20], ['DE', 12], ['AU', 10], ['CA', 8], ['GR', 6], ['FR', 6], ['NL', 6], ['IT', 5], ['IE', 5]],
};

const TIER_WEIGHTS: readonly (readonly [LoyaltyTier, number])[] = [['Blue', 52], ['Silver', 26], ['Gold', 15], ['Platinum', 7]];

const DIETARY = [
  'Vegetarian',
  'Vegan',
  'Gluten-free (coeliac disease)',
  'Severe tree-nut allergy, carries an EpiPen',
  'Shellfish allergy',
  'Lactose intolerant',
  'Kosher meals',
  'Halal meals',
  'Diabetic-friendly menu',
  'Low-sodium diet',
];

const MOBILITY: readonly (readonly [string, MobilityNeed])[] = [
  ['Uses a wheelchair; needs an accessible cabin and tender assistance', 'wheelchair'],
  ['Travels with own mobility scooter', 'wheelchair'],
  ['Limited walking distance; needs assistance at embarkation', 'limited_walking'],
  ['Walks with a cane; prefers to avoid stairs', 'limited_walking'],
];

const MEDICAL = [
  'Uses a CPAP machine; needs a power outlet by the bed',
  'Needs an in-cabin refrigerator for insulin',
  'Travels with a portable oxygen concentrator',
  'Pregnant (22 weeks at embarkation)',
];

const CANCELLATION_REASONS = [
  'Medical reasons',
  'Change of travel plans',
  'Family emergency',
  'Moved to a different sailing',
  'Visa or documentation issue',
  'Found a lower fare elsewhere',
  'Work commitments',
];

const FARE_PER_NIGHT: Record<Region, Record<CabinCategory, number>> = {
  Caribbean: { Inside: 110, Oceanview: 140, Balcony: 190, Suite: 360 },
  Mediterranean: { Inside: 130, Oceanview: 165, Balcony: 220, Suite: 420 },
  'Greek Isles': { Inside: 120, Oceanview: 150, Balcony: 205, Suite: 390 },
};

const FINAL_PAYMENT_DAYS = 75;

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function compactDate(iso: string): string {
  return iso.slice(2).replaceAll('-', '');
}

export function generateDataset(seed = SEED): Dataset {
  const rng = new Rng(seed);

  const sailings: Sailing[] = [];
  const bookings: Booking[] = [];
  const passengers: Passenger[] = [];
  const excursions: Excursion[] = [];
  const excursionBookings: ExcursionBooking[] = [];

  let nextBooking = 100001;
  let nextPassenger = 100001;
  let nextExcursion = 1;
  let nextExcursionBooking = 1;
  let nextLoyalty = 4100001;

  // --- Sailings ------------------------------------------------------------
  for (const ship of SHIPS) {
    const route = ROUTES[ship.id];
    for (let i = 0; i < SAILINGS_PER_SHIP; i++) {
      const departureDate = addDays(route.firstDeparture, i * DAYS_BETWEEN_SAILINGS);
      const itinerary: ItineraryDay[] = [
        { day: 1, date: departureDate, kind: 'embark', port: route.embarkPort, arrival: null, departure: '17:00', tender: false },
      ];
      route.days.forEach((stop, idx) => {
        const day = idx + 2;
        const date = addDays(departureDate, idx + 1);
        itinerary.push(
          stop === 'sea'
            ? { day, date, kind: 'sea', port: null, arrival: null, departure: null, tender: false }
            : { day, date, kind: 'port', port: stop.port, arrival: stop.arrival, departure: stop.departure, tender: stop.tender ?? false },
        );
      });
      const returnDate = addDays(departureDate, 7);
      itinerary.push({ day: 8, date: returnDate, kind: 'disembark', port: route.embarkPort, arrival: '07:00', departure: null, tender: false });
      sailings.push({
        id: `AH-${ship.id}-${compactDate(departureDate)}`,
        shipId: ship.id,
        region: route.region,
        name: route.name,
        departureDate,
        returnDate,
        nights: 7,
        embarkPort: route.embarkPort,
        currency: route.currency,
        itinerary,
      });
    }
  }
  sailings.sort((a, b) => (a.departureDate < b.departureDate ? -1 : a.departureDate > b.departureDate ? 1 : a.id < b.id ? -1 : 1));

  // --- Bookings, passengers, excursions per sailing -----------------------
  for (const sailing of sailings) {
    const ship = SHIPS.find((s) => s.id === sailing.shipId)!;
    const daysOut = daysBetween(AS_OF, sailing.departureDate);
    const occupancy = Math.min(0.97, Math.max(0.6, 0.97 - (daysOut / 150) * 0.3 + (rng.next() - 0.5) * 0.06));
    const finalDue = addDays(sailing.departureDate, -FINAL_PAYMENT_DAYS);

    const makePassengers = (bookingId: string, partySize: number): string[] => {
      const nationality = rng.weighted(NATIONALITIES[sailing.region]);
      const familyName = rng.pick(LAST_NAMES[nationality]!);
      const leadTier = rng.weighted(TIER_WEIGHTS);
      const leadAge = rng.int(26, 79);
      const ids: string[] = [];
      for (let p = 0; p < partySize; p++) {
        const nat = p === 0 || rng.chance(0.9) ? nationality : rng.weighted(NATIONALITIES[sailing.region]);
        const isChild = p >= 2 && rng.chance(0.6);
        const age = p === 0 ? leadAge : isChild ? rng.int(3, 17) : Math.max(18, leadAge + rng.int(-8, 8));
        const lastName = p === 0 || isChild || rng.chance(0.7) ? familyName : rng.pick(LAST_NAMES[nat]!);
        const birthYear = Number(sailing.departureDate.slice(0, 4)) - age - 1;
        const dateOfBirth = addDays(`${birthYear}-01-01`, rng.int(0, 364));
        const tier: LoyaltyTier = isChild ? 'Blue' : p === 0 || rng.chance(0.7) ? leadTier : rng.weighted(TIER_WEIGHTS);

        // Passport collection lags for sailings far in the future.
        const missingRate = daysOut <= 30 ? 0.03 : daysOut <= 90 ? 0.07 : 0.12;
        const passport = rng.chance(missingRate)
          ? { status: 'missing' as const, number: null, expiryDate: null, issuingCountry: null }
          : {
              status: 'on_file' as const,
              number: `${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))}${pad(rng.int(0, 9_999_999), 7)}`,
              expiryDate: addDays(AS_OF, rng.int(20, 3650)),
              issuingCountry: nat,
            };

        const specialRequests: SpecialRequest[] = [];
        if (rng.chance(0.1)) specialRequests.push({ type: 'dietary', detail: rng.pick(DIETARY), mobilityNeed: null });
        if (!isChild && rng.chance(age >= 65 ? 0.08 : 0.02)) {
          const [detail, need] = rng.pick(MOBILITY);
          specialRequests.push({ type: 'mobility', detail, mobilityNeed: need });
        }
        if (!isChild && rng.chance(0.02)) specialRequests.push({ type: 'medical', detail: rng.pick(MEDICAL), mobilityNeed: null });
        if (p === 0 && rng.chance(0.09)) {
          const celebrationDate = addDays(sailing.departureDate, rng.int(1, 6));
          const detail = rng.pick([
            `Birthday on ${celebrationDate}; would like a cake at dinner`,
            `${rng.pick(['10th', '25th', '30th', '40th', '50th'])} wedding anniversary on ${celebrationDate}`,
            'Honeymoon; requests champagne and flowers in cabin on embarkation',
            `Retirement celebration; dinner for the party on ${celebrationDate}`,
            `Vow renewal ceremony requested on ${celebrationDate}`,
          ]);
          specialRequests.push({ type: 'celebration', detail, mobilityNeed: null });
        }

        const id = `PX-${pad(nextPassenger++, 6)}`;
        ids.push(id);
        passengers.push({
          id,
          bookingId,
          firstName: rng.pick(FIRST_NAMES[nat]!),
          lastName,
          dateOfBirth,
          nationality: nat,
          loyaltyTier: tier,
          loyaltyNumber: `AH${nextLoyalty++}`,
          passport,
          specialRequests,
        });
      }
      return ids;
    };

    const fareFor = (category: CabinCategory, partySize: number): number => {
      const perGuest = FARE_PER_NIGHT[sailing.region][category] * sailing.nights;
      const guests = Math.min(partySize, 2) + Math.max(0, partySize - 2) * 0.5;
      return Math.round((perGuest * guests * (0.9 + rng.next() * 0.3)) / 5) * 5;
    };

    const channel = (): BookingChannel => rng.weighted([['direct', 45], ['travel_agent', 40], ['call_center', 15]] as const);

    const partySizeFor = (maxOccupancy: number): number =>
      rng.weighted(([[1, 10], [2, 68], [3, 14], [4, 8]] as const).filter(([n]) => n <= maxOccupancy));

    // Active bookings: one per occupied cabin.
    const cabins: { category: CabinCategory; number: string; maxOccupancy: number }[] = [];
    for (const cat of ship.cabinCategories) {
      const layout = CABIN_LAYOUT[cat.category];
      for (let c = 0; c < cat.cabins; c++) {
        const deck = layout.decks[c % layout.decks.length]!;
        cabins.push({ category: cat.category, number: `${deck}${layout.firstNumber + c}`, maxOccupancy: cat.maxOccupancy });
      }
    }
    const occupied = rng.shuffle(cabins).slice(0, Math.round(cabins.length * occupancy));
    occupied.sort((a, b) => (a.number < b.number ? -1 : 1));

    const sailingBookings: Booking[] = [];
    for (const cabin of occupied) {
      const id = `BK-${pad(nextBooking++, 6)}`;
      const partySize = partySizeFor(cabin.maxOccupancy);
      const totalFare = fareFor(cabin.category, partySize);
      const deposit = Math.round(totalFare * 0.2);
      const pending = rng.chance(0.08);
      let status: BookingStatus = 'confirmed';
      let bookedOn = addDays(sailing.departureDate, -rng.int(Math.max(daysOut, 1), Math.max(daysOut + 30, 330)));
      let amountPaid: number;
      let paymentDueDate = finalDue;
      if (pending) {
        status = 'pending_payment';
        if (finalDue <= AS_OF) {
          amountPaid = deposit; // final balance overdue
        } else {
          // A new hold: deposit not yet received.
          bookedOn = addDays(AS_OF, -rng.int(0, 9));
          amountPaid = 0;
          paymentDueDate = addDays(bookedOn, 7);
        }
      } else {
        amountPaid = finalDue <= AS_OF || rng.chance(0.3) ? totalFare : deposit;
      }
      const passengerIds = makePassengers(id, partySize);
      sailingBookings.push({
        id,
        sailingId: sailing.id,
        status,
        channel: channel(),
        cabinCategory: cabin.category,
        cabinNumber: cabin.number,
        leadPassengerId: passengerIds[0]!,
        passengerIds,
        bookedOn,
        currency: sailing.currency,
        totalFare,
        amountPaid,
        paymentDueDate,
        cancelledOn: null,
        cancellationReason: null,
        waitlistPosition: null,
      });
    }

    // Cancellations: cabin released, no cabin number.
    const cancelledCount = Math.round(occupied.length * (0.05 + rng.next() * 0.04));
    for (let c = 0; c < cancelledCount; c++) {
      const id = `BK-${pad(nextBooking++, 6)}`;
      const category = rng.weighted([['Inside', 2], ['Oceanview', 3], ['Balcony', 5], ['Suite', 1]] as const);
      const partySize = partySizeFor(3);
      const totalFare = fareFor(category, partySize);
      const bookedOn = addDays(sailing.departureDate, -rng.int(Math.max(daysOut + 10, 40), Math.max(daysOut + 40, 360)));
      const cancelledOn = addDays(bookedOn, rng.int(1, Math.max(1, daysBetween(bookedOn, AS_OF))));
      const passengerIds = makePassengers(id, partySize);
      sailingBookings.push({
        id,
        sailingId: sailing.id,
        status: 'cancelled',
        channel: channel(),
        cabinCategory: category,
        cabinNumber: null,
        leadPassengerId: passengerIds[0]!,
        passengerIds,
        bookedOn,
        currency: sailing.currency,
        totalFare,
        amountPaid: 0,
        paymentDueDate: finalDue,
        cancelledOn,
        cancellationReason: rng.pick(CANCELLATION_REASONS),
        waitlistPosition: null,
      });
    }

    // Cruise waitlist for nearly sold-out sailings.
    if (occupancy >= 0.88) {
      const waitlistCount = rng.int(2, 7);
      for (let w = 0; w < waitlistCount; w++) {
        const id = `BK-${pad(nextBooking++, 6)}`;
        const category = rng.weighted([['Balcony', 3], ['Suite', 2]] as const);
        const partySize = partySizeFor(2);
        const passengerIds = makePassengers(id, partySize);
        sailingBookings.push({
          id,
          sailingId: sailing.id,
          status: 'waitlisted',
          channel: channel(),
          cabinCategory: category,
          cabinNumber: null,
          leadPassengerId: passengerIds[0]!,
          passengerIds,
          bookedOn: addDays(AS_OF, -rng.int(1, 45)),
          currency: sailing.currency,
          totalFare: fareFor(category, partySize),
          amountPaid: 0,
          paymentDueDate: finalDue,
          cancelledOn: null,
          cancellationReason: null,
          waitlistPosition: w + 1,
        });
      }
    }
    bookings.push(...sailingBookings);
    const passengerById = new Map(passengers.map((p) => [p.id, p]));

    // Excursions at each port of call.
    const sailingExcursions: Excursion[] = [];
    for (const day of sailing.itinerary) {
      if (day.kind !== 'port' || day.port === null) continue;
      for (const [name, hours, price, capacity, activity, wheelchair, operatorConfirm] of EXCURSIONS[day.port] ?? []) {
        sailingExcursions.push({
          id: `EX-${pad(nextExcursion++, 5)}`,
          sailingId: sailing.id,
          port: day.port,
          date: day.date,
          name,
          durationHours: hours,
          pricePerGuest: price,
          currency: sailing.currency,
          capacity,
          originalCapacity: capacity,
          capacityNote: null,
          activityLevel: activity,
          wheelchairAccessible: wheelchair,
          requiresOperatorConfirmation: operatorConfirm,
        });
      }
    }
    const popularity = new Map<string, number>();
    for (const ex of sailingExcursions) {
      popularity.set(ex.id, EXCURSIONS[ex.port]!.find(([n]) => n === ex.name)![7]);
    }
    const ports = [...new Set(sailingExcursions.map((e) => e.port))];

    // Requests from active bookings, processed first-come-first-served.
    interface Request {
      excursion: Excursion;
      booking: Booking;
      passengerIds: string[];
      requestedOn: string;
    }
    const requests: Request[] = [];
    for (const booking of sailingBookings) {
      if (booking.status !== 'confirmed' && booking.status !== 'pending_payment') continue;
      if (!rng.chance(0.8)) continue;
      const chosenPorts = rng.shuffle(ports).slice(0, rng.int(2, Math.min(5, ports.length)));
      for (const port of chosenPorts) {
        const options = sailingExcursions.filter((e) => e.port === port);
        const excursion = rng.weighted(options.map((e) => [e, popularity.get(e.id)!] as const));
        const party =
          booking.passengerIds.length === 1 || rng.chance(0.75)
            ? booking.passengerIds
            : booking.passengerIds.slice(0, rng.int(1, booking.passengerIds.length - 1));
        // Guests with mobility needs usually skip unsuitable tours; occasionally one slips through.
        const guests = party.filter((pid) => {
          const need = passengerById.get(pid)?.specialRequests.find((r) => r.type === 'mobility')?.mobilityNeed;
          const unsuitable =
            (need === 'wheelchair' && !excursion.wheelchairAccessible) || (need === 'limited_walking' && excursion.activityLevel === 'strenuous');
          return !unsuitable || rng.chance(0.12);
        });
        if (guests.length === 0) continue;
        const window = Math.max(0, daysBetween(booking.bookedOn, AS_OF));
        requests.push({ excursion, booking, passengerIds: guests, requestedOn: addDays(booking.bookedOn, rng.int(0, window)) });
      }
    }
    requests.sort((a, b) =>
      a.requestedOn < b.requestedOn ? -1 : a.requestedOn > b.requestedOn ? 1 : a.booking.id < b.booking.id ? -1 : a.booking.id > b.booking.id ? 1 : 0,
    );

    const confirmedSeats = new Map<string, number>();
    const waitlistLength = new Map<string, number>();
    for (const req of requests) {
      const ex = req.excursion;
      const seats = confirmedSeats.get(ex.id) ?? 0;
      let status: ExcursionBooking['status'];
      let waitlistPosition: number | null = null;
      if (ex.requiresOperatorConfirmation && rng.chance(0.3)) {
        status = 'requested';
      } else if (seats + req.passengerIds.length <= ex.capacity) {
        status = 'confirmed';
        confirmedSeats.set(ex.id, seats + req.passengerIds.length);
      } else {
        status = 'waitlisted';
        waitlistPosition = (waitlistLength.get(ex.id) ?? 0) + 1;
        waitlistLength.set(ex.id, waitlistPosition);
      }
      excursionBookings.push({
        id: `XB-${pad(nextExcursionBooking++, 6)}`,
        excursionId: ex.id,
        bookingId: req.booking.id,
        passengerIds: req.passengerIds,
        status,
        requestedOn: req.requestedOn,
        waitlistPosition,
      });
    }

    // Operators sometimes cut capacity after seats were sold, leaving the excursion overbooked.
    // Always happens on the next few departures so the demo has something to find.
    if (daysOut <= 14 || rng.chance(0.4)) {
      const ranked = [...sailingExcursions].sort((a, b) => {
        const fa = (confirmedSeats.get(a.id) ?? 0) / a.capacity;
        const fb = (confirmedSeats.get(b.id) ?? 0) / b.capacity;
        return fb - fa || (a.id < b.id ? -1 : 1);
      });
      const target = ranked[rng.int(0, 2)]!;
      const sold = confirmedSeats.get(target.id) ?? 0;
      if (sold >= 8) {
        target.capacity = Math.max(4, Math.floor(sold * (0.7 + rng.next() * 0.15)));
        target.capacityNote = `Operator reduced capacity from ${target.originalCapacity} to ${target.capacity} (${rng.pick(CAPACITY_CUT_REASONS)})`;
      }
    }
    excursions.push(...sailingExcursions);
  }

  return {
    meta: {
      name: 'Azure Horizon Cruises demo operations data (fictional)',
      fictional: true,
      schemaVersion: 1,
      seed,
      asOf: AS_OF,
      generator: 'scripts/generate.ts',
    },
    ships: SHIPS,
    sailings,
    bookings,
    passengers,
    excursions,
    excursionBookings,
  };
}

export function serializeDataset(dataset: Dataset): string {
  return `${JSON.stringify(dataset)}\n`;
}
