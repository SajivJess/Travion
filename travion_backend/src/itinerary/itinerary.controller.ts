import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, Headers, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ItineraryService } from './itinerary.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { Itinerary } from './itinerary.interface';
import { UsageLimit, UsageLimitGuard } from '../guards/usage-limit.guard';
import { QueueService } from '../queue/queue.service';
import { UserFlagService, ReportIssueRequest } from './user-flag.service';
import { ChatbotService } from './chatbot.service';
import { InstagramService } from './instagram.service';
import { YoutubeDiscoveryService } from './youtube-discovery.service';
import { TripTrackerService } from './trip-tracker.service';
import { EtaMonitorService } from './eta-monitor.service';
import { OpenRouterService } from './openrouter.service';

interface ReplanDayRequest {
  itinerary: Itinerary;
  dayIndex: number;
  source: string;
  destination: string;
  travelStyle: string;
}

interface ValidateBudgetRequest {
  source: string;
  destination: string;
  travellers: number;
  budget: number;
  transportMode: string;
  startDate: string;
  endDate: string;
  travelStyle: string;
}

@Controller('api/itinerary')
@UseGuards(UsageLimitGuard)
export class ItineraryController {
  constructor(
    private readonly itineraryService: ItineraryService,
    private readonly queueService: QueueService,
    private readonly userFlagService: UserFlagService,
    private readonly chatbotService: ChatbotService,
    private readonly instagramService: InstagramService,
    private readonly youtubeDiscoveryService: YoutubeDiscoveryService,
    private readonly tripTrackerService: TripTrackerService,
    private readonly etaMonitorService: EtaMonitorService,
    private readonly openRouterService: OpenRouterService,
  ) {}

  /**
   * Create itinerary — async (BullMQ) by default, sync with ?sync=true
   */
  @Post()
  @UsageLimit('trips')
  async create(
    @Body() createItineraryDto: CreateItineraryDto,
    @Query('sync') sync?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ success: boolean; data?: Itinerary; jobId?: string; status?: string }> {
    // Sync mode: immediate response (backward compatible)
    if (sync === 'true') {
      const data = await this.itineraryService.generate(createItineraryDto);
      return { success: true, data };
    }

    // Async mode: submit to BullMQ queue
    const uid = userId || `anon-${Date.now()}`;
    const jobId = await this.queueService.submitTripPlanningJob(uid, createItineraryDto);
    return { success: true, jobId, status: 'queued' };
  }

  /**
   * Poll job status for async trip planning
   */
  @Get('status/:jobId')
  async getJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<any> {
    return await this.queueService.getTripJobStatus(jobId);
  }

  /**
   * List all completed trips for the authenticated user
   */
  @Get('trips')
  async getUserTrips(
    @Req() req: Request,
    @Headers('x-user-id') xUserId?: string,
  ): Promise<any> {
    const userId = (req as any).user?.userId || xUserId;
    if (!userId) return { trips: [], total: 0 };
    return this.queueService.getUserTrips(userId);
  }


  @Post('replan-day')
  @UsageLimit('ai_requests')
  async replanDay(
    @Body() req: ReplanDayRequest,
  ): Promise<{ day: any; cost: number; improvements: string[]; warnings: string[] }> {
    const { itinerary, dayIndex, source, destination, travelStyle } = req;

    if (dayIndex < 0 || dayIndex >= itinerary.days.length) {
      return { day: null, cost: 0, improvements: [], warnings: ['Invalid day index'] };
    }

    const replannedDay = await this.itineraryService.replanDay({
      itinerary,
      dayIndex,
      destination,
      travelStyle,
    });

    return {
      day: replannedDay,
      cost: replannedDay.totalCost,
      improvements: [],
      warnings: [],
    };
  }

  @Post('validate-budget')
  @UsageLimit('ai_requests')
  async validateBudget(
    @Body() req: ValidateBudgetRequest,
  ): Promise<{ isValid: boolean; message?: string; suggestedBudget?: number; transportCost?: number }> {
    return await this.itineraryService.validateBudgetWithAI(req);
  }

