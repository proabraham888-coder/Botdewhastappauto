// forwarder.js
const fs = require('fs');
const {
  downloadMediaMessage,
  generateForwardMessageContent,
  generateWAMessageFromContent,
} = require('baileys');
const { MEDIA_TMP_FOLDER } = require('./config');

if (!fs.existsSync(MEDIA_TMP_FOLDER)) {
  fs.mkdirSync(MEDIA_TMP_FOLDER, { recursive: true });
}

async function tryNativeForward(sock, destJid, message, sourceJid) {
  const content = generateForwardMessageContent(message, false);
  if (!content) throw new Error('No se pudo generar contenido de reenvío nativo');
  
  const waMessage = generateWAMessageFromContent(destJid, content, {
    userJid: sock.user.id,
  });
  await sock.relayMessage(destJid, waMessage.message, {
    messageId: waMessage.key.id,
  });
}

async function fallbackDownloadAndSend(sock, destJid, message, sourceJid) {
  const msgContent = message.message;
  if (!msgContent) return;

  const type = Object.keys(msgContent)[0];

  if (type === 'conversation' || type === 'extendedTextMessage') {
    const text = msgContent.conversation || msgContent.extendedTextMessage?.text || '';
    if (text) await sock.sendMessage(destJid, { text });
    return;
  }

  const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
  if (mediaTypes.includes(type)) {
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      { logger: sock.logger, reuploadRequest: sock.updateMediaMessage }
    );

    const caption = msgContent[type]?.caption || undefined;
    const payloadKey = type.replace('Message', ''); 
    const payload = { [payloadKey]: buffer };
    
    if (caption) payload.caption = caption;
    if (type === 'documentMessage') {
      payload.mimetype = msgContent[type]?.mimetype;
      payload.fileName = msgContent[type]?.fileName || 'archivo';
    }
    if (type === 'audioMessage') {
      payload.mimetype = msgContent[type]?.mimetype || 'audio/mp4';
      payload.ptt = msgContent[type]?.ptt || false;
    }

    await sock.sendMessage(destJid, payload);
    return;
  }

  console.warn(`[forwarder] Tipo de mensaje no manejado en fallback: ${type}`);
}

async function forwardToChannel(sock, destJid, message, sourceJid) {
  try {
    await tryNativeForward(sock, destJid, message, sourceJid);
  } catch (err) {
    console.warn(`[forwarder] Forward nativo falló hacia ${destJid}: ${err.message}. Usando fallback...`);
    try {
      await fallbackDownloadAndSend(sock, destJid, message, sourceJid);
    } catch (err2) {
      console.error(`[forwarder] Fallback también falló hacia ${destJid}:`, err2.message);
    }
  }
}

module.exports = { forwardToChannel };
