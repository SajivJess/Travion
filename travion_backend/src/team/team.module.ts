import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';
import { InviteService } from './invite.service';
import { FeedbackService } from './feedback.service';
import { SuggestionService } from './suggestion.service';
import { ConsensusService } from './consensus.service';
import { OpenRouterService } from '../itinerary/openrouter.service';

@Module({
  controllers: [TeamController],
  providers: [InviteService, FeedbackService, SuggestionService, ConsensusService, OpenRouterService],
  exports: [InviteService, FeedbackService, SuggestionService, ConsensusService],
})
export class TeamModule {}
