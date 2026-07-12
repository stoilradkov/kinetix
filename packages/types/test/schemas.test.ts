import { describe, expect, it } from 'vitest';

import { createProjectSchema } from '../src/index.js';

describe('createProjectSchema', () => {
  it('accepts a valid project', () => {
    expect(
      createProjectSchema.parse({ name: 'Kinetix', slug: 'kinetix' }),
    ).toEqual({ name: 'Kinetix', slug: 'kinetix' });
  });

  it('rejects a non URL-safe slug', () => {
    expect(() =>
      createProjectSchema.parse({ name: 'Kinetix', slug: 'Not safe' }),
    ).toThrow();
  });
});
