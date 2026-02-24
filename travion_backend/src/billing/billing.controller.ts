import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

@Controller('api/billing')
export class BillingController {
  constructor(private subscriptionService: SubscriptionService) {}

  /**
   * Get tier info and pricing
   */
  @Get('tiers')
  getTiers() {
    return this.subscriptionService.getTierInfo();
  }

  /**
   * Create payment link
   * Body: { planType: 'monthly' | 'annual', email: string, userId: string }
   */
  @Post('create-payment')
  async createPayment(
    @Body() body: { planType: 'monthly' | 'annual'; email: string; userId: string },
  ) {
    if (!['monthly', 'annual'].includes(body.planType)) {
      throw new HttpException('Invalid plan type', HttpStatus.BAD_REQUEST);
    }

    if (!body.email || !body.userId) {
      throw new HttpException(
        'Email and userId are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const paymentLink = await this.subscriptionService.createPaymentLink(
        body.planType,
        body.email,
        body.userId,
      );
      return paymentLink;
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Dodo payment callback (success page)
   */
  @Get('test-checkout')
  testCheckout(
    @Query('order_id') orderId: string,
    @Query('amount') amount: string,
    @Query('email') email: string,
    @Query('plan') plan: string,
    @Res() res: any,
  ) {
    const amountInRupees = (parseInt(amount) / 100).toFixed(2);
    
    res.send(`
      <html>
        <head>
          <title>Dodo Payments - Travion Pro</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
            }
            .container {
              background: rgba(255, 255, 255, 0.05);
              backdrop-filter: blur(10px);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 16px;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
              padding: 40px;
              max-width: 450px;
              width: 100%;
            }
            .logo {
              text-align: center;
              font-size: 48px;
              margin-bottom: 10px;
            }
            h1 {
              color: #00d4ff;
              text-align: center;
              margin: 0 0 10px 0;
              font-size: 28px;
            }
            .plan {
              text-align: center;
              color: #aaa;
              margin-bottom: 20px;
              font-size: 14px;
            }
            .amount {
              font-size: 48px;
              text-align: center;
              margin: 20px 0;
              font-weight: bold;
              color: #00d4ff;
            }
            .info {
              background: rgba(15, 52, 96, 0.5);
              padding: 15px;
              border-radius: 8px;
              margin: 20px 0;
              font-size: 13px;
              border-left: 3px solid #00d4ff;
              color: #fff;
            }
            input {
              width: 100%;
              padding: 14px;
              margin: 10px 0;
              box-sizing: border-box;
              border-radius: 8px;
              border: 1px solid rgba(255, 255, 255, 0.2);
              background: rgba(15, 52, 96, 0.3);
              color: #fff;
              font-size: 14px;
            }
            label {
              color: #aaa;
              font-size: 13px;
              display: block;
              margin-top: 12px;
            }
            button {
              width: 100%;
              padding: 16px;
              background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
              color: #000;
              border: none;
              border-radius: 8px;
              font-weight: bold;
              cursor: pointer;
              margin-top: 20px;
              font-size: 16px;
              transition: transform 0.2s;
            }
            button:hover {
              transform: translateY(-2px);
            }
            button:disabled {
              background: #555;
              cursor: not-allowed;
              transform: none;
            }
            .status {
              text-align: center;
              margin-top: 20px;
              font-size: 14px;
              color: #00d4ff;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">💳</div>
            <h1>Dodo Payments</h1>
            <div class="plan">${plan === 'annual' ? 'Annual' : 'Monthly'} Plan</div>
            <div class="amount">₹${amountInRupees}</div>
            
            <div class="info">
              <strong>🧪 Test Mode</strong><br>
              Use the test card details below
            </div>

            <form id="paymentForm" onsubmit="return handlePayment(event)">
              <label>Card Number</label>
              <input type="text" value="4111 1111 1111 1111" readonly />
              
              <label>Expiry (MM/YY)</label>
              <input type="text" value="12/28" readonly />
              
              <label>CVV</label>
              <input type="text" value="123" readonly />

              <label>Email</label>
              <input type="email" value="${email}" readonly />

              <button type="submit" id="payBtn">Complete Payment</button>
            </form>

            <div class="status" id="status"></div>
          </div>

          <script>
            async function handlePayment(e) {
              e.preventDefault();
              
              const btn = document.getElementById('payBtn');
              const status = document.getElementById('status');
              
              btn.disabled = true;
              btn.textContent = 'Processing...';
              status.innerHTML = '⏳ Processing payment...';
              
              await new Promise(r => setTimeout(r, 2000));
              
              const paymentId = 'pay_' + Date.now();
              
              status.innerHTML = '✅ Payment successful!';
              btn.textContent = 'Payment Complete';
              
              setTimeout(() => {
                window.location.href = 'http://localhost:3000/api/billing/payment-callback?order_id=${orderId}&payment_id=' + paymentId;
              }, 1500);
            }
          </script>
        </body>
      </html>
    `);
  }

  @Get('payment-callback')
  paymentCallback(
    @Query('order_id') orderId: string,
    @Query('payment_id') paymentId: string,
    @Res() res: any,
  ) {
    console.log('Payment callback:', { orderId, paymentId });

    // Return success HTML
    res.send(`
      <html>
        <head>
          <title>Payment Successful</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
              padding: 40px;
              text-align: center;
              max-width: 500px;
            }
            h1 {
              color: #10b981;
              margin: 0 0 15px 0;
              font-size: 32px;
            }
            .checkmark {
              font-size: 64px;
              margin-bottom: 20px;
            }
            p {
              color: #666;
              font-size: 16px;
              line-height: 1.6;
              margin: 10px 0;
            }
            .order-id {
              background: #f3f4f6;
              padding: 10px;
              border-radius: 6px;
              margin: 15px 0;
              font-family: monospace;
              font-size: 12px;
              color: #666;
            }
            .info {
              background: #ecfdf5;
              border-left: 4px solid #10b981;
              padding: 15px;
              border-radius: 6px;
              margin-top: 20px;
              text-align: left;
              font-size: 14px;
            }
            .info strong {
              color: #059669;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="checkmark">✅</div>
            <h1>Payment Successful!</h1>
            <p>Your Travion Pro subscription is now active.</p>
            <div class="order-id">Order ID: ${orderId}</div>
            <div class="info">
              <strong>What's included:</strong>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>Unlimited trips</li>
                <li>Full AI capabilities</li>
                <li>What-If mode</li>
                <li>Advanced features</li>
              </ul>
            </div>
            <p style="margin-top: 20px; font-size: 14px; color: #999;">
              You can close this window and return to the app.
            </p>
          </div>
          <script>
            setTimeout(() => window.close(), 5000);
          </script>
        </body>
      </html>
    `);
  }

  /**
   * Dodo webhook for payment notifications
   */
  @Post('webhook')
  handleWebhook(@Body() body: any) {
    console.log('Webhook received:', body);
    // Verify and update subscription in database
    // TODO: Implement webhook verification with Dodo secret
    return { received: true };
  }
}
