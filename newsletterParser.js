// newsletterParser.js
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

    const plaintextNode = Array.isArray(child.content)
      ? child.content.find((c) => c.tag === 'plaintext')
      : null;

    if (!plaintextNode || !plaintextNode.content) continue;

    let webMessageInfo;
    try {
      // CORRECCIÓN: Asegurar que el contenido sea un Buffer nativo de Node.js
      const contentBuffer = Buffer.from(plaintextNode.content);
      webMessageInfo = proto.WebMessageInfo.decode(contentBuffer);
    } catch (err) {
      console.warn(`[parser] No se pudo decodificar mensaje server_id=${serverId}:`, err.message);
      continue;
    }

    results.push({ serverId, message: webMessageInfo });
  }

  results.sort((a, b) => a.serverId - b.serverId);
  return results;
}

module.exports = { parseNewsletterMessages };
