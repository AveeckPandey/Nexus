// scenarios/chat-chatter.js
// Shared Artillery processor functions for the load-test suite
// (tests/load/1k-baseline.yml, 10k-cluster.yml, 50k-scale.yml, 100k-enterprise.yml).
//
// Fixes applied here:
//   1. assignRoom() picks ONE room per virtual user and stores it in
//      context.vars.roomId. Every stage's YAML now references
//      "{{ roomId }}" in join_room, send_message, AND leave_room —
//      previously join_room used a random room but send_message/leave_room
//      were hardcoded to "bench-room-001", so all traffic funneled into
//      a single room regardless of how many rooms the phase intended.
//   2. Room pool size is read from context.vars.roomPoolSize, which each
//      YAML file sets under config.variables — so pool size lives with
//      the stage that defines it, not buried in this shared file.
//   3. sendEncryptedChatter() generates a fresh random ciphertext + nonce
//      per call via crypto.randomBytes instead of reusing one static sample string,
//      so payload entropy and size are realistic (prevents artificial compression).

const crypto = require('crypto');

const EMOJIS = ['❤️', '😂', '🔥', '👍', '🎉'];

function assignRoom(context, events, done) {
  const poolSize = parseInt(context.vars.roomPoolSize || 50, 10);
  const roomNum = Math.floor(Math.random() * poolSize) + 1;
  context.vars.roomId = `bench-room-${String(roomNum).padStart(3, '0')}`;
  return done();
}

/** Alias for backward compatibility across stage YAMLs */
const initChatSession = assignRoom;

function sendEncryptedChatter(context, events, done) {
  // 48 random bytes -> 96 hex chars, matching an authenticated NaCl Secretbox ciphertext
  const payload = crypto.randomBytes(48).toString('hex');
  context.vars.content = payload;
  context.vars.ciphertext = payload; // alias for template compatibility

  // 24-byte nonce (48 hex chars) matching XSalsa20-Poly1305 nonce specification
  context.vars.nonce = crypto.randomBytes(24).toString('hex');
  return done();
}

/** Emit typing and emoji reaction noise for 10k/50k scenarios */
function sendReactionNoise(context, events, done) {
  context.vars.emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
  return done();
}

module.exports = {
  assignRoom,
  initChatSession,
  sendEncryptedChatter,
  sendReactionNoise,
};
