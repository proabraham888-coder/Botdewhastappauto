// index.js
const makeWASocket = require('baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers } = require('baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');

const config = require('./config');
const { loadState, saveState, getLastSeen, setLastSeen } = require('./state');
const { parseNewsletterMessages } = require('./newsletterParser');
const { forwardToChannel } = require('./forwarder');

const logger = pino({ level: 'info' });

let sock;
let pollTimer;
let isPolling = false; // evita solapar ciclos si un poll tarda más que el intervalo

async function start() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(config.AUTH_FOLDER);

  sock = makeWASocket({
    auth: authState,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'connecting' && !sock.authState.creds.registered) {
      // Login por pairing code (no QR)
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const code = await sock.requestPairingCode(config.PHONE_NUMBER);
        console.log('\n========================================');
        console.log(`CÓDIGO DE VINCULACIÓN: ${code}`);
        console.log('Ingresa este código en WhatsApp > Dispositivos vinculados > Vincular con número de teléfono');
        console.log('========================================\n');
      } catch (err) {
        console.error('Error pidiendo pairing code:', err.message);
      }
    }

    if (connection === 'open') {
      console.log('✅ Conectado a WhatsApp.');
      await resolvePendingInvites();
      validateConfig();
      startPollingLoop();
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`Conexión cerrada (code ${statusCode}). Reconectar: ${shouldReconnect}`);
      clearInterval(pollTimer);
      if (shouldReconnect) {
        start();
      } else {
        console.log('Sesión cerrada (logged out). Borra la carpeta de auth y vuelve a vincular.');
      }
    }
  });
}

// Si hay invites pendientes en config.RESOLVE_INVITES, los resuelve a JID real
// y los imprime para que el usuario los mueva a SOURCE_CHANNELS.
async function resolvePendingInvites() {
  if (!config.RESOLVE_INVITES.length) return;

  console.log('\n--- Resolviendo invites pendientes ---');
  for (const inviteCode of config.RESOLVE_INVITES) {
    try {
      const meta = await sock.newsletterMetadata('invite', inviteCode);
      console.log(`Invite "${inviteCode}" -> JID: ${meta.id}  (nombre: "${meta.name}")`);
      // Lo sigue automáticamente para poder leer sus mensajes
      await sock.newsletterFollow(meta.id);
      console.log(`  Seguido automáticamente.`);
    } catch (err) {
      console.error(`No se pudo resolver invite "${inviteCode}":`, err.message);
    }
  }
  console.log('--- Copia los JIDs de arriba a SOURCE_CHANNELS en config.js ---\n');
}

function validateConfig() {
  if (!config.SOURCE_CHANNELS.length) {
    console.warn(
      '⚠️  SOURCE_CHANNELS está vacío. Agrega los JIDs de los 10 canales en config.js antes de que el polling tenga algo que hacer.'
    );
  }
  if (!config.DEST_CHANNELS.length) {
    console.warn('⚠️  DEST_CHANNELS está vacío. Agrega 1 a 3 JIDs de canales destino en config.js.');
  }
  if (config.DEST_CHANNELS.length > 3) {
    console.warn('⚠️  Tienes más de 3 canales destino configurados; revisa config.js.');
  }
}

function startPollingLoop() {
  if (pollTimer) clearInterval(pollTimer);

  // Corre un poll inmediato al conectar, luego cada POLL_INTERVAL_MINUTES
  pollOnce();
  pollTimer = setInterval(pollOnce, config.POLL_INTERVAL_MINUTES * 60 * 1000);
  console.log(`🔄 Polling cada ${config.POLL_INTERVAL_MINUTES} minutos.`);
}

async function pollOnce() {
  if (isPolling) {
    console.log('[poll] Ciclo anterior aún en curso, se omite este tick.');
    return;
  }
  isPolling = true;

  const state = loadState();

  try {
    for (const sourceJid of config.SOURCE_CHANNELS) {
      await pollChannel(sourceJid, state);
    }
  } catch (err) {
    console.error('[poll] Error general en el ciclo:', err.message);
  } finally {
    saveState(state);
    isPolling = false;
  }
}

async function pollChannel(sourceJid, state) {
  try {
    const lastSeenId = getLastSeen(state, sourceJid);

    // newsletterFetchMessages(jid, count, since, after)
    // 'after' filtra server_id mayores a este valor -> solo trae lo nuevo.
    const node = await sock.newsletterFetchMessages(
      sourceJid,
      config.FETCH_COUNT,
      0,
      lastSeenId
    );

    const newMessages = parseNewsletterMessages(node);

    if (!newMessages.length) {
      return; // nada nuevo en este canal
    }

    console.log(`[poll] ${sourceJid}: ${newMessages.length} mensaje(s) nuevo(s).`);

    for (const { serverId, message } of newMessages) {
      // Asegura que la key tenga remoteJid correcto para que forward/download funcionen bien
      if (message.key) {
        message.key.remoteJid = sourceJid;
      }

      for (const destJid of config.DEST_CHANNELS) {
        await forwardToChannel(sock, destJid, message, sourceJid);
        // Pequeña pausa entre envíos para no saturar / parecer spam
        await sleep(1500);
      }

      setLastSeen(state, sourceJid, serverId);
      // Guarda progreso incremental por si el proceso se cae a mitad de un canal grande
      saveState(state);
    }
  } catch (err) {
    console.error(`[poll] Error en canal ${sourceJid}:`, err.message);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

process.on('SIGINT', () => {
  console.log('\nApagando bot...');
  clearInterval(pollTimer);
  process.exit(0);
});

start().catch((err) => {
  console.error('Error fatal al iniciar:', err);
  process.exit(1);
});
