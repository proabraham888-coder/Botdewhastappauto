// test-connection.js
const makeWASocket = require('baileys').default;
const { useMultiFileAuthState, Browsers, DisconnectReason } = require('baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const config = require('./config');

async function testConnection() {
  console.log('⏳ Inicializando prueba de conexión...');
  const { state, saveCreds } = await useMultiFileAuthState(config.AUTH_FOLDER);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'connecting' && !sock.authState.creds.registered) {
      console.log('⚠️ No hay sesión activa. Solicitando código de vinculación...');
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const code = await sock.requestPairingCode(config.PHONE_NUMBER);
        console.log('\n========================================');
        console.log(`CÓDIGO DE VINCULACIÓN GENERADO: ${code}`);
        console.log('========================================\n');
      } catch (err) {
        console.error('Error al solicitar pairing code:', err.message);
      }
    }

    if (connection === 'open') {
      console.log('\n✅ ¡CONEXIÓN EXITOSA CON WHATSAPP!');
      console.log(`Conectado como: ${sock.user.name || 'Bot'} (${sock.user.id.split(':')[0]})`);
      
      console.log('\nPrueba de consulta de Newsletter...');
      try {
        // Intenta obtener información de prueba si hay algún canal configurado
        if (config.SOURCE_CHANNELS.length > 0) {
          const testJid = config.SOURCE_CHANNELS[0];
          console.log(`Consultando metadatos del canal: ${testJid}`);
          const meta = await sock.newsletterMetadata('jid', testJid);
          console.log(`🎉 Canal verificado con éxito: "${meta.name}"`);
        } else {
          console.log('ℹ️ SOURCE_CHANNELS está vacío en config.js. Agrega un JID para probar consultas.');
        }
      } catch (e) {
        console.error('❌ Error al consultar el canal de prueba:', e.message);
      }

      console.log('\nCerrando el test correctamente...');
      process.exit(0);
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`Conexión de prueba cerrada (Código: ${statusCode})`);
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('Reintentando test...');
        testConnection();
      }
    }
  });
}

testConnection().catch(err => {
  console.error('Error fatal en el test:', err);
});
