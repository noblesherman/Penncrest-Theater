/*
Handoff note for Mr. Smith:
- File: `src/lib/adminQrScanner.ts`
- What this is: Frontend shared helper module.
- What it does: Holds reusable client logic, types, and config used across the web app.
- Connections: Imported by pages/components and often mirrors backend contracts.
- Main content type: Logic/config/data-shaping (not page layout).
- Safe edits here: Additive helpers and text constants.
- Be careful with: Changing exported behavior/types that many files consume.
- Useful context: If a bug appears across multiple pages, this shared layer is a likely source.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import QrScanner from 'qr-scanner';

const SCAN_REGION_RATIO = 0.72;
const DOWNSCALED_REGION_SIZE = 420;
const MAX_SCANS_PER_SECOND = 24;

function calculateCenteredScanRegion(video: HTMLVideoElement) {
  const shortestSide = Math.min(video.videoWidth || 0, video.videoHeight || 0);
  const regionSize = Math.max(220, Math.round(shortestSide * SCAN_REGION_RATIO));
  const downScaledSize = Math.min(DOWNSCALED_REGION_SIZE, regionSize);

  return {
    x: Math.max(0, Math.round((video.videoWidth - regionSize) / 2)),
    y: Math.max(0, Math.round((video.videoHeight - regionSize) / 2)),
    width: regionSize,
    height: regionSize,
    downScaledWidth: downScaledSize,
    downScaledHeight: downScaledSize
  };
}

export async function detectQrCameraSupport(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  return QrScanner.hasCamera();
}

export function createAdminQrScanner(params: {
  video: HTMLVideoElement;
  onDecode: (decodedValue: string) => void;
  onDecodeError?: (message: string) => void;
}) {
  return new QrScanner(
    params.video,
    (result) => {
      params.onDecode(result.data.trim());
    },
    {
      preferredCamera: 'environment',
      maxScansPerSecond: MAX_SCANS_PER_SECOND,
      calculateScanRegion: calculateCenteredScanRegion,
      onDecodeError: (error) => {
        const message = typeof error === 'string' ? error : error.message;
        if (message === QrScanner.NO_QR_CODE_FOUND) return;
        params.onDecodeError?.(message);
      },
      returnDetailedScanResult: true
    }
  );
}
