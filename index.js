const http = require('http');
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

const PORT = Number(process.env.PORT) || 10000;
const PHONE_NUMBER = process.env.PAIR_PHONE;

const AUTH_DIR = path.join(__dirname, 'auth_info');
const TEMP_DIR = path.join(__dirname, 'temp');

fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });

/*
========================================
RENDER HEALTH SERVER
========================================
*/

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Jamil Ahmed Song Bot is running.\n');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

/*
========================================
WHATSAPP BOT
========================================
*/

let pairingStarted = false;
let starting = false;

async function startBot() {
  if (starting) return;

  starting = true;

  try {
    const { state, saveCreds } =
      await useMultiFileAuthState(AUTH_DIR);

    let version = null;

    /*
    Get current WhatsApp Web version
    */

    try {
      const live = await fetchLatestWaWebVersion();

      if (live?.version) {
        version = live.version;

        console.log(
          `🌐 Live WhatsApp Web version: ${version.join('.')}`
        );
      }
    } catch (err) {
      console.log(
        '⚠️ Live version failed:',
        err.message
      );
    }

    /*
    Fallback
    */

    if (!version) {
      try {
        const latest =
          await fetchLatestBaileysVersion();

        if (latest?.version) {
          version = latest.version;

          console.log(
            `📦 Baileys version: ${version.join('.')}`
          );
        }
      } catch (err) {
        console.log(
          '⚠️ Version fallback failed:',
          err.message
        );
      }
    }

    const config = {
      auth: state,

      logger: P({
        level: 'silent'
      }),

      printQRInTerminal: false,

      browser: Browsers.macOS('Chrome'),

      markOnlineOnConnect: false
    };

    if (version) {
      config.version = version;
    }

    console.log('🔌 Creating WhatsApp socket...');

    const sock = makeWASocket(config);

    sock.ev.on(
      'creds.update',
      saveCreds
    );

    /*
    ========================================
    CONNECTION
    ========================================
    */

    sock.ev.on(
      'connection.update',
      async (update) => {
        const {
          connection,
          lastDisconnect
        } = update;

        if (connection === 'connecting') {
          console.log(
            '🔌 Connecting to WhatsApp...'
          );
        }

        if (connection === 'open') {
          starting = false;
          pairingStarted = false;

          console.log('');
          console.log(
            '╔════════════════════════════════════╗'
          );
          console.log(
            '║   ✅ JAMIL AHMED SONG BOT         ║'
          );
          console.log(
            '║   WhatsApp Connected Successfully ║'
          );
          console.log(
            '╚════════════════════════════════════╝'
          );
          console.log('');
        }

        if (connection === 'close') {
          starting = false;

          const statusCode =
            lastDisconnect?.error?.output?.statusCode;

          console.log(
            '❌ WhatsApp connection closed:',
            statusCode || 'unknown'
          );

          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {
            console.log(
              '⚠️ WhatsApp session logged out.'
            );

            console.log(
              '📱 Delete auth_info and pair again.'
            );

            return;
          }

          /*
          Do not repeatedly reconnect on 405.
          */

          if (statusCode === 405) {
            console.log(
              '⚠️ WhatsApp rejected the connection with 405.'
            );

            return;
          }

          /*
          Reconnect after temporary errors.
          */

          setTimeout(() => {
            startBot().catch((err) => {
              console.log(
                '❌ Reconnect error:',
                err.message
              );
            });
          }, 5000);
        }

        /*
        ========================================
        PHONE PAIRING ONLY
        ========================================
        */

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

            await new Promise(
              resolve =>
                setTimeout(resolve, 2500)
            );

            const phone =
              PHONE_NUMBER.replace(
                /\D/g,
                ''
              );

            const code =
              await sock.requestPairingCode(
                phone
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
      }
    );

    /*
    ========================================
    MESSAGE HANDLER
    ========================================
    */

    sock.ev.on(
      'messages.upsert',
      async ({ messages }) => {
        try {
          const msg = messages?.[0];

          if (!msg?.message) return;
          if (msg.key?.fromMe) return;

          const jid =
            msg.key.remoteJid;

          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            '';

          const command =
            text.trim();

          /*
          ------------------------------------
          .song TEST
          ------------------------------------
          */

          if (
            command
              .toLowerCase()
              .startsWith('.song ')
          ) {
            const value =
              command
                .slice(6)
                .trim();

            /*
            For now this checks whether the
            user supplied a direct audio URL.
            */

            if (
              !/^https?:\/\//i.test(value)
            ) {
              await sock.sendMessage(
                jid,
                {
                  text:
                    '🎵 .song is online.\n\n' +
                    'Name-based song search will be added next.\n\n' +
                    'For the current test, use a direct audio URL.'
                }
              );

              await sock.sendMessage(
                jid,
                {
                  react: {
                    text: '🎵',
                    key: msg.key
                  }
                }
              );

              return;
            }

            await sock.sendMessage(
              jid,
              {
                react: {
                  text: '⏳',
                  key: msg.key
                }
              }
            );

            try {
              const response =
                await fetch(value);

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
                !value
                  .toLowerCase()
                  .includes('.mp3')
              ) {
                throw new Error(
                  'Not a direct audio URL'
                );
              }

              const buffer =
                Buffer.from(
                  await response.arrayBuffer()
                );

              if (!buffer.length) {
                throw new Error(
                  'Empty audio'
                );
              }

              if (
                buffer.length >
                20 * 1024 * 1024
              ) {
                throw new Error(
                  'Audio is larger than 20MB'
                );
              }

              const filePath =
                path.join(
                  TEMP_DIR,
                  `song-${Date.now()}.mp3`
                );

              fs.writeFileSync(
                filePath,
                buffer
              );

              await sock.sendMessage(
                jid,
                {
                  audio:
                    fs.readFileSync(
                      filePath
                    ),
                  mimetype:
                    'audio/mpeg',
                  fileName:
                    'song.mp3',
                  ptt: false
                }
              );

              await sock.sendMessage(
                jid,
                {
                  react: {
                    text: '✅',
                    key: msg.key
                  }
                }
              );

              try {
                fs.unlinkSync(
                  filePath
                );
              } catch {}

              console.log(
                '✅ Audio sent successfully.'
              );

            } catch (err) {
              console.log(
                '❌ Song error:',
                err.message
              );

              await sock.sendMessage(
                jid,
                {
                  text:
                    '❌ Audio send failed.'
                }
              );

              await sock.sendMessage(
                jid,
                {
                  react: {
                    text: '❌',
                    key: msg.key
                  }
                }
              );
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
    starting = false;

    console.log(
      '❌ Bot startup error:',
      err.message
    );

    setTimeout(() => {
      startBot().catch(() => {});
    }, 5000);
  }
}

/*
========================================
START
========================================
*/

console.log('');
console.log(
  '╔════════════════════════════════════╗'
);
console.log(
  '║     JAMIL AHMED SONG BOT          ║'
);
console.log(
  '║          Starting...              ║'
);
console.log(
  '╚════════════════════════════════════╝'
);
console.log('');

startBot();
