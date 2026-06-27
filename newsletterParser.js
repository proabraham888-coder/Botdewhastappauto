// newsletterParser.js
// newsletterFetchMessages devuelve un BinaryNode crudo (formato XML-like interno
// de WhatsApp). Cada hijo <message> contiene un atributo server_id y, dentro,
// un nodo <plaintext> o <enc> con el WAMessage serializado en protobuf.
// Esta función lo normaliza a una lista de { serverId, message } donde
// `message` ya es un objeto WAMessage usable con sock.relayMessage / downloadMediaMessage.

const { proto } = require('baileys');

/**
 * @param {import('baileys').BinaryNode} node - resultado de sock.newsletterFetchMessages
 * @returns {Array<{ serverId: number, message: import('baileys').proto.IWebMessageInfo }>}
 */
function parseNewsletterMessages(node) {
  if (!node || !Array.isArray(node.content)) return [];

  const results = [];

  for (const child of node.content) {
    if (child.tag !== 'message') continue;

    const serverId = parseInt(child.attrs?.server_id, 10);
    if (!serverId || Number.isNaN(serverId)) continue;

    // Dentro de <message> viene un <plaintext> con el WAMessage serializado en protobuf,
    // o (raramente) <enc> si está cifrado de extremo a extremo a nivel newsletter.
    const plaintextNode = Array.isArray(child.content)
      ? child.content.find((c) => c.tag === 'plaintext')
      : null;

    if (!plaintextNode || !plaintextNode.content) continue;

    let webMessageInfo;
    try {
      // El contenido es un Buffer con el WebMessageInfo serializado
      webMessageInfo = proto.WebMessageInfo.decode(plaintextNode.content);
    } catch (err) {
      console.warn(`[parser] No se pudo decodificar mensaje server_id=${serverId}:`, err.message);
      continue;
    }

    results.push({ serverId, message: webMessageInfo });
  }

  // Orden ascendente por serverId (más viejo primero) para reenviar en orden cronológico
  results.sort((a, b) => a.serverId - b.serverId);
  return results;
}

module.exports = { parseNewsletterMessages };
