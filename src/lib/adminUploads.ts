import { adminFetch } from './adminAuth';

type UploadOptions = {
  maxWidth: number;
  maxHeight: number;
  scope: string;
  filenameBase?: string;
  maxFileBytes?: number;
};

async function fileToDataUrl(file: File, maxWidth: number, maxHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to parse image.'));
        return;
      }

      const image = new Image();
      image.onerror = () => reject(new Error('Failed to load image.'));
      image.onload = () => {
        const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const width = Math.max(1, Math.round(image.width * ratio));
        const height = Math.max(1, Math.round(image.height * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas error.'));
          return;
        }

        ctx.drawImage(image, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, mime === 'image/png' ? undefined : 0.84));
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

type UploadResponse = {
  key: string;
  url: string;
  size: number;
  mimeType: string;
};

function fileToRawDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to parse file.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadAdminImage(file: File, options: UploadOptions): Promise<UploadResponse> {
  const maxFileBytes = options.maxFileBytes ?? 8 * 1024 * 1024;
  if (!file.type.startsWith('image/')) {
    throw new Error('Upload an image file.');
  }
  if (file.size > maxFileBytes) {
    throw new Error(`File too large (max ${Math.round(maxFileBytes / (1024 * 1024))}MB).`);
  }

  const dataUrl = await fileToDataUrl(file, options.maxWidth, options.maxHeight);
  return adminFetch<UploadResponse>('/api/admin/uploads/image', {
    method: 'POST',
    body: JSON.stringify({
      dataUrl,
      scope: options.scope,
      filenameBase: options.filenameBase
    })
  });
}

export async function uploadAdminPdf(
  file: File,
  options: { scope: string; filenameBase?: string; maxFileBytes?: number }
): Promise<UploadResponse> {
  const maxFileBytes = options.maxFileBytes ?? 8 * 1024 * 1024;
  if (file.type !== 'application/pdf') {
    throw new Error('Upload a PDF file.');
  }
  if (file.size > maxFileBytes) {
    throw new Error(`File too large (max ${Math.round(maxFileBytes / (1024 * 1024))}MB).`);
  }

  const dataUrl = await fileToRawDataUrl(file);
  return adminFetch<UploadResponse>('/api/admin/uploads/pdf', {
    method: 'POST',
    body: JSON.stringify({
      dataUrl,
      scope: options.scope,
      filenameBase: options.filenameBase
    })
  });
}
