const extensionTypes = {
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};
const imageTypes = new Set(Object.values(extensionTypes).filter(type => type.startsWith('image/')));

function matchesFileType(bytes, type) {
  switch (type) {
    case 'application/zip':
      return ['504b0304', '504b0506'].includes(bytes.subarray(0, 4).toString('hex'));
    case 'image/png':
      return bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    case 'image/jpeg':
      return bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
    case 'image/gif':
      return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
    case 'image/webp':
      return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    default:
      return false;
  }
}

module.exports = { extensionTypes, imageTypes, matchesFileType };
