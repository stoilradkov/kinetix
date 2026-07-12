import { describe, expect, it } from 'vitest';

import { parseApiEnv, parseCliEnv } from '../src/index.js';

describe('environment parsing', () => {
  it('provides local API defaults', () => {
    const config = parseApiEnv({
      DATABASE_URL: 'postgresql://kinetix:kinetix@localhost:5432/kinetix',
    });

    expect(config.PORT).toBe(3000);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('provides the local CLI API URL', () => {
    expect(parseCliEnv({}).KINETIX_API_URL).toContain('/api/v1');
  });
});
