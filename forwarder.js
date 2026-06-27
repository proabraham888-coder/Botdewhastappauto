// forwarder.js
// Reenvía un WAMessage (sacado de un canal origen) hacia los canales destino.
// Intenta primero "forward" nativo (más ligero, sin re-subir el archivo).
// Si el tipo de mensaje no soporta forward directo o falla, hace fallback a
// descargar el medio y reenviarlo como mensaje nuevo.

const fs = require('fs');
const path = require('path');
const {
  downloadMediaMessage,
  generateForwardMessageContent,
  generateWAMessageFromContent,
} = require('baileys');
const { MEDIA_TMP_FOLDER } = require('./config');

if (!fs.existsSync(MEDIA_TMP_FOLDER)) {
  fs.mkdirSync(MEDIA_TMP_FOLDER, { recursive: true });
}

/**
 * Intenta reenvío nativo (forward). Esto NO re-descarga el medio: WhatsApp
 * reusa el mismo archivo subido del lado del servidor. Es el modo "ligero".
 */
async function tryNativeForward(sock, destJid, message, sourceJid) {
  const content = generateForwardMessageContent(message, false);
  const waMessage = generateWAMessageFromContent(destJid, content, {
    userJid: sock.user.id,
  });
  await sock.relayMessage(destJid, waMessage.message, {
    messageId: waMessage.key.id,
  });
}

/**
 * Fallback: descarga el medio (o extrae el texto) y lo reenvía como mensaje nuevo.
 * Más pesado (re-sube el archivo) pero funciona para casos que el forward nativo
 * no soporta bien (algunos mensajes de canal vienen con metadata que el forward
 * directo rechaza).
 */
async function fallbackDownloadAndSend(sock, destJid, message, sourceJid) {
  const msgContent = message.message;
  if (!msgContent) return;

  const type = Object.keys(msgContent)[0];

  // Mensajes de solo texto
  if (type === 'conversation' || type === 'extendedTextMessage') {
    const text = msgContent.conversation || msgContent.extendedTextMessage?.text || '';
    if (text) await sock.sendMessage(destJid, { text });
    return;
  }

  // Mensajes con medio: imagen, video, audio, documento, sticker
  const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
  if (mediaTypes.includes(type)) {
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      { logger: sock.logger, reuploadRequest: sock.updateMediaMessage }
    );

    const caption =
      msgContent[type]?.caption ||
      undefined;

    const payloadKey = type.replace('Message', ''); // imageMessage -> image, etc.
    const payload = { [payloadKey]: buffer };
    if (caption) payload.caption = caption;
    if (type === 'documentMessage') {
      payload.mimetype = msgContent[type]?.mimetype;
      payload.fileName = msgContent[type]?.fileName || 'archivo';
    }
    if (type === 'audioMessage') {
      payload.mimetype = msgContent[type]?.mimetype || 'audio/ogg; codecs=opus';
      payload.ptt = msgContent[type]?.ptt || false;
    }

    await sock.sendMessage(destJid, payload);
    return;
  }

  console.warn(`[forwarder] Tipo de mensaje no manejado en fallback: ${type}`);
}

/**
 * Punto de entrada: intenta forward nativo, si falla cae a fallback.
 */
async function forwardToChannel(sock, destJid, message, sourceJid) {
  try {
    await tryNativeForward(sock, destJid, message, sourceJid);
  } catch (err) {
    console.warn(
      `[forwarder] Forward nativo falló hacia ${destJid} (origen ${sourceJid}): ${err.message}. Usando fallback...`
    );
    try {
      await fallbackDownloadAndSend(sock, destJid, message, sourceJid);
    } catch (err2) {
      console.error(
        `[forwarder] Fallback también falló hacia ${destJid} (origen ${sourceJid}):`,
        err2.message
      );
    }
  }
}

module.exports = { forwardToChannel };
