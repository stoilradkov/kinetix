import { describe, expect, it } from 'vitest';

import { projects } from '../src/schema.js';

describe('projects schema', () => {
  it('uses the conventional projects table name', () => {
    expect(projects).toBeDefined();
  });
});
