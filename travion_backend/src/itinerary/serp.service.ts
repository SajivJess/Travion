import { Injectable } from '@nestjs/common';
import axios from 'axios';

/**
 * Google Places Discovery Service
 * 
 * PURPOSE: Discover REAL places using Google Places API (New) directly.
 * USE FOR: Hotels, Attractions, Restaurants, Nearby POIs
 * DO NOT USE FOR: Distance, Travel time, Weather, Budget optimization
 * 
 * Uses the same GOOGLE_MAPS_API_KEY already configured for geocoding.
 * No SerpAPI dependency needed for discovery — SerpAPI is only used for flights.
 */

export interface DiscoveredHotel {
  name: string;
  rating: number;
  reviews: number;
  pricePerNight: number;       // INR
  amenities: string[];
  location: string;            // Address
  category: string;            // Budget / Mid-range / Luxury
  thumbnail?: string;
  link?: string;
  gpsCoordinates?: { lat: number; lng: number };
}

export interface DiscoveredAttraction {
  name: string;
  rating: number;
  reviews: number;
  description: string;
  category: string;            // Sightseeing / Museum / Park / Beach / Temple / Adventure
  address: string;
  thumbnail?: string;
  gpsCoordinates?: { lat: number; lng: number };
  openingHours?: string;
  entryFee?: number;           // INR (0 if free)
}

export interface DiscoveredRestaurant {
  name: string;
  rating: number;
  reviews: number;
  cuisine: string;
  priceLevel: string;          // $ / $$ / $$$ / $$$$
  address: string;
  gpsCoordinates?: { lat: number; lng: number };
}

@Injectable()
export class SerpService {
  private readonly apiKey: string;
  private readonly placesBaseUrl = 'https://places.googleapis.com/v1/places';
  private readonly serpApiKeys: string[];
  private serpKeyIndex = 0;

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    this.serpApiKeys = [
      process.env.SERP_API_KEY,
      process.env.SERP_API_KEY_2,
      process.env.SERP_API_KEY_3,
      process.env.SERP_API_KEY_4,
      process.env.SERP_API_KEY_5,
    ].filter(Boolean) as string[];

