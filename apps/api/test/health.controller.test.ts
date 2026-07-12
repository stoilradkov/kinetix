import { describe, expect, it, vi } from 'vitest';

import { HealthController } from '../src/health/health.controller.js';
import type { HealthService } from '../src/health/health.service.js';

describe('HealthController', () => {
  it('returns the service health', () => {
    const response = {
      status: 'ok' as const,
      service: 'kinetix-api' as const,
      timestamp: new Date().toISOString(),
    };
    const healthService = {
      getHealth: vi.fn(() => response),
    } as unknown as HealthService;
    const controller = new HealthController(healthService);

    expect(controller.getHealth()).toEqual(response);
  });
});
