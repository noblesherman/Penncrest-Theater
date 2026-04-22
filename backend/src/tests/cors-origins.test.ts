/*
Handoff note for Mr. Smith:
- File: `backend/src/tests/cors-origins.test.ts`
- What this is: Backend test module.
- What it does: Covers integration/smoke behavior for key backend workflows.
- Connections: Exercises route + service behavior to catch regressions early.
- Main content type: Test setup and assertions.
- Safe edits here: Assertion message clarity and docs comments.
- Be careful with: Changing expectations without confirming intended behavior.
- Useful context: Useful for understanding what the system is supposed to do right now.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./cors-origins.test.db';
process.env.APP_BASE_URL = 'https://www.penncresttheater.com';
process.env.FRONTEND_ORIGIN = 'https://www.penncresttheater.com';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'not-a-real-stripe-secret';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'not-a-real-webhook-secret';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'cors-test-secret-12345';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'cors-admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cors-admin-password';

const { getAllowedOrigins } = await import('../lib/env.js');
const { isAllowedOrigin } = await import('../plugins/cors.js');

describe('CORS origin allowlist', () => {
  it('includes www and apex variants for the configured frontend origin', () => {
    const allowedOrigins = getAllowedOrigins();

    expect(allowedOrigins).toContain('https://penncresttheater.com');
    expect(allowedOrigins).toContain('https://www.penncresttheater.com');
    expect(isAllowedOrigin('https://www.penncresttheater.com', allowedOrigins)).toBe(true);
    expect(isAllowedOrigin('https://penncresttheater.com', allowedOrigins)).toBe(true);
    expect(isAllowedOrigin('https://example.com', allowedOrigins)).toBe(false);
  });
});
