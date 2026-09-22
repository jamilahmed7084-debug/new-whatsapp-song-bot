const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');

const P = require('pino');
const fs = require('fs');
const path = require('path');

const PHONE_NUMBER = process.env.PAIR_PHONE;

const AUTH_DIR = path.join(__dirname, 'auth_info');
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

let pairingStarted = false;
let reconnecting = false;

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    let version;

    // Get the current WhatsApp Web version first
    try {
      const live = await fetchLatestWaWebVersion();

      if (live?.version) {
        version = live.version;

        console.log(
          `🌐 Live WhatsApp Web version: ${version.join('.')}`
        );

        console.log(
          `📌 Live version status: ${live.isLatest ? 'true' : 'false'}`
        );
      }
    } catch (err) {
      console.log(
        '⚠️ Live WhatsApp version fetch failed:',
        err.message
      );
    }

    // Fallback to Baileys version
    if (!version) {
      try {
        const latest = await fetchLatestBaileysVersion();

        if (latest?.version) {
          version = latest.version;

          console.log(
            `📦 Baileys fallback version: ${version.join('.')}`
          );
        }
      } catch (err) {
        console.log(
          '⚠️ Baileys version fetch failed:',
          err.message
        );
      }
    }

    const socketConfig = {
      auth: state,
      logger: P({ level: 'silent' }),

      // QR completely disabled
      printQRInTerminal: false,

      // Desktop browser identity
      browser: Browsers.macOS('Chrome'),

      // Helps prevent unnecessary online presence
      markOnlineOnConnect: false
    };

    if (version) {
      socketConfig.version = version;
    }

    console.log('🔌 Creating WhatsApp socket...');

    const sock = makeWASocket(socketConfig);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const {
        connection,
        lastDisconnect
      } = update;

      if (connection === 'connecting') {
        console.log('🔌 Connecting to WhatsApp...');
      }

      if (connection === 'open') {
        console.log('');
        console.log('╔════════════════════════════════════╗');
        console.log('║   ✅ JAMIL AHMED SONG BOT         ║');
        console.log('║   WhatsApp Connected Successfully ║');
        console.log('╚════════════════════════════════════╝');
        console.log('');

        pairingStarted = false;
        reconnecting = false;
      }

      if (connection === 'close') {
        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        console.log(
          '❌ WhatsApp connection closed:',
          statusCode || 'unknown'
        );

        // Logged out
        if (statusCode === DisconnectReason.loggedOut) {
          console.log(
            '⚠️ WhatsApp session logged out.'
          );

          console.log(
            '🗑️ Delete auth_info and pair again.'
          );

          return;
        }

        // 405 usually means WhatsApp rejected the client/session
        if (statusCode === 405) {
          console.log('');
          console.log(
            '⚠️ WhatsApp returned 405.'
          );
          console.log(
            '📌 The bot is using the latest WhatsApp Web version.'
          );
          console.log(
            '📌 If 405 continues, the hosting/server connection may be rejected by WhatsApp.'
          );
          console.log('');

          return;
        }

        // Prevent duplicate reconnects
        if (!reconnecting) {
          reconnecting = true;

          console.log(
            '🔄 Reconnecting in 5 seconds...'
          );

          setTimeout(() => {
            reconnecting = false;
            startBot().catch((err) => {
              console.log(
                '❌ Reconnect error:',
                err.message
              );
            });
          }, 5000);
        }
      }

      // Phone pairing only — NO QR
      if (
        !state.creds.registered &&
        PHONE_NUMBER &&
        !pairingStarted &&
        connection !== 'close'
      ) {
        pairingStarted = true;

        try {
          console.log('');
          console.log(
            '📱 Preparing phone pairing...'
          );

          await new Promise(resolve =>
            setTimeout(resolve, 2500)
          );

          const cleanPhone =
            PHONE_NUMBER.replace(/\D/g, '');

          const code =
            await sock.requestPairingCode(
              cleanPhone
            );

          console.log('');
          console.log(
            '╔════════════════════════════════╗'
          );
          console.log(
            '║     JAMIL AHMED SONG BOT       ║'
          );
          console.log(
            '╠════════════════════════════════╣'
          );
          console.log(
            '║ Pairing Code: ' + code
          );
          console.log(
            '╚════════════════════════════════╝'
          );
          console.log('');
        } catch (err) {
          console.log(
            '❌ Pairing error:',
            err.message
          );

          pairingStarted = false;
        }
      }
    });

    // ==============================
    // MESSAGE HANDLER
    // ==============================

    sock.ev.on(
      'messages.upsert',
      async ({ messages }) => {
        try {
          const msg = messages[0];

          if (!msg || !msg.message) return;
          if (msg.key.fromMe) return;

          const jid = msg.key.remoteJid;

          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            '';

          const command = text.trim();

          // ==============================
          // .song TEST COMMAND
          // ==============================

          if (command.toLowerCase().startsWith('.song ')) {
            const url = command
              .slice(6)
              .trim();

            if (!/^https?:\/\//i.test(url)) {
              await sock.sendMessage(jid, {
                text:
                  '❌ Use a valid direct MP3/audio URL.\n\n' +
                  'Example:\n' +
                  '.song https://example.com/song.mp3'
              });

              return;
            }

            // Processing reaction
            await sock.sendMessage(jid, {
              react: {
                text: '⏳',
                key: msg.key
              }
            });

            try {
              console.log(
                '🎵 Downloading audio:',
                url
              );

              const response =
                await fetch(url);

              if (!response.ok) {
                throw new Error(
                  `HTTP ${response.status}`
                );
              }

              const contentType =
                response.headers.get(
                  'content-type'
                ) || '';

              if (
                !contentType.includes('audio') &&
                !url
                  .toLowerCase()
                  .includes('.mp3')
              ) {
                throw new Error(
                  'URL is not a direct audio file'
                );
              }

              const buffer = Buffer.from(
                await response.arrayBuffer()
              );

              if (!buffer.length) {
                throw new Error(
                  'Empty audio file'
                );
              }

              // 20 MB limit
              if (
                buffer.length >
                20 * 1024 * 1024
              ) {
                throw new Error(
                  'Audio file is larger than 20MB'
                );
              }

              const filePath = path.join(
                TEMP_DIR,
                `song-${Date.now()}.mp3`
              );

              fs.writeFileSync(
                filePath,
                buffer
              );

              console.log(
                '📤 Sending audio...'
              );

              await sock.sendMessage(jid, {
                audio: fs.readFileSync(
                  filePath
                ),
                mimetype: 'audio/mpeg',
                fileName: 'song.mp3',
                ptt: false
              });

              // Success reaction
              await sock.sendMessage(jid, {
                react: {
                  text: '✅',
                  key: msg.key
                }
              });

              // Delete temporary file
              try {
                fs.unlinkSync(filePath);
              } catch {}

              console.log(
                '✅ Audio sent successfully.'
              );

            } catch (err) {
              console.log(
                '❌ Song error:',
                err.message
              );

              await sock.sendMessage(jid, {
                text:
                  '❌ Song download/send failed.\n\n' +
                  'Please use a direct MP3/audio URL.'
              });

              await sock.sendMessage(jid, {
                react: {
                  text: '❌',
                  key: msg.key
                }
              });
            }

            return;
          }

        } catch (err) {
          console.log(
            '❌ Message error:',
            err.message
          );
        }
      }
    );

  } catch (err) {
    console.log(
      '❌ Bot startup error:',
      err.message
    );

    setTimeout(() => {
      startBot().catch(() => {});
    }, 5000);
  }
}

console.log('');
console.log('╔════════════════════════════════════╗');
console.log('║     JAMIL AHMED SONG BOT          ║');
console.log('║        Starting V1 Test           ║');
console.log('╚════════════════════════════════════╝');
console.log('');

startBot();
