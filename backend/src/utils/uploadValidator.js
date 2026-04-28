const MAX_FILE_SIZE = Number(process.env.FILE_UPLOAD_MAX_BYTES || 2 * 1024 * 1024 * 1024); // 2GB

const VALID_FILE_TYPES = {
  pdf: {
    mimes: ['application/pdf'],
    maxBytes: Math.min(50 * 1024 * 1024, MAX_FILE_SIZE)
  },  docx: {
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ],
    maxBytes: 20 * 1024 * 1024
  },
  image: {
    mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxBytes: 20 * 1024 * 1024
  },
  video: {
    mimes: ['video/mp4', 'video/webm', 'video/ogg', 'video/x-msvideo', 'video/x-matroska'],
    maxBytes: 500 * 1024 * 1024
  }
};

const extensionMap = {
  pdf: 'pdf',
  docx: 'docx',
  jpeg: 'image',
  jpg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  mp4: 'video',
  mkv: 'video',
  webm: 'video',
  avi: 'video',
  ogg: 'video'
};

const getFileExtension = (filename = '') => {
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  return parts.pop().toLowerCase();
};

const validateUploadFile = (file, allowedCategories = ['pdf', 'docx', 'image', 'video']) => {
  if (!file) {
    throw new Error('No file uploaded');
  }

  const extension = getFileExtension(file.name || file.name || '');
  if (!extension) {
    throw new Error('Uploaded file has no extension');
  }

  const category = extensionMap[extension];
  if (!category || !allowedCategories.includes(category)) {
    throw new Error(`Unsupported file extension: .${extension}`);
  }

  const fileTypeDef = VALID_FILE_TYPES[category];
  if (!fileTypeDef) {
    throw new Error(`Unsupported upload category: ${category}`);
  }

  if (!fileTypeDef.mimes.includes(file.mimetype)) {
    throw new Error(`Invalid MIME type: ${file.mimetype} for extension .${extension}`);
  }

  const fileSize = Number(file.size || 0);
  if (fileSize <= 0) {
    throw new Error('Uploaded file is empty');
  }

  if (fileSize > fileTypeDef.maxBytes) {
    const maxMB = Math.round(fileTypeDef.maxBytes / (1024 * 1024));
    throw new Error(`File exceeds size limit of ${maxMB}MB`);
  }

  if (fileSize > MAX_FILE_SIZE) {
    const maxMB = Math.round(MAX_FILE_SIZE / (1024 * 1024));
    throw new Error(`File exceeds system maximum size limit of ${maxMB}MB`);
  }

  return {
    extension,
    category,
    fileSize,
    mimetype: file.mimetype,
    originalName: file.name
  };
};

export { VALID_FILE_TYPES, validateUploadFile, extensionMap };
