import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

export interface NotificationPayload {
  type: string;
  tripId?: string;
  data: any;
  timestamp: string;
}

@WebSocketGateway({
  cors: {
    origin: '*', // Configure appropriately for production
    methods: ['GET', 'POST'],
  },
  namespace: '/agent',
})
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AgentGateway.name);
  private userSockets: Map<string, Set<string>> = new Map();

  handleConnection(client: Socket) {
    this.logger.log(`🔌 Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`🔌 Client disconnected: ${client.id}`);
    
    // Remove from user mappings
    for (const [userId, sockets] of this.userSockets.entries()) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  /**
   * User subscribes to their notifications
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const { userId } = data;
    
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(client.id);
    
    // Join user room for targeted broadcasts
    client.join(`user:${userId}`);
    
    this.logger.log(`👤 User ${userId} subscribed on socket ${client.id}`);
    
    client.emit('subscribed', { 
      status: 'success',
      message: 'Connected to Travion Agent',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * User subscribes to a specific trip updates
   */
  @SubscribeMessage('subscribe_trip')
  handleSubscribeTrip(
    @MessageBody() data: { tripId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const { tripId } = data;
    client.join(`trip:${tripId}`);
    
    this.logger.log(`📍 Client ${client.id} subscribed to trip ${tripId}`);
    
    client.emit('trip_subscribed', { tripId, status: 'active' });
  }

  /**
   * Send notification to a specific user
   */
  sendToUser(userId: string, notification: NotificationPayload): void {
    this.server.to(`user:${userId}`).emit('notification', notification);
    this.logger.log(`📤 Notification sent to user ${userId}: ${notification.type}`);
  }

  /**
   * Send update to all subscribers of a trip
   */
  sendToTrip(tripId: string, notification: NotificationPayload): void {
    this.server.to(`trip:${tripId}`).emit('trip_update', notification);
    this.logger.log(`📤 Update sent to trip ${tripId}: ${notification.type}`);
  }

  /**
   * Broadcast weather alert
   */
  sendWeatherAlert(userId: string, data: any): void {
    this.sendToUser(userId, {
      type: 'WEATHER_ALERT',
      tripId: data.tripId,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast crowd alert
   */
  sendCrowdAlert(userId: string, data: any): void {
    this.sendToUser(userId, {
      type: 'CROWD_ALERT',
      tripId: data.tripId,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast itinerary update
   */
  sendItineraryUpdate(userId: string, data: any): void {
    this.sendToUser(userId, {
      type: 'ITINERARY_UPDATED',
      tripId: data.tripId,
      data,
      timestamp: new Date().toISOString(),
    });

    // Also send to trip subscribers
    if (data.tripId) {
      this.sendToTrip(data.tripId, {
        type: 'ITINERARY_UPDATED',
        tripId: data.tripId,
        data,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Send agent status update
   */
  sendAgentStatus(userId: string, status: any): void {
    this.sendToUser(userId, {
      type: 'AGENT_STATUS',
      data: status,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get connected users count
   */
  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  /**
   * Check if user is connected
   */
  isUserConnected(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return sockets !== undefined && sockets.size > 0;
  }
}
