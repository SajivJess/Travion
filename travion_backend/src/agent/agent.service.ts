import { Injectable, Logger } from '@nestjs/common';
import { QueueService, TripMonitoringJob } from '../queue/queue.service';
import { NotificationService } from '../websocket/notification.service';
import { AgentGateway } from '../websocket/agent.gateway';

export interface TripAgentConfig {
  tripId: string;
  userId: string;
  destination: string;
  startDate: string;
  endDate: string;
  activities: string[];
  enableWeatherMonitoring?: boolean;
  enableCrowdMonitoring?: boolean;
  autoReplan?: boolean;
}

export interface AgentStatus {
  tripId: string;
  isActive: boolean;
  weatherMonitoring: boolean;
  crowdMonitoring: boolean;
  lastCheck: string | null;
  pendingReplans: number;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private activeTrips: Map<string, TripAgentConfig> = new Map();

  constructor(
    private readonly queueService: QueueService,
    private readonly notificationService: NotificationService,
    private readonly agentGateway: AgentGateway,
  ) {}

  /**
   * Activate agent monitoring for a trip
   */
  async activateAgent(config: TripAgentConfig): Promise<AgentStatus> {
    this.logger.log(`🤖 Activating agent for trip ${config.tripId}`);

    // Store config
    this.activeTrips.set(config.tripId, config);

    const job: TripMonitoringJob = {
      tripId: config.tripId,
      userId: config.userId,
      destination: config.destination,
      startDate: config.startDate,
      endDate: config.endDate,
      activities: config.activities,
    };

    // Start monitoring based on configuration
    if (config.enableWeatherMonitoring !== false) {
      await this.queueService.startWeatherMonitoring(job);
      this.logger.log(`🌤️ Weather monitoring activated for trip ${config.tripId}`);
    }

    if (config.enableCrowdMonitoring !== false) {
      await this.queueService.startCrowdMonitoring(job);
      this.logger.log(`👥 Crowd monitoring activated for trip ${config.tripId}`);
    }

    // Notify user
    await this.notificationService.sendAgentStatus(
      config.userId,
      config.tripId,
      'monitoring',
      {
        weatherMonitoring: config.enableWeatherMonitoring !== false,
        crowdMonitoring: config.enableCrowdMonitoring !== false,
      },
    );

    return this.getAgentStatus(config.tripId);
  }

  /**
   * Deactivate agent monitoring for a trip
   */
  async deactivateAgent(tripId: string): Promise<void> {
    this.logger.log(`⏹️ Deactivating agent for trip ${tripId}`);

    const config = this.activeTrips.get(tripId);
    
    // Stop all monitoring
    await this.queueService.stopTripMonitoring(tripId);
    
    // Remove from active trips
    this.activeTrips.delete(tripId);

    // Notify user if connected
    if (config) {
      await this.notificationService.sendAgentStatus(
        config.userId,
        tripId,
        'idle',
        { message: 'Agent monitoring stopped' },
      );
    }
  }

  /**
   * Get agent status for a trip
   */
  async getAgentStatus(tripId: string): Promise<AgentStatus> {
    const config = this.activeTrips.get(tripId);
    const queueStatus = await this.queueService.getMonitoringStatus(tripId);

    return {
      tripId,
      isActive: !!config,
      weatherMonitoring: queueStatus.weatherActive,
      crowdMonitoring: queueStatus.crowdActive,
      lastCheck: null, // Could be tracked in Redis
      pendingReplans: queueStatus.pendingReplans,
    };
  }

  /**
   * Manually trigger a replan
   */
  async manualReplan(
    tripId: string,
    userId: string,
    affectedDays: number[],
    reason: string = 'user_request',
    context: any = {},
  ): Promise<void> {
    this.logger.log(`🔄 Manual replan requested for trip ${tripId}`);

    await this.queueService.queueReplan({
      tripId,
      userId,
      reason: reason as any,
      affectedDays,
      context,
    });

    // Notify user
    await this.notificationService.sendAgentStatus(
      userId,
      tripId,
      'replanning',
      { affectedDays, reason },
    );
  }

  /**
   * Update agent configuration
   */
  async updateAgentConfig(
    tripId: string,
    updates: Partial<TripAgentConfig>,
  ): Promise<AgentStatus> {
    const config = this.activeTrips.get(tripId);
    
    if (!config) {
      throw new Error(`No active agent for trip ${tripId}`);
    }

    // Update config
    const newConfig = { ...config, ...updates };
    this.activeTrips.set(tripId, newConfig);

    // Restart monitoring with new config if needed
    await this.queueService.stopTripMonitoring(tripId);
    
    return this.activateAgent(newConfig);
  }

  /**
   * Get all active agent trips
   */
  getActiveTrips(): string[] {
    return Array.from(this.activeTrips.keys());
  }

  /**
   * Check if trip has active agent
   */
  isTripActive(tripId: string): boolean {
    return this.activeTrips.has(tripId);
  }

  /**
   * Get connected users count
   */
  getConnectedUsersCount(): number {
    return this.agentGateway.getConnectedUsersCount();
  }
}
