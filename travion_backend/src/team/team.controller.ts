import {
  Controller, Get, Post, Patch, Param, Body, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { InviteService } from './invite.service';
import { FeedbackService, FeedbackType } from './feedback.service';
import { SuggestionService } from './suggestion.service';
import { ConsensusService } from './consensus.service';

// ─── DTOs ─────────────────────────────────────────────────────

class GenerateInviteDto {
  tripJobId: string;
  ownerId: string;
  maxTravelers: number;         // trip.travelers value
  ownerDisplayName?: string;
}

class JoinTripDto {
  tokenOrCode: string;
  userId: string;
  displayName?: string;
  email?: string;
}

class SubmitFeedbackDto {
  tripJobId: string;
  activityName: string;
  dayIndex: number;
  userId: string;
  feedbackType: FeedbackType;
  comment?: string;
}

class SubmitSuggestionDto {
  tripJobId: string;
  userId: string;
  text: string;
}

class UpdateSuggestionDto {
  status: 'applied' | 'ignored';
}

class SubmitVoteDto {
  tripJobId: string;
  userId: string;
  activityName: string;
  voteType: 'agree' | 'disagree' | 'neutral';
  suggestionText?: string;
}

// ─── Controller ───────────────────────────────────────────────

@Controller('api/team')
export class TeamController {
  constructor(
    private readonly inviteService: InviteService,
    private readonly feedbackService: FeedbackService,
    private readonly suggestionService: SuggestionService,
    private readonly consensusService: ConsensusService,
  ) {}

  // ──────────────────────────── INVITE ─────────────────────────

  /**
   * GET /api/team/members/:tripJobId
   * Returns the member list for a trip.
   */
  @Get('members/:tripJobId')
  async getMembers(@Param('tripJobId') tripJobId: string) {
    return this.inviteService.getMembers(tripJobId);
  }

  /**
   * GET /api/team/invite/:tripJobId
   * Returns the currently active invite (code + link) for the owner.
   */
  @Get('invite/:tripJobId')
  async getActiveInvite(@Param('tripJobId') tripJobId: string) {
    return this.inviteService.getActiveInvite(tripJobId);
  }

  /**
   * POST /api/team/invite/generate
   * Owner generates a new invite link + code.
   * Also registers the owner in trip_members if not already present.
   */
  @Post('invite/generate')
  @HttpCode(HttpStatus.CREATED)
  async generateInvite(@Body() body: GenerateInviteDto) {
    // Ensure owner is registered
    await this.inviteService.ensureOwner(
      body.tripJobId,
      body.ownerId,
      body.ownerDisplayName,
    );
    return this.inviteService.generateInvite(
      body.tripJobId,
      body.ownerId,
      body.maxTravelers,
    );
  }

  /**
   * POST /api/team/invite/join
   * Member joins a trip using a token from URL or a 6-char code.
   */
  @Post('invite/join')
  @HttpCode(HttpStatus.OK)
  async joinTrip(@Body() body: JoinTripDto) {
    return this.inviteService.joinTrip(
      body.tokenOrCode,
      body.userId,
      body.displayName,
      body.email,
    );
  }

  // ──────────────────────────── FEEDBACK ───────────────────────

  /**
   * GET /api/team/feedback/:tripJobId
   * Returns aggregated feedback counts per activity.
   */
  @Get('feedback/:tripJobId')
  async getFeedback(@Param('tripJobId') tripJobId: string) {
    return this.feedbackService.getAggregatedFeedback(tripJobId);
  }

  /**
   * GET /api/team/feedback/:tripJobId/raw
   * Returns raw feedback rows (for admin / owner detail view).
   */
  @Get('feedback/:tripJobId/raw')
  async getRawFeedback(@Param('tripJobId') tripJobId: string) {
    return this.feedbackService.getRawFeedback(tripJobId);
  }

  /**
   * POST /api/team/feedback
   * Submit / change reaction for an activity.
   */
  @Post('feedback')
  @HttpCode(HttpStatus.CREATED)
  async submitFeedback(@Body() body: SubmitFeedbackDto) {
    return this.feedbackService.submitFeedback(
      body.tripJobId,
      body.activityName,
      body.dayIndex,
      body.userId,
      body.feedbackType,
      body.comment,
    );
  }

  // ──────────────────────────── SUGGESTIONS ────────────────────

  /**
   * GET /api/team/suggestions/:tripJobId?status=pending
   * Returns NLP-parsed suggestions for the owner.
   */
  @Get('suggestions/:tripJobId')
  async getSuggestions(
    @Param('tripJobId') tripJobId: string,
    @Query('status') status?: string,
  ) {
    return this.suggestionService.getSuggestions(tripJobId, status);
  }

  /**
   * POST /api/team/suggestion
   * Member submits free-text suggestion → Gemini NLP parse → stored.
   */
  @Post('suggestion')
  @HttpCode(HttpStatus.CREATED)
  async submitSuggestion(@Body() body: SubmitSuggestionDto) {
    return this.suggestionService.submitSuggestion(
      body.tripJobId,
      body.userId,
      body.text,
    );
  }

  /**
   * PATCH /api/team/suggestion/:id
   * Owner applies or ignores a suggestion.
   */
  @Patch('suggestion/:id')
  async updateSuggestion(
    @Param('id') id: string,
    @Body() body: UpdateSuggestionDto,
  ) {
    await this.suggestionService.updateStatus(id, body.status);
    return { ok: true };
  }

  // ──────────────────────────── CONSENSUS ──────────────────────

  /**
   * GET /api/team/consensus/:tripJobId
   * Returns the team consensus score for a trip.
   */
  @Get('consensus/:tripJobId')
  async getConsensus(@Param('tripJobId') tripJobId: string) {
    return this.consensusService.getConsensusScore(tripJobId);
  }

  /**
   * GET /api/team/consensus/:tripJobId/breakdown
   * Returns per-activity vote breakdown.
   */
  @Get('consensus/:tripJobId/breakdown')
  async getConsensusBreakdown(@Param('tripJobId') tripJobId: string) {
    return this.consensusService.getActivityBreakdown(tripJobId);
  }

  /**
   * POST /api/team/consensus/vote
   * Submit a vote on a proposed activity change.
   */
  @Post('consensus/vote')
  @HttpCode(HttpStatus.CREATED)
  async submitVote(@Body() body: SubmitVoteDto) {
    return this.consensusService.submitVote(
      body.tripJobId,
      body.userId,
      body.activityName,
      body.voteType,
      body.suggestionText,
    );
  }
}
