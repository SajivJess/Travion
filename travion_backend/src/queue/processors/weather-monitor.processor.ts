import { Process, Processor, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bull';
import { TripMonitoringJob, QueueService } from '../queue.service';
import { WeatherService } from '../../itinerary/weather.service';
import { GeoService } from '../../itinerary/geo.service';
import { DiscoveryCacheService } from '../../supabase/discovery-cache.service';

interface WeatherData {
  temperature: number;
  condition: string;
  precipitation: number;
  windSpeed: number;
  isBadWeather: boolean;
}

@Processor('weather-monitor')
export class WeatherMonitorProcessor {
  private readonly logger = new Logger(WeatherMonitorProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly weatherService: WeatherService,
    private readonly geoService: GeoService,
    private readonly cacheService: DiscoveryCacheService,
  ) {}

  @Process('check-weather')
  async handleWeatherCheck(job: Job<TripMonitoringJob>): Promise<any> {
    const { tripId, userId, destination, startDate, endDate } = job.data;
    
    this.logger.log(`🌤️ Checking weather for trip ${tripId} - ${destination}`);

    try {
      // Geocode destination to get lat/lng
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const cached = await this.cacheService.get('geocode', destination) as any;
        if (cached && cached.lat && cached.lng) {
          lat = cached.lat;
          lng = cached.lng;
        } else {
          const geo = await this.geoService.geocode(destination);
          if (geo && geo.lat && geo.lng) {
            lat = geo.lat;
            lng = geo.lng;
            await this.cacheService.set('geocode', destination, geo);
          }
        }
      } catch (err) {
        this.logger.warn(`Geocode failed for ${destination}: ${err.message}`);
      }

      // Skip weather check entirely if we can't geocode the destination
      // (prevents false positive alerts from 0,0 coordinates)
      if (!lat || !lng || (lat === 0 && lng === 0)) {
        this.logger.warn(`⚠️ Skipping weather check for "${destination}" — geocoding failed, no valid coordinates`);
        return { action: 'skipped', reason: 'geocoding_failed' };
      }

      // Get weather forecast using WeatherService
      let weather: WeatherData[];
      const forecast = await this.weatherService.getForecast(lat, lng, destination, startDate, endDate);
      weather = forecast.days.map(d => ({
        temperature: Math.round((d.tempMin + d.tempMax) / 2),
        condition: d.condition,
        precipitation: d.rainChance,
        windSpeed: d.windSpeed,
        isBadWeather: d.rainChance > 70 || 
          ['Thunderstorm', 'Heavy Rain', 'Snow'].includes(d.condition) ||
          d.tempMin < 0 || d.tempMax > 40,
      }));

      // Skip if no weather data returned
      if (!weather || weather.length === 0) {
        this.logger.warn(`⚠️ No weather data available for "${destination}", skipping check`);
        return { action: 'skipped', reason: 'no_weather_data' };
      }
      
      // Check for bad weather conditions
      const badWeatherDays = this.detectBadWeather(weather);
      
      if (badWeatherDays.length > 0) {
        this.logger.warn(`⚠️ Bad weather detected for days: ${badWeatherDays.join(', ')}`);
        
        // Store update in Supabase and send PLAN_UPDATE_AVAILABLE to user
        await this.queueService.createTripUpdate({
          tripId,
          userId,
          day: badWeatherDays[0],
          reason: 'weather',
          riskLevel: 'HIGH',
          affectedActivities: badWeatherDays.map(d => `Day ${d} outdoor activities`),
          suggestedChanges: badWeatherDays.map(day => ({
            day,
            suggestion: 'Replace outdoor activities with indoor alternatives',
            condition: weather[day - 1]?.condition || 'bad weather',
          })),
          summary: `Bad weather on ${badWeatherDays.length} day(s). ${badWeatherDays.length > 1 ? 'Days ' + badWeatherDays.join(', ') : 'Day ' + badWeatherDays[0]} may need replanning.`,
          context: {
            destination,
            weatherData: weather,
            detectedConditions: badWeatherDays.map(day => ({
              day,
              condition: weather[day - 1]?.condition || 'unknown',
              precipitation: weather[day - 1]?.precipitation,
              temperature: weather[day - 1]?.temperature,
            })),
            affectedDays: badWeatherDays,
          },
        });

        return { action: 'update_created', affectedDays: badWeatherDays };
      }

      return { action: 'no_changes', weather };
    } catch (error) {
      this.logger.error(`Weather check failed: ${error.message}`);
      throw error;
    }
  }

  private async getWeatherFallback(
    destination: string,
    startDate: string,
    endDate: string,
  ): Promise<WeatherData[]> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    try {
      const axios = await import('axios');
      const apiKey = process.env.OPENWEATHER_API_KEY;
      if (apiKey) {
        const response = await axios.default.get(
          `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(destination)}&appid=${apiKey}&units=metric&cnt=${days * 8}`,
        );

        const dailyData: WeatherData[] = [];
        const forecasts = response.data.list;
        
        for (let i = 0; i < days; i++) {
          const dayForecasts = forecasts.slice(i * 8, (i + 1) * 8);
          if (dayForecasts.length > 0) {
            const avgTemp = dayForecasts.reduce((sum: number, f: any) => sum + f.main.temp, 0) / dayForecasts.length;
            const maxPrecip = Math.max(...dayForecasts.map((f: any) => f.pop * 100));
            const conditions = dayForecasts.map((f: any) => f.weather[0].main);
            const mainCondition = this.getMostFrequent(conditions);
            
            dailyData.push({
              temperature: Math.round(avgTemp),
              condition: mainCondition,
              precipitation: Math.round(maxPrecip),
              windSpeed: Math.round(dayForecasts[0].wind.speed),
              isBadWeather: maxPrecip > 70 || 
                ['Thunderstorm', 'Heavy Rain', 'Snow'].includes(mainCondition) ||
                avgTemp < 0 || avgTemp > 40,
            });
          }
        }
        return dailyData;
      }
    } catch (error) {
      this.logger.warn(`Weather fallback API failed: ${error.message}`);
    }

    return []; // No simulated data — real APIs only
  }

  private detectBadWeather(weather: WeatherData[]): number[] {
    const badDays: number[] = [];
    
    weather.forEach((day, index) => {
      if (day.isBadWeather) {
        badDays.push(index + 1); // 1-indexed day numbers
      }
    });

    return badDays;
  }

  private getMostFrequent(arr: string[]): string {
    const counts: Record<string, number> = {};
    arr.forEach(item => {
      counts[item] = (counts[item] || 0) + 1;
    });
    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`✅ Weather check completed for job ${job.id}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`❌ Weather check failed for job ${job.id}: ${error.message}`);
  }
}
