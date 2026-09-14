/**
 * tests/load/scenarios/media-uploader.js — Artillery processor simulating
 * concurrent presigned S3 uploads (TESTING_SPEC.md §3 `load/scenarios/media-uploader.js`).
 * Flow: POST /api/media/presigned-url → PUT binary to uploadUrl → send_message
 * with the S3 URL inside the encrypted payload.
 */
'use strict';

const TYPES = [
  { fileType: 'image/jpeg', fileExtension: 'jpg' },
  { fileType: 'image/png', fileExtension: 'png' },
  { fileType: 'video/mp4', fileExtension: 'mp4' },
  { fileType: 'audio/webm', fileExtension: 'webm' },
];

function pickUpload(context, events, done) {
  const pick = TYPES[Math.floor(Math.random() * TYPES.length)];
  context.vars.fileType = pick.fileType;
  context.vars.fileExtension = pick.fileExtension;
  return done();
}

module.exports = { pickUpload };
