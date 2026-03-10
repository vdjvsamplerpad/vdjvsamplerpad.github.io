/**
 * Audio Engine V3 – Lifecycle Manager
 *
 * Centralized handler for visibility, focus, and app-resume events.
 * Replaces scattered listeners in the old GlobalPlaybackManagerClass constructor.
 */

export interface LifecycleDelegate {
    /** Called when the app returns to the foreground (after a debounce). */
    onForeground(): void;
    /** Returns true if a user gesture has occurred (needed before AudioContext.resume). */
    hasUserActivation(): boolean;
}

export class LifecycleManager {
    private delegate: LifecycleDelegate;
    private foregroundTimeout: ReturnType<typeof setTimeout> | null = null;
    private boundVisibility: () => void;
    private boundFocus: () => void;
    private boundPageShow: () => void;

    constructor(delegate: LifecycleDelegate) {
        this.delegate = delegate;

        this.boundVisibility = this.handleEvent.bind(this);
        this.boundFocus = this.handleEvent.bind(this);
        this.boundPageShow = this.handleEvent.bind(this);

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.boundVisibility);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', this.boundFocus);
            window.addEventListener('pageshow', this.boundPageShow);
        }
    }

    private handleEvent(): void {
        // Skip if document is hidden
        if (typeof document !== 'undefined' && document.hidden) return;

        // Debounce — collapse rapid events (e.g. focus + visibilitychange)
        if (this.foregroundTimeout) {
            clearTimeout(this.foregroundTimeout);
        }

        this.foregroundTimeout = setTimeout(() => {
            this.foregroundTimeout = null;

            if (!this.delegate.hasUserActivation()) return;

            this.delegate.onForeground();
        }, 60);
    }

    /** Stop listening to lifecycle events and release resources. */
    destroy(): void {
        if (this.foregroundTimeout) {
            clearTimeout(this.foregroundTimeout);
            this.foregroundTimeout = null;
        }

        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.boundVisibility);
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('focus', this.boundFocus);
            window.removeEventListener('pageshow', this.boundPageShow);
        }
    }
}
