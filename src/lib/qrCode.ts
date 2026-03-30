import QRCode from 'qrcode';

export function toQrCodeDataUrl(payload: string, width: number): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width
  });
}
