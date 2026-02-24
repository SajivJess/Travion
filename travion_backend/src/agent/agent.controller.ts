import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AgentService, TripAgentConfig } from './agent.service';

class ActivateAgentDto {
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

class ManualReplanDto {
  tripId: string;
  userId: string;
  affectedDays: number[];
  reason?: string;
  context?: any;
}

@Controller('api/agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(private readonly agentService: AgentService) {}

  /**
   * Activate agent monitoring for a trip
   * POST /api/agent/activate
   */
  @Post('activate')
  async activateAgent(@Body() dto: ActivateAgentDto) {
    try {
      this.logger.log(`Activating agent for trip ${dto.tripId}`);
      
      const status = await this.agentService.activateAgent(dto);
      
      return {
        success: true,
        message: 'Agent activated successfully',
        data: status,
      };
    } catch (error) {
      this.logger.error(`Failed to activate agent: ${error.message}`);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Deactivate agent monitoring for a trip
   * DELETE /api/agent/:tripId
   */
  @Delete(':tripId')
  async deactivateAgent(@Param('tripId') tripId: string) {
    try {
      await this.agentService.deactivateAgent(tripId);
      
      return {
        success: true,
        message: 'Agent deactivated successfully',
        tripId,
      };
    } catch (error) {
      this.logger.error(`Failed to deactivate agent: ${error.message}`);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get agent status for a trip
   * GET /api/agent/status/:tripId
   */
  @Get('status/:tripId')
  async getAgentStatus(@Param('tripId') tripId: string) {
    try {
      const status = await this.agentService.getAgentStatus(tripId);
      
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      this.logger.error(`Failed to get agent status: ${error.message}`);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Manually trigger a replan
   * POST /api/agent/replan
   */
  @Post('replan')
  async manualReplan(@Body() dto: ManualReplanDto) {
    try {
      this.logger.log(`Manual replan requested for trip ${dto.tripId}`);
      
      await this.agentService.manualReplan(
        dto.tripId,
        dto.userId,
        dto.affectedDays,
        dto.reason,
        dto.context,
      );
      
      return {
        success: true,
        message: 'Replan job queued successfully',
        tripId: dto.tripId,
      };
    } catch (error) {
      this.logger.error(`Failed to queue replan: ${error.message}`);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all active agent trips
   * GET /api/agent/active
   */
  @Get('active')
  async getActiveTrips() {
    const trips = this.agentService.getActiveTrips();
    const connectedUsers = this.agentService.getConnectedUsersCount();
    
    return {
      success: true,
      data: {
        activeTrips: trips,
        count: trips.length,
        connectedUsers,
      },
    };
  }

  /**
   * Health check endpoint
   * GET /api/agent/health
   */
  @Get('health')
  async healthCheck() {
    return {
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      activeTrips: this.agentService.getActiveTrips().length,
      connectedUsers: this.agentService.getConnectedUsersCount(),
    };
  }
}
