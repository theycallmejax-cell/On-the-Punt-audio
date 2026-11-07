const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_FILE, STARTING_BALANCE } = require('./config');

const empty = () => ({ users: {}, rooms: {} });
let db = empty();
let saveTimer = null;

function load() {
  try {
    db = { ...empty(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('store: could not read, starting fresh', e.message);
    db = empty();
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DATA_FILE);
  }, 250);
}

const id = (n = 9) => crypto.randomBytes(n).toString('base64url');
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N}_ .'-]/gu, '').trim().slice(0, 20);

function userByToken(token) {
  if (!token) return null;
  return Object.values(db.users).find((u) => u.token === token) || null;
}
function userByName(name) {
  const n = cleanName(name).toLowerCase();
  return Object.values(db.users).find((u) => u.username.toLowerCase() === n) || null;
}
function createUser(username, characterId) {
  const user = {
    id: id(), token: id(24), username: cleanName(username), characterId,
    balance: STARTING_BALANCE, mates: [], mateRequests: [], invites: [], createdAt: Date.now(),
  };
  db.users[user.id] = user;
  save();
  return user;
}
const getUser = (uid) => db.users[uid] || null;

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do c = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join('');
  while (db.rooms[c]);
  return c;
}
function createRoom({ name, ownerId, buyIn, scheduledAt }) {
  const code = roomCode();
  db.rooms[code] = { code, name, ownerId, buyIn, scheduledAt: scheduledAt || null, members: [ownerId], createdAt: Date.now() };
  save();
  return db.rooms[code];
}
const getRoom = (code) => db.rooms[String(code || '').toUpperCase()] || null;
const roomsFor = (uid) => Object.values(db.rooms).filter((r) => r.members.includes(uid));

load();
module.exports = { save, cleanName, userByToken, userByName, createUser, getUser, createRoom, getRoom, roomsFor, newId: id };
