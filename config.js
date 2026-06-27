// config.js
// Edita aquí los JIDs de tus canales. El JID de un canal SIEMPRE termina en @newsletter.
// Lo obtienes así:
//   1. Abre el canal en WhatsApp > toca el nombre > "Invite via link"
//   2. El link es algo como https://whatsapp.com/channel/0029VaXXXXXXXXXXXXX
//   3. Pega ese código en RESOLVE_INVITES (abajo) la primera vez que corras el bot,
//      el bot imprimirá el JID real (xxxxxxxxxxxxxxxxx@newsletter) en consola.
//      Luego copialo a SOURCE_CHANNELS y borralo de RESOLVE_INVITES.

module.exports = {
  // Carpeta donde Baileys guarda la sesión (credenciales de login)
  AUTH_FOLDER: './auth_info',

  // Número de teléfono para login por pairing code (con código de país, sin + ni espacios)
  // Ej: '521234567890'
  PHONE_NUMBER: '5212261058297',

  // --- CANALES ORIGEN (los 10 que vas a monitorear) ---
  // Una vez que tengas los JIDs reales, van aquí:
  SOURCE_CHANNELS: [
    // '120363XXXXXXXXXXXXXXX@newsletter',
    // '120363XXXXXXXXXXXXXXX@newsletter',
    // ... hasta 10
  ],

  // --- INVITES PENDIENTES DE RESOLVER ---
  // Pega aquí los códigos de invite (la parte después de /channel/ en el link)
  // de los canales que aún no tengas el JID. El bot los resuelve al iniciar
  // e imprime el JID en consola para que lo muevas a SOURCE_CHANNELS.
  RESOLVE_INVITES: [
    // '0029VaXXXXXXXXXXXXX',
  ],

  // --- CANALES DESTINO (1 a 3, donde se reenvía todo) ---
  DEST_CHANNELS: [
    // '120363YYYYYYYYYYYYYYY@newsletter',
  ],

  // --- INTERVALO DE POLLING (en minutos) ---
  POLL_INTERVAL_MINUTES: 5,

  // Cuántos mensajes recientes pedir por canal en cada poll
  // (suficiente margen para no perder mensajes si el canal publica seguido)
  FETCH_COUNT: 20,

  // Archivo donde se guarda el último mensaje visto por canal (anti-duplicados)
  STATE_FILE: './state.json',

  // Carpeta temporal para medios descargados antes de reenviar
  MEDIA_TMP_FOLDER: './media_tmp',
};
