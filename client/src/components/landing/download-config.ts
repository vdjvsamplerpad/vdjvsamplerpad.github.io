export type VersionKey = 'V1' | 'V2' | 'V3';
export type PlatformKey = 'android' | 'ios' | 'windows' | 'macos';

export interface LandingVersionDescription {
  title: string;
  desc: string;
}

export interface LandingBuySection {
  title: string;
  description: string;
  imageUrl: string;
  defaultInstallerDownloadLink: string;
}

export interface LandingDownloadConfig {
  downloadLinks: Record<VersionKey, Record<PlatformKey, string>>;
  platformDescriptions: Record<VersionKey, Record<PlatformKey, string>>;
  versionDescriptions: Record<VersionKey, LandingVersionDescription>;
  buySections: Record<VersionKey, LandingBuySection>;
}

export const VERSION_OPTIONS: VersionKey[] = ['V1', 'V2', 'V3'];
export const PLATFORM_OPTIONS: PlatformKey[] = ['android', 'ios', 'windows', 'macos'];

export const DEFAULT_DOWNLOAD_LINKS: Record<VersionKey, Record<PlatformKey, string>> = {
  V1: {
    android: '/android/',
    ios: '/ios/',
    windows: 'https://m.me/vdjvsampler/',
    macos: 'https://m.me/vdjvsampler/',
  },
  V2: {
    android: 'https://m.me/vdjvsampler/',
    ios: 'https://apps.apple.com/us/app/virtualdj-remote/id407160120',
    windows: 'https://m.me/vdjvsampler/',
    macos: 'https://m.me/vdjvsampler/',
  },
  V3: {
    android: 'https://m.me/vdjvsampler/',
    ios: 'https://apps.apple.com/us/app/virtualdj-remote/id407160120',
    windows: 'https://m.me/vdjvsampler/',
    macos: 'https://m.me/vdjvsampler/',
  },
};

export const DEFAULT_VERSION_DESCRIPTIONS: Record<VersionKey, LandingVersionDescription> = {
  V1: {
    title: 'V1 - Standalone Version',
    desc: 'Pinakasimple na version ng VDJV. Hindi kailangan ng laptop o PC dahil diretso na itong gagana sa device mo. Best ito para sa mga gusto lang ng basic sampler pad para sa events gamit ang phone, tablet, o computer nang walang setup o remote connection. May unique features kumpara sa V2 at V3 pero mabilis at madaling gamitin.'
  },
  V2: {
    title: 'V2 - Laptop/PC Based Version',
    desc: 'Ito ang 2023 version na gumagamit ng laptop o PC bilang main system. Ang phone o tablet ay gagamitin bilang wireless touchscreen controller gamit ang remote app. Mas stable ito para sa events at mas flexible kumpara sa V1 dahil naka-run ang audio sa laptop. Recommended ito kung gusto mo ng mas professional setup pero hindi pa kailangan ang full features ng V3.'
  },
  V3: {
    title: 'V3 - Full Features Version',
    desc: 'Ito ang pinaka-complete at latest version ng VDJV. May kasama na itong installer, bagong features, effects, at lahat ng banks. Designed ito para sa professional events at mas advanced na paggamit. Laptop o PC pa rin ang main system habang ang phone o tablet ay gagamitin bilang wireless controller. Ito ang recommended version kung gusto mo ng full VDJV experience.'
  }
};

export const DEFAULT_PLATFORM_DESCRIPTIONS: Record<VersionKey, Record<PlatformKey, string>> = {
  V1: {
    android: 'VDJV App, no laptop needed',
    ios: 'Web App, no laptop needed',
    windows: 'Standalone software, no remote app',
    macos: 'Web app sa browser, no remote app',
  },
  V2: {
    android: 'VDJV Remote App V2 connect sa laptop/PC',
    ios: 'VirtualDJ Remote App',
    windows: 'VDJV V2 (up to V2.5)',
    macos: 'Message muna for compatibility',
  },
  V3: {
    android: 'VDJV Remote App V3 connect sa laptop/PC',
    ios: 'VirtualDJ Remote App',
    windows: 'VDJV V3 (2026 latest)',
    macos: 'Message muna for compatibility',
  },
};

export const DEFAULT_BUY_SECTIONS: Record<VersionKey, LandingBuySection> = {
  V1: {
    title: 'Buy V1',
    description: 'Register your VDJV V1 account, submit payment proof, and wait for approval before logging in.',
    imageUrl: '/assets/logo.png',
    defaultInstallerDownloadLink: '',
  },
  V2: {
    title: 'Buy V2',
    description: 'Includes FREE Android Remote App, iOS sold separately • Easy Windows installer • macOS: contact for compatibility',
    imageUrl: '/assets/logo.png',
    defaultInstallerDownloadLink: 'https://m.me/vdjvsampler/',
  },
  V3: {
    title: 'Buy V3',
    description: 'Includes FREE Android Remote App, iOS sold separately • Easy Windows installer • macOS: contact for compatibility',
    imageUrl: '/assets/logo.png',
    defaultInstallerDownloadLink: 'https://m.me/vdjvsampler/',
  },
};

