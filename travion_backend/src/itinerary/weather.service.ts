import { Injectable } from '@nestjs/common';
import axios from 'axios';

/**
 * Open-Meteo Weather Service (free, no API key required)
 *
 * PURPOSE: Provide real-time weather data for dynamic trip planning.
 * USE FOR: Rain detection, temperature, UV index, activity swapping
 * DO NOT USE FOR: Finding places, calculating distances, budget optimization
 *
 * TRIGGERS:
 * - Rain adaptation (outdoor → indoor swap)
 * - Activity time shifting (avoid peak heat)
 * - Packing recommendations
 */

export interface WeatherDay {
  date: string;           // YYYY-MM-DD
  tempMin: number;        // °C
  tempMax: number;        // °C
  feelsLike: number;      // °C (approx = tempMax for Open-Meteo)
  humidity: number;       // % (not available in daily — set 0)
  windSpeed: number;      // km/h
  rainChance: number;     // 0-100%
  rainMm: number;         // mm of rain expected (set 0; use rainChance instead)
  uvIndex: number;        // UV Index
  condition: string;      // Clear / Partly Cloudy / Cloudy / Fog / Drizzle / Rain / Snow / Thunderstorm
  conditionDetail: string;
  icon: string;           // WMO weather code as string
  sunrise: string;        // HH:MM
  sunset: string;         // HH:MM
}

export interface WeatherForecast {
  destination: string;
  lat: number;
  lng: number;
  days: WeatherDay[];
  alerts: WeatherAlert[];
}

export interface WeatherAlert {
  event: string;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  description: string;
  startDate: string;
  endDate: string;
}

/** Map WMO weather codes → human-readable condition */
function wmoCondition(code: number): { condition: string; detail: string } {
  if (code === 0)                    return { condition: 'Clear', detail: 'Clear sky' };
  if (code <= 3)                     return { condition: 'Partly Cloudy', detail: 'Partly cloudy' };
  if (code <= 48)                    return { condition: 'Fog', detail: 'Fog / icy fog' };
  if (code <= 55)                    return { condition: 'Drizzle', detail: 'Light drizzle' };
  if (code <= 67)                    return { condition: 'Rain', detail: code >= 65 ? 'Heavy rain' : 'Moderate rain' };
  if (code <= 77)                    return { condition: 'Snow', detail: 'Snowfall' };
  if (code <= 82)                    return { condition: 'Rain', detail: 'Rain showers' };
  if (code <= 86)                    return { condition: 'Snow', detail: 'Snow showers' };
  if (code === 95)                   return { condition: 'Thunderstorm', detail: 'Thunderstorm' };
  if (code >= 96)                    return { condition: 'Thunderstorm', detail: 'Heavy thunderstorm with hail' };
  return { condition: 'Cloudy', detail: 'Overcast' };
}

/** Extract HH:MM from ISO datetime string like "2024-01-15T06:23" */
function extractTime(iso: string): string {
  if (!iso) return '06:00';
  const parts = iso.split('T');
  return parts[1]?.slice(0, 5) || '06:00';
}

@Injectable()
export class WeatherService {
  constructor() {
    console.log('🌦️ Open-Meteo weather service initialized (no API key needed)');
  }

