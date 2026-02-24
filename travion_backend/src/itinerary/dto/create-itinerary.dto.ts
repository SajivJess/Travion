import { IsString, IsNotEmpty, IsNumber, Min, Max, IsDateString, IsEnum, IsOptional, IsBoolean } from 'class-validator';

export enum TravelStyle {
  BUDGET = 'Budget',
  COMFORT = 'Comfort',
  MIDRANGE = 'Mid-range',
  LUXURY = 'Luxury',
  PREMIUM = 'Premium',
}

export class CreateItineraryDto {
  @IsString()
  @IsNotEmpty()
  source: string;

  @IsString()
  @IsNotEmpty()
  destination: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsNumber()
  @Min(1)
  @Max(50)
  travellers: number;

  @IsNumber()
  @Min(0)
  budget: number;

  @IsEnum(TravelStyle)
  travelStyle: TravelStyle;

  @IsString()
  @IsOptional()
  mealPreference?: string;

  @IsNumber()
  @IsOptional()
  averageAge?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  minTravellerAge?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  maxTravellerAge?: number;

  @IsString({ each: true })
  @IsOptional()
  travellerAges?: string[];

  @IsBoolean()
  @IsOptional()
  includeNightlife?: boolean;

  @IsBoolean()
  @IsOptional()
  aiBudgetOptimization?: boolean;

  @IsString()
  @IsOptional()
  transportMode?: string; // 'Flight', 'Train', or 'Bus'
  
  @IsString()
  @IsOptional()
  arrivalTime?: string; // Expected arrival time on Day 1 (HH:mm format)
  
  @IsString()
  @IsOptional()
  specificPlaces?: string; // User's must-visit places/attractions
  
  @IsString()
  @IsOptional()
  foodPreferences?: string; // Preferred cuisines or specific food places
  
  @IsBoolean()
  @IsOptional()
  checkHolidays?: boolean; // Whether to check for local holidays
  
  @IsBoolean()
  @IsOptional()
  optimizeCrowds?: boolean; // Whether to plan crowded places on weekdays
}
