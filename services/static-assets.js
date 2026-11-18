const path = require('node:path');
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');

const publicDirectory = path.join(__dirname, '../public');
const versions = new Map(readdirSync(publicDirectory).filter(name => /\.(css|js)$/.test(name)).map(name => [
  '/' + name, createHash('sha256').update(readFileSync(path.join(publicDirectory, name))).digest('hex').slice(0, 16)
]));

function assetUrl(url) {
  const version = versions.get(url);
  return version ? url + '?v=' + version : url;
}

function assetHeaders(res, file) {
  const url = '/' + path.relative(publicDirectory, file).split(path.sep).join('/');
  const version = versions.get(url);
  res.setHeader('Cache-Control', version && res.req.query.v === version
    ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
}

module.exports = { assetUrl, assetHeaders };
