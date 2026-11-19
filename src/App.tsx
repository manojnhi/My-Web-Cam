import { useEffect, useMemo, useState } from 'react';
import { DesktopReceiver } from './components/DesktopReceiver';
import { NativeDownloads } from './components/NativeDownloads';
import { PhoneStreamer } from './components/PhoneStreamer';
import { TopNav, type AppTab } from './components/TopNav';
import { VirtualWebcamGuide } from './components/VirtualWebcamGuide';
import { generateRoomCode } from './utils/streamConfig';

interface NetworkInfoResponse {
  localIps: string[];
  suggestedLanUrl: string;
}

function getInitialRouteState(): {
  tab: AppTab;
  roomId: string;
  feedOnly: boolean;
} {
  if (typeof window === 'undefined') {
    return { tab: 'desktop', roomId: 'STUDIO1', feedOnly: false };
  }
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const room = (params.get('room') ?? 'STUDIO1').toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'STUDIO1';

  if (mode === 'feed') {
    return { tab: 'desktop', roomId: room, feedOnly: true };
  }
  if (mode === 'phone') {
    return { tab: 'phone', roomId: room, feedOnly: false };
  }
  if (mode === 'virtual-cam') {
    return { tab: 'virtual-cam', roomId: room, feedOnly: false };
  }
  if (mode === 'downloads') {
    return { tab: 'downloads', roomId: room, feedOnly: false };
  }
  return { tab: 'desktop', roomId: room, feedOnly: false };
}

export default function App() {
  const initial = useMemo(() => getInitialRouteState(), []);
  const [activeTab, setActiveTab] = useState<AppTab>(initial.tab);
  const [roomId, setRoomId] = useState<string>(initial.roomId);
  const [suggestedBaseUrl, setSuggestedBaseUrl] = useState<string>(
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  );

  useEffect(() => {
    fetch('/api/network-info')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: NetworkInfoResponse | null) => {
        if (!data) return;
        // Prefer real browser origin when accessed over HTTPS or non-localhost LAN IP;
        // otherwise display the detected LAN IPv4 address for phone QR pairing.
        if (
          typeof window !== 'undefined' &&
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
          data.localIps.length > 0
        ) {
          setSuggestedBaseUrl(data.suggestedLanUrl);
        }
      })
      .catch(() => {});
  }, []);

  if (initial.feedOnly) {
    return (
      <DesktopReceiver
        roomId={roomId}
        onChangeRoomId={setRoomId}
        onNewRoom={() => setRoomId(generateRoomCode())}
        suggestedBaseUrl={suggestedBaseUrl}
        feedOnly
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onQuickPair={() => {
          setRoomId(generateRoomCode());
          setActiveTab('desktop');
        }}
      />

      <main className="flex-1">
        {activeTab === 'desktop' && (
          <DesktopReceiver
            roomId={roomId}
            onChangeRoomId={(next) => setRoomId(next || 'STUDIO1')}
            onNewRoom={() => setRoomId(generateRoomCode())}
            suggestedBaseUrl={suggestedBaseUrl}
            onOpenVirtualCamGuide={() => setActiveTab('virtual-cam')}
          />
        )}

        {activeTab === 'phone' && (
          <PhoneStreamer
            roomId={roomId}
            onChangeRoomId={(next) => setRoomId(next || 'STUDIO1')}
            suggestedBaseUrl={suggestedBaseUrl}
          />
        )}

        {activeTab === 'virtual-cam' && <VirtualWebcamGuide roomId={roomId} />}

        {activeTab === 'downloads' && <NativeDownloads />}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>My Web Cam · Local Wi-Fi camera &amp; virtual webcam streaming</span>
          <span>No video is recorded or stored unless explicitly saved by you.</span>
        </div>
      </footer>
    </div>
  );
}
