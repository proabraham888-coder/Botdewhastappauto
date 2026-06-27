// state.js
// Guarda/lee el "último server_id visto" por canal para no reenviar duplicados.
const fs = require('fs');
const path = require('path');
const { STATE_FILE } = require('./config');

function loadState() {
  try {
    const raw = fs.readFileSync(path.resolve(STATE_FILE), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {}; // primera ejecución o archivo corrupto -> arranca limpio
  }
}

function saveState(state) {
  fs.writeFileSync(path.resolve(STATE_FILE), JSON.stringify(state, null, 2));
}

function getLastSeen(state, channelJid) {
  return state[channelJid]?.lastServerId || 0;
}

function setLastSeen(state, channelJid, serverId) {
  if (!state[channelJid]) state[channelJid] = {};
  if (serverId > (state[channelJid].lastServerId || 0)) {
    state[channelJid].lastServerId = serverId;
  }
}

module.exports = { loadState, saveState, getLastSeen, setLastSeen };
