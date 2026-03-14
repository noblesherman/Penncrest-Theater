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
