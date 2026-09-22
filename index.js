const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const P = require('pino');
const fs = require('fs');
const path = require('path');

const PHONE_NUMBER = process.env.PAIR_PHONE;

const AUTH_DIR = path.join(__dirname, 'auth_info');
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

let pairingStarted = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'connecting') {
      console.log('🔌 Connecting to WhatsApp...');
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully!');
      pairingStarted = false;
    }

    if (
      connection === 'close'
    ) {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      console.log('❌ WhatsApp connection closed:', statusCode || 'unknown');

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconnecting...');
        setTimeout(startBot, 5000);
      } else {
        console.log('⚠️ Session logged out. Pair again.');
      }
    }

    if (
      !state.creds.registered &&
      PHONE_NUMBER &&
      !pairingStarted
    ) {
      pairingStarted = true;

      try {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const code = await sock.requestPairingCode(
          PHONE_NUMBER.replace(/\D/g, '')
        );

        console.log('');
        console.log('╔════════════════════════════════╗');
        console.log('║     JAMIL AHMED SONG BOT       ║');
        console.log('╠════════════════════════════════╣');
        console.log('║ Pairing Code: ' + code + '       ║');
        console.log('╚════════════════════════════════╝');
        console.log('');
      } catch (err) {
        console.log('❌ Pairing error:', err.message);
        pairingStarted = false;
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
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

      // =========================
      // .song TEST COMMAND
      // =========================
      if (command.startsWith('.song ')) {
        const url = command.slice(6).trim();

        if (!/^https?:\/\//i.test(url)) {
          await sock.sendMessage(jid, {
            text: '❌ Use a valid direct MP3 URL.\n\nExample:\n.song https://example.com/song.mp3'
          });
          return;
        }

        await sock.sendMessage(jid, {
          react: {
            text: '⏳',
            key: msg.key
          }
        });

        try {
          const response = await fetch(url);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const contentType =
            response.headers.get('content-type') || '';

          if (
            !contentType.includes('audio') &&
            !url.toLowerCase().includes('.mp3')
          ) {
            throw new Error('URL is not a direct audio file');
          }

          const buffer = Buffer.from(
            await response.arrayBuffer()
          );

          if (!buffer.length) {
            throw new Error('Empty audio file');
          }

          if (buffer.length > 20 * 1024 * 1024) {
            throw new Error('File is larger than 20MB');
          }

          const filePath = path.join(
            TEMP_DIR,
            `song-${Date.now()}.mp3`
          );

          fs.writeFileSync(filePath, buffer);

          await sock.sendMessage(jid, {
            audio: fs.readFileSync(filePath),
            mimetype: 'audio/mpeg',
            fileName: 'song.mp3',
            ptt: false
          });

          await sock.sendMessage(jid, {
            react: {
              text: '✅',
              key: msg.key
            }
          });

          fs.unlinkSync(filePath);

        } catch (err) {
          console.log('Song error:', err.message);

          await sock.sendMessage(jid, {
            text: '❌ Song download/send failed.\n\nUse a direct MP3/audio URL.'
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
      console.log('Message error:', err.message);
    }
  });
}

startBot().catch(err => {
  console.error('❌ Bot startup error:', err);
});