  /**
   * Get weather forecast for a destination using Open-Meteo (free, no key).
   * Returns up to 16 days of daily forecasts.
   */
  async getForecast(
    lat: number,
    lng: number,
    destination: string,
    startDate: string,
    endDate: string,
  ): Promise<WeatherForecast> {
    console.log(`🌦️ Fetching Open-Meteo weather for ${destination} (${lat}, ${lng})...`);

    try {
      const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: lat,
          longitude: lng,
          daily: [
            'temperature_2m_max',
            'temperature_2m_min',
            'precipitation_probability_max',
            'weathercode',
            'windspeed_10m_max',
            'uv_index_max',
            'sunrise',
            'sunset',
          ].join(','),
          timezone: 'auto',
          start_date: startDate,
          end_date: endDate,
          forecast_days: 16,
        },
        timeout: 10000,
      });

      const d = response.data.daily as Record<string, any[]>;
      const times: string[] = d.time || [];

      const days: WeatherDay[] = times.map((date, i) => {
        const code = (d.weathercode?.[i] ?? 0) as number;
        const { condition, detail } = wmoCondition(code);
        return {
          date,
          tempMin: Math.round(d.temperature_2m_min?.[i] ?? 0),
          tempMax: Math.round(d.temperature_2m_max?.[i] ?? 0),
          feelsLike: Math.round(d.temperature_2m_max?.[i] ?? 0), // approx
          humidity: 0,  // not in daily endpoint
          windSpeed: Math.round((d.windspeed_10m_max?.[i] ?? 0) * 10) / 10,
          rainChance: Math.round(d.precipitation_probability_max?.[i] ?? 0),
          rainMm: 0,
          uvIndex: Math.round(d.uv_index_max?.[i] ?? 0),
          condition,
          conditionDetail: detail,
          icon: String(code),
          sunrise: extractTime(d.sunrise?.[i] ?? ''),
          sunset: extractTime(d.sunset?.[i] ?? ''),
        };
      });

      const alerts = this.generateAlerts(days);
      console.log(`✅ Open-Meteo forecast: ${days.length} days | Alerts: ${alerts.length}`);
      return { destination, lat, lng, days, alerts };
    } catch (error: any) {
      console.error(`❌ Open-Meteo weather API failed:`, error.message);
      return { destination, lat, lng, days: [], alerts: [] };
    }
  }

  /**
   * Generate weather-based alerts for trip planning
   */
  private generateAlerts(days: WeatherDay[]): WeatherAlert[] {
    const alerts: WeatherAlert[] = [];

    for (const day of days) {
      // Heavy rain alert
      if (day.rainChance > 60) {
        alerts.push({
          event: 'Heavy Rain Expected',
          severity: day.rainChance > 80 ? 'high' : 'medium',
          description: `${day.rainChance}% chance of rain. Consider indoor alternatives.`,
          startDate: day.date,
          endDate: day.date,
        });
      }

      // Extreme heat alert
      if (day.tempMax > 40) {
        alerts.push({
          event: 'Extreme Heat Warning',
          severity: day.tempMax > 45 ? 'extreme' : 'high',
          description: `Temperature expected to reach ${day.tempMax}°C. Avoid outdoor activities during midday.`,
          startDate: day.date,
          endDate: day.date,
        });
      }

      // Cold alert
      if (day.tempMin < 5) {
        alerts.push({
          event: 'Cold Weather Advisory',
          severity: day.tempMin < 0 ? 'high' : 'medium',
          description: `Temperature may drop to ${day.tempMin}°C. Pack warm clothing.`,
          startDate: day.date,
          endDate: day.date,
        });
      }

      // Strong wind
      if (day.windSpeed > 15) {
        alerts.push({
          event: 'Strong Wind Advisory',
          severity: day.windSpeed > 25 ? 'high' : 'medium',
          description: `Wind speeds of ${day.windSpeed} m/s expected. Outdoor activities may be affected.`,
          startDate: day.date,
          endDate: day.date,
        });
      }

      // Thunderstorm
      if (day.condition === 'Thunderstorm') {
        alerts.push({
          event: 'Thunderstorm Warning',
          severity: 'high',
          description: `Thunderstorms expected. Stay indoors during storm periods.`,
          startDate: day.date,
          endDate: day.date,
        });
      }
    }

    return alerts;
  }

  /**
   * Quick check: Is it going to rain on a specific day?
   * Used for rain adaptation logic
   */
  isRainyDay(day: WeatherDay): boolean {
    return day.rainChance > 50 ||
           day.condition === 'Rain' || day.condition === 'Thunderstorm';
  }

  /**
   * Quick check: Is it dangerously hot?
   */
  isExtremeHeat(day: WeatherDay): boolean {
    return day.tempMax > 38;
  }

  /**
   * Get best time of day for outdoor activities based on weather
   */
  getBestOutdoorSlot(day: WeatherDay): { start: string; end: string; reason: string } {
    if (day.tempMax > 38) {
      // Hot climate: morning/evening
      return { start: '06:00', end: '10:00', reason: 'Avoid midday heat' };
    }
    if (day.condition === 'Rain') {
      return { start: '09:00', end: '12:00', reason: 'Morning window before afternoon rain' };
    }
    // Default: full day available
    return { start: '08:00', end: '18:00', reason: 'Pleasant weather all day' };
  }
}
