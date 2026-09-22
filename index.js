const http = require('http');
const fs = require('fs');
const path = require('path');
const P = require('pino');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT) || 10000;

const PHONE_NUMBER =
  (process.env.PAIR_PHONE || '').replace(/\D/g, '');

const AUTH_DIR =
  path.join(__dirname, 'auth_info');

const TEMP_DIR =
  path.join(__dirname, 'temp');

fs.mkdirSync(AUTH_DIR, {
  recursive: true
});

fs.mkdirSync(TEMP_DIR, {
  recursive: true
});

/* =========================================================
   RENDER WEB SERVER
========================================================= */

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end(
    'Jamil Ahmed Song Bot is running.\n'
  );
});

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `🌐 HTTP server listening on port ${PORT}`
    );
  }
);

/* =========================================================
   BOT STATE
========================================================= */

let sock = null;
let starting = false;
let pairingRequested = false;
let reconnectTimer = null;

/* =========================================================
   HELPERS
========================================================= */

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function getDisconnectCode(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.statusCode ||
    lastDisconnect?.error?.statusCode ||
    null
  );
}

function cleanupTemp() {
  try {
    const files =
      fs.readdirSync(TEMP_DIR);

    for (const file of files) {
      try {
        fs.unlinkSync(
          path.join(TEMP_DIR, file)
        );
      } catch {}
    }
  } catch {}
}

/* =========================================================
   SEARCH SONG
   iTunes Search API
========================================================= */

async function searchSong(query) {
  const url =
    'https://itunes.apple.com/search?' +
    new URLSearchParams({
      term: query,
      media: 'music',
      entity: 'song',
      limit: '1'
    }).toString();

  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Search HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  if (
    !data.results ||
    !data.results.length
  ) {
    return null;
  }

  return data.results[0];
}

/* =========================================================
   START BOT
========================================================= */