    if (!this.apiKey && this.serpApiKeys.length === 0) {
      console.error('❌ No GOOGLE_MAPS_API_KEY or SERP_API_KEY configured! Discovery will not work.');
    } else {
      console.log(`🔍 Discovery Service initialized (Google Places + ${this.serpApiKeys.length} SerpAPI keys)`);
    }
  }

  private getNextSerpKey(): string {
    const key = this.serpApiKeys[this.serpKeyIndex];
    this.serpKeyIndex = (this.serpKeyIndex + 1) % this.serpApiKeys.length;
    return key;
  }

  // ===================================================
  // 🔎 CORE: Google Places Text Search (New API)
  // ===================================================

  /**
   * Search places using Google Places API (New) — Text Search
   * https://developers.google.com/maps/documentation/places/web-service/text-search
   */
  private async textSearch(
    query: string,
    options: {
      includedType?: string;
      locationBias?: { lat: number; lng: number; radiusMeters?: number };
      maxResultCount?: number;
      priceLevels?: string[];
      languageCode?: string;
      regionCode?: string;
    } = {},
  ): Promise<any[]> {
    try {
      const fieldMask = [
        'places.displayName',
        'places.formattedAddress',
        'places.rating',
        'places.userRatingCount',
        'places.priceLevel',
        'places.types',
        'places.location',
        'places.photos',
        'places.regularOpeningHours',
        'places.editorialSummary',
        'places.primaryType',
        'places.googleMapsUri',
        'places.websiteUri',
      ].join(',');

      const body: any = {
        textQuery: query,
        languageCode: options.languageCode || 'en',
        regionCode: options.regionCode || 'in',
        maxResultCount: options.maxResultCount || 10,
      };

      if (options.includedType) {
        body.includedType = options.includedType;
      }

      if (options.priceLevels && options.priceLevels.length > 0) {
        body.priceLevels = options.priceLevels;
      }

      if (options.locationBias) {
        body.locationBias = {
          circle: {
            center: {
              latitude: options.locationBias.lat,
              longitude: options.locationBias.lng,
            },
            radius: options.locationBias.radiusMeters || 50000,
          },
        };
      }

      const response = await axios.post(
        `${this.placesBaseUrl}:searchText`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': fieldMask,
          },
          timeout: 15000,
        },
      );

      return response.data?.places || [];
    } catch (error: any) {
      console.error(`❌ Google Places Text Search failed for "${query}":`, error.response?.data?.error?.message || error.message);
      return [];
    }
  }

  /**
   * Search places using Google Places API (Legacy) — as fallback
   * Uses the older Text Search endpoint that's more forgiving with queries
   */
  private async legacyTextSearch(query: string, type?: string): Promise<any[]> {
    try {
      const params: any = {
        query,
        key: this.apiKey,
        language: 'en',
        region: 'in',
      };
      if (type) params.type = type;

      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/textsearch/json',
        { params, timeout: 15000 },
      );

      return response.data?.results || [];
    } catch (error: any) {
      console.error(`❌ Legacy Places search failed for "${query}":`, error.message);
      return [];
    }
  }

  /**
   * Get a photo URL from a place photo reference (New API)
   */
  private getPhotoUrl(photoName: string, maxWidth = 400): string {
    if (!photoName) return '';
    return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${this.apiKey}`;
  }

  /**
   * Get photo URL from legacy API photo_reference
   */
  private getLegacyPhotoUrl(photoReference: string, maxWidth = 400): string {
    if (!photoReference) return '';
    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${this.apiKey}`;
  }

  // ===================================================
  // 🏨 HOTEL DISCOVERY
  // ===================================================

  async discoverHotels(
    destination: string,
    checkInDate: string,
    checkOutDate: string,
    travelStyle: string,
    adults: number = 2,
  ): Promise<DiscoveredHotel[]> {
    console.log(`🏨 Discovering hotels in ${destination} (${travelStyle}) via Google Places...`);

    try {
      const styleQuery = travelStyle === 'Luxury' ? 'luxury 5 star' :
                         travelStyle === 'Budget' ? 'budget affordable' :
                         travelStyle === 'Backpacker' ? 'hostel budget' : 'popular';

      // Try legacy Google Places API first
      if (this.apiKey) {
        console.log(`   Using legacy Places API for hotels...`);
        const legacyResults = await this.legacyTextSearch(
          `${styleQuery} hotels in ${destination}`,
          'lodging',
        );
        
        if (legacyResults.length > 0) {
          return this.parseLegacyHotels(legacyResults, travelStyle);
        }
      }
      
      // Fallback to SerpAPI Google Maps search
      if (this.serpApiKeys.length > 0) {
        console.log(`   🔄 Falling back to SerpAPI for hotels in ${destination}...`);
        return await this.discoverHotelsViaSerpAPI(destination, travelStyle);
      }
      
      console.warn(`   No hotels found for ${destination}`);
      return [];
    } catch (error: any) {
      console.error(`❌ Hotel discovery failed:`, error.message);
      return [];
    }
  }

  /**
   * Discover hotels using SerpAPI Google Maps engine
   */
  private async discoverHotelsViaSerpAPI(destination: string, travelStyle: string): Promise<DiscoveredHotel[]> {
    try {
      const styleQuery = travelStyle === 'Luxury' ? 'luxury hotels' :
                         travelStyle === 'Budget' ? 'budget hotels' :
                         travelStyle === 'Backpacker' ? 'hostels' : 'hotels';
      const apiKey = this.getNextSerpKey();
      const response = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google_maps',
          q: `${styleQuery} in ${destination}`,
          type: 'search',
          hl: 'en',
          api_key: apiKey,
        },
        timeout: 15000,
      });

      const results = response.data?.local_results || [];
      if (results.length === 0) {
        console.warn(`   SerpAPI: No hotel results for ${destination}`);
        return [];
      }

      const hotels: DiscoveredHotel[] = results.slice(0, 10).map((r: any) => {
        const pricePerNight = r.price ? this.extractSerpPrice(r.price) :
          this.estimateHotelPrice(undefined, travelStyle);
        return {
          name: r.title || 'Unknown Hotel',
          rating: r.rating || 0,
          reviews: r.reviews || 0,
          pricePerNight,
          amenities: this.extractSerpAmenities(r.type || ''),
          location: r.address || destination,
          category: this.categorizeHotel(pricePerNight, travelStyle),
          thumbnail: r.thumbnail || undefined,
          link: r.place_id ? `https://www.google.com/maps/place/?q=place_id:${r.place_id}` : undefined,
          gpsCoordinates: r.gps_coordinates ? {
            lat: r.gps_coordinates.latitude,
            lng: r.gps_coordinates.longitude,
          } : undefined,
        };
      });

      console.log(`✅ SerpAPI found ${hotels.length} hotels in ${destination}`);
      return hotels;
    } catch (error: any) {
      console.warn(`⚠️ SerpAPI hotel search failed: ${error.message}`);
      return [];
    }
  }

  private parseLegacyHotels(results: any[], travelStyle: string): DiscoveredHotel[] {
    return results.slice(0, 10).map((p: any) => {
      const pricePerNight = this.estimateHotelPrice(
        this.legacyPriceToNew(p.price_level),
        travelStyle,
      );
      return {
        name: p.name || 'Unknown Hotel',
        rating: p.rating || 0,
        reviews: p.user_ratings_total || 0,
        pricePerNight,
        amenities: this.extractAmenities(p.types || []),
        location: p.formatted_address || p.vicinity || '',
        category: this.categorizeHotel(pricePerNight, travelStyle),
        thumbnail: p.photos?.[0]?.photo_reference
          ? this.getLegacyPhotoUrl(p.photos[0].photo_reference) : undefined,
        gpsCoordinates: p.geometry?.location ? {
          lat: p.geometry.location.lat,
          lng: p.geometry.location.lng,
        } : undefined,
      };
    });
  }

  /**
   * Estimate INR price per night from Google's price_level
   */
  private estimateHotelPrice(priceLevel: string | undefined, travelStyle: string): number {
    switch (priceLevel) {
      case 'PRICE_LEVEL_FREE': return 0;
      case 'PRICE_LEVEL_INEXPENSIVE': return 1500;
      case 'PRICE_LEVEL_MODERATE': return 4000;
      case 'PRICE_LEVEL_EXPENSIVE': return 8000;
      case 'PRICE_LEVEL_VERY_EXPENSIVE': return 15000;
      default:
        // No price level — estimate from travel style
        if (travelStyle === 'Luxury') return 12000;
        if (travelStyle === 'Budget' || travelStyle === 'Backpacker') return 1500;
        return 4000; // Mid-range default
    }
  }

  private legacyPriceToNew(level: number | undefined): string | undefined {
    if (level === undefined || level === null) return undefined;
    const map: Record<number, string> = {
      0: 'PRICE_LEVEL_FREE',
      1: 'PRICE_LEVEL_INEXPENSIVE',
      2: 'PRICE_LEVEL_MODERATE',
      3: 'PRICE_LEVEL_EXPENSIVE',
      4: 'PRICE_LEVEL_VERY_EXPENSIVE',
    };
    return map[level];
  }

  private extractAmenities(types: string[]): string[] {
    const amenityMap: Record<string, string> = {
      'swimming_pool': 'Pool', 'spa': 'Spa', 'gym': 'Gym', 'fitness_center': 'Gym',
      'restaurant': 'Restaurant', 'bar': 'Bar', 'parking': 'Parking',
      'free_parking': 'Free Parking', 'wifi': 'WiFi', 'airport_shuttle': 'Airport Shuttle',
      'room_service': 'Room Service', 'laundry_service': 'Laundry',
    };
    return types.filter(t => amenityMap[t]).map(t => amenityMap[t]);
  }

  private categorizeHotel(pricePerNight: number, travelStyle: string): string {
    if (pricePerNight <= 2000) return 'Budget';
    if (pricePerNight <= 5000) return 'Mid-range';
    if (pricePerNight <= 12000) return 'Comfort';
    return 'Luxury';
  }

  // ===================================================
  // 🏞️ ATTRACTION DISCOVERY
  // ===================================================

  async discoverAttractions(
    destination: string,
    categories: string[] = ['tourist attractions', 'museums', 'parks', 'temples', 'beaches'],
  ): Promise<DiscoveredAttraction[]> {
    console.log(`🏞️ Discovering attractions in ${destination} via Google Places...`);

    const allAttractions: DiscoveredAttraction[] = [];
    const seenNames = new Set<string>();

    // Search multiple categories in parallel
    const searches = categories.map(category =>
      this.searchAttractions(destination, category),
    );

    const results = await Promise.allSettled(searches);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const attraction of result.value) {
          const normalizedName = attraction.name.toLowerCase().trim();
          if (!seenNames.has(normalizedName)) {
            seenNames.add(normalizedName);
            allAttractions.push(attraction);
          }
        }
      }
    }

    // If Google Places returned nothing, try SerpAPI
    if (allAttractions.length === 0 && this.serpApiKeys.length > 0) {
      console.log(`   🔄 Falling back to SerpAPI for attractions in ${destination}...`);
      const serpResults = await this.discoverAttractionsViaSerpAPI(destination);
      for (const attraction of serpResults) {
        const normalizedName = attraction.name.toLowerCase().trim();
        if (!seenNames.has(normalizedName)) {
          seenNames.add(normalizedName);
          allAttractions.push(attraction);
        }
      }
    }

    console.log(`✅ Found ${allAttractions.length} unique attractions in ${destination}`);
    return allAttractions;
  }

  /**
   * Discover attractions using SerpAPI Google Maps engine
   */
  private async discoverAttractionsViaSerpAPI(destination: string): Promise<DiscoveredAttraction[]> {
    try {
      const apiKey = this.getNextSerpKey();
      const response = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google_maps',
          q: `top tourist attractions in ${destination}`,
          type: 'search',
          hl: 'en',
          api_key: apiKey,
        },
        timeout: 15000,
      });

      const results = response.data?.local_results || [];
      if (results.length === 0) {
        console.warn(`   SerpAPI: No attraction results for ${destination}`);
        return [];
      }

      const attractions: DiscoveredAttraction[] = results.slice(0, 15).map((r: any) => ({
        name: r.title || 'Unknown Attraction',
        rating: r.rating || 0,
        reviews: r.reviews || 0,
        description: r.type || r.description || 'Tourist Attraction',
        category: this.categorizeAttraction(r.type || '', r.type),
        address: r.address || destination,
        thumbnail: r.thumbnail || undefined,
        gpsCoordinates: r.gps_coordinates ? {
          lat: r.gps_coordinates.latitude,
          lng: r.gps_coordinates.longitude,
        } : undefined,
      }));

      console.log(`✅ SerpAPI found ${attractions.length} attractions in ${destination}`);
      return attractions;
    } catch (error: any) {
      console.warn(`⚠️ SerpAPI attraction search failed: ${error.message}`);
      return [];
    }
  }

  private async searchAttractions(destination: string, category: string): Promise<DiscoveredAttraction[]> {
    try {
      // Use legacy API directly (New API requires billing)
      const legacy = await this.legacyTextSearch(`top ${category} in ${destination}`, 'tourist_attraction');
      if (legacy.length > 0) {
        return legacy.slice(0, 8).map((p: any) => ({
          name: p.name || 'Unknown Attraction',
          rating: p.rating || 0,
          reviews: p.user_ratings_total || 0,
          description: category,
          category: this.categorizeAttraction(category, p.types?.join(' ')),
          address: p.formatted_address || p.vicinity || destination,
          thumbnail: p.photos?.[0]?.photo_reference
            ? this.getLegacyPhotoUrl(p.photos[0].photo_reference) : undefined,
          gpsCoordinates: p.geometry?.location ? {
            lat: p.geometry.location.lat,
            lng: p.geometry.location.lng,
          } : undefined,
        }));
      }

      // New API code disabled (requires billing)
      return [];
    } catch (error: any) {
      console.warn(`⚠️ Attraction search failed for "${category}" in ${destination}:`, error.message);
      return [];
    }
  }

  private categorizeAttraction(searchCategory: string, placeType?: string): string {
    const cat = (searchCategory + ' ' + (placeType || '')).toLowerCase();
    if (cat.includes('museum') || cat.includes('gallery')) return 'Museum';
    if (cat.includes('temple') || cat.includes('church') || cat.includes('mosque')) return 'Religious';
    if (cat.includes('beach')) return 'Beach';
    if (cat.includes('park') || cat.includes('garden')) return 'Park';
    if (cat.includes('adventure') || cat.includes('trek')) return 'Adventure';
    if (cat.includes('shopping') || cat.includes('market')) return 'Shopping';
    if (cat.includes('nightlife') || cat.includes('club') || cat.includes('bar')) return 'Nightlife';
    return 'Sightseeing';
  }

  // ===================================================
  // 🍽️ RESTAURANT DISCOVERY
  // ===================================================

  async discoverRestaurants(
    destination: string,
    mealPreference?: string,
    travelStyle?: string,
  ): Promise<DiscoveredRestaurant[]> {
    console.log(`🍽️ Discovering restaurants in ${destination} via Google Places...`);

    try {
      const priceWord = travelStyle === 'Luxury' ? 'fine dining' :
                        travelStyle === 'Budget' ? 'affordable' : 'popular';
      const dietWord = mealPreference === 'Vegetarian' ? 'vegetarian' :
                       mealPreference === 'Vegan' ? 'vegan' : '';
      const query = `best ${dietWord} ${priceWord} restaurants in ${destination}`.trim();

      // Try legacy Google Places API first
      if (this.apiKey) {
        console.log(`   Using legacy Places API for restaurants...`);
        const legacy = await this.legacyTextSearch(query, 'restaurant');
        if (legacy.length > 0) {
          const restaurants = this.parseLegacyRestaurants(legacy);
          console.log(`✅ Found ${restaurants.length} restaurants in ${destination}`);
          return restaurants;
        }
      }

      // Fallback to SerpAPI
      if (this.serpApiKeys.length > 0) {
        console.log(`   🔄 Falling back to SerpAPI for restaurants in ${destination}...`);
        return await this.discoverRestaurantsViaSerpAPI(destination, mealPreference, travelStyle);
      }

      console.log(`✅ Found 0 restaurants in ${destination}`);
      return [];
    } catch (error: any) {
      console.error(`❌ Restaurant discovery failed:`, error.message);
      return [];
    }
  }

  /**
   * Discover restaurants using SerpAPI Google Maps engine
   */
  private async discoverRestaurantsViaSerpAPI(
    destination: string,
    mealPreference?: string,
    travelStyle?: string,
  ): Promise<DiscoveredRestaurant[]> {
    try {
      const priceWord = travelStyle === 'Luxury' ? 'fine dining' :
                        travelStyle === 'Budget' ? 'affordable' : 'popular';
      const dietWord = mealPreference === 'Vegetarian' ? 'vegetarian' :
                       mealPreference === 'Vegan' ? 'vegan' : '';
      const query = `best ${dietWord} ${priceWord} restaurants in ${destination}`.trim();

      const apiKey = this.getNextSerpKey();
      const response = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google_maps',
          q: query,
          type: 'search',
          hl: 'en',
          api_key: apiKey,
        },
        timeout: 15000,
      });

      const results = response.data?.local_results || [];
      if (results.length === 0) {
        console.warn(`   SerpAPI: No restaurant results for ${destination}`);
        return [];
      }

      const restaurants: DiscoveredRestaurant[] = results.slice(0, 10).map((r: any) => ({
        name: r.title || 'Unknown Restaurant',
        rating: r.rating || 0,
        reviews: r.reviews || 0,
        cuisine: r.type || 'Local Cuisine',
        priceLevel: r.price ? r.price : '$$',
        address: r.address || destination,
        gpsCoordinates: r.gps_coordinates ? {
          lat: r.gps_coordinates.latitude,
          lng: r.gps_coordinates.longitude,
        } : undefined,
      }));

      console.log(`✅ SerpAPI found ${restaurants.length} restaurants in ${destination}`);
      return restaurants;
    } catch (error: any) {
      console.warn(`⚠️ SerpAPI restaurant search failed: ${error.message}`);
      return [];
    }
  }

  private parseLegacyRestaurants(results: any[]): DiscoveredRestaurant[] {
    return results.slice(0, 10).map((p: any) => ({
      name: p.name || 'Unknown Restaurant',
      rating: p.rating || 0,
      reviews: p.user_ratings_total || 0,
      cuisine: p.types?.find((t: string) => !['restaurant', 'food', 'point_of_interest', 'establishment'].includes(t)) || 'Local Cuisine',
      priceLevel: this.legacyPriceToSymbol(p.price_level),
      address: p.formatted_address || p.vicinity || '',
      gpsCoordinates: p.geometry?.location ? {
        lat: p.geometry.location.lat,
        lng: p.geometry.location.lng,
      } : undefined,
    }));
  }

  /**
   * Extract numeric price from SerpAPI price strings like "₹2,500" or "$50"
   */
  private extractSerpPrice(priceStr: string): number {
    if (!priceStr) return 4000;
    const digits = priceStr.replace(/[^0-9]/g, '');
    const val = parseInt(digits, 10);
    if (isNaN(val) || val === 0) return 4000;
    // If it looks like USD (< 500), convert to INR
    if (val < 500 && priceStr.includes('$')) return val * 85;
    return val;
  }

  /**
   * Extract amenity keywords from SerpAPI type strings
   */
  private extractSerpAmenities(typeStr: string): string[] {
    const amenities: string[] = [];
    const lower = typeStr.toLowerCase();
    if (lower.includes('pool') || lower.includes('swim')) amenities.push('Pool');
    if (lower.includes('spa')) amenities.push('Spa');
    if (lower.includes('gym') || lower.includes('fitness')) amenities.push('Gym');
    if (lower.includes('restaurant') || lower.includes('dining')) amenities.push('Restaurant');
    if (lower.includes('wifi') || lower.includes('internet')) amenities.push('WiFi');
    if (lower.includes('parking')) amenities.push('Parking');
    if (lower.includes('bar') || lower.includes('lounge')) amenities.push('Bar');
    return amenities;
  }

  private priceLevelToSymbol(level: string | undefined): string {
    switch (level) {
      case 'PRICE_LEVEL_FREE': return 'Free';
      case 'PRICE_LEVEL_INEXPENSIVE': return '$';
      case 'PRICE_LEVEL_MODERATE': return '$$';
      case 'PRICE_LEVEL_EXPENSIVE': return '$$$';
      case 'PRICE_LEVEL_VERY_EXPENSIVE': return '$$$$';
      default: return '$$';
    }
  }

  private legacyPriceToSymbol(level: number | undefined): string {
    if (level === undefined || level === null) return '$$';
    return ['Free', '$', '$$', '$$$', '$$$$'][level] || '$$';
  }

  // ===================================================
  // 🧭 NEARBY POI DISCOVERY (for cluster planning)
  // ===================================================

  async discoverNearbyPOIs(
    placeName: string,
    destination: string,
    type: 'restaurants' | 'attractions' | 'hotels' = 'restaurants',
  ): Promise<Array<{ name: string; rating: number; address: string; type: string }>> {
    try {
      const includedType = type === 'restaurants' ? 'restaurant' :
                           type === 'hotels' ? 'hotel' : undefined;

      const places = await this.textSearch(
        `${type} near ${placeName} ${destination}`,
        { includedType, maxResultCount: 5 },
      );

      if (places.length === 0) {
        // Fallback to legacy
        const legacy = await this.legacyTextSearch(`${type} near ${placeName} ${destination}`, includedType);
        return legacy.slice(0, 5).map((p: any) => ({
          name: p.name || 'Unknown',
          rating: p.rating || 0,
          address: p.formatted_address || p.vicinity || '',
          type: p.types?.[0] || type,
        }));
      }

      return places.map((p: any) => ({
        name: p.displayName?.text || 'Unknown',
        rating: p.rating || 0,
        address: p.formattedAddress || '',
        type: p.primaryType || type,
      }));
    } catch (error: any) {
      console.warn(`⚠️ Nearby POI search failed:`, error.message);
      return [];
    }
  }
}
