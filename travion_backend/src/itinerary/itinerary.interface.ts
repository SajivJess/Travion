export interface Activity {
  time: string;
  name: string;
  description: string;
  estimatedCost: number;
  duration: string;
  category: string;
}

export interface Meals {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
}

export interface DayPlan {
  day: number;
  date: string;
  theme: string;
  activities: Activity[];
  totalCost: number;
  meals: Meals;
}

export interface TripSummary {
  destination: string;
  duration: number;
  totalBudget: number;
  travelStyle: string;
}

export interface BudgetBreakdown {
  accommodation: number;
  food: number;
  activities: number;
  transport: number;
  miscellaneous: number;
  total: number;
}

export interface HotelStay {
  name: string;
  location: string;
  locality: string;
  checkIn: string;
  checkOut: string;
  costPerNight: number;
  nights: number;
  category: string;
  amenities: string[];
  description: string;
}

export interface Optimization {
  budgetPerDay: number;
  transportMode: string;
  savingsTips: string[];
  bestTimeToVisit: string;
  packingEssentials: string[];
  avgDailySpending: number;
}

export interface TransportTier {
  mode: string;
  estDailyCost: number;
  notes: string;
}

export interface AirportTransferPlan {
  mode: string;
  estCost: number;
  notes: string;
}

export interface TransportPlan {
  midBudget: TransportTier;
  premium: TransportTier;
  airportOrRailTransfers: AirportTransferPlan;
}

export interface FlightOption {
  airline: string;
  departureTime: string;
  arrivalTime: string;
  duration: number; // in minutes
  cost: number; // per person
  stops: number;
  flightNumber: string;
  bookingUrl?: string; // Deep link to booking site
  airlineLogo?: string; // Airline logo URL
}

export interface FlightInfo {
  outbound: FlightOption;
  return?: FlightOption;
  totalCost: number; // total cost for all passengers
  warning?: string;
}

export interface DayScheduleWarning {
  day: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  freeTimeMinutes: number;
  recommendation: string;
}

export interface ScheduleAnalysis {
  hasInternationalFlight: boolean;
  flightInfo?: FlightInfo;
  dayWarnings: DayScheduleWarning[];
  firstActivityTime?: string;
  arrivalTime?: string;
}

// ─── IMAGE DATA ────────────────────────────────────────────────────────────

export interface PlaceImageData {
  place: string;
  imageUrl: string;
  thumbnailUrl?: string;
  title?: string;
  source?: string;
}

export interface ItineraryImages {
  destination?: PlaceImageData;
  /** Keyed by attraction/place name */
  attractions: Record<string, PlaceImageData>;
  /** Keyed by hotel name */
  hotels: Record<string, PlaceImageData>;
  /** Keyed by restaurant name */
  restaurants: Record<string, PlaceImageData>;
}

export interface Itinerary {
  tripSummary: TripSummary;
  hotelStays: HotelStay[];
  days: DayPlan[];
  budgetBreakdown: BudgetBreakdown;
  optimization: Optimization;
  transportPlan: TransportPlan;
  helplines: string[];
  guideContacts: string[];
  recommendations: string[];
  flightInfo?: FlightInfo;
  scheduleAnalysis?: ScheduleAnalysis;
  /** High-resolution images fetched post-discovery */
  images?: ItineraryImages;
  /** Government tourism advisories for this destination */
  tourismAdvisories?: { alert: string; type: string; crowdImpact: string }[];
  /** Official tourism board POIs */
  officialPois?: { name: string; category: string; lat?: number; lng?: number }[];
}
