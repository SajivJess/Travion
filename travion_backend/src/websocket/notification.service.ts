import { Injectable, Logger } from '@nestjs/common';
import { AgentGateway, NotificationPayload } from './agent.gateway';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Processor, Process } from '@nestjs/bull';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly agentGateway: AgentGateway) {}

  /**
   * Send immediate notification to user
   */
  async sendNotification(
    userId: string,
    type: string,
    data: any,
  ): Promise<void> {
    const payload: NotificationPayload = {
      type,
      tripId: data.tripId,
      data,
      timestamp: new Date().toISOString(),
    };

    // Check if user is connected
    if (this.agentGateway.isUserConnected(userId)) {
      this.agentGateway.sendToUser(userId, payload);
      this.logger.log(`📤 Real-time notification sent to ${userId}: ${type}`);
    } else {
      // Store for later delivery (could use database)
      this.logger.log(`📦 User ${userId} offline, notification stored: ${type}`);
      // TODO: Store in database for later retrieval
    }
  }

  /**
   * Send weather alert
   */
  async sendWeatherAlert(
    userId: string,
    tripId: string,
    weatherData: any,
  ): Promise<void> {
    await this.sendNotification(userId, 'WEATHER_ALERT', {
      tripId,
      ...weatherData,
      severity: this.calculateWeatherSeverity(weatherData),
      suggestions: this.getWeatherSuggestions(weatherData),
    });
  }

  /**
   * Send crowd alert
   */
  async sendCrowdAlert(
    userId: string,
    tripId: string,
    crowdData: any,
  ): Promise<void> {
    await this.sendNotification(userId, 'CROWD_ALERT', {
      tripId,
      ...crowdData,
      recommendations: this.getCrowdRecommendations(crowdData),
    });
  }

  /**
   * Send itinerary update notification
   */
  async sendItineraryUpdate(
    userId: string,
    tripId: string,
    changes: any[],
    reason: string,
  ): Promise<void> {
    await this.sendNotification(userId, 'ITINERARY_UPDATED', {
      tripId,
      changes,
      reason,
      changesCount: changes.length,
      summary: this.summarizeChanges(changes),
    });
  }

  /**
   * Send agent status update
   */
  async sendAgentStatus(
    userId: string,
    tripId: string,
    status: 'monitoring' | 'replanning' | 'idle' | 'error',
    details?: any,
  ): Promise<void> {
    await this.sendNotification(userId, 'AGENT_STATUS', {
      tripId,
      status,
      details,
      message: this.getStatusMessage(status),
    });
  }

  private calculateWeatherSeverity(weatherData: any): 'low' | 'medium' | 'high' {
    if (weatherData.condition === 'Thunderstorm' || weatherData.precipitation > 80) {
      return 'high';
    }
    if (weatherData.condition === 'Rainy' || weatherData.precipitation > 50) {
      return 'medium';
    }
    return 'low';
  }

  private getWeatherSuggestions(weatherData: any): string[] {
    const suggestions: string[] = [];
    
    if (weatherData.isBadWeather) {
      suggestions.push('Consider indoor alternatives for outdoor activities');
      suggestions.push('Pack rain gear or umbrella');
    }
    
    if (weatherData.temperature < 10) {
      suggestions.push('Bring warm clothing');
    } else if (weatherData.temperature > 35) {
      suggestions.push('Stay hydrated and avoid peak sun hours');
    }

    return suggestions;
  }

  private getCrowdRecommendations(crowdData: any): string[] {
    const recommendations: string[] = [];

    if (crowdData.crowdLevel === 'very_high') {
      recommendations.push('Visit early morning (before 8 AM) or late evening');
      recommendations.push('Consider booking tickets in advance');
      recommendations.push('Look for alternative similar attractions nearby');
    } else if (crowdData.crowdLevel === 'high') {
      recommendations.push('Plan extra buffer time for queues');
      recommendations.push('Avoid weekend visits if possible');
    }

    return recommendations;
  }

  private summarizeChanges(changes: any[]): string {
    if (changes.length === 0) return 'No changes made';
    if (changes.length === 1) return `1 activity adjusted`;
    return `${changes.length} activities adjusted`;
  }

  private getStatusMessage(status: string): string {
    switch (status) {
      case 'monitoring':
        return 'Travion Agent is actively monitoring your trip conditions';
      case 'replanning':
        return 'Travion Agent is optimizing your itinerary...';
      case 'idle':
        return 'Travion Agent is on standby';
      case 'error':
        return 'Travion Agent encountered an issue';
      default:
        return 'Agent status updated';
    }
  }
}
