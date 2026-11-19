export type AppTab = 'desktop' | 'phone' | 'virtual-cam' | 'downloads';

interface TopNavProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onQuickPair: () => void;
}

const NAV_ITEMS: { id: AppTab; label: string }[] = [
  { id: 'desktop', label: 'Desktop Receiver' },
  { id: 'phone', label: 'Phone Camera' },
  { id: 'virtual-cam', label: 'Virtual Webcam' },
  { id: 'downloads', label: 'Apps & Source' },
];

export function TopNav({ activeTab, onSelectTab, onQuickPair }: TopNavProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-3.5">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('desktop');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          My Web Cam
        </a>

        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-6">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                  isActive
                    ? 'border-blue-600 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onQuickPair}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Pair New Device
          </button>
        </div>
      </div>

      {/* Mobile navigation strip */}
      <nav
        aria-label="Mobile navigation"
        className="grid grid-cols-4 gap-1 border-t border-slate-100 px-3 py-1.5 md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`min-h-[40px] rounded-lg px-1.5 py-1.5 text-[11px] font-medium whitespace-nowrap truncate transition-colors ${
                isActive
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
