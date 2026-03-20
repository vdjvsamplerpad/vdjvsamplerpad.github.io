const path = require('path');
const dotenv = require('dotenv');
const packageJson = require('./package.json');

dotenv.config({ path: path.join(__dirname, '.env') });

const updateUrl = String(process.env.ELECTRON_AUTO_UPDATE_URL || '').trim();
const updateChannel = String(process.env.ELECTRON_AUTO_UPDATE_CHANNEL || 'latest').trim() || 'latest';

const baseConfig = packageJson.build || {};

module.exports = {
  ...baseConfig,
  electronUpdaterCompatibility: '>=2.16',
  publish: updateUrl
    ? [
        {
          provider: 'generic',
          url: updateUrl,
          channel: updateChannel,
          useMultipleRangeRequest: false,
        },
      ]
    : baseConfig.publish,
};
