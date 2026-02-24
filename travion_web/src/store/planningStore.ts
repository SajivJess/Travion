import { create } from 'zustand';

// Type exports
export type Step = 'intro' | 'intent' | 'dates' | 'style' | 'budget' | 'energy' | 'transport' | 'review' | 'generating' | 'itinerary' | 'monitoring';
export type TravelStyle = 'Relaxed' | 'Cultural' | 'Adventure' | 'Spiritual' | 'Party' | 'Nature';
export type ArrivalEnergy = 'Low' | 'Normal' | 'Energetic';
export type TransportMode = 'Flight' | 'Train' | 'Bus';
export type MealPreference = 'Any' | 'Vegetarian' | 'Vegan';

interface PlanningState {
  currentStep: Step;
  source: string;
  destination: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  travelStyle: TravelStyle | null;
  budget: number;
  arrivalEnergy: ArrivalEnergy | null;
  arrivalTime: string;
  transportMode: TransportMode;
  travelers: number;
  mealPreference: MealPreference;

  // Job state
  jobId: string | null;
  jobStatus: string | null;
  jobError: string | null;
  itinerary: Record<string, unknown> | null;

  // Actions
  setStep: (step: Step) => void;
  setSource: (source: string) => void;
  setDestination: (dest: string) => void;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  setDateRange: (start: string, end: string) => void;
  setTravelStyle: (style: TravelStyle) => void;
  setBudget: (amount: number) => void;
  setArrivalEnergy: (energy: ArrivalEnergy) => void;
  setArrivalTime: (time: string) => void;
  setTransportMode: (mode: TransportMode) => void;
  setTravelers: (count: number) => void;
  setMealPreference: (pref: MealPreference) => void;
  setJobId: (id: string | null) => void;
  setJobStatus: (status: string | null) => void;
  setJobError: (error: string | null) => void;
  setItinerary: (data: Record<string, unknown> | null) => void;
  reset: () => void;
}

const getDefaultDates = () => {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 3);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
};

const defaults = getDefaultDates();

export const usePlanningStore = create<PlanningState>((set) => ({
  currentStep: 'intro',
  source: '',
  destination: '',
  startDate: defaults.startDate,
  endDate: defaults.endDate,
  travelStyle: null,
  budget: 25000,
  arrivalEnergy: null,
  arrivalTime: '12:00 PM',
  transportMode: 'Flight',
  travelers: 2,
  mealPreference: 'Any',
  jobId: null,
  jobStatus: null,
  jobError: null,
  itinerary: null,

  setStep: (step) => set({ currentStep: step }),
  setSource: (source) => set({ source }),
  setDestination: (dest) => set({ destination: dest }),
  setStartDate: (date) => set({ startDate: date }),
  setEndDate: (date) => set({ endDate: date }),
  setDateRange: (start, end) => set({ startDate: start, endDate: end }),
  setTravelStyle: (style) => set({ travelStyle: style }),
  setBudget: (amount) => set({ budget: amount }),
  setArrivalEnergy: (energy) => set({ arrivalEnergy: energy }),
  setArrivalTime: (time) => set({ arrivalTime: time }),
  setTransportMode: (mode) => set({ transportMode: mode }),
  setTravelers: (count) => set({ travelers: count }),
  setMealPreference: (pref) => set({ mealPreference: pref }),
  setJobId: (id) => set({ jobId: id }),
  setJobStatus: (status) => set({ jobStatus: status }),
  setJobError: (error) => set({ jobError: error }),
  setItinerary: (data) => set({ itinerary: data }),
  reset: () => {
    const d = getDefaultDates();
    set({
      currentStep: 'intro',
      source: '',
      destination: '',
      startDate: d.startDate,
      endDate: d.endDate,
      travelStyle: null,
      budget: 25000,
      arrivalEnergy: null,
      arrivalTime: '12:00 PM',
      transportMode: 'Flight',
      travelers: 2,
      mealPreference: 'Any',
      jobId: null,
      jobStatus: null,
      jobError: null,
      itinerary: null,
    });
  },
}));
