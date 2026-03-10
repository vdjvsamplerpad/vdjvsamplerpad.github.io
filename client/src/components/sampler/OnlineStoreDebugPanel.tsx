import * as React from 'react';
import { Button } from '@/components/ui/button';
import { StoreDownloadDebugEntry } from '@/components/sampler/onlineStore.types';

type OnlineStoreDebugPanelProps = {
    isDark: boolean;
    entries: StoreDownloadDebugEntry[];
    debugText: string;
    onClear: () => void;
    onCopy: () => void | Promise<void>;
    onExport: () => void;
};

export function OnlineStoreDebugPanel({
    isDark,
    entries,
    debugText,
    onClear,
    onCopy,
    onExport,
}: OnlineStoreDebugPanelProps) {
    const [expanded, setExpanded] = React.useState(false);

    return (
        <div className={`px-6 py-3 border-b shrink-0 ${isDark ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-white/70'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    Store Download Debug Log - {entries.length} entries
                </div>
                <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setExpanded((prev) => !prev)}>
                        {expanded ? 'Hide' : 'Show'}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={onClear}>
                        Clear
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => void onCopy()}>
                        Copy Log
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={onExport}>
                        Export Log
                    </Button>
                </div>
            </div>
            {expanded && (
                <pre className={`mt-2 max-h-36 overflow-auto rounded-md p-2 text-[11px] leading-relaxed ${isDark ? 'bg-gray-950 text-gray-200 border border-gray-800' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                    {debugText}
                </pre>
            )}
        </div>
    );
}
