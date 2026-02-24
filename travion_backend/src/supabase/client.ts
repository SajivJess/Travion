import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Only create client if credentials exist
let supabase: any = null;

if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey);
} else {
  console.warn('⚠️ Supabase credentials not found. Auth and usage limits will be disabled.');
}

export { supabase };

// User subscription tiers
export enum SubscriptionTier {
  FREE = 'free',
  PRO = 'pro',
}

// Free tier limits
export const FREE_TIER_LIMITS = {
  tripsPerMonth: 3,
  aiRequestsPerMonth: 5,
  whatIfEnabled: false,
  replanEnabled: false,
};

// Check usage limit
export async function checkUsageLimit(
  userId: string,
  limitType: string,
): Promise<boolean> {
  if (!supabase) return true; // Allow if Supabase not configured

  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const { data: user } = await supabase
      .from('user_profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .single();

    if (!user) return false;

    const tier = user.subscription_tier as SubscriptionTier;
    if (tier === SubscriptionTier.PRO) return true;

    // Check FREE tier limits
    const { data: usage } = await supabase
      .from('usage_tracking')
      .select('trips_created, ai_requests')
      .eq('user_id', userId)
      .eq('month', month)
      .eq('year', year)
      .single();

    if (!usage) return true;

    if (limitType === 'trips') {
      return usage.trips_created < FREE_TIER_LIMITS.tripsPerMonth;
    } else if (limitType === 'ai_requests') {
      return usage.ai_requests < FREE_TIER_LIMITS.aiRequestsPerMonth;
    }

    return true;
  } catch (error) {
    console.error('Error checking usage limit:', error);
    return true; // Allow on error
  }
}

// Increment usage
export async function incrementUsage(userId: string, usageType: string): Promise<void> {
  if (!supabase) return;

  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // Get or create usage record
    const { data: existing } = await supabase
      .from('usage_tracking')
      .select()
      .eq('user_id', userId)
      .eq('month', month)
      .eq('year', year)
      .single();

    if (existing) {
      if (usageType === 'trips') {
        await supabase
          .from('usage_tracking')
          .update({ trips_created: existing.trips_created + 1 })
          .eq('id', existing.id);
      } else if (usageType === 'ai_requests') {
        await supabase
          .from('usage_tracking')
          .update({ ai_requests: existing.ai_requests + 1 })
          .eq('id', existing.id);
      }
    } else {
      const initialData = {
        user_id: userId,
        month,
        year,
        trips_created: usageType === 'trips' ? 1 : 0,
        ai_requests: usageType === 'ai_requests' ? 1 : 0,
      };
      await supabase.from('usage_tracking').insert(initialData);
    }
  } catch (error) {
    console.error('Error incrementing usage:', error);
  }
}

// Get user usage stats
export async function getUserUsage(userId: string): Promise<any> {
  if (!supabase) return null;

  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const { data: usage } = await supabase
      .from('usage_tracking')
      .select()
      .eq('user_id', userId)
      .eq('month', month)
      .eq('year', year)
      .single();

    return usage;
  } catch (error) {
    console.error('Error getting user usage:', error);
    return null;
  }
}

// Verify JWT token
export async function verifyToken(token: string): Promise<any> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    return data.user;
  } catch (error) {
    console.error('Error verifying token:', error);
    return null;
  }
}
