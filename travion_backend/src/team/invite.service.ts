import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { supabase } from '../supabase/client';

export interface TripMember {
  id: string;
  tripJobId: string;
  userId: string;
  role: 'owner' | 'member';
  status: 'invited' | 'joined';
  displayName?: string;
  email?: string;
  joinedAt?: string;
  createdAt: string;
}

export interface InviteResult {
  token: string;
  code: string;
  link: string;
  expiresAt: string;
}

@Injectable()
export class InviteService {
  private readonly BASE_URL = process.env.APP_BASE_URL || 'https://travion.app';

  // ─────────────────────────────────────────────────────────────
  // Ensure owner is registered in trip_members for this trip
  // ─────────────────────────────────────────────────────────────
  async ensureOwner(tripJobId: string, ownerId: string, displayName?: string): Promise<void> {
    if (!supabase) return;
    await supabase.from('trip_members').upsert(
      {
        trip_job_id: tripJobId,
        user_id: ownerId,
        role: 'owner',
        status: 'joined',
        display_name: displayName ?? 'Owner',
        joined_at: new Date().toISOString(),
      },
      { onConflict: 'trip_job_id,user_id' },
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Generate a new invite (link token + 6-char code)
  // Enforces max_travelers cap before creating
  // ─────────────────────────────────────────────────────────────
  async generateInvite(
    tripJobId: string,
    ownerId: string,
    maxTravelers: number,
  ): Promise<InviteResult> {
    if (!supabase) throw new BadRequestException('Database not configured');

    // Enforce cap: current joined members < maxTravelers
    const { count } = await supabase
      .from('trip_members')
      .select('id', { count: 'exact', head: true })
      .eq('trip_job_id', tripJobId)
      .eq('status', 'joined');

    const joined = (count as number) || 0;
    if (joined >= maxTravelers) {
      throw new ForbiddenException(
        `Trip is full — ${joined}/${maxTravelers} travelers have joined.`,
      );
    }

    // Invalidate any existing unexpired invites for this trip
    await supabase
      .from('trip_invites')
      .update({ expires_at: new Date().toISOString() })
      .eq('trip_job_id', tripJobId)
      .gt('expires_at', new Date().toISOString());

    // Generate token + code
    const token = randomBytes(16).toString('hex');          // 32 hex chars
    const code = this.generateCode();                        // 6 alphanum chars
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const { error } = await supabase.from('trip_invites').insert({
      trip_job_id: tripJobId,
      token,
      code,
      invited_by: ownerId,
      max_travelers: maxTravelers,
      expires_at: expiresAt,
    });

    if (error) throw new BadRequestException(`Failed to create invite: ${error.message}`);

    return {
      token,
      code,
      link: `${this.BASE_URL}/join/${token}`,
      expiresAt,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Join via token (link) or code
  // ─────────────────────────────────────────────────────────────
  async joinTrip(
    tokenOrCode: string,
    userId: string,
    displayName?: string,
    email?: string,
  ): Promise<{ tripJobId: string; role: string }> {
    if (!supabase) throw new BadRequestException('Database not configured');

    const isCode = tokenOrCode.length <= 8;
    const query = supabase
      .from('trip_invites')
      .select('*')
      .gt('expires_at', new Date().toISOString());

    const { data: invites, error } = await (isCode
      ? query.eq('code', tokenOrCode.toUpperCase())
      : query.eq('token', tokenOrCode)
    ).limit(1);

    if (error || !invites?.length) {
      throw new BadRequestException('Invite not found or has expired.');
    }

    const invite = invites[0];
    const tripJobId: string = invite.trip_job_id;

    // Check if trip is full
    const { count } = await supabase
      .from('trip_members')
      .select('id', { count: 'exact', head: true })
      .eq('trip_job_id', tripJobId)
      .eq('status', 'joined');

    const joined = (count as number) || 0;
    if (joined >= invite.max_travelers) {
      throw new ForbiddenException('This trip is already full.');
    }

    // Check if already a member
    const { data: existing } = await supabase
      .from('trip_members')
      .select('id, status')
      .eq('trip_job_id', tripJobId)
      .eq('user_id', userId)
      .single();

    if (existing?.status === 'joined') {
      return { tripJobId, role: 'member' };
    }

    // Add / update member record
    await supabase.from('trip_members').upsert(
      {
        trip_job_id: tripJobId,
        user_id: userId,
        role: 'member',
        status: 'joined',
        display_name: displayName,
        email,
        joined_at: new Date().toISOString(),
      },
      { onConflict: 'trip_job_id,user_id' },
    );

    // Mark invite as used (single-use)
    await supabase
      .from('trip_invites')
      .update({ used_by: userId, used_at: new Date().toISOString() })
      .eq('id', invite.id);

    return { tripJobId, role: 'member' };
  }

  // ─────────────────────────────────────────────────────────────
  // Get members
  // ─────────────────────────────────────────────────────────────
  async getMembers(tripJobId: string): Promise<TripMember[]> {
    if (!supabase) return [];

    const { data } = await supabase
      .from('trip_members')
      .select('*')
      .eq('trip_job_id', tripJobId)
      .order('created_at', { ascending: true });

    return (data || []).map((r: any) => ({
      id: r.id,
      tripJobId: r.trip_job_id,
      userId: r.user_id,
      role: r.role,
      status: r.status,
      displayName: r.display_name,
      email: r.email,
      joinedAt: r.joined_at,
      createdAt: r.created_at,
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Current active invite for a trip (for re-displaying code)
  // ─────────────────────────────────────────────────────────────
  async getActiveInvite(tripJobId: string): Promise<InviteResult | null> {
    if (!supabase) return null;

    const { data } = await supabase
      .from('trip_invites')
      .select('*')
      .eq('trip_job_id', tripJobId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (!data?.length) return null;
    const r = data[0];
    return {
      token: r.token,
      code: r.code,
      link: `${this.BASE_URL}/join/${r.token}`,
      expiresAt: r.expires_at,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable O0I1
    let code = '';
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
    return code;
  }
}
