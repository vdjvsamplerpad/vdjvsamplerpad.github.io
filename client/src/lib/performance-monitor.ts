export type PerformanceTier = 'lowest' | 'low' | 'medium' | 'high';
export type GraphicsProfile = 'auto' | PerformanceTier;

export interface DeviceCapabilities {
  tier: PerformanceTier;
  hardwareConcurrency: number;
  deviceMemory: number;
  isMobile: boolean;
  isNativePlatform: boolean;
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private currentTier: PerformanceTier = 'high';
  private capabilities: DeviceCapabilities;
  private tierChangeListeners: Set<(tier: PerformanceTier) => void> = new Set();
  
  // Optional override for testing or manual user preference (Auto, Lowest, Low, Medium, High)
  private overrideTier: PerformanceTier | null = null;

  private constructor() {
    this.capabilities = this.detectCapabilities();
    this.currentTier = this.evaluateInitialTier(this.capabilities);
  }

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  private detectCapabilities(): DeviceCapabilities {
    const hasNavigator = typeof navigator !== 'undefined';
    const ua = hasNavigator ? navigator.userAgent || '' : '';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

    // navigator.hardwareConcurrency usually returns the number of logical processors.
    const rawConcurrency = hasNavigator ? navigator.hardwareConcurrency : undefined;
    const concurrency = typeof rawConcurrency === 'number' && rawConcurrency > 0
      ? rawConcurrency
      : (isMobile ? 2 : 4);
    // navigator.deviceMemory returns approximate RAM in GB. Typically 2, 4, 8.
    const rawMemory = hasNavigator ? (navigator as any).deviceMemory : undefined;
    const memory = typeof rawMemory === 'number' && Number.isFinite(rawMemory) && rawMemory > 0
      ? rawMemory
      : (isMobile ? 2 : 4);
    const isNativePlatform = typeof window !== 'undefined' &&
      Boolean((window as any).Capacitor?.isNativePlatform?.());

    return {
      hardwareConcurrency: concurrency,
      deviceMemory: memory,
      isMobile,
      isNativePlatform,
      tier: 'high', // overwritten in evaluateInitialTier
    };
  }

  private evaluateInitialTier(caps: DeviceCapabilities): PerformanceTier {
    let score = 0;

    // CPU score
    if (caps.hardwareConcurrency >= 8) score += 3;
    else if (caps.hardwareConcurrency >= 4) score += 2;
    else score += 1;

    // Memory score
    if (caps.deviceMemory >= 8) score += 3;
    else if (caps.deviceMemory >= 4) score += 2;
    else score += 1;

    if (caps.isMobile) {
      // Mobile WebView/WKWebView rendering can be much slower than raw specs imply.
      score -= caps.isNativePlatform ? 2 : 1;
      if (caps.deviceMemory <= 3) score -= 1;
      if (caps.hardwareConcurrency <= 4) score -= 1;
    }

    if (score >= 5) {
      // Guardrail: avoid classifying native-mobile as high unless clearly strong.
      if (caps.isMobile && (caps.isNativePlatform || caps.deviceMemory < 6 || caps.hardwareConcurrency < 8)) {
        return 'medium';
      }
      return 'high';
    }
    if (score >= 3) return 'medium';
    // AUTO profile floor: never go below low.
    return 'low';
  }

  public getTier(): PerformanceTier {
    return this.overrideTier || this.currentTier;
  }

  public getCapabilities(): DeviceCapabilities {
    return this.capabilities;
  }

  public setOverrideTier(tier: PerformanceTier | null) {
    this.overrideTier = tier;
    this.notifyListeners();
  }

  public subscribe(listener: (tier: PerformanceTier) => void): () => void {
    this.tierChangeListeners.add(listener);
    listener(this.getTier());
    return () => this.tierChangeListeners.delete(listener);
  }

  private notifyListeners() {
    const tier = this.getTier();
    this.tierChangeListeners.forEach(l => l(tier));
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance();
