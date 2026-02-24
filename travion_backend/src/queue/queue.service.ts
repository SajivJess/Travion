import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { supabase } from '../supabase/client';
import { TripPlanningJobData } from './processors/trip-planning.processor';
import { FlightMonitoringJob } from './processors/flight-delay-monitor.processor';
import { TransportMonitoringJob } from './processors/transport-delay-monitor.processor';
import { PoiMonitoringJob } from './processors/poi-monitor.processor';

export interface TripMonitoringJob {
  tripId: string;
  userId: string;
  destination: string;
  startDate: string;
  endDate: string;
  activities: string[];
}

export interface TripUpdateInput {
  tripId: string;
  userId: string;
  day: number;
  reason: 'weather' | 'crowd' | 'flight_delay' | 'transport_delay' | 'poi_closed' | 'user_flag';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  affectedActivities: string[];
  suggestedChanges: any[];
  summary: string;
  context: any;
}

export interface TripUpdate extends TripUpdateInput {
  id: string;
  status: 'pending' | 'applied' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

export interface ReplanJob {
  tripId: string;
  userId: string;
  reason: 'weather' | 'crowd' | 'availability' | 'user_request' | 'flight_delay' | 'transport_delay' | 'user_flag' | 'poi_closed';
  affectedDays: number[];
  context: any;
}

/** Extended job for the autonomous agent-loop processor */
export interface AgentLoopJob extends ReplanJob {
  currentDays?: any[];    // live itinerary days to simulate against
  destination?: string;
  travelStyle?: string;
}

/** A proposed replan awaiting user consent */
export interface ProposedReplan {
  proposalId: string;
  tripId: string;
  userId: string;
  reason: string;
  affectedDays: number[];
  proposedChanges: any[]; // Array of activity changes
  context: any;
  summary: string;        // Human-readable one-liner shown in consent banner
  createdAt: string;
  expiresAt: string;      // ISO — auto-expire after 24h
  status: 'pending' | 'accepted' | 'rejected';
}

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);

  /** In-memory proposal store — short-lived (user acts within minutes to hours) */
  private readonly proposals = new Map<string, ProposedReplan>();

  constructor(
    @InjectQueue('trip-planning') private tripPlanningQueue: Queue,
    @InjectQueue('weather-monitor') private weatherQueue: Queue,
    @InjectQueue('crowd-monitor') private crowdQueue: Queue,
    @InjectQueue('replan') private replanQueue: Queue,
    @InjectQueue('notifications') private notificationQueue: Queue,
    @InjectQueue('flight-delay-monitor') private flightDelayQueue: Queue,
    @InjectQueue('transport-delay-monitor') private transportDelayQueue: Queue,
    @InjectQueue('poi-monitor') private poiMonitorQueue: Queue,
    @InjectQueue('agent-loop') private agentLoopQueue: Queue,
  ) {}

  /**
   * On startup, clean stale repeatable weather/crowd monitors and
   * drain any leftover replan jobs from previous runs
   */
  async onModuleInit(): Promise<void> {
    try {
      // Remove all stale repeatable weather jobs
      const weatherRepeatables = await this.weatherQueue.getRepeatableJobs();
      for (const job of weatherRepeatables) {
        await this.weatherQueue.removeRepeatableByKey(job.key);
      }
      if (weatherRepeatables.length > 0) {
        this.logger.log(`🧹 Cleaned ${weatherRepeatables.length} stale weather monitor(s)`);
      }

      // Remove all stale repeatable crowd jobs
      const crowdRepeatables = await this.crowdQueue.getRepeatableJobs();
      for (const job of crowdRepeatables) {
        await this.crowdQueue.removeRepeatableByKey(job.key);
      }
      if (crowdRepeatables.length > 0) {
        this.logger.log(`🧹 Cleaned ${crowdRepeatables.length} stale crowd monitor(s)`);
      }

      // Remove all stale repeatable flight delay jobs
      const flightRepeatables = await this.flightDelayQueue.getRepeatableJobs();
      for (const job of flightRepeatables) {
        await this.flightDelayQueue.removeRepeatableByKey(job.key);
      }
      if (flightRepeatables.length > 0) {
        this.logger.log(`🧹 Cleaned ${flightRepeatables.length} stale flight monitor(s)`);
      }

      // Remove all stale repeatable transport delay jobs
      const transportRepeatables = await this.transportDelayQueue.getRepeatableJobs();
      for (const job of transportRepeatables) {
        await this.transportDelayQueue.removeRepeatableByKey(job.key);
      }
      if (transportRepeatables.length > 0) {
        this.logger.log(`🧹 Cleaned ${transportRepeatables.length} stale transport monitor(s)`);
      }

      // Remove all stale repeatable POI monitor jobs
      const poiRepeatables = await this.poiMonitorQueue.getRepeatableJobs();
      for (const job of poiRepeatables) {
        await this.poiMonitorQueue.removeRepeatableByKey(job.key);
      }
      if (poiRepeatables.length > 0) {
        this.logger.log(`🧹 Cleaned ${poiRepeatables.length} stale POI monitor(s)`);
      }

      // Drain waiting replan jobs from previous crashed runs
      const waitingReplans = await this.replanQueue.getWaitingCount();
      if (waitingReplans > 0) {
        await this.replanQueue.empty();
        this.logger.log(`🧹 Drained ${waitingReplans} stale replan job(s)`);
      }
    } catch (err) {
      this.logger.warn(`Queue cleanup on startup failed: ${err.message}`);
    }
  }

  /**
   * Submit a trip planning job to BullMQ for async processing
   * Returns jobId for status polling / WebSocket push
   */
  async submitTripPlanningJob(userId: string, dto: any): Promise<string> {
    const jobId = `trip-${Date.now()}-${userId.slice(-6)}`;
    this.logger.log(`📋 Submitting trip planning job ${jobId} for user ${userId}`);

    // Create job record in Supabase for status tracking
    if (supabase) {
      try {
        await supabase.from('trip_planning_jobs').insert({
          job_id: jobId,
          user_id: userId,
          status: 'queued',
          progress: 0,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.warn(`Failed to create Supabase job record: ${err.message}`);
      }
    }

    // Add to BullMQ queue
    const jobData: TripPlanningJobData = { jobId, userId, dto };
    await this.tripPlanningQueue.add('plan-trip', jobData, {
      jobId,
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
      timeout: 5 * 60 * 1000, // 5 min timeout
    });

    this.logger.log(`✅ Job ${jobId} added to trip-planning queue`);
    return jobId;
  }

  /**
   * Get trip planning job status from Supabase
   */
  async getTripJobStatus(jobId: string): Promise<any> {
    if (!supabase) {
      // Fallback: check BullMQ directly
      const job = await this.tripPlanningQueue.getJob(jobId);
      if (!job) return { status: 'not_found' };
      const state = await job.getState();
      const result = job.returnvalue;
      return { 
        jobId, 
        status: state, 
        progress: job.progress(),
        itinerary_data: result?.itinerary,
        error_message: job.failedReason
      };
    }

    const { data, error } = await supabase
      .from('trip_planning_jobs')
      .select('*')
      .eq('job_id', jobId)
      .single();

    if (error || !data) return { status: 'not_found' };
    return data;
  }

  /**
   * List all trip planning jobs for a given user (completed + in-progress)
   */
  async getUserTrips(userId: string): Promise<{ trips: any[]; total: number }> {
    if (!supabase) return { trips: [], total: 0 };
    try {
      const { data, error } = await supabase
        .from('trip_planning_jobs')
        .select('job_id, user_id, status, progress, itinerary_data, created_at, completed_at, error_message')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error || !data) return { trips: [], total: 0 };
      return { trips: data, total: data.length };
    } catch {
      return { trips: [], total: 0 };
    }
  }

  /**
   * Start monitoring a trip for weather changes
   * Runs every 6 hours until trip end date
   */
  async startWeatherMonitoring(job: TripMonitoringJob): Promise<void> {
    this.logger.log(`🌤️ Starting weather monitoring for trip ${job.tripId}`);
    
    await this.weatherQueue.add('check-weather', job, {
      repeat: {
        every: 6 * 60 * 60 * 1000, // Every 6 hours
        endDate: new Date(job.endDate).getTime(),
      },
      jobId: `weather-${job.tripId}`,
    });
  }

  /**
   * Start monitoring crowd levels at destinations
   * Runs every 12 hours until trip start
   */
  async startCrowdMonitoring(job: TripMonitoringJob): Promise<void> {
    this.logger.log(`👥 Starting crowd monitoring for trip ${job.tripId}`);
    
    await this.crowdQueue.add('check-crowds', job, {
      repeat: {
        every: 12 * 60 * 60 * 1000, // Every 12 hours
        endDate: new Date(job.startDate).getTime(),
      },
      jobId: `crowd-${job.tripId}`,
    });
  }

  /**
   * Start monitoring flight delays for a trip.
   * Checks every 3 hours on the day of travel (flightDate).
   * Stops automatically once the flight date has passed.
   */
  async startFlightMonitoring(job: FlightMonitoringJob): Promise<void> {
    this.logger.log(
      `✈️ Starting flight delay monitoring for trip ${job.tripId} ` +
      `(${job.depIata} → ${job.arrIata} on ${job.flightDate})`,
    );

    // Calculate end of flight day (midnight of flightDate + 1 day)
    const flightDayEnd = new Date(job.flightDate);
    flightDayEnd.setDate(flightDayEnd.getDate() + 1);

    await this.flightDelayQueue.add('check-flight-delay', job, {
      repeat: {
        every: 3 * 60 * 60 * 1000, // Every 3 hours
        endDate: flightDayEnd.getTime(),
      },
      jobId: `flight-${job.tripId}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
    });
  }

  /**
   * Start monitoring POI open/closed status using YouTube + SerpAPI.
   * Runs every 12 hours until trip end date.
   */
  async startPoiMonitoring(job: PoiMonitoringJob): Promise<void> {
    this.logger.log(`📍 Starting POI monitoring for trip ${job.tripId}`);

    await this.poiMonitorQueue.add('check-poi', job, {
      repeat: {
        every: 12 * 60 * 60 * 1000, // Every 12 hours
        endDate: new Date(job.endDate).getTime(),
      },
      jobId: `poi-${job.tripId}`,
      attempts: 1,
    });
  }

  /**
   * Start monitoring transport delays (live traffic via Google Maps)
   * Runs every 4 hours during the active trip days.
   */
  async startTransportMonitoring(job: TransportMonitoringJob): Promise<void> {
    this.logger.log(`🚦 Starting transport delay monitoring for trip ${job.tripId}`);

    await this.transportDelayQueue.add('check-transport', job, {
      repeat: {
        every: 4 * 60 * 60 * 1000, // Every 4 hours
        endDate: new Date(job.endDate).getTime(),
      },
      jobId: `transport-${job.tripId}`,
      attempts: 1,
    });
  }

  /**
   * Queue a replanning job
   */
  async queueReplan(job: ReplanJob): Promise<void> {
    this.logger.log(`🔄 Queuing replan for trip ${job.tripId}, reason: ${job.reason}`);
    
    await this.replanQueue.add('execute-replan', job, {
      priority: job.reason === 'weather' || job.reason === 'flight_delay' ? 1 : 2,
      attempts: 2,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnFail: true,
    });
  }

  async queueAgentLoop(job: AgentLoopJob): Promise<void> {
    this.logger.log(`🤖 Queuing agent-loop for trip ${job.tripId}, reason: ${job.reason}`);
    await this.agentLoopQueue.add('run-agent-loop', job, {
      priority: job.reason === 'user_flag' || job.reason === 'weather' ? 1 : 2,
      attempts: 2,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnFail: true,
    });
  }

  /**
   * Stop all monitoring for a trip
   */
  async stopTripMonitoring(tripId: string): Promise<void> {
    this.logger.log(`⏹️ Stopping all monitoring for trip ${tripId}`);
    
    // Remove repeatable jobs
    const weatherJobs = await this.weatherQueue.getRepeatableJobs();
    const crowdJobs = await this.crowdQueue.getRepeatableJobs();
    const transportJobs = await this.transportDelayQueue.getRepeatableJobs();
    
    for (const job of weatherJobs) {
      if (job.id === `weather-${tripId}`) {
        await this.weatherQueue.removeRepeatableByKey(job.key);
      }
    }
    
    for (const job of crowdJobs) {
      if (job.id === `crowd-${tripId}`) {
        await this.crowdQueue.removeRepeatableByKey(job.key);
      }
    }

    for (const job of transportJobs) {
      if (job.id === `transport-${tripId}`) {
        await this.transportDelayQueue.removeRepeatableByKey(job.key);
      }
    }

    // Remove flight delay monitoring jobs
    const flightJobs = await this.flightDelayQueue.getRepeatableJobs();
    for (const job of flightJobs) {
      if (job.id === `flight-${tripId}`) {
        await this.flightDelayQueue.removeRepeatableByKey(job.key);
      }
    }

    const poiJobs = await this.poiMonitorQueue.getRepeatableJobs();
    for (const job of poiJobs) {
      if (job.id === `poi-${tripId}`) {
        await this.poiMonitorQueue.removeRepeatableByKey(job.key);
      }
    }
  }

  /**
   * Queue a notification to be sent via WebSocket
   */
  async queueNotification(userId: string, type: string, data: any): Promise<void> {
    await this.notificationQueue.add('send-notification', {
      userId,
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get monitoring status for a trip
   */
  async getMonitoringStatus(tripId: string): Promise<{
    weatherActive: boolean;
    crowdActive: boolean;
    flightMonitorActive: boolean;
    transportMonitorActive: boolean;
    pendingReplans: number;
  }> {
    const weatherJobs = await this.weatherQueue.getRepeatableJobs();
    const crowdJobs = await this.crowdQueue.getRepeatableJobs();
    const flightJobs = await this.flightDelayQueue.getRepeatableJobs();
    const transportJobs = await this.transportDelayQueue.getRepeatableJobs();
    const replanJobs = await this.replanQueue.getWaiting();
    
    return {
      weatherActive: weatherJobs.some(j => j.id === `weather-${tripId}`),
      crowdActive: crowdJobs.some(j => j.id === `crowd-${tripId}`),
      flightMonitorActive: flightJobs.some(j => j.id === `flight-${tripId}`),
      transportMonitorActive: transportJobs.some(j => j.id === `transport-${tripId}`),
      pendingReplans: replanJobs.filter(j => j.data.tripId === tripId).length,
    };
  }

  // ─── TRIP UPDATES (Supabase-persisted, user-consent gated) ──────────────

  /**
   * Store a system-detected update in trip_updates (Supabase) and
   * send PLAN_UPDATE_AVAILABLE WebSocket event to the user.
   * Monitors call this instead of directly calling queueReplan.
   */
  async createTripUpdate(input: TripUpdateInput): Promise<string | null> {
    if (!supabase) {
      this.logger.warn('createTripUpdate: Supabase not configured');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('trip_updates')
        .insert({
          trip_id: input.tripId,
          user_id: input.userId,
          day: input.day,
          reason: input.reason,
          risk_level: input.riskLevel,
          affected_activities: input.affectedActivities,
          suggested_changes: input.suggestedChanges,
          summary: input.summary,
          context: input.context,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) {
        this.logger.warn(`createTripUpdate insert failed: ${error.message}`);
        return null;
      }

      const updateId = data?.id as string;
      this.logger.log(`📋 Trip update ${updateId} created for trip ${input.tripId} (${input.reason})`);

      // Notify user via WebSocket — PLAN_UPDATE_AVAILABLE
      await this.queueNotification(input.userId, 'PLAN_UPDATE_AVAILABLE', {
        tripId: input.tripId,
        updateId,
        reason: input.reason,
        riskLevel: input.riskLevel,
        day: input.day,
        summary: input.summary,
        affectedActivities: input.affectedActivities,
      });

      return updateId;
    } catch (err: any) {
      this.logger.error(`createTripUpdate failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Get all pending trip updates for a trip
   */
  async getTripUpdates(tripId: string): Promise<TripUpdate[]> {
    if (!supabase) return [];
    try {
      const { data, error } = await supabase
        .from('trip_updates')
        .select('*')
        .eq('trip_id', tripId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error || !data) return [];
      return data.map(row => ({
        id: row.id,
        tripId: row.trip_id,
        userId: row.user_id,
        day: row.day,
        reason: row.reason,
        riskLevel: row.risk_level,
        affectedActivities: row.affected_activities ?? [],
        suggestedChanges: row.suggested_changes ?? [],
        summary: row.summary,
        context: row.context,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })) as TripUpdate[];
    } catch {
      return [];
    }
  }

  /**
   * Apply a trip update: trigger Gemini replan using update context,
   * then mark the update row as applied.
   */
  async applyTripUpdate(updateId: string, userId: string): Promise<{ success: boolean; message: string; proposalId?: string }> {
    if (!supabase) return { success: false, message: 'Database not configured' };

    try {
      const { data: row, error } = await supabase
        .from('trip_updates')
        .select('*')
        .eq('id', updateId)
        .single();

      if (error || !row) return { success: false, message: 'Update not found' };
      if (row.status !== 'pending') return { success: false, message: `Update already ${row.status}` };

      // Mark as applied immediately to prevent duplicate processing
      await supabase
        .from('trip_updates')
        .update({ status: 'applied', updated_at: new Date().toISOString() })
        .eq('id', updateId);

      // Queue Gemini replan — replan.processor will create a proposal + notify user
      await this.queueReplan({
        tripId: row.trip_id,
        userId,
        reason: row.reason,
        affectedDays: [row.day],
        context: {
          ...row.context,
          updateId,
          suggestedChanges: row.suggested_changes,
          affectedActivities: row.affected_activities,
          summary: row.summary,
        },
      });

      this.logger.log(`▶️ Replan queued for update ${updateId} (trip ${row.trip_id})`);
      return { success: true, message: 'Replan started — you will receive a proposal shortly' };
    } catch (err: any) {
      this.logger.error(`applyTripUpdate failed: ${err.message}`);
      return { success: false, message: 'Failed to start replan' };
    }
  }

  /**
   * Dismiss a pending trip update
   */
  async dismissTripUpdate(updateId: string): Promise<{ success: boolean }> {
    if (!supabase) return { success: false };
    try {
      await supabase
        .from('trip_updates')
        .update({ status: 'dismissed', updated_at: new Date().toISOString() })
        .eq('id', updateId);
      this.logger.log(`🚫 Trip update ${updateId} dismissed`);
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  /**
   * Save a snapshot of the current itinerary as a versioned record in trip_versions.
   * V1 = original plan, V2+ = after each user-approved replan.
   */
  async saveTripVersion(tripId: string, reason?: string, updateId?: string): Promise<void> {
    if (!supabase) return;
    try {
      // Fetch current itinerary
      const { data: jobData } = await supabase
        .from('trip_planning_jobs')
        .select('itinerary_data')
        .eq('job_id', tripId)
        .single();

      if (!jobData?.itinerary_data) return;

      // Get next version number
      const { data: versions } = await supabase
        .from('trip_versions')
        .select('version_number')
        .eq('trip_id', tripId)
        .order('version_number', { ascending: false })
        .limit(1);

      const nextVersion = ((versions?.[0]?.version_number as number) ?? 0) + 1;

      await supabase.from('trip_versions').insert({
        trip_id: tripId,
        version_number: nextVersion,
        itinerary_data: jobData.itinerary_data,
        reason: reason ?? 'original',
        update_id: updateId ?? null,
        created_at: new Date().toISOString(),
      });

      this.logger.log(`📌 Saved trip version V${nextVersion} for trip ${tripId}`);
    } catch (err: any) {
      this.logger.warn(`saveTripVersion failed: ${err.message}`);
    }
  }

  /**
   * Get all saved versions for a trip
   */
  async getTripVersions(tripId: string): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data, error } = await supabase
        .from('trip_versions')
        .select('id, version_number, reason, update_id, created_at')
        .eq('trip_id', tripId)
        .order('version_number', { ascending: true });
      return error || !data ? [] : data;
    } catch {
      return [];
    }
  }

  async updateTripDays(tripId: string, days: any[]): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { data } = await supabase
        .from('trip_planning_jobs')
        .select('itinerary_data')
        .eq('job_id', tripId)
        .single();
      if (!data?.itinerary_data) return false;
      const updated = { ...(data.itinerary_data as any), days };
      const { error } = await supabase
        .from('trip_planning_jobs')
        .update({ itinerary_data: updated })
        .eq('job_id', tripId);
      return !error;
    } catch {
      return false;
    }
  }

  // ─── PROPOSED REPLAN + CONSENT ────────────────────────────────────────

  /**
   * Store a proposed replan and notify the user to review it.
   * The user can then accept or reject via /replan-consent/:proposalId.
   */
  async createProposal(
    tripId: string,
    userId: string,
    reason: string,
    affectedDays: number[],
    proposedChanges: any[],
    context: any,
    summary: string,
  ): Promise<string> {
    // Clean up expired proposals first
    const now = new Date();
    for (const [id, p] of this.proposals) {
      if (new Date(p.expiresAt) < now) this.proposals.delete(id);
    }

    const proposalId = crypto.randomUUID();
    const proposal: ProposedReplan = {
      proposalId,
      tripId,
      userId,
      reason,
      affectedDays,
      proposedChanges,
      context,
      summary,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      status: 'pending',
    };

    this.proposals.set(proposalId, proposal);
    this.logger.log(`📋 Created proposal ${proposalId} for trip ${tripId} (${reason})`);
    return proposalId;
  }

  /** Get all pending proposals for a trip (for the consent banner) */
  getProposalsForTrip(tripId: string): ProposedReplan[] {
    return Array.from(this.proposals.values())
      .filter(p => p.tripId === tripId && p.status === 'pending')
      .filter(p => new Date(p.expiresAt) > new Date());
  }

  /** Get a single proposal by ID */
  getProposal(proposalId: string): ProposedReplan | null {
    return this.proposals.get(proposalId) ?? null;
  }

  /**
   * Accept a proposal: apply the proposed changes to the trip's itinerary_data in Supabase.
   */
  async acceptProposal(proposalId: string): Promise<{ success: boolean; message: string }> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return { success: false, message: 'Proposal not found or expired' };
    if (proposal.status !== 'pending') return { success: false, message: `Proposal already ${proposal.status}` };

    try {
      if (supabase && proposal.proposedChanges.length > 0) {
        // Fetch current itinerary
        const { data: job } = await supabase
          .from('trip_planning_jobs')
          .select('itinerary_data')
          .eq('job_id', proposal.tripId)
          .single();

        if (job?.itinerary_data) {
          const itinerary = job.itinerary_data as any;
          const days: any[] = itinerary.days || [];

          // Apply each proposed change by matching day number and activity name
          for (const change of proposal.proposedChanges) {
            const dayIdx = days.findIndex((d: any) => d.day === change.day);
            if (dayIdx === -1) continue;

            const activities: any[] = days[dayIdx].activities || [];
            const actIdx = activities.findIndex(
              (a: any) => a.name === change.originalActivity || a.name?.includes(change.originalActivity),
            );

            if (actIdx !== -1) {
              // Replace activity
              activities[actIdx] = {
                ...activities[actIdx],
                name: change.newActivity,
                description: change.reason || activities[actIdx].description,
                time: change.time || activities[actIdx].time,
                duration: change.duration || activities[actIdx].duration,
                estimatedCost: change.estimatedCost ?? activities[actIdx].estimatedCost,
                _replanned: true,
                _replanReason: proposal.reason,
              };
            }
          }

          // If no itinerary.warnings array, create one
          itinerary.warnings = itinerary.warnings || [];
          itinerary.warnings.push(`[${proposal.reason}] Itinerary updated on ${new Date().toLocaleDateString()}`);

          // Save back
          await supabase
            .from('trip_planning_jobs')
            .update({ itinerary_data: itinerary })
            .eq('job_id', proposal.tripId);
        }
      }

      proposal.status = 'accepted';
      this.proposals.set(proposalId, proposal);

      // Notify the user
      await this.queueNotification(proposal.userId, 'ITINERARY_UPDATED', {
        tripId: proposal.tripId,
        reason: proposal.reason,
        affectedDays: proposal.affectedDays,
        changes: proposal.proposedChanges,
        message: `Your itinerary has been updated (${proposal.reason.replace('_', ' ')}). ${proposal.proposedChanges.length} activity change(s) applied.`,
      });

      this.logger.log(`✅ Proposal ${proposalId} accepted and applied`);
      return { success: true, message: `${proposal.proposedChanges.length} change(s) applied to your itinerary` };
    } catch (err: any) {
      this.logger.error(`Failed to apply proposal ${proposalId}: ${err.message}`);
      return { success: false, message: 'Failed to apply changes. Please try again.' };
    }
  }

  /** Reject a proposal (user chose to ignore the suggested replan) */
  rejectProposal(proposalId: string): { success: boolean; message: string } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return { success: false, message: 'Proposal not found or expired' };
    proposal.status = 'rejected';
    this.proposals.set(proposalId, proposal);
    this.logger.log(`🚫 Proposal ${proposalId} rejected by user`);
    return { success: true, message: 'Replan dismissed' };
  }
}