async function startBot() {
  if (starting) {
    return;
  }

  starting = true;

  try {
    cleanupTemp();

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      AUTH_DIR
    );

    /* -----------------------------------------------------
       LIVE WHATSAPP WEB VERSION
    ----------------------------------------------------- */

    let version = null;

    try {
      const live =
        await fetchLatestWaWebVersion();

      if (live?.version) {
        version = live.version;

        console.log(
          `🌐 Live WhatsApp Web version: ${version.join('.')}`
        );
      }
    } catch (err) {
      console.log(
        '⚠️ Live WA version failed:',
        err.message
      );
    }

    /* -----------------------------------------------------
       FALLBACK VERSION
    ----------------------------------------------------- */

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

    /* -----------------------------------------------------
       SOCKET CONFIG
    ----------------------------------------------------- */

    const config = {
      auth: state,

      logger: P({
        level: 'silent'
      }),

      printQRInTerminal: false,

      browser:
        Browsers.macOS('Chrome'),

      markOnlineOnConnect: false,

      syncFullHistory: false,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000,

      keepAliveIntervalMs: 30000
    };

    if (version) {
      config.version = version;
    }

    console.log(
      '🔌 Creating WhatsApp socket...'
    );

    sock =
      makeWASocket(config);

    sock.ev.on(
      'creds.update',
      saveCreds
    );

    /* =====================================================
       CONNECTION UPDATE
    ===================================================== */

    sock.ev.on(
      'connection.update',
      async update => {
        const {
          connection,
          lastDisconnect
        } = update;

        /* -----------------------------------------------
           CONNECTING
        ------------------------------------------------ */

        if (
          connection === 'connecting'
        ) {
          console.log(
            '🔌 Connecting to WhatsApp...'
          );
        }

        /* -----------------------------------------------
           PAIRING
        ------------------------------------------------ */

        if (
          !state.creds.registered &&
          PHONE_NUMBER &&
          !pairingRequested &&
          connection !== 'close'
        ) {
          pairingRequested = true;

          try {
            console.log('');
            console.log(
              '📱 Preparing phone pairing...'
            );

            await sleep(2500);

            const code =
              await sock.requestPairingCode(
                PHONE_NUMBER
              );

            console.log('');
            console.log(
              '╔════════════════════════════════╗'
            );
            console.log(
              '║     JAMIL AHMED SONG BOT      ║'
            );
            console.log(
              '╠════════════════════════════════╣'
            );
            console.log(
              `║ Pairing Code: ${code}`
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

            pairingRequested = false;
          }
        }

        /* -----------------------------------------------
           CONNECTED
        ------------------------------------------------ */

        if (
          connection === 'open'
        ) {
          starting = false;
          pairingRequested = false;

          console.log('');
          console.log(
            '╔════════════════════════════════════╗'
          );
          console.log(
            '║     JAMIL AHMED SONG BOT          ║'
          );
          console.log(
            '║   WhatsApp Connected Successfully ║'
          );
          console.log(
            '╚════════════════════════════════════╝'
          );
          console.log('');

          console.log(
            '🏓 .ping'
          );

          console.log(
            '🎵 .song O Mahi'
          );
        }

        /* -----------------------------------------------
           CLOSED
        ------------------------------------------------ */

        if (
          connection === 'close'
        ) {
          starting = false;

          const statusCode =
            getDisconnectCode(
              lastDisconnect
            );

          console.log(
            '❌ WhatsApp connection closed:',
            statusCode || 'unknown'
          );

          /* Logged out */

          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {
            console.log(
              '⚠️ WhatsApp session logged out.'
            );

            console.log(
              '📱 Fresh pairing is required.'
            );

            return;
          }

          /* Reconnect */

          if (reconnectTimer) {
            return;
          }

          pairingRequested = false;

          reconnectTimer =
            setTimeout(() => {
              reconnectTimer = null;

              console.log(
                '🔄 Reconnecting...'
              );

              startBot().catch(err => {
                console.log(
                  '❌ Reconnect error:',
                  err.message
                );
              });

            }, 5000);
        }
      }
    );

    /* =====================================================
       MESSAGE HANDLER
    ===================================================== */

    sock.ev.on(
      'messages.upsert',
      async ({ messages }) => {
        try {
          for (
            const msg of messages || []
          ) {
            if (!msg?.message) {
              continue;
            }

            if (msg.key?.fromMe) {
              continue;
            }

            const jid =
              msg.key?.remoteJid;

            if (!jid) {
              continue;
            }

            const text =
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption ||
              '';

            const command =
              text.trim();

            if (!command) {
              continue;
            }

            /* =============================================
               PING
            ============================================= */

            if (
              command.toLowerCase() ===
              '.ping'
            ) {
              const start =
                Date.now();

              await sock.sendMessage(
                jid,
                {
                  react: {
                    text: '🏓',
                    key: msg.key
                  }
                }
              );

              const ms =
                Date.now() - start;

              await sock.sendMessage(
                jid,
                {
                  text:
                    `🏓 Pong!\n\n` +
                    `⚡ Response: ${ms}ms\n` +
                    `🤖 Jamil Ahmed Song Bot`
                }
              );

              continue;
            }

            /* =============================================
               SONG
               .song O Mahi
            ============================================= */

            if (
              command
                .toLowerCase()
                .startsWith('.song')
            ) {
              const query =
                command
                  .slice(5)
                  .trim();

              /* -------------------------------------------
                 NO QUERY
              -------------------------------------------- */

              if (!query) {
                await sock.sendMessage(
                  jid,
                  {
                    text:
                      '🎵 Song Search\n\n' +
                      'Use:\n' +
                      '.song O Mahi\n\n' +
                      'You can also use a direct audio URL.'
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

                continue;
              }

              /* -------------------------------------------
                 DIRECT AUDIO URL
              -------------------------------------------- */

              if (
                /^https?:\/\//i.test(
                  query
                )
              ) {
                await sendDirectAudio(
                  jid,
                  msg,
                  query
                );

                continue;
              }

              /* -------------------------------------------
                 SONG SEARCH
              -------------------------------------------- */

              await sock.sendMessage(
                jid,
                {
                  react: {
                    text: '🔎',
                    key: msg.key
                  }
                }
              );

              await sock.sendMessage(
                jid,
                {
                  text:
                    `🔎 Searching: ${query}`
                }
              );

              try {
                const song =
                  await searchSong(
                    query
                  );

                if (!song) {
                  await sock.sendMessage(
                    jid,
                    {
                      text:
                        '❌ Song not found.'
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

                  continue;
                }

                const title =
                  song.trackName ||
                  query;

                const artist =
                  song.artistName ||
                  'Unknown Artist';

                const album =
                  song.collectionName ||
                  'Unknown Album';

                const preview =
                  song.previewUrl;

                if (!preview) {
                  await sock.sendMessage(
                    jid,
                    {
                      text:
                        `🎵 Found:\n\n` +
                        `🎶 ${title}\n` +
                        `👤 ${artist}\n` +
                        `💿 ${album}\n\n` +
                        `❌ Audio preview unavailable.`
                    }
                  );

                  continue;
                }

                await sock.sendMessage(
                  jid,
                  {
                    text:
                      `🎵 ${title}\n` +
                      `👤 ${artist}\n` +
                      `💿 ${album}\n\n` +
                      `⏳ Sending audio...`
                  }
                );

                await sendDirectAudio(
                  jid,
                  msg,
                  preview,
                  {
                    title,
                    artist
                  }
                );

              } catch (err) {
                console.log(
                  '❌ Search error:',
                  err.message
                );

                await sock.sendMessage(
                  jid,
                  {
                    text:
                      '❌ Song search failed.\n\n' +
                      err.message
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

              continue;
            }
          }

        } catch (err) {
          console.log(
            '❌ Message handler error:',
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

    if (!reconnectTimer) {
      reconnectTimer =
        setTimeout(() => {
          reconnectTimer = null;

          startBot().catch(() => {});
        }, 5000);
    }
  }
}

/* =========================================================
   DIRECT AUDIO SENDER
========================================================= */

async function sendDirectAudio(
  jid,
  msg,
  url,
  info = {}
) {
  const filePath =
    path.join(
      TEMP_DIR,
      `song-${Date.now()}.mp3`
    );

  try {
    await sock.sendMessage(
      jid,
      {
        react: {
          text: '⏳',
          key: msg.key
        }
      }
    );

    console.log(
      '🎵 Fetching audio...'
    );

    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const contentType =
      (
        response.headers.get(
          'content-type'
        ) || ''
      ).toLowerCase();

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (!buffer.length) {
      throw new Error(
        'Empty audio'
      );
    }

    /*
       20 MB safety limit
    */

    if (
      buffer.length >
      20 * 1024 * 1024
    ) {
      throw new Error(
        'Audio is larger than 20MB'
      );
    }

    fs.writeFileSync(
      filePath,
      buffer
    );

    const title =
      info.title || 'song';

    const artist =
      info.artist || '';

    const caption =
      artist
        ? `🎵 ${title}\n👤 ${artist}`
        : `🎵 ${title}`;

    await sock.sendMessage(
      jid,
      {
        audio:
          fs.readFileSync(
            filePath
          ),

        mimetype:
          contentType.includes(
            'audio/ogg'
          )
            ? 'audio/ogg'
            : 'audio/mpeg',

        fileName:
          `${title
            .replace(/[\\/:*?"<>|]/g, '')
            .slice(0, 80)}.mp3`,

        ptt: false,

        caption
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

    console.log(
      '✅ Audio sent successfully.'
    );

  } catch (err) {
    console.log(
      '❌ Audio error:',
      err.message
    );

    await sock.sendMessage(
      jid,
      {
        text:
          `❌ Audio send failed.\n\n${err.message}`
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

  } finally {
    try {
      if (
        fs.existsSync(filePath)
      ) {
        fs.unlinkSync(
          filePath
        );
      }
    } catch {}
  }
}

/* =========================================================
   START
========================================================= */

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

if (!PHONE_NUMBER) {
  console.log(
    '⚠️ PAIR_PHONE is missing.'
  );
} else {
  console.log(
    '📱 Phone pairing is configured.'
  );
}

startBot();
