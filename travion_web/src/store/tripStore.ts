import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SavedTrip {
  jobId: string;
  destination: string;
  source: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  budget: number;
  travelers: number;
  travelStyle: string;
  createdAt: string;
}

interface TripStoreState {
  savedTrips: SavedTrip[];
  addTrip: (trip: SavedTrip) => void;
  removeTrip: (jobId: string) => void;
  clearTrips: () => void;
}

export const useTripStore = create<TripStoreState>()(
  persist(
    (set) => ({
      savedTrips: [],
      addTrip: (trip) =>
        set((state) => ({
          savedTrips: [
            trip,
            ...state.savedTrips.filter((t) => t.jobId !== trip.jobId),
          ],
        })),
      removeTrip: (jobId) =>
        set((state) => ({
          savedTrips: state.savedTrips.filter((t) => t.jobId !== jobId),
        })),
      clearTrips: () => set({ savedTrips: [] }),
    }),
    { name: 'travion-trips' },
  ),
);
