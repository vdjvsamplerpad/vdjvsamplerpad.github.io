type ManagedImageKind = 'thumbnail' | 'banner' | 'qr';

type ManagedImageProfile = {
  label: string;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxWidth: number;
  maxHeight: number;
  outputType: 'image/webp';
  qualitySteps: number[];
};

const ALLOWED_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const IMAGE_PROFILES: Record<ManagedImageKind, ManagedImageProfile> = {
  thumbnail: {
    label: 'Thumbnail',
    maxInputBytes: 5 * 1024 * 1024,
    maxOutputBytes: 350 * 1024,
    maxWidth: 768,
    maxHeight: 768,
    outputType: 'image/webp',
    qualitySteps: [0.86, 0.78, 0.7, 0.62, 0.54],
  },
  banner: {
    label: 'Banner image',
    maxInputBytes: 5 * 1024 * 1024,
    maxOutputBytes: 900 * 1024,
    maxWidth: 1600,
    maxHeight: 900,
    outputType: 'image/webp',
    qualitySteps: [0.84, 0.76, 0.68, 0.6, 0.52],
  },
  qr: {
    label: 'QR image',
    maxInputBytes: 2 * 1024 * 1024,
    maxOutputBytes: 350 * 1024,
    maxWidth: 1024,
    maxHeight: 1024,
    outputType: 'image/webp',
    qualitySteps: [0.9, 0.82, 0.74, 0.66],
  },
};

const toMbLabel = (bytes: number): string => `${Math.ceil(bytes / (1024 * 1024))}MB`;

const renameWithExtension = (fileName: string, nextExtension: string): string => {
  const normalized = String(fileName || 'image').trim() || 'image';
  const base = normalized.replace(/\.[^.]+$/, '');
  return `${base}.${nextExtension}`;
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });

const loadImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('IMAGE_DECODE_FAILED'));
    };
    image.src = objectUrl;
  });

export const validateManagedImageFile = (file: File, kind: ManagedImageKind): string | null => {
  const profile = IMAGE_PROFILES[kind];
  if (!file) return 'No file selected.';
  if (file.size <= 0) return `Selected ${profile.label.toLowerCase()} is empty.`;
  if (file.size > profile.maxInputBytes) {
    return `${profile.label} is too large (${toMbLabel(file.size)}). Max is ${toMbLabel(profile.maxInputBytes)}.`;
  }

  const ext = String(file.name.split('.').pop() || '').toLowerCase();
  const mime = String(file.type || '').toLowerCase();
  const extAllowed = ALLOWED_IMAGE_EXTENSIONS.has(ext);
  const mimeAllowed = !mime || ALLOWED_IMAGE_MIME_TYPES.has(mime);
  if (!extAllowed || !mimeAllowed) {
    if (kind === 'banner') {
      return 'Uploaded banner files must be JPG, PNG, or WEBP. Use an external banner URL for SVG or GIF.';
    }
    return `${profile.label} must be JPG, PNG, or WEBP.`;
  }
  return null;
};

export const prepareManagedImageUpload = async (file: File, kind: ManagedImageKind): Promise<File> => {
  const validationError = validateManagedImageFile(file, kind);
  if (validationError) {
    throw new Error(validationError);
  }

  if (typeof document === 'undefined') {
    return file;
  }

  const profile = IMAGE_PROFILES[kind];
  const source = await loadImageElement(file);
  const sourceWidth = Math.max(1, source.naturalWidth || source.width || 1);
  const sourceHeight = Math.max(1, source.naturalHeight || source.height || 1);
  const scale = Math.min(1, profile.maxWidth / sourceWidth, profile.maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) {
    throw new Error('This browser could not process the selected image.');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  let bestBlob: Blob | null = null;
  for (const quality of profile.qualitySteps) {
    const candidate = await canvasToBlob(canvas, profile.outputType, quality);
    if (!candidate) continue;
    bestBlob = candidate;
    if (candidate.size <= profile.maxOutputBytes) break;
  }

  if (!bestBlob) {
    throw new Error('This browser could not encode the selected image.');
  }
  if (bestBlob.size > profile.maxOutputBytes) {
    throw new Error(`${profile.label} is still too large after compression. Use a smaller image.`);
  }

  return new File([bestBlob], renameWithExtension(file.name, 'webp'), {
    type: profile.outputType,
    lastModified: Date.now(),
  });
};