  /**
   * User reports an issue mid-trip (free text)
   * NLP-parses it via Gemini and queues a proposed replan for consent
   */
  @Post('report-issue')
  async reportIssue(
    @Body() body: ReportIssueRequest & { activities?: string[] },
    @Headers('x-user-id') xUserId?: string,
  ): Promise<{ success: boolean; parsed: any; proposalQueued: boolean }> {
    const userId = body.userId || xUserId || 'anon';

    // 1. NLP parse via Gemini
    const parsed = await this.userFlagService.parseIssue({ ...body, userId });

    // 2. If NLP says replanning is needed, queue a replan
    if (parsed.shouldReplan) {
      await this.queueService.queueReplan({
        tripId: body.tripId,
        userId,
        reason: 'user_flag',
        affectedDays: body.dayIndex != null ? [body.dayIndex] : [0],
        context: {
          userMessage: body.message,
          parsedIssue: parsed,
          affectedActivity: parsed.affectedActivity,
          shiftHours: parsed.shiftHours ?? 0,
          activityName: body.activityName,
        },
      });
    }

    return { success: true, parsed, proposalQueued: parsed.shouldReplan };
  }

  /**
   * Get pending replan proposals for a trip (drives the consent banner)
   */
  @Get('proposals/:tripId')
  getProposals(
    @Param('tripId') tripId: string,
  ): any[] {
    return this.queueService.getProposalsForTrip(tripId);
  }

  /**
   * Accept or reject a proposed replan
   * action = 'accept' | 'reject'
   */
  @Post('replan-consent/:proposalId')
  async replanConsent(
    @Param('proposalId') proposalId: string,
    @Body() body: { action: 'accept' | 'reject' },
  ): Promise<{ success: boolean; message: string }> {
    if (body.action === 'accept') {
      return this.queueService.acceptProposal(proposalId);
    }
    return this.queueService.rejectProposal(proposalId);
  }

  // ─── TRIP UPDATES (Supabase-persisted system detections) ─────────────────

  /**
   * Get all pending system-detected trip updates (weather, crowd, flight, POI).
   * Frontend polls this to show the PLAN_UPDATE_AVAILABLE banner.
   */
  @Get('trip-updates/:tripId')
  async getTripUpdates(
    @Param('tripId') tripId: string,
  ): Promise<any[]> {
    return this.queueService.getTripUpdates(tripId);
  }

  /**
   * User clicks "Review Update" → triggers Gemini replan from the stored context.
   * Creates a proposal that the user can then accept/reject via replan-consent.
   */
  @Post('apply-update/:updateId')
  async applyUpdate(
    @Param('updateId') updateId: string,
    @Headers('x-user-id') xUserId?: string,
    @Body() body?: { userId?: string },
  ): Promise<{ success: boolean; message: string }> {
    const userId = body?.userId || xUserId || 'anon';
    return this.queueService.applyTripUpdate(updateId, userId);
  }

  /**
   * Dismiss a pending trip update (user chose to ignore it).
   */
  @Post('dismiss-update/:updateId')
  async dismissUpdate(
    @Param('updateId') updateId: string,
  ): Promise<{ success: boolean }> {
    return this.queueService.dismissTripUpdate(updateId);
  }

  /**
   * Get trip version history (V1 = original, V2+ = replanned)
   */
  @Get('trip-versions/:tripId')
  async getTripVersions(
    @Param('tripId') tripId: string,
  ): Promise<any[]> {
    return this.queueService.getTripVersions(tripId);
  }

  /**
   * Persist manually reordered / edited days back to Supabase.
   */
  @Patch('update-days/:tripId')
  async updateDays(
    @Param('tripId') tripId: string,
    @Body() body: { days: any[] },
  ): Promise<{ success: boolean }> {
    return { success: await this.queueService.updateTripDays(tripId, body.days) };
  }

  /**
   * Live social vibe feed — Apify Instagram hashtag scrape + SocialCrowdScore.
   * Cached in Supabase for 6 hours per destination.
   * GET /api/itinerary/social-feed/:destination?pois=poi1,poi2
   */
  @Get('social-feed/:destination')
  async getSocialFeed(
    @Param('destination') destination: string,
    @Query('pois') poisRaw?: string,
  ): Promise<any> {
    const pois = poisRaw ? poisRaw.split(',').map((p) => p.trim()).filter(Boolean) : [];
    return this.instagramService.getOrFetchFeed(destination, pois);
  }

