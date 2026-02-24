import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../supabase/client';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
      };
    }
  }
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token with Supabase
        const user = await verifyToken(token);

        if (user) {
          // Attach authenticated user to request
          req.user = user;
        }
      }
      
      // Continue regardless of auth status - let guards handle authorization
      next();
    } catch (error) {
      // On error, just continue without user - let guards decide if auth is required
      next();
    }
  }
}