export const DEFAULT_LANDING_DOWNLOAD_CONFIG: LandingDownloadConfig = {
  downloadLinks: DEFAULT_DOWNLOAD_LINKS,
  platformDescriptions: DEFAULT_PLATFORM_DESCRIPTIONS,
  versionDescriptions: DEFAULT_VERSION_DESCRIPTIONS,
  buySections: DEFAULT_BUY_SECTIONS,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const canonicalizeInstallGuideLink = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  const canonicalizePath = (pathname: string): string | null => {
    const normalized = pathname.trim().toLowerCase();
    if (normalized === '/ios' || normalized === '/ios/') return '/ios/';
    if (normalized === '/android' || normalized === '/android/') return '/android/';
    return null;
  };

  const pathMatch = canonicalizePath(trimmed);
  if (pathMatch) return pathMatch;

  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const canonicalPath = canonicalizePath(parsed.pathname);
    if (!canonicalPath) return trimmed;
    parsed.pathname = canonicalPath;
    return parsed.toString();
  } catch {
    return trimmed;
  }
};

const cloneDefaultConfig = (): LandingDownloadConfig => ({
  downloadLinks: JSON.parse(JSON.stringify(DEFAULT_DOWNLOAD_LINKS)) as Record<VersionKey, Record<PlatformKey, string>>,
  platformDescriptions: JSON.parse(JSON.stringify(DEFAULT_PLATFORM_DESCRIPTIONS)) as Record<VersionKey, Record<PlatformKey, string>>,
  versionDescriptions: JSON.parse(JSON.stringify(DEFAULT_VERSION_DESCRIPTIONS)) as Record<VersionKey, LandingVersionDescription>,
  buySections: JSON.parse(JSON.stringify(DEFAULT_BUY_SECTIONS)) as Record<VersionKey, LandingBuySection>,
});

export const normalizeLandingDownloadConfig = (input: unknown): LandingDownloadConfig => {
  const next = cloneDefaultConfig();
  if (!isRecord(input)) return next;

  const downloadLinks = isRecord(input.downloadLinks) ? input.downloadLinks : null;
  const platformDescriptions = isRecord(input.platformDescriptions) ? input.platformDescriptions : null;
  const versionDescriptions = isRecord(input.versionDescriptions) ? input.versionDescriptions : null;
  const buySections = isRecord(input.buySections) ? input.buySections : null;

  VERSION_OPTIONS.forEach((version) => {
    const versionLinks = downloadLinks && isRecord(downloadLinks[version]) ? downloadLinks[version] : null;
    const versionPlatformDescriptions = platformDescriptions && isRecord(platformDescriptions[version]) ? platformDescriptions[version] : null;
    const versionDescription = versionDescriptions && isRecord(versionDescriptions[version]) ? versionDescriptions[version] : null;

    PLATFORM_OPTIONS.forEach((platform) => {
      if (versionLinks && typeof versionLinks[platform] === 'string') {
        next.downloadLinks[version][platform] = canonicalizeInstallGuideLink(versionLinks[platform]);
      }
      if (versionPlatformDescriptions && typeof versionPlatformDescriptions[platform] === 'string') {
        next.platformDescriptions[version][platform] = versionPlatformDescriptions[platform].trim();
      }
    });

    if (versionDescription && typeof versionDescription.title === 'string') {
      next.versionDescriptions[version].title = versionDescription.title.trim() || next.versionDescriptions[version].title;
    }
    if (versionDescription && typeof versionDescription.desc === 'string') {
      next.versionDescriptions[version].desc = versionDescription.desc.trim() || next.versionDescriptions[version].desc;
    }

    const buySection = buySections && isRecord(buySections[version]) ? buySections[version] : null;
    if (buySection && typeof buySection.title === 'string') {
      next.buySections[version].title = buySection.title.trim() || next.buySections[version].title;
    }
    if (buySection && typeof buySection.description === 'string') {
      next.buySections[version].description = buySection.description.trim() || next.buySections[version].description;
    }
    if (buySection && typeof buySection.imageUrl === 'string') {
      next.buySections[version].imageUrl = buySection.imageUrl.trim();
    }
    if (buySection && typeof buySection.defaultInstallerDownloadLink === 'string') {
      next.buySections[version].defaultInstallerDownloadLink = canonicalizeInstallGuideLink(buySection.defaultInstallerDownloadLink);
    }
  });

  return next;
};
