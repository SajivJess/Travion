import { Injectable } from '@nestjs/common';
import axios from 'axios';

/**
 * Google Maps Geo Service
 * 
 * PURPOSE: Measure real distances, travel times, and get coordinates.
 * USE FOR: Distance Matrix, Geocoding, Directions, Route optimization.
 * DO NOT USE FOR: Finding places (use SerpAPI), Weather (use OpenWeather), 
 *                 Budget optimization (use Gemini).
 * 
 * ENABLES:
 * - Stay Optimizer (closest hotel to activity clusters)
 * - Fatigue-aware scheduling (avoid long commutes back-to-back)
 * - Travel cluster planning (group nearby attractions by day)
 * - Commute load estimation
 */

export interface GeoCoordinates {
  lat: number;
  lng: number;
}

export interface GeocodedPlace {
  name: string;
  lat: number;
  lng: number;
  formattedAddress: string;
  city?: string;
  state?: string;
  country?: string;
  types?: string[];
}

export interface DistanceResult {
  originName: string;
  destinationName: string;
  distanceKm: number;
  durationMinutes: number;
  durationInTraffic?: number;    // Minutes (peak hour)
  mode: 'driving' | 'walking' | 'transit' | 'bicycling';
}

export interface DistanceMatrix {
  origins: string[];
  destinations: string[];
  rows: Array<{
    elements: Array<{
      distanceKm: number;
      durationMinutes: number;
      status: string;
    }>;
  }>;
}

