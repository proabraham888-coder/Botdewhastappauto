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

let sock;
let pollTimer;
let isPolling = false; // Evita solapar ciclos si un poll tarda más que el intervalo

async function start() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(config.AUTH_FOLDER);

  sock = makeWASocket({
    auth: authState,
    logger: pino({ level: 'silent' }), // Mantiene la consola limpia de spam de Baileys
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'connecting' && !sock.authState.creds.registered) {
      // Login por pairing code
      await new Promise((r) => setTimeout(r, 2000));
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
      console.log('✅ Conectado a WhatsApp con éxito.');
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
        console.log('❌ Sesión cerrada (logged out). Por favor borra la carpeta de auth y vuelve a vincular.');
      }
    }
  });
}

// Resuelve links de invitación a JIDs reales (@newsletter)
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
      await sleep(2000); // Pausa antibloqueo
    } catch (err) {
      console.error(`No se pudo resolver invite "${inviteCode}":`, err.message);
    }
  }
  console.log('--- Copia los JIDs de arriba a SOURCE_CHANNELS en config.js ---\n');
}

function validateConfig() {
  if (!config.SOURCE_CHANNELS.length) {
    console.warn('⚠️ SOURCE_CHANNELS está vacío. Agrega JIDs en config.js.');
  }
  if (!config.DEST_CHANNELS.length) {
    console.warn('⚠️ DEST_CHANNELS está vacío. Agrega de 1 a 3 JIDs destino.');
  }
}

function startPollingLoop() {
  if (pollTimer) clearInterval(pollTimer);

  // Ejecuta un ciclo inmediato al conectar, luego repite según el intervalo
  pollOnce();
  pollTimer = setInterval(pollOnce, config.POLL_INTERVAL_MINUTES * 60 * 1000);
  console.log(`🔄 Loop de Polling activo: revisando cada ${config.POLL_INTERVAL_MINUTES} minutos.`);
}

async function pollOnce() {
  if (isPolling) {
    console.log('[poll] Ciclo anterior aún en curso, se omite este tick.');
    return;
  }
  isPolling = true;

  try {
    for (const sourceJid of config.SOURCE_CHANNELS) {
      // Cargamos el estado fresco de disco al inicio de cada canal
      const state = loadState();
      await pollChannel(sourceJid, state);
      // Espaciado de 3 segundos entre canales para evitar baneo/error 405 de la API
      await sleep(3000);
    }
  } catch (err) {
    console.error('[poll] Error general en el ciclo:', err.message);
  } finally {
    isPolling = false;
  }
}

async function pollChannel(sourceJid, state) {
  try {
    const lastSeenId = getLastSeen(state, sourceJid);

    // Consulta los mensajes nuevos posteriores al ID guardado
    const node = await sock.newsletterFetchMessages(
      sourceJid,
      config.FETCH_COUNT,
      0,
      lastSeenId
    );

    const newMessages = parseNewsletterMessages(node);

    if (!newMessages.length) return; // Canal al día

    console.log(`[poll] ${sourceJid}: ${newMessages.length} mensaje(s) nuevo(s) detectado(s).`);

    for (const { serverId, message } of newMessages) {
      if (message.key) {
        message.key.remoteJid = sourceJid;
      }

      for (const destJid of config.DEST_CHANNELS) {
        await forwardToChannel(sock, destJid, message, sourceJid);
        await sleep(2000); // Pausa prudente entre envíos de reenvío
      }

      // Actualiza el ID visto y lo persiste inmediatamente en el JSON de forma segura
      setLastSeen(state, sourceJid, serverId);
      saveState(state);
    }
  } catch (err) {
    console.error(`[poll] Error procesando canal ${sourceJid}:`, err.message);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

process.on('SIGINT', () => {
  console.log('\nApagando bot de forma segura...');
  clearInterval(pollTimer);
  process.exit(0);
});

start().catch((err) => {
  console.error('Error fatal al iniciar:', err);
  process.exit(1);
});