  /**
   * Best YouTube travel video per POI for visual discovery.
   * Cached in Supabase for 24 hours.
   * GET /api/itinerary/poi-videos/:destination?pois=Echo+Point,Tea+Museum
   */
  @Get('poi-videos/:destination')
  async getPoiVideos(
    @Param('destination') destination: string,
    @Query('pois') poisRaw?: string,
  ): Promise<any> {
    const pois = poisRaw ? poisRaw.split(',').map((p) => p.trim()).filter(Boolean) : [];
    return this.youtubeDiscoveryService.getPoiVideos(destination, pois);
  }

  /**
   * Trip chatbot — "Ask about this place"
   * Uses Jina Reader to scrape the official state tourism site, then
   * passes the authoritative content to OpenRouter/Mistral for Q-A.
   *
   * POST /api/itinerary/chatbot
   * Body: { place, destination, question }
   */
  @Post('chatbot')
  @UsageLimit('ai_requests')
  async chatbot(
    @Body() body: { place: string; destination: string; question: string },
  ): Promise<{ answer: string; source?: string; sourceUrl?: string }> {
    const { place = '', destination = '', question = '' } = body;
    if (!place || !question) {
      return { answer: 'Please provide both a place name and a question.' };
    }
    return this.chatbotService.askAboutPlace(place, destination, question);
  }

  // ─── TRIP TRACKING ENDPOINTS ─────────────────────────────────

  /**
   * POST /api/itinerary/checkin
   * User checks in to an activity.
   * Body: { tripJobId, userId, dayIndex, activityName, plannedTime, notes? }
   */
  @Post('checkin')
  async checkIn(
    @Body() body: {
      tripJobId: string;
      userId: string;
      dayIndex: number;
      activityName: string;
      plannedTime: string;
      notes?: string;
    },
  ) {
    return this.tripTrackerService.checkIn(
      body.tripJobId,
      body.userId,
      body.dayIndex,
      body.activityName,
      body.plannedTime,
      body.notes,
    );
  }

  /**
   * POST /api/itinerary/checkout
   * User checks out from an activity.
   * Body: { tripJobId, userId, dayIndex, activityName }
   */
  @Post('checkout')
  async checkOut(
    @Body() body: {
      tripJobId: string;
      userId: string;
      dayIndex: number;
      activityName: string;
    },
  ) {
    return this.tripTrackerService.checkOut(
      body.tripJobId,
      body.userId,
      body.dayIndex,
      body.activityName,
    );
  }

  /**
   * POST /api/itinerary/skip-activity
   * User skips an activity.
   * Body: { tripJobId, userId, dayIndex, activityName, reason? }
   */
  @Post('skip-activity')
  async skipActivity(
    @Body() body: {
      tripJobId: string;
      userId: string;
      dayIndex: number;
      activityName: string;
      reason?: string;
    },
  ) {
    return this.tripTrackerService.skipActivity(
      body.tripJobId,
      body.userId,
      body.dayIndex,
      body.activityName,
      body.reason,
    );
  }

  /**
   * GET /api/itinerary/tracking/:tripJobId?userId=
   * Returns real-time tracking status for a trip.
   */
  @Get('tracking/:tripJobId')
  async getTrackingStatus(
    @Param('tripJobId') tripJobId: string,
    @Query('userId') userId?: string,
  ) {
    return this.tripTrackerService.getTrackingStatus(tripJobId, userId);
  }

  /**
   * POST /api/itinerary/eta-check
   * Returns live ETA risk for the next activity after check-in.
   * Body: { tripJobId, userId, dayIndex, currentActivity, nextActivity, destination }
   */
  @Post('eta-check')
  async etaCheck(
    @Body() body: {
      tripJobId: string;
      userId: string;
      dayIndex: number;
      currentActivity: { name: string; location?: string };
      nextActivity: { name: string; time: string; location?: string } | null;
      destination: string;
    },
  ) {
    return this.etaMonitorService.checkEtaAfterCheckin(
      body.tripJobId,
      body.userId,
      body.dayIndex,
      body.currentActivity,
      body.nextActivity,
      body.destination,
    );
  }

  /**
   * GET /api/itinerary/openrouter-health
   * Pings OpenRouter and returns connectivity + latency status.
   */
  @Get('openrouter-health')
  async openRouterHealth() {
    return this.openRouterService.ping();
  }
}