@Injectable()
export class GeoService {
  private readonly apiKey: string;
  // Cache geocoded coordinates to avoid repeated API calls
  private geocodeCache = new Map<string, GeocodedPlace>();

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    // apiKey is used only for Distance Matrix; geocoding uses Nominatim (free, no key)
  }

  // ===================================================
  // 📍 GEOCODING
  // ===================================================

  /**
   * Convert a place name to coordinates using OpenStreetMap Nominatim (free, no API key).
   */
  async geocode(placeName: string, context?: string): Promise<GeocodedPlace | null> {
    const cacheKey = `${placeName}|${context || ''}`;
    if (this.geocodeCache.has(cacheKey)) {
      return this.geocodeCache.get(cacheKey)!;
    }

    const result = await this.geocodeWithNominatim(placeName, context);
    if (result) {
      this.geocodeCache.set(cacheKey, result);
      return result;
    }

    console.debug(`geocoding failed for "${placeName}"`);
    return null;
  }

  /**
   * OpenStreetMap Nominatim Geocoding (free fallback, no API key needed)
   * https://nominatim.org/release-docs/develop/api/Search/
   */
  private async geocodeWithNominatim(placeName: string, context?: string): Promise<GeocodedPlace | null> {
    try {
      const query = context ? `${placeName}, ${context}` : placeName;

      const response = await axios.get(
        'https://nominatim.openstreetmap.org/search',
        {
          params: {
            q: query,
            format: 'json',
            addressdetails: 1,
            limit: 1,
          },
          headers: {
            'User-Agent': 'Travion-AI-Travel-Planner/1.0',
          },
          timeout: 5000,
        }
      );

      const result = response.data?.[0];
      if (!result) {
        return null;
      }

      const lat = parseFloat(result.lat);
      const lng = parseFloat(result.lon);
      const addr = result.address || {};

      const place: GeocodedPlace = {
        name: placeName,
        lat,
        lng,
        formattedAddress: result.display_name || placeName,
        city: addr.city || addr.town || addr.village || addr.county,
        state: addr.state,
        country: addr.country,
        types: result.type ? [result.type] : [],
      };

      return place;
    } catch (error: any) {
      console.warn(`⚠️ Nominatim geocoding failed for "${placeName}": ${error.message}`);
      return null;
    }
  }

  /**
   * Geocode multiple places at once (for batch coordinate lookup)
   */
  async geocodeBatch(
    placeNames: string[],
    context?: string,
  ): Promise<Map<string, GeocodedPlace>> {
    const results = new Map<string, GeocodedPlace>();
    
    // Process in parallel batches of 5 (respect API rate limits)
    const batchSize = 5;
    for (let i = 0; i < placeNames.length; i += batchSize) {
      const batch = placeNames.slice(i, i + batchSize);
      const promises = batch.map(name => this.geocode(name, context));
      const batchResults = await Promise.allSettled(promises);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          results.set(batch[index], result.value);
        }
      });
    }

    return results;
  }

  // ===================================================
  // 📏 DISTANCE MATRIX
  // ===================================================

  /**
   * Get travel distance and time between two places
   */
  async getDistance(
    origin: string | GeoCoordinates,
    destination: string | GeoCoordinates,
    mode: 'driving' | 'walking' | 'transit' | 'bicycling' = 'driving',
  ): Promise<DistanceResult | null> {
    if (!this.apiKey) return null;

    try {
      const originStr = typeof origin === 'string' ? origin : `${origin.lat},${origin.lng}`;
      const destStr = typeof destination === 'string' ? destination : `${destination.lat},${destination.lng}`;

      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        {
          params: {
            origins: originStr,
            destinations: destStr,
            mode,
            key: this.apiKey,
            departure_time: 'now',
          },
          timeout: 5000,
        }
      );

      const element = response.data.rows?.[0]?.elements?.[0];
      if (!element || element.status !== 'OK') {
        console.warn(`⚠️ Distance Matrix: ${element?.status || 'no result'} for ${originStr} → ${destStr}`);
        return null;
      }

      return {
        originName: response.data.origin_addresses?.[0] || originStr,
        destinationName: response.data.destination_addresses?.[0] || destStr,
        distanceKm: Math.round(element.distance.value / 100) / 10, // meters → km with 1 decimal
        durationMinutes: Math.round(element.duration.value / 60),
        durationInTraffic: element.duration_in_traffic ?
          Math.round(element.duration_in_traffic.value / 60) : undefined,
        mode,
      };
    } catch (error: any) {
      console.error(`❌ Distance Matrix failed:`, error.message);
      return null;
    }
  }

  /**
   * Calculate full N×N distance matrix between multiple places
   * Critical for: stay optimizer, cluster planning, route optimization
   */
  async getDistanceMatrix(
    origins: string[],
    destinations: string[],
    mode: 'driving' | 'walking' | 'transit' = 'driving',
  ): Promise<DistanceMatrix | null> {
    if (!this.apiKey) return null;

    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        {
          params: {
            origins: origins.join('|'),
            destinations: destinations.join('|'),
            mode,
            key: this.apiKey,
          },
          timeout: 10000,
        }
      );

      const data = response.data;
      if (data.status !== 'OK') {
        console.error(`❌ Distance Matrix failed: ${data.status}`);
        return null;
      }

      const matrix: DistanceMatrix = {
        origins: data.origin_addresses,
        destinations: data.destination_addresses,
        rows: data.rows.map((row: any) => ({
          elements: row.elements.map((el: any) => ({
            distanceKm: el.status === 'OK' ? Math.round(el.distance.value / 100) / 10 : -1,
            durationMinutes: el.status === 'OK' ? Math.round(el.duration.value / 60) : -1,
            status: el.status,
          })),
        })),
      };

      return matrix;
    } catch (error: any) {
      console.error(`❌ Distance Matrix batch failed:`, error.message);
      return null;
    }
  }

  /**
   * Group attractions into clusters based on proximity
   * Used for day-wise activity planning (nearby attractions on same day)
   */
  async clusterByProximity(
    places: Array<{ name: string; lat: number; lng: number }>,
    maxClusterRadiusKm: number = 10,
  ): Promise<Array<Array<{ name: string; lat: number; lng: number }>>> {
    if (places.length === 0) return [];
    if (places.length <= 3) return [places]; // No need to cluster

    // Simple greedy clustering using haversine distance
    const clusters: Array<Array<typeof places[0]>> = [];
    const used = new Set<number>();

    for (let i = 0; i < places.length; i++) {
      if (used.has(i)) continue;

      const cluster = [places[i]];
      used.add(i);

      for (let j = i + 1; j < places.length; j++) {
        if (used.has(j)) continue;

        const dist = this.haversineDistance(
          places[i].lat, places[i].lng,
          places[j].lat, places[j].lng,
        );

        if (dist <= maxClusterRadiusKm) {
          cluster.push(places[j]);
          used.add(j);
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * Find the optimal hotel position relative to activity clusters
   * Returns the hotel closest to the center of most activities
   */
  findOptimalStay(
    hotels: Array<{ name: string; lat: number; lng: number; costPerNight: number }>,
    activities: Array<{ name: string; lat: number; lng: number }>,
  ): { name: string; lat: number; lng: number; costPerNight: number; avgDistanceKm: number } | null {
    if (hotels.length === 0 || activities.length === 0) return null;

    // Calculate center of all activities
    const centerLat = activities.reduce((sum, a) => sum + a.lat, 0) / activities.length;
    const centerLng = activities.reduce((sum, a) => sum + a.lng, 0) / activities.length;

    // Score each hotel by average distance to all activities
    let bestHotel: typeof hotels[0] & { avgDistanceKm: number } = { ...hotels[0], avgDistanceKm: Infinity };

    for (const hotel of hotels) {
      const avgDist = activities.reduce((sum, act) => {
        return sum + this.haversineDistance(hotel.lat, hotel.lng, act.lat, act.lng);
      }, 0) / activities.length;

      if (avgDist < bestHotel.avgDistanceKm) {
        bestHotel = { ...hotel, avgDistanceKm: Math.round(avgDist * 10) / 10 };
      }
    }

    return bestHotel;
  }

  /**
   * Haversine formula for quick straight-line distance (km)
   * Used for clustering; Distance Matrix API for accurate road distance
   */
  haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Sort activities by optimal visit order to minimize travel
   * Simple nearest-neighbor TSP approximation
   */
  async optimizeRouteOrder(
    places: Array<{ name: string; lat: number; lng: number }>,
    startPoint?: GeoCoordinates,
  ): Promise<Array<{ name: string; lat: number; lng: number; order: number }>> {
    if (places.length <= 2) {
      return places.map((p, i) => ({ ...p, order: i }));
    }

    const ordered: typeof places = [];
    const remaining = [...places];

    // Start from first place or the given start point
    let current = startPoint || { lat: places[0].lat, lng: places[0].lng };

    while (remaining.length > 0) {
      // Find nearest unvisited place
      let nearestIdx = 0;
      let nearestDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const dist = this.haversineDistance(
          current.lat, current.lng,
          remaining[i].lat, remaining[i].lng,
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }

      const next = remaining.splice(nearestIdx, 1)[0];
      ordered.push(next);
      current = { lat: next.lat, lng: next.lng };
    }

    return ordered.map((p, i) => ({ ...p, order: i }));
  }

  /**
   * Check if two places are in different countries
   */
  async areDifferentCountries(place1: string, place2: string): Promise<boolean> {
    const geo1 = await this.geocode(place1);
    const geo2 = await this.geocode(place2);

    if (!geo1 || !geo2) return false;
    return !!geo1.country && !!geo2.country && geo1.country !== geo2.country;
  }
}
