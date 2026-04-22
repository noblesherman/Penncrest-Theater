/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/legacy-image-backfill.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { isImageDataUrl } from './image-data-url.js';
import { prisma } from './prisma.js';
import { isR2Configured, uploadImageFromDataUrl } from './r2.js';

type CastLike = {
  id: string;
  name: string;
  photoUrl: string | null;
};

type ShowLike = {
  id: string;
  title: string | null;
  posterUrl: string | null;
  castMembers?: CastLike[];
};

function sanitizeFilenameBase(value: string | null | undefined, fallback: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return fallback;

  const safe = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return safe || fallback;
}

export async function backfillLegacyShowAndCastImagesToR2(shows: ShowLike[]): Promise<void> {
  if (!isR2Configured() || shows.length === 0) {
    return;
  }

  const convertedBySource = new Map<string, string>();
  const persistedShowIds = new Set<string>();
  const persistedCastIds = new Set<string>();

  const convertDataUrl = async (dataUrl: string, scope: string, filenameBase: string): Promise<string> => {
    const cached = convertedBySource.get(dataUrl);
    if (cached) {
      return cached;
    }

    const uploaded = await uploadImageFromDataUrl({
      dataUrl,
      scope,
      filenameBase
    });

    convertedBySource.set(dataUrl, uploaded.url);
    return uploaded.url;
  };

  for (const show of shows) {
    const posterUrl = show.posterUrl?.trim();
    if (posterUrl && isImageDataUrl(posterUrl)) {
      try {
        const convertedPosterUrl = await convertDataUrl(
          posterUrl,
          'show-posters',
          sanitizeFilenameBase(show.title, 'show-poster')
        );
        show.posterUrl = convertedPosterUrl;

        if (!persistedShowIds.has(show.id)) {
          await prisma.show.update({
            where: { id: show.id },
            data: { posterUrl: convertedPosterUrl }
          });
          persistedShowIds.add(show.id);
        }
      } catch {
        // Best effort backfill: skip this image and keep serving existing data.
      }
    }

    if (!show.castMembers || show.castMembers.length === 0) {
      continue;
    }

    for (let index = 0; index < show.castMembers.length; index += 1) {
      const castMember = show.castMembers[index];
      const photoUrl = castMember.photoUrl?.trim();
      if (!photoUrl || !isImageDataUrl(photoUrl)) {
        continue;
      }

      try {
        const convertedPhotoUrl = await convertDataUrl(
          photoUrl,
          'cast-photos',
          sanitizeFilenameBase(castMember.name, `cast-member-${index + 1}`)
        );
        castMember.photoUrl = convertedPhotoUrl;

        if (!persistedCastIds.has(castMember.id)) {
          await prisma.castMember.update({
            where: { id: castMember.id },
            data: { photoUrl: convertedPhotoUrl }
          });
          persistedCastIds.add(castMember.id);
        }
      } catch {
        // Best effort backfill: skip this image and keep serving existing data.
      }
    }
  }
}
