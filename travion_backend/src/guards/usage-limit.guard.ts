import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { checkUsageLimit, incrementUsage } from '../supabase/client';

export const UsageLimit = (limitType: 'trips' | 'ai_requests' | 'what_if' | 'replan') => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('usage_limit_type', limitType, descriptor.value);
    return descriptor;
  };
};

@Injectable()
export class UsageLimitGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId || 'anonymous-user';
    const isAuthenticated = !!request.user?.userId;

    const handler = context.getHandler();
    const limitType = Reflect.getMetadata('usage_limit_type', handler);

    if (!limitType) {
      return true; // No usage limit defined
    }

    // Check if user can perform this action
    const canProceed = await checkUsageLimit(userId, limitType);

    if (!canProceed) {
      const message = isAuthenticated 
        ? 'Usage limit exceeded. Upgrade to Pro to continue.'
        : 'Free usage limit reached. Please sign in or upgrade to continue.';
      throw new ForbiddenException(message);
    }

    // Increment usage counter
    await incrementUsage(userId, limitType);

    return true;
  }
}
