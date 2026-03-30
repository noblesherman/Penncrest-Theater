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

