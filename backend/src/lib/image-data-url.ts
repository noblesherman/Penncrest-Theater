/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/image-data-url.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

const IMAGE_DATA_URL_REGEX = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/i;

export type ParsedImageDataUrl = {
  mimeType: string;
  buffer: Buffer;
};

export function isImageDataUrl(value: string): boolean {
  return IMAGE_DATA_URL_REGEX.test(value.trim());
}

export function parseImageDataUrl(value: string): ParsedImageDataUrl | null {
  const match = IMAGE_DATA_URL_REGEX.exec(value.trim());
  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase();
  const payload = match[2];

  try {
    return {
      mimeType,
      buffer: Buffer.from(payload, 'base64')
    };
  } catch {
    return null;
  }
}

export function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/jpg':
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

