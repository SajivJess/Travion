import { Controller, Get, Query, Res, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Email verification callback
   * Called when user clicks the email verification link
   * Handles both signup confirmation and password reset
   */
  @Get('verify-email')
  async verifyEmail(
    @Query('token') token: string,
    @Query('type') type: string,
    @Query('redirect_to') redirectTo: string,
    @Res() res: any,
  ) {
    try {
      if (!token || !type) {
        throw new BadRequestException('Missing verification token or type');
      }

      // Types can be: signup, magiclink, recovery, invite
      // For email confirmation: type=signup or magiclink
      const isConfirmation = ['signup', 'magiclink'].includes(type);

      let title = 'Email Verified!';
      let message = 'Your email has been verified successfully.';
      let icon = '✅';
      let color = '#10b981';

      if (type === 'recovery') {
        title = 'Password Reset';
        message = 'You can now reset your password.';
        icon = '🔐';
        color = '#3b82f6';
      }

      // If there's a redirect_to parameter, redirect after showing success
      const hasRedirect = redirectTo && redirectTo.startsWith('http');
      const redirectScript = hasRedirect
        ? `
          <script>
            setTimeout(() => {
              window.location.href = '${redirectTo}';
            }, 3000);
          </script>
        `
        : '';

      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${title}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
                'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
                sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              justify-content: center;
              align-items: center;
              padding: 20px;
            }

            .container {
              background: white;
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              padding: 60px 40px;
              max-width: 500px;
              width: 100%;
              text-align: center;
              animation: slideUp 0.6s ease-out;
            }

            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(30px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }

            .icon {
              font-size: 80px;
              margin-bottom: 20px;
              animation: bounce 1s ease-out;
            }

            @keyframes bounce {
              0% {
                transform: scale(0);
              }
              50% {
                transform: scale(1.1);
              }
              100% {
                transform: scale(1);
              }
            }

            h1 {
              color: #1f2937;
              font-size: 32px;
              margin-bottom: 15px;
              font-weight: 700;
            }

            p {
              color: #6b7280;
              font-size: 16px;
              line-height: 1.6;
              margin-bottom: 30px;
            }

            .status-badge {
              display: inline-block;
              background: ${color};
              color: white;
              padding: 10px 20px;
              border-radius: 30px;
              font-size: 14px;
              font-weight: 600;
              margin-bottom: 30px;
              animation: fadeIn 0.8s ease-out 0.3s both;
            }

            @keyframes fadeIn {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }

            .button-group {
              display: flex;
              gap: 10px;
              margin-top: 30px;
              flex-direction: column;
            }

            .button {
              padding: 12px 24px;
              border: none;
              border-radius: 10px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.3s ease;
              text-decoration: none;
              display: inline-block;
            }

            .button-primary {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
            }

            .button-primary:hover {
              transform: translateY(-2px);
              box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
            }

            .button-secondary {
              background: #f3f4f6;
              color: #1f2937;
              border: 2px solid #e5e7eb;
            }

            .button-secondary:hover {
              background: #e5e7eb;
            }

            .info-box {
              background: #f0fdf4;
              border-left: 4px solid ${color};
              padding: 15px;
              border-radius: 8px;
              margin-top: 20px;
              text-align: left;
            }

            .info-box p {
              color: #166534;
              font-size: 14px;
              margin: 0;
            }

            .redirect-info {
              color: #9ca3af;
              font-size: 13px;
              margin-top: 20px;
              font-style: italic;
            }

            .logo {
              font-size: 24px;
              font-weight: 700;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">🌍 Travion</div>
            <div class="icon">${icon}</div>
            <h1>${title}</h1>
            <p>${message}</p>
            
            <div class="status-badge">
              ${isConfirmation ? 'Account Activated' : 'Password Reset Ready'}
            </div>

            <div class="info-box">
              <p>
                <strong>What's next?</strong><br>
                ${isConfirmation 
                  ? 'Your account is now active. You can log in and start planning your trips!' 
                  : 'You can now set a new password for your account.'}
              </p>
            </div>

            <div class="button-group">
              <a href="/" class="button button-primary">
                ${isConfirmation ? 'Go to Travion' : 'Reset Password'}
              </a>
              <a href="/login" class="button button-secondary">
                Back to Login
              </a>
            </div>

            ${hasRedirect ? `<p class="redirect-info">Redirecting in 3 seconds...</p>` : ''}
          </div>

          ${redirectScript}
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      const errorHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verification Error</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              min-height: 100vh;
              display: flex;
              justify-content: center;
              align-items: center;
              padding: 20px;
            }

            .container {
              background: white;
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              padding: 60px 40px;
              max-width: 500px;
              width: 100%;
              text-align: center;
            }

            .icon {
              font-size: 80px;
              margin-bottom: 20px;
            }

            h1 {
              color: #dc2626;
              font-size: 32px;
              margin-bottom: 15px;
            }

            p {
              color: #6b7280;
              font-size: 16px;
              line-height: 1.6;
              margin-bottom: 30px;
            }

            .button {
              display: inline-block;
              padding: 12px 24px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              border: none;
              border-radius: 10px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              text-decoration: none;
              transition: all 0.3s ease;
            }

            .button:hover {
              transform: translateY(-2px);
              box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">❌</div>
            <h1>Verification Failed</h1>
            <p>${error.message || 'The verification link is invalid or has expired.'}</p>
            <p style="color: #9ca3af; font-size: 14px;">
              Please request a new verification link or contact support.
            </p>
            <a href="/login" class="button">Back to Login</a>
          </div>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(errorHtml);
    }
  }
}
