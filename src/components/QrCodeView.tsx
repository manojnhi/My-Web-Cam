import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode } from 'lucide-react';

interface QrCodeViewProps {
  value: string;
  size?: number;
  label?: string;
}

export function QrCodeView({ value, size = 180, label = 'Pairing QR code' }: QrCodeViewProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (failed || !dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400"
      >
        <QrCode className="h-8 w-8 mb-2" />
        <span className="text-xs text-slate-500">Generating QR</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center justify-center rounded-lg bg-white p-1">
      <img
        src={dataUrl}
        alt={`${label} for ${value}`}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="block rounded-md"
      />
    </div>
  );
}
