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

const PORT =
  Number(process.env.PORT) || 10000;

const PHONE_NUMBER =
  (process.env.PAIR_PHONE || '')
    .replace(/\D/g, '');

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
   RENDER HTTP SERVER
========================================================= */

const server = http.createServer(
  (req, res) => {
    res.writeHead(200, {
      'Content-Type':
        'text/plain; charset=utf-8'
    });

    res.end(
      'Jamil Ahmed Song Bot is running.\n'
    );
  }
);

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
   STATE
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

function getDisconnectCode(
  lastDisconnect
) {
  return (
    lastDisconnect?.error?.output
      ?.statusCode ||
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
          path.join(
            TEMP_DIR,
            file
          )
        );
      } catch {}
    }
  } catch {}
}

/* =========================================================
   ITUNES SEARCH
   Authorized music metadata + preview source
========================================================= */

async function searchSong(query) {
  const params =
    new URLSearchParams({
      term: query,
      media: 'music',
      entity: 'song',
      limit: '10'
    });

  const apiUrl =
    `https://itunes.apple.com/search?${params}`;

  const response =
    await fetch(apiUrl);

  if (!response.ok) {
    throw new Error(
      `Music search HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  const results =
    Array.isArray(data.results)
      ? data.results
      : [];

  /*
     Prefer a result that actually has
     an audio preview.
  */

  const withPreview =
    results.find(
      item =>
        item.previewUrl &&
        item.trackName
    );

  return (
    withPreview ||
    results[0] ||
    null
  );
}

/* =========================================================
   DOWNLOAD AUTHORIZED PREVIEW
========================================================= */

async function downloadPreview(
  previewUrl,
  outputPath
) {
  const response =
    await fetch(previewUrl);

  if (!response.ok) {
    throw new Error(
      `Audio HTTP ${response.status}`
    );
  }

  const contentType =
    (
      response.headers.get(
        'content-type'
      ) || ''
    ).toLowerCase();

  if (
    !contentType.includes('audio')
  ) {
    throw new Error(
      'Source did not return audio.'
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  if (!buffer.length) {
    throw new Error(
      'Audio preview is empty.'
    );
  }

  /*
     Safety limit.
  */

  if (
    buffer.length >
    20 * 1024 * 1024
  ) {
    throw new Error(
      'Audio preview is too large.'
    );
  }

  fs.writeFileSync(
    outputPath,
    buffer
  );

  return contentType;
}

/* =========================================================
   SEND SONG PREVIEW
========================================================= */

async function sendSongPreview(
  chatId,
  msg,
  song
) {
  let tempFile = null;

  try {
    const title =
      song.trackName ||
      'Unknown Song';

    const artist =
      song.artistName ||
      'Unknown Artist';

    const album =
      song.collectionName ||
      'Unknown Album';

    const previewUrl =
      song.previewUrl;

    if (!previewUrl) {
      throw new Error(
        'No authorized audio preview is available.'
      );
    }

    const safeName =
      `${title} - ${artist}`
        .replace(
          /[<>:"/\\|?*\x00-\x1F]/g,
          ''
        )
        .replace(
          /\s+/g,
          ' '
        )
        .trim()
        .slice(0, 100) ||
      'song';

    tempFile =
      path.join(
        TEMP_DIR,
        `song-${Date.now()}.m4a`
      );

    await downloadPreview(
      previewUrl,
      tempFile
    );

    await sock.sendMessage(
      chatId,
      {
        audio: {
          url: tempFile
        },

        mimetype:
          'audio/mp4',

        fileName:
          `${safeName}.m4a`,

        ptt: false,

        caption:
          `🎵 ${title}\n` +
          `👤 ${artist}\n` +
          `💿 ${album}\n\n` +
          `©️ Music preview`
      },
      {
        quoted: msg
      }
    );

    await sock.sendMessage(
      chatId,
      {
        react: {
          text: '✅',
          key: msg.key
        }
      }
    );

    console.log(
      `✅ Song preview sent: ${title}`
    );

  } finally {
    if (
      tempFile &&
      fs.existsSync(tempFile)
    ) {
      try {
        fs.unlinkSync(tempFile);
      } catch {}
    }
  }
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
    } =
      await useMultiFileAuthState(
        AUTH_DIR
      );

    /* -----------------------------------------------------
       LIVE WA WEB VERSION
    ----------------------------------------------------- */

    let version = null;

    try {
      const live =
        await fetchLatestWaWebVersion();

      if (live?.version) {
        version =
          live.version;

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
          version =
            latest.version;

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
       SOCKET
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

      defaultQueryTimeoutMs:
        60000,

      keepAliveIntervalMs:
        30000
    };

    if (version) {
      config.version =
        version;
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
           PHONE PAIRING
        ------------------------------------------------ */

        if (
          !state.creds.registered &&
          PHONE_NUMBER &&
          !pairingRequested &&
          connection !== 'close'
        ) {
          pairingRequested =
            true;

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

            pairingRequested =
              false;
          }
        }

        /* -----------------------------------------------
           OPEN
        ------------------------------------------------ */

        if (
          connection === 'open'
        ) {
          starting = false;

          pairingRequested =
            false;

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

          console.log(
            '🎵 .play O Mahi'
          );

          console.log(
            '🎵 .music O Mahi'
          );
        }

        /* -----------------------------------------------
           CLOSE
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
            statusCode ||
              'unknown'
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
              '📱 Fresh pairing required.'
            );

            return;
          }

          /* Reconnect */

          if (reconnectTimer) {
            return;
          }

          pairingRequested =
            false;

          reconnectTimer =
            setTimeout(
              () => {
                reconnectTimer =
                  null;

                console.log(
                  '🔄 Reconnecting WhatsApp...'
                );

                startBot().catch(
                  err => {
                    console.log(
                      '❌ Reconnect error:',
                      err.message
                    );
                  }
                );
              },
              5000
            );
        }
      }
    );

    /* =====================================================
       MESSAGE HANDLER
    ===================================================== */

    sock.ev.on(
      'messages.upsert',
      async ({
        messages
      }) => {
        try {
          for (
            const msg of
              messages || []
          ) {

            if (!msg?.message) {
              continue;
            }

            const jid =
              msg.key?.remoteJid;

            if (!jid) {
              continue;
            }

            /*
               IMPORTANT:

               We intentionally DO NOT reject
               msg.key.fromMe here.

               Therefore commands sent from
               the bot's own WhatsApp ID work.

               Only actual dot-commands below
               are processed, so normal bot
               messages don't create loops.
            */

            const rawText =
              msg.message?.conversation ||
              msg.message
                ?.extendedTextMessage
                ?.text ||
              msg.message
                ?.imageMessage
                ?.caption ||
              msg.message
                ?.videoMessage
                ?.caption ||
              '';

            const cleanText =
              rawText.trim();

            if (!cleanText) {
              continue;
            }

            /* =============================================
               PING
            ============================================= */

            if (
              /^\.ping$/i.test(
                cleanText
              )
            ) {
              const start =
                Date.now();

              try {
                await sock.sendMessage(
                  jid,
                  {
                    react: {
                      text: '🏓',
                      key: msg.key
                    }
                  }
                );
              } catch {}

              const latency =
                Date.now() -
                start;

              await sock.sendMessage(
                jid,
                {
                  text:
                    `🏓 Pong!\n\n` +
                    `⚡ ${latency}ms\n` +
                    `🤖 Jamil Ahmed Song Bot`
                },
                {
                  quoted: msg
                }
              );

              continue;
            }

            /* =============================================
               SONG / PLAY / MUSIC
            ============================================= */

            const songMatch =
              cleanText.match(
                /^\.(song|play|music)\s+(.+)$/i
              );

            if (songMatch) {
              const query =
                songMatch[2].trim();

              try {
                await sock.sendMessage(
                  jid,
                  {
                    react: {
                      text: '🎵',
                      key: msg.key
                    }
                  }
                );
              } catch {}

              if (!query) {
                await sock.sendMessage(
                  jid,
                  {
                    text:
                      '📛 ᴜsᴀɢᴇ:\n' +
                      '• .sᴏɴɢ <sᴏɴɢ ɴᴀᴍᴇ>\n' +
                      '• .ᴘʟᴀʏ <sᴏɴɢ ɴᴀᴍᴇ>\n' +
                      '• .ᴍᴜsɪᴄ <sᴏɴɢ ɴᴀᴍᴇ>'
                  },
                  {
                    quoted: msg
                  }
                );

                continue;
              }

              let statusMsg =
                null;

              try {
                /* -----------------------------------------
                   SEARCH STATUS
                ----------------------------------------- */

                statusMsg =
                  await sock.sendMessage(
                    jid,
                    {
                      text:
                        '🎵 ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ...\n\n' +
                        '🔎 sᴇᴀʀᴄɪɴɢ : ' +
                        query
                    },
                    {
                      quoted: msg
                    }
                  );

                /* -----------------------------------------
                   SEARCH
                ----------------------------------------- */

                const song =
                  await searchSong(
                    query
                  );

                if (!song) {
                  if (
                    statusMsg?.key
                  ) {
                    await sock.sendMessage(
                      jid,
                      {
                        text:
                          '❌ sᴏɴɢ ɴᴏᴛ ғᴏᴜɴᴅ',
                        edit:
                          statusMsg.key
                      }
                    );
                  }

                  continue;
                }

                const title =
                  song.trackName ||
                  query;

                const artist =
                  song.artistName ||
                  'Unknown Artist';

                /* -----------------------------------------
                   NO PREVIEW
                ----------------------------------------- */

                if (
                  !song.previewUrl
                ) {
                  if (
                    statusMsg?.key
                  ) {
                    await sock.sendMessage(
                      jid,
                      {
                        text:
                          `❌ ᴀᴜᴅɪᴏ ᴘʀᴇᴠɪᴇᴡ ɴᴇɪ\n\n` +
                          `🎵 ${title}\n` +
                          `👤 ${artist}`,
                        edit:
                          statusMsg.key
                      }
                    );
                  }

                  continue;
                }

                /* -----------------------------------------
                   STATUS UPDATE
                ----------------------------------------- */

                if (
                  statusMsg?.key
                ) {
                  await sock.sendMessage(
                    jid,
                    {
                      text:
                        '⬇️ ᴀᴜᴅɪᴏ ᴘʀᴇᴘᴀʀɪɴɢ...\n\n' +
                        `🎵 ${title}\n` +
                        `👤 ${artist}`,
                      edit:
                        statusMsg.key
                    }
                  );
                }

                /* -----------------------------------------
                   SEND
                ----------------------------------------- */

                await sendSongPreview(
                  jid,
                  msg,
                  song
                );

                /* -----------------------------------------
                   FINAL STATUS
                ----------------------------------------- */

                if (
                  statusMsg?.key
                ) {
                  await sock.sendMessage(
                    jid,
                    {
                      text:
                        '✅ ᴀᴜᴅɪᴏ sᴇɴᴛ\n\n' +
                        `🎵 ${title}`,
                      edit:
                        statusMsg.key
                    }
                  );
                }

              } catch (songErr) {
                console.log(
                  '❌ Song command error:',
                  songErr?.message ||
                    songErr
                );

                try {
                  if (
                    statusMsg?.key
                  ) {
                    await sock.sendMessage(
                      jid,
                      {
                        text:
                          '❌ ᴍᴜsɪᴄ ᴘʀᴇᴠɪᴇᴡ ғᴀɪʟᴇᴅ\n\n' +
                          '🎵 ᴏᴛʜᴇʀ sᴏɴɢ ɴᴀᴍᴇ ᴅɪʏᴇ ᴛʀʏ ᴋᴏʀᴏ.',
                        edit:
                          statusMsg.key
                      }
                    );
                  } else {
                    await sock.sendMessage(
                      jid,
                      {
                        text:
                          '❌ ᴍᴜsɪᴄ sᴇᴀʀᴄʜ ғᴀɪʟᴇᴅ'
                      },
                      {
                        quoted: msg
                      }
                    );
                  }
                } catch {}
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
        setTimeout(
          () => {
            reconnectTimer =
              null;

            startBot().catch(
              () => {}
            );
          },
          5000
        );
    }
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
    '📱 Phone pairing configured.'
  );
}

startBot();
