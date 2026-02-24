import { Injectable } from '@nestjs/common';
import axios from 'axios';

// Tier pricing (in paise)
const TIER_PRICING = {
  monthly: 49900, // ₹499
  annual: 499900, // ₹4,999
};

// Usage limits per tier
const TIER_LIMITS = {
  free: {
    trips_per_month: 5,
    ai_usage_per_month: 10,
    what_if_mode: false,
    partial_replan: false,
  },
  pro: {
    trips_per_month: 999999, // Unlimited
    ai_usage_per_month: 999999, // Unlimited
    what_if_mode: true,
    partial_replan: true,
  },
};

@Injectable()
export class SubscriptionService {
  private readonly DODO_API_KEY = process.env.DODO_API_KEY;
  private readonly DODO_API_SECRET = process.env.DODO_API_SECRET;
  private readonly DODO_PUBLISHABLE_KEY = process.env.DODO_PUBLISHABLE_KEY;
  private readonly BACKEND_URL = process.env.BACKEND_URL;
  private readonly DODO_ENVIRONMENT =
    process.env.DODO_ENVIRONMENT || 'test_mode';
  private readonly PRODUCT_ID_PRO_MONTHLY =
    process.env.DODO_PRODUCT_ID_PRO_MONTHLY;
  private readonly PRODUCT_ID_PRO_ANNUAL =
    process.env.DODO_PRODUCT_ID_PRO_ANNUAL;

  /**
   * Resolve the correct Dodo base URL based on environment (test/live)
   */
  private getDodoBaseUrl() {
    return this.DODO_ENVIRONMENT === 'live_mode'
      ? 'https://live.dodopayments.com'
      : 'https://test.dodopayments.com';
  }

  /**
   * Create Dodo payment link for subscription
   */
  async createPaymentLink(
    planType: 'monthly' | 'annual',
    userEmail: string,
    userId: string,
  ) {
    const amount = TIER_PRICING[planType];

    if (!this.DODO_API_KEY) {
      throw new Error('DODO_API_KEY is missing');
    }

    const productId =
      planType === 'annual'
        ? this.PRODUCT_ID_PRO_ANNUAL
        : this.PRODUCT_ID_PRO_MONTHLY;

    if (!productId) {
      throw new Error(
        `Missing Dodo product id for ${planType}. Set DODO_PRODUCT_ID_PRO_${
          planType === 'annual' ? 'ANNUAL' : 'MONTHLY'
        }`,
      );
    }

    try {
      const orderId = `order_${userId}_${Date.now()}`;

      console.log('🔵 Attempting Dodo API call...');
      console.log('API Key:', this.DODO_API_KEY?.substring(0, 20) + '...');
      console.log('Backend URL:', this.BACKEND_URL);
      console.log('Dodo environment:', this.DODO_ENVIRONMENT);

      const baseUrl = this.getDodoBaseUrl();

      // Call Dodo Payments API to create a payment (payment_link = true)
      const response = await axios.post(
        `${baseUrl}/payments`,
        {
          payment_link: true,
          reference_id: orderId,
          return_url: `${
            this.BACKEND_URL || 'http://localhost:3000'
          }/api/billing/payment-callback?order_id=${orderId}&plan=${planType}&email=${encodeURIComponent(
            userEmail,
          )}&amount=${amount}`,
          customer: {
            email: userEmail,
            name: userEmail?.split('@')[0] || 'Travion User',
          },
          billing: {
            country: 'IN',
          },
          product_cart: [
            {
              product_id: productId,
              quantity: 1,
            },
          ],
          metadata: {
            plan: planType,
            user_id: userId,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.DODO_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );

      console.log('✅ Dodo payment link created:', response.data);

      return {
        success: true,
        order_id: orderId,
        amount,
        checkout_url:
          response.data?.checkout_url ||
          response.data?.payment_link_url ||
          response.data?.short_url ||
          response.data?.url,
        payment_link_id: response.data?.id,
      };
    } catch (error: any) {
      console.error('❌ Dodo API Error Details:');
      console.error('Status:', error.response?.status);
      console.error('Status Text:', error.response?.statusText);
      console.error('Response Data:', error.response?.data);
      console.error('Error Message:', error.message);
      
      throw new Error(
        `Payment link creation failed: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  /**
   * Get tier pricing and features
   */
  getTierInfo() {
    return {
      free: {
        name: 'Free',
        price: 0,
        limits: TIER_LIMITS.free,
        features: [
          'Create up to 5 trips/month',
          'Limited AI features',
          'Basic route optimization',
          'No What-If mode',
        ],
      },
      pro: {
        name: 'Pro',
        price: `₹${TIER_PRICING.monthly / 100}/month or ₹${TIER_PRICING.annual / 100}/year`,
        limits: TIER_LIMITS.pro,
        features: [
          'Unlimited trips',
          'Full AI capabilities',
          'What-If mode',
          'Partial re-planning',
          'Advanced intelligence features',
          'Priority support',
        ],
      },
    };
  }

  /**
   * Get user tier limits
   */
  getUserLimits(tier: 'free' | 'pro') {
    return TIER_LIMITS[tier];
  }
}
