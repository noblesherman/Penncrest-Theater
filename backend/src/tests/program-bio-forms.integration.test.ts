/*
Handoff note for Mr. Smith:
- File: `backend/src/tests/program-bio-forms.integration.test.ts`
- What this is: Backend test module.
- What it does: Covers integration/smoke behavior for key backend workflows.
- Connections: Exercises route + service behavior to catch regressions early.
- Main content type: Test setup and assertions.
- Safe edits here: Assertion message clarity and docs comments.
- Be careful with: Changing expectations without confirming intended behavior.
- Useful context: Useful for understanding what the system is supposed to do right now.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const rootDir = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const backendDir = path.join(rootDir, 'backend');

dotenv.config({ path: path.join(backendDir, '.env') });

function withSchema(databaseUrl: string, schemaName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

const schemaName = `program_bio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be configured to run backend tests');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withSchema(baseDatabaseUrl, schemaName);
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.STRIPE_SECRET_KEY = 'sk_test_program_bio';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_program_bio';
process.env.JWT_SECRET = 'program-bio-test-secret-12345';
process.env.ADMIN_USERNAME = 'program-bio-admin';
process.env.ADMIN_PASSWORD = 'program-bio-admin-password';
process.env.STAFF_ALLOWED_DOMAIN = 'rtmsd.org';

vi.mock('../lib/r2.js', () => ({
  isR2Configured: vi.fn(() => false),
  uploadImageFromDataUrl: vi.fn(async (input: { scope: string; filenameBase?: string }) => ({
    key: `${input.scope}/${(input.filenameBase || 'headshot').replace(/\s+/g, '-').toLowerCase()}.jpg`,
    url: `https://cdn.test/${input.scope}/${(input.filenameBase || 'headshot').replace(/\s+/g, '-').toLowerCase()}.jpg`,
    size: 1024,
    mimeType: 'image/jpeg'
  })),
  deleteUploadedObjectByKey: vi.fn(async () => undefined)
}));

let prisma: typeof import('../lib/prisma.js').prisma;
let createServer: typeof import('../server.js').createServer;
let app: Awaited<ReturnType<typeof import('../server.js').createServer>>;
let adminToken: string;

const TEST_HEADSHOT_DATA_URL = 'data:image/jpeg;base64,aGVsbG8=';

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${adminToken}`
  };
}

async function createShowWithPerformance(title: string) {
  const show = await prisma.show.create({
    data: {
      title,
      description: 'Program bio test show'
    }
  });

  const performance = await prisma.performance.create({
    data: {
      showId: show.id,
      title: `${title} Performance`,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      salesCutoffAt: new Date(Date.now() + 23 * 60 * 60 * 1000),
      venue: 'Program Bio Test Theater'
    }
  });

  return { show, performance };
}

describe.sequential('program bio forms integration', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
      cwd: backendDir,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL
      },
      stdio: 'pipe'
    });

    ({ prisma } = await import('../lib/prisma.js'));
    ({ createServer } = await import('../server.js'));
    app = await createServer();

    const adminUser = await prisma.adminUser.create({
      data: {
        username: 'program-bio-admin',
        name: 'Program Bio Admin',
        passwordHash: 'not-used-in-test',
        role: 'ADMIN',
        isActive: true
      }
    });

    adminToken = await app.jwt.sign({
      role: 'admin',
      adminId: adminUser.id,
      adminRole: adminUser.role,
      username: adminUser.username
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('creates a form, exposes public metadata, and accepts a submission', async () => {
    const { show } = await createShowWithPerformance(`Lifecycle Show ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms',
      headers: authHeaders(),
      payload: { showId: show.id }
    });

    expect(createResponse.statusCode).toBe(201);
    const createdForm = createResponse.json();
    expect(createdForm.showId).toBe(show.id);
    expect(createdForm.publicSlug).toBeTruthy();
    expect(createdForm.schemaVersion).toBe('PROGRAM_BIO_V1');

    const publicFormResponse = await app.inject({
      method: 'GET',
      url: `/api/forms/${encodeURIComponent(createdForm.publicSlug)}`
    });
    expect(publicFormResponse.statusCode).toBe(200);
    expect(publicFormResponse.json().acceptingResponses).toBe(true);

    const submissionResponse = await app.inject({
      method: 'POST',
      url: `/api/forms/${encodeURIComponent(createdForm.publicSlug)}/submissions`,
      payload: {
        fullName: 'Jordan Cast',
        schoolEmail: 'jcast@rtmsd.org',
        gradeLevel: 11,
        roleInShow: 'Lead',
        bio: 'Jordan loves theater and spends weekends in rehearsal.',
        headshotDataUrl: TEST_HEADSHOT_DATA_URL
      }
    });
    expect(submissionResponse.statusCode).toBe(201);

    const count = await prisma.programBioSubmission.count({
      where: { formId: createdForm.id }
    });
    expect(count).toBe(1);
  });

  it('updates the existing submission when the same school email submits again', async () => {
    const { show } = await createShowWithPerformance(`Self Edit Show ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms',
      headers: authHeaders(),
      payload: { showId: show.id }
    });
    const form = createResponse.json();

    const first = await app.inject({
      method: 'POST',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        fullName: 'Avery Stage',
        schoolEmail: 'astage@rtmsd.org',
        gradeLevel: 10,
        roleInShow: 'Chorus',
        bio: 'Avery enjoys performing with the ensemble.',
        headshotDataUrl: TEST_HEADSHOT_DATA_URL
      }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        fullName: 'Avery Stage',
        schoolEmail: 'astage@rtmsd.org',
        gradeLevel: 10,
        roleInShow: 'Dance Captain',
        bio: 'Avery now serves as dance captain for the show.',
        headshotDataUrl: TEST_HEADSHOT_DATA_URL
      }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().updatedExisting).toBe(true);

    const count = await prisma.programBioSubmission.count({
      where: { formId: form.id }
    });
    expect(count).toBe(1);

    const updated = await prisma.programBioSubmission.findFirstOrThrow({
      where: { formId: form.id, schoolEmail: 'astage@rtmsd.org' }
    });
    expect(updated.roleInShow).toBe('Dance Captain');
  });

  it('blocks submissions when manually closed or when deadline has passed', async () => {
    const { show } = await createShowWithPerformance(`Closed Show ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms',
      headers: authHeaders(),
      payload: { showId: show.id }
    });
    const form = createResponse.json();

    const closeResponse = await app.inject({
      method: 'PATCH',
      url: `/api/admin/forms/${encodeURIComponent(form.id)}`,
      headers: authHeaders(),
      payload: { isOpen: false }
    });
    expect(closeResponse.statusCode).toBe(200);

    const closedSubmit = await app.inject({
      method: 'POST',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        fullName: 'Casey Closed',
        schoolEmail: 'cclosed@rtmsd.org',
        gradeLevel: 9,
        roleInShow: 'Crew',
        bio: 'Casey helps behind the scenes.',
        headshotDataUrl: TEST_HEADSHOT_DATA_URL
      }
    });
    expect(closedSubmit.statusCode).toBe(409);
    expect(closedSubmit.json().error).toContain("isn't accepting responses");

    const deadlineResponse = await app.inject({
      method: 'PATCH',
      url: `/api/admin/forms/${encodeURIComponent(form.id)}`,
      headers: authHeaders(),
      payload: {
        isOpen: true,
        deadlineAt: new Date(Date.now() - 60_000).toISOString()
      }
    });
    expect(deadlineResponse.statusCode).toBe(200);

    const expiredSubmit = await app.inject({
      method: 'POST',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        fullName: 'Taylor Late',
        schoolEmail: 'tlate@rtmsd.org',
        gradeLevel: 12,
        roleInShow: 'Lead',
        bio: 'Taylor is excited for opening night.',
        headshotDataUrl: TEST_HEADSHOT_DATA_URL
      }
    });
    expect(expiredSubmit.statusCode).toBe(409);
    expect(expiredSubmit.json().error).toContain("isn't accepting responses");
  });

  it('omits hidden custom questions from public forms and does not require responses for them', async () => {
    const { show } = await createShowWithPerformance(`Hidden Questions Show ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms',
      headers: authHeaders(),
      payload: { showId: show.id }
    });
    const form = createResponse.json();

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/admin/forms/${encodeURIComponent(form.id)}`,
      headers: authHeaders(),
      payload: {
        questions: {
          customQuestions: [
            {
              id: 'favorite-musical',
              label: 'Favorite musical',
              type: 'short_text',
              required: true,
              hidden: false
            },
            {
              id: 'internal-note',
              label: 'Internal note',
              type: 'short_text',
              required: true,
              hidden: true
            }
          ]
        }
      }
    });
    expect(patchResponse.statusCode).toBe(200);

    const publicFormResponse = await app.inject({
      method: 'GET',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}`
    });
    expect(publicFormResponse.statusCode).toBe(200);
    const publicQuestions = publicFormResponse.json().questions.customQuestions as Array<{ id: string }>;
    expect(publicQuestions.some((question) => question.id === 'internal-note')).toBe(false);
    expect(publicQuestions.some((question) => question.id === 'favorite-musical')).toBe(true);

    const submitResponse = await app.inject({
      method: 'POST',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        fullName: 'Riley Hidden',
        schoolEmail: 'rhidden@rtmsd.org',
        gradeLevel: 11,
        roleInShow: 'Stage Manager',
        bio: 'Riley keeps production running smoothly.',
        customResponses: {
          'favorite-musical': 'Hadestown'
        },
        headshotDataUrl: TEST_HEADSHOT_DATA_URL
      }
    });
    expect(submitResponse.statusCode).toBe(201);
  });

  it('allows base fields to be removed and treats remaining base fields as optional', async () => {
    const { show } = await createShowWithPerformance(`Optional Base Fields Show ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms',
      headers: authHeaders(),
      payload: { showId: show.id }
    });
    const form = createResponse.json();

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/admin/forms/${encodeURIComponent(form.id)}`,
      headers: authHeaders(),
      payload: {
        questions: {
          fullNameEnabled: false,
          gradeLevelEnabled: false,
          roleInShowEnabled: false,
          bioEnabled: false,
          headshotEnabled: false,
          schoolEmailEnabled: true,
          schoolEmailRequired: false
        }
      }
    });
    expect(patchResponse.statusCode).toBe(200);

    const publicFormResponse = await app.inject({
      method: 'GET',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}`
    });
    expect(publicFormResponse.statusCode).toBe(200);
    const publicForm = publicFormResponse.json();
    expect(publicForm.questions.fullNameEnabled).toBe(false);
    expect(publicForm.questions.headshotEnabled).toBe(false);
    expect(publicForm.requiredFields.includes('schoolEmail')).toBe(false);

    const submitResponse = await app.inject({
      method: 'POST',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {}
    });
    expect(submitResponse.statusCode).toBe(201);

    const submission = await prisma.programBioSubmission.findFirstOrThrow({
      where: { formId: form.id }
    });
    expect(submission.fullName).toBe('Unnamed student');
    expect(submission.schoolEmail.startsWith('submission-')).toBe(true);
    expect(submission.gradeLevel).toBe(0);
    expect(submission.roleInShow).toBe('Unknown role');
    expect(submission.bio).toBe('');
    expect(submission.headshotUrl).toBe('');
  });

  it('returns validation errors instead of silently dropping invalid custom questions', async () => {
    const { show } = await createShowWithPerformance(`Custom Validation Show ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms',
      headers: authHeaders(),
      payload: { showId: show.id }
    });
    const form = createResponse.json();

    const invalidPatch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/forms/${encodeURIComponent(form.id)}`,
      headers: authHeaders(),
      payload: {
        questions: {
          customQuestions: [
            {
              id: 'q1',
              label: '',
              type: 'short_text',
              required: false,
              hidden: false
            }
          ]
        }
      }
    });

    expect(invalidPatch.statusCode).toBe(400);
    expect(invalidPatch.json().error).toContain('label is required');
  });

  it('syncs submissions into cast metadata and optional Student Credits records', async () => {
    const { show, performance } = await createShowWithPerformance(`Sync Show ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms',
      headers: authHeaders(),
      payload: { showId: show.id }
    });
    const form = createResponse.json();

    const responses = [
      {
        fullName: 'Alex Smith',
        schoolEmail: 'asmith@rtmsd.org',
        gradeLevel: 12,
        roleInShow: 'Narrator',
        bio: 'Alex leads the storytelling in the production.'
      },
      {
        fullName: 'Bailey Jones',
        schoolEmail: 'bjones@rtmsd.org',
        gradeLevel: 10,
        roleInShow: 'Ensemble',
        bio: 'Bailey is part of the ensemble and dance team.'
      }
    ];

    for (const payload of responses) {
      const submissionResponse = await app.inject({
        method: 'POST',
        url: `/api/forms/${encodeURIComponent(form.publicSlug)}/submissions`,
        payload: {
          ...payload,
          headshotDataUrl: TEST_HEADSHOT_DATA_URL
        }
      });
      expect(submissionResponse.statusCode).toBe(201);
    }

    const syncResponse = await app.inject({
      method: 'POST',
      url: `/api/admin/forms/${encodeURIComponent(form.id)}/sync`,
      headers: authHeaders(),
      payload: {
        syncCast: true,
        syncStudentCredits: true
      }
    });
    expect(syncResponse.statusCode).toBe(200);

    const syncBody = syncResponse.json();
    expect(syncBody.syncCast.created).toBe(2);
    expect(syncBody.syncStudentCredits.created).toBe(2);

    const cast = await prisma.castMember.findMany({
      where: { showId: show.id },
      orderBy: { name: 'asc' }
    });
    expect(cast.length).toBe(2);
    expect(cast[0].schoolEmail).toBeTruthy();
    expect(cast[0].gradeLevel).toBeTruthy();
    expect(cast[0].bio).toBeTruthy();
    expect(cast[0].photoUrl).toContain('https://cdn.test/');

    const credits = await prisma.studentTicketCredit.findMany({
      where: { showId: show.id },
      orderBy: { studentName: 'asc' }
    });
    expect(credits.length).toBe(2);
    expect(credits.some((row) => row.studentEmail === 'asmith')).toBe(true);
    expect(credits.some((row) => row.studentEmail === 'bjones')).toBe(true);

    const adminPerformanceResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/performances?scope=all&kind=all',
      headers: authHeaders()
    });
    expect(adminPerformanceResponse.statusCode).toBe(200);
    const performanceRow = adminPerformanceResponse
      .json()
      .find((row: { id: string }) => row.id === performance.id);
    expect(performanceRow).toBeTruthy();

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/admin/performances/${encodeURIComponent(performance.id)}`,
      headers: authHeaders(),
      payload: {
        venue: 'Updated Venue',
        castMembers: performanceRow.castMembers
      }
    });
    expect(patchResponse.statusCode).toBe(200);

    const preserved = await prisma.castMember.findFirstOrThrow({
      where: {
        showId: show.id,
        schoolEmail: 'asmith@rtmsd.org'
      }
    });
    expect(preserved.gradeLevel).toBe(12);
    expect(preserved.bio).toContain('storytelling');
  });

  it('allows admins to delete an individual submission', async () => {
    const { show } = await createShowWithPerformance(`Delete Submission Show ${Date.now()}`);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/forms',
      headers: authHeaders(),
      payload: { showId: show.id }
    });
    expect(createResponse.statusCode).toBe(201);
    const form = createResponse.json();

    const firstSubmission = await app.inject({
      method: 'POST',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        fullName: 'Delete Me',
        schoolEmail: 'deleteme@rtmsd.org',
        gradeLevel: 11,
        roleInShow: 'Crew',
        bio: 'Please remove this response for admin testing.',
        headshotDataUrl: TEST_HEADSHOT_DATA_URL
      }
    });
    expect(firstSubmission.statusCode).toBe(201);
    const firstSubmissionId = firstSubmission.json().submissionId;

    const secondSubmission = await app.inject({
      method: 'POST',
      url: `/api/forms/${encodeURIComponent(form.publicSlug)}/submissions`,
      payload: {
        fullName: 'Keep Me',
        schoolEmail: 'keepme@rtmsd.org',
        gradeLevel: 12,
        roleInShow: 'Ensemble',
        bio: 'This response should remain after deletion.',
        headshotDataUrl: TEST_HEADSHOT_DATA_URL
      }
    });
    expect(secondSubmission.statusCode).toBe(201);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/admin/forms/${encodeURIComponent(form.id)}/submissions/${encodeURIComponent(firstSubmissionId)}`,
      headers: authHeaders()
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json().deleted).toBe(true);

    const remaining = await prisma.programBioSubmission.findMany({
      where: { formId: form.id },
      orderBy: { createdAt: 'asc' }
    });
    expect(remaining.length).toBe(1);
    expect(remaining[0].schoolEmail).toBe('keepme@rtmsd.org');

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/admin/forms/${encodeURIComponent(form.id)}/submissions`,
      headers: authHeaders()
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().length).toBe(1);
    expect(listResponse.json()[0].schoolEmail).toBe('keepme@rtmsd.org');
  });
});
