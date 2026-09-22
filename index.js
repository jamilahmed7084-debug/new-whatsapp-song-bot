const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  Browsers
} = require('@whiskeysockets/baileys');

const P = require('pino');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ytSearch = require('yt-search');



// =========================================================
// FAST SONG SYSTEM
// .song / .play / .music
// =========================================================

const songDownloadDir = path.resolve(
  config.DOWNLOAD_DIR || './downloads'
);

fs.mkdirSync(songDownloadDir, { recursive: true });

let songBusy = false;

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        maxBuffer: 1024 * 1024 * 10
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }

        resolve({
          stdout: stdout || '',
          stderr: stderr || ''
        });
      }
    );
  });
}

async function downloadSong(url, outputFile) {
  const args = [
    '--no-playlist',
    '--quiet',
    '--no-warnings',
    '--js-runtimes',
    'deno',
    '--extractor-args',
    'youtube:player_client=android',
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '128K',
    '--concurrent-fragments',
    '8',
    '--retries',
    '1',
    '--fragment-retries',
    '1',
    '-o',
    outputFile,
    url
  ];

  await runCommand('yt-dlp', args);
}

function cleanupSongFiles(baseFile) {
  const extensions = [
    '',
    '.mp3',
    '.part',
    '.webm',
    '.m4a',
    '.opus'
  ];

  for (const ext of extensions) {
    const file = baseFile.endsWith(ext)
      ? baseFile
      : baseFile + ext;

    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (_) {}
  }
}

function safeFileName(name) {
  return String(name || 'song')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'song';
}

async function startBot() {
  console.log('🔌 Creating WhatsApp socket...');

  const { state, saveCreds } =
    await useMultiFileAuthState(config.SESSION_DIR);

  let waVersion;

  try {
    // Use the live WhatsApp Web client revision.
    const live = await fetchLatestWaWebVersion();

    if (live?.version) {
      waVersion = live.version;

      console.log(
        '🌐 Live WhatsApp Web version:',
        waVersion.join('.')
      );

      console.log(
        '📌 Live version status:',
        live.isLatest
      );
    } else {
      throw new Error('Live WhatsApp Web version unavailable');
    }
  } catch (liveErr) {
    console.log(
      '⚠️ Live WA version failed:',
      liveErr?.message || liveErr
    );

    try {
      const fallback =
        await fetchLatestBaileysVersion();

      waVersion = fallback.version;

      console.log(
        '🔄 Fallback Baileys version:',
        waVersion.join('.')
      );
    } catch (fallbackErr) {
      console.log(
        '❌ Could not determine WhatsApp Web version:',
        fallbackErr?.message || fallbackErr
      );
    }
  }

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: config.LOG_LEVEL || 'silent' }),
    browser: Browsers.macOS('Desktop'),
    ...(waVersion ? { version: waVersion } : {})
  });

  sock.ev.on('creds.update', saveCreds);

  let pairingRequested = false;

  sock.ev.on('connection.update', async (update) => {
    const {
      connection,
      lastDisconnect,
      qr
    } = update;

    /*
     * PHONE NUMBER PAIRING
     * Pair Code only — QR is not used for linking.
     */
    if (
      !state.creds.registered &&
      !pairingRequested &&
      connection === 'connecting'
    ) {
      pairingRequested = true;

      const phone = String(
        config.PAIRING_PHONE || ''
      ).replace(/\D/g, '');

      if (!phone) {
        console.log('❌ PAIR_PHONE পাওয়া যায়নি');
      } else {
        try {
          console.log('');
          console.log('📱 Preparing phone pairing...');
          console.log('📱 Phone:', phone);

          // Allow the socket transport to settle.
          await new Promise(resolve =>
            setTimeout(resolve, 1500)
          );

          if (state.creds.registered) {
            console.log(
              'ℹ️ Session is already registered.'
            );
          } else {
            console.log(
              '🔐 Requesting phone pairing code...'
            );

            const code =
              await sock.requestPairingCode(phone);

            console.log('');
            console.log(
              '╔════════════════════════════════════╗'
            );
            console.log(
              '║       JAMIL AHMED BOT V3          ║'
            );
            console.log(
              '╠════════════════════════════════════╣'
            );
            console.log(
              `║          ${code}              ║`
            );
            console.log(
              '╚════════════════════════════════════╝'
            );
            console.log('');
            console.log(
              'WhatsApp → Linked devices'
            );
            console.log(
              '→ Link a device'
            );
            console.log(
              '→ Link with phone number'
            );
            console.log('');
            console.log(
              '⏳ Enter the code on WhatsApp.'
            );
          }
        } catch (err) {
          console.log('');
          console.log(
            '❌ Pairing request failed'
          );
          console.log(
            'Message:',
            err?.message || err
          );
          console.log(
            'Status:',
            err?.output?.statusCode ||
            err?.statusCode ||
            'unknown'
          );
          console.log('');
        }
      }
    }

    /*
     * Connection state
     */
    if (connection === 'open') {
      console.log('');
      console.log(
        '╔════════════════════════════════════╗'
      );
      console.log(
        '║       JAMIL AHMED BOT V3          ║'
      );
      console.log(
        '╠════════════════════════════════════╣'
      );
      console.log(
        '║        🟢 CONNECTED               ║'
      );
      console.log(
        '╚════════════════════════════════════╝'
      );
      console.log('');
    }

    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      console.log('');
      console.log('❌ Connection closed');
      console.log('Status code:', statusCode);

      if (
        statusCode === DisconnectReason.loggedOut
      ) {
        console.log(
          '🔴 WhatsApp session is logged out.'
        );
        console.log(
          'Delete auth_info and pair again.'
        );
        return;
      }

      console.log(
        '⚠️ Connection closed before pairing completed.'
      );
      console.log(
        'ℹ️ No QR pairing is being used.'
      );
    }
  });

  



// GROUP_SETTINGS_SYSTEM_V3
const groupSettingsFile = path.resolve(
  './data/group-settings.json'
);

fs.mkdirSync(
  path.dirname(groupSettingsFile),
  { recursive: true }
);

let groupSettings = {};

try {
  if (fs.existsSync(groupSettingsFile)) {
    const saved = fs.readFileSync(
      groupSettingsFile,
      'utf8'
    );

    groupSettings = JSON.parse(saved || '{}');
    console.log('💾 Group settings loaded');
  }
} catch (loadErr) {
  console.log(
    '⚠️ Could not load group settings:',
    loadErr?.message || loadErr
  );

  groupSettings = {};
}

function getGroupSettings(jid) {
  if (!groupSettings[jid]) {
    groupSettings[jid] = {
      antilink: false,
      welcome: false,
      goodbye: false
    };
  }

  // Keep old/missing settings compatible
  if (typeof groupSettings[jid].antilink !== 'boolean') {
    groupSettings[jid].antilink = false;
  }

  if (typeof groupSettings[jid].welcome !== 'boolean') {
    groupSettings[jid].welcome = false;
  }

  if (typeof groupSettings[jid].goodbye !== 'boolean') {
    groupSettings[jid].goodbye = false;
  }

  // Persistent AntiSticker setting
  if (typeof groupSettings[jid].antisticker !== 'boolean') {
    groupSettings[jid].antisticker = false;
  }

  // Persistent AntiLink setting
  if (typeof groupSettings[jid].antilink !== 'boolean') {
    groupSettings[jid].antilink = false;
  }

  return groupSettings[jid];
}

function saveGroupSettings() {
  try {
    fs.writeFileSync(
      groupSettingsFile,
      JSON.stringify(
        groupSettings,
        null,
        2
      ),
      'utf8'
    );

    console.log('💾 Group settings saved');
  } catch (saveErr) {
    console.log(
      '⚠️ Could not save group settings:',
      saveErr?.message || saveErr
    );
  }
}

// BOT_ONLINE_TIME_V3
// Only participant events received after this time
// are treated as live events. Old/offline events are ignored.
const botOnlineAt = Date.now();



// WELCOME_AUTO_JOIN_V3
sock.ev.on('group-participants.update', async (update) => {
  try {
    const { id: chatId, participants, action } = update;

    console.log(
      '👥 WELCOME EVENT:',
      action,
      participants?.length || 0
    );

    // Ignore participant events that belong to the
    // period before this bot session came online.
    const eventTimestamp =
      Number(
        update?.timestamp ||
        update?.ts ||
        update?.timestampMs ||
        0
      );

    if (
      eventTimestamp > 0 &&
      eventTimestamp < 100000000000 &&
      (eventTimestamp * 1000) < botOnlineAt
    ) {
      console.log(
        '⏭️ Ignoring offline/stale participant event'
      );
      return;
    }

    if (!chatId?.endsWith('@g.us')) {
      return;
    }

    const setting = getGroupSettings(chatId);

    // GOODBYE_AUTO_LEAVE_V3
    if (action === 'remove') {
      if (!setting.goodbye) {
        console.log('🔕 Goodbye is OFF for:', chatId);
        return;
      }

      for (const participant of participants || []) {
        const jid =
          participant?.phoneNumber ||
          participant?.id;

        if (!jid) continue;

        const number = String(jid)
          .split(':')[0]
          .split('@')[0];

        const goodbyeText =
          '╭❖ 𝗚𝗢𝗢𝗗𝗕𝗬𝗘 ❖╮\n\n' +
          '👋 𝗚𝗢𝗢𝗗𝗕𝗬𝗘 @' + number + '\n' +
          '💫 𝗧𝗛𝗔𝗡𝗞𝗦 𝗙𝗢𝗥 𝗕𝗘𝗜𝗡𝗚 𝗪𝗜𝗧𝗛 𝗨𝗦!\n' +
          '🏠 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗙𝗔𝗠𝗜𝗟𝗬\n\n' +
          '╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯';

        console.log(
          '👋 Sending goodbye to:',
          jid
        );

        // 🖼️ Get member profile picture
        let profilePic = null;

        try {
          profilePic = await sock.profilePictureUrl(
            jid,
            'image'
          );
        } catch (picErr) {
          console.log(
            '⚠️ Goodbye profile picture unavailable:',
            picErr?.message || picErr
          );
        }

        if (profilePic) {
          try {
            await sock.sendMessage(chatId, {
              image: { url: profilePic },
              caption: goodbyeText,
              mentions: [jid]
            });

            console.log('🖼️ Goodbye + profile picture sent');
          } catch (imageErr) {
            console.log(
              '⚠️ Goodbye image failed, sending text:',
              imageErr?.message || imageErr
            );

            await sock.sendMessage(chatId, {
              text: goodbyeText,
              mentions: [jid]
            });
          }
        } else {
          await sock.sendMessage(chatId, {
            text: goodbyeText,
            mentions: [jid]
          });
        }

        console.log('✅ Goodbye sent');
      }

      return;
    }

    // Only ADD events continue to welcome logic
    if (action !== 'add') {
      return;
    }

    if (!setting.welcome) {
      console.log('🔕 Welcome is OFF for:', chatId);
      return;
    }

    const list = participants || [];

    if (!list.length) {
      return;
    }

    const groupName = 'JAMIL AHMED FAMILY';
    const memberCount = list.length;

    for (const participant of list) {
      const jid =
        participant?.phoneNumber ||
        participant?.id;

      if (!jid) {
        console.log('⚠️ No participant JID found');
        continue;
      }

      const number = String(jid)
        .split(':')[0]
        .split('@')[0];

      const welcomeText =
        '╭❖ 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 ❖╮\n\n' +
        '👑 𝗛𝗘𝗟𝗟𝗢 @' + number + '\n' +
        '✨ 𝗘𝗡𝗝𝗢𝗬 𝗧𝗛𝗘 𝗩𝗜𝗕𝗘!\n' +
        '🏠 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗙𝗔𝗠𝗜𝗟𝗬\n' +
        '👥 𝗠𝗘𝗠𝗕𝗘𝗥𝗦 ─ ' + memberCount + '\n\n' +
        '╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯';

      console.log(
        '👋 Sending welcome to:',
        jid
      );

      // 🖼️ Get new member profile picture
      let profilePic = null;

      try {
        profilePic = await sock.profilePictureUrl(
          jid,
          'image'
        );
      } catch (picErr) {
        console.log(
          '⚠️ Welcome profile picture unavailable:',
          picErr?.message || picErr
        );
      }

      if (profilePic) {
        try {
          await sock.sendMessage(chatId, {
            image: { url: profilePic },
            caption: welcomeText,
            mentions: [jid]
          });

          console.log('🖼️ Welcome + profile picture sent');
        } catch (imageErr) {
          console.log(
            '⚠️ Welcome image failed, sending text:',
            imageErr?.message || imageErr
          );

          await sock.sendMessage(chatId, {
            text: welcomeText,
            mentions: [jid]
          });
        }
      } else {
        await sock.sendMessage(chatId, {
          text: welcomeText,
          mentions: [jid]
        });
      }

      console.log('✅ Welcome sent');
    }

  } catch (err) {
    console.log(
      '❌ Welcome/Goodbye event error:',
      err?.stack || err?.message || err
    );
  }
});


// RANDOM_AUTOREACT_V3
// AUTOREACT_STATE_V3

// AUTOREACT_STATE_V3
const autoReactStateFile = path.resolve('./data/autoreact.json');

function loadAutoReactState() {
  try {
    fs.mkdirSync(path.dirname(autoReactStateFile), {
      recursive: true
    });

    if (!fs.existsSync(autoReactStateFile)) {
      fs.writeFileSync(
        autoReactStateFile,
        JSON.stringify({ enabled: false }, null, 2)
      );
      return false;
    }

    return JSON.parse(
      fs.readFileSync(autoReactStateFile, 'utf8')
    )?.enabled === true;
  } catch (err) {
    console.log(
      '⚠️ AutoReact state load error:',
      err?.message || err
    );
    return false;
  }
}

function saveAutoReactState(enabled) {
  try {
    fs.mkdirSync(path.dirname(autoReactStateFile), {
      recursive: true
    });

    fs.writeFileSync(
      autoReactStateFile,
      JSON.stringify(
        { enabled: Boolean(enabled) },
        null,
        2
      )
    );
  } catch (err) {
    console.log(
      '⚠️ AutoReact state save error:',
      err?.message || err
    );
  }
}

let autoReactEnabled = loadAutoReactState();

const autoReactEmojis = [
  '❤️', '😂', '😍', '🥰', '😎', '🤩', '🔥', '👍',
  '👏', '😮', '😢', '😭', '🤣', '💯', '✨', '🙌',
  '🤍', '🫶', '👑', '🤴', '👸', '🫅', '💎', '🗿',
  '💀', '☠️', '😈', '👻', '⚡', '🥳'
];

function getRandomAutoReact() {
  return autoReactEmojis[
    Math.floor(Math.random() * autoReactEmojis.length)
  ];
}


// STATUSLIKE_PERSISTENT_STATE_V3
const statusLikeFile = path.resolve(
  __dirname,
  'data',
  'statuslike.json'
);

fs.mkdirSync(path.dirname(statusLikeFile), { recursive: true });

let statusLikeEnabled = false;

try {
  if (fs.existsSync(statusLikeFile)) {
    const saved = JSON.parse(
      fs.readFileSync(statusLikeFile, 'utf8')
    );

    statusLikeEnabled = saved.enabled === true;
  }
} catch (err) {
  console.log(
    '⚠️ StatusLike state load failed:',
    err?.message || err
  );
}

function saveStatusLikeState(enabled) {
  try {
    fs.writeFileSync(
      statusLikeFile,
      JSON.stringify(
        {
          enabled: Boolean(enabled)
        },
        null,
        2
      )
    );
  } catch (err) {
    console.log(
      '⚠️ StatusLike state save failed:',
      err?.message || err
    );
  }
}

// STATUSLIKE_ENGINE_V3

sock.ev.on('messages.upsert', async ({ messages }) => {

// AUTOREACT_ENGINE_V3

// AUTOREACT_ENGINE_V3
if (autoReactEnabled) {
  try {
    
// STATUSLIKE_AUTO_ENGINE_V3
try {
  const statusMessage = messages?.[0];

  if (
    statusLikeEnabled &&
    statusMessage?.message &&
    statusMessage.key?.remoteJid === 'status@broadcast' &&
    statusMessage.key?.fromMe !== true &&
    statusMessage.key
  ) {
    await sock.sendMessage(
      'status@broadcast',
      {
        react: {
          text: getRandomAutoReact(),
          key: statusMessage.key
        }
      }
    );

    console.log('🎲 StatusLike: random reaction sent');
  }
} catch (statusLikeErr) {
  console.log(
    '⚠️ StatusLike error:',
    statusLikeErr?.message || statusLikeErr
  );
}

const arMessage = messages?.[0];

    if (
      arMessage?.message &&
      !arMessage.key?.fromMe &&
      arMessage.key?.remoteJid &&
      arMessage.key.remoteJid !== 'status@broadcast'
    ) {
      const randomReaction = getRandomAutoReact();

      await sock.sendMessage(
        arMessage.key.remoteJid,
        {
          react: {
            text: randomReaction,
            key: arMessage.key
          }
        }
      );

      console.log(
        '🎲 AutoReact:',
        randomReaction
      );
    }
  } catch (arErr) {
    console.log(
      '⚠️ AutoReact error:',
      arErr?.message || arErr
    );
  }
}

    try {
      console.log(
        '📩 MESSAGE EVENT:',
        messages?.length || 0
      );

      const msg = messages?.[0];

      if (!msg?.message) {
        console.log('⚠️ Message event received, but no message payload.');
        return;
      }

      console.log(
        '📨 FROM:',
        msg.key?.remoteJid || 'unknown'
      );

      /*
       * Do not reject messages only because fromMe is true.
       * Some LID-based sessions can report the key differently.
       * Commands are handled from the actual message payload.
       */

      
    
    

const chatId = msg.key.remoteJid;
      const settings = getGroupSettings(chatId);

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      const cleanText = text.trim();


// TOP10_MESSAGE_TRACKER_V1_START
// Count every new group message from now on.

try {
  if (
    chatId &&
    chatId.endsWith("@g.us") &&
    msg?.message &&
    !msg.key?.fromMe
  ) {
    const fs = require("fs");
    const pathModule = require("path");

    const statsDir = pathModule.join(
      process.cwd(),
      "data"
    );

    const statsPath = pathModule.join(
      statsDir,
      "message_stats.json"
    );

    if (!fs.existsSync(statsDir)) {
      fs.mkdirSync(statsDir, { recursive: true });
    }

    let stats = {};

    if (fs.existsSync(statsPath)) {
      try {
        stats = JSON.parse(
          fs.readFileSync(statsPath, "utf8")
        );
      } catch {
        stats = {};
      }
    }

    if (!stats[chatId]) {
      stats[chatId] = {};
    }

    const sender =
      msg.key?.participant ||
      msg.participant ||
      "";

    const senderId =
      String(sender)
        .split(":")[0];

    if (senderId) {
      if (!stats[chatId][senderId]) {
        stats[chatId][senderId] = 0;
      }

      stats[chatId][senderId]++;

      fs.writeFileSync(
        statsPath,
        JSON.stringify(stats, null, 2)
      );
    }
  }
} catch (e) {
  console.log(
    "TOP10 tracker error:",
    e?.message || e
  );
}
// TOP10_MESSAGE_TRACKER_V1_END





// JOKE_COMMAND_V3
if (/^\.joke$/i.test(cleanText)) {
  const jokes = [
    '😂 Teacher: Why are you late?\\nStudent: Sir, I followed the sign.\\nTeacher: Which sign?\\nStudent: School Ahead, Go Slow! 😭',
    '🤣 My phone battery and my motivation have one thing in common — both disappear very fast! 🔋😂',
    '😆 Friend: Bro, are you free?\\nMe: Yes.\\nFriend: Great, help me move tomorrow.\\nMe: Actually, I just remembered I am busy. 🏃😂',
    '😂 I told my computer I needed a break... now it keeps showing me vacation ads. 💻🤣',
    '😎 I am not lazy. I am just saving my energy for something important. 🔋😂',
    '🤣 Mom: Why is your room so messy?\\nMe: It is not messy, it is an organized adventure. 😭',
    '😂 Exam: "Do you understand?"\\nMy brain: Absolutely.\\nExam paper: "Prove it."\\nMy brain: Goodbye. 💀',
    '😆 I opened the fridge three times hoping new food would spawn. Still nothing. 🥲😂',
    '🤣 Friend: You changed!\\nMe: Yes, the Wi-Fi password changed too. 📶😂',
    '😂 Sleep is my favorite hobby, but somehow I never have enough time for it. 😴',
    '😎 My wallet is like an onion... opening it makes me cry. 💸😂',
    '🤣 I tried to be normal once. Worst two minutes of my life. 💀',
    '😂 The problem with doing nothing is you never know when you are finished. 😭',
    '😆 My internet connection has more mood swings than I do. 📶🤣',
    '😂 I need a six-month vacation, twice a year. 🌴😎'
  ];

  const joke =
    jokes[Math.floor(Math.random() * jokes.length)];

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗝𝗢𝗞𝗘 𝗧𝗜𝗠𝗘 ❖╮\\n\\n' +
        joke +
        '\\n\\n╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}


// MEME_COMMAND_V3
if (/^\.meme$/i.test(cleanText)) {
  const memes = [
    '😂 যখন বলি “৫ মিনিট পরে আসছি” — ২ ঘণ্টা পরেও আমি পথে আছি... 🗿',
    '🤣 Exam এর আগে: “সব পারি!”\\nExam শুরু: “এই প্রশ্নটা কোন ভাষায়?” 💀',
    '😭 Wi-Fi চলে গেলে বুঝি—জীবনে আসলে কিছুই নেই। 📶💔',
    '😂 মা: ফোনটা একটু দাও।\\nআমি: কেন?\\nমা: শুধু একটু দেখব।\\nMe: আমার শেষ সময় এসে গেছে... 💀',
    '🤣 Online: Active 24/7\\nReal life: Bed এ inactive 😴',
    '😎 টাকা থাকলে সমস্যা কমে না... কিন্তু সমস্যাগুলো দেখতে সুন্দর লাগে। 💸😂',
    '😂 Friend: Bro, পড়তে বসেছিস?\\nMe: হ্যাঁ।\\nFriend: বই কোথায়?\\nMe: সেটা এখনও loading... ⏳🤣',
    '💀 Battery 1% → জীবন শেষ\\nCharger হাতে পেলাম → আবার CEO 😎🔋',
    '🤣 “আমি কাল থেকে serious হব।”\\n— এই কথাটা আমি গত ৫ বছর ধরে বলছি। 😭',
    '😂 যখন কেউ বলে “একটা কথা বলব, রাগ করিস না” — তখনই বুঝি বিপদ আসছে। 💀',
    '😆 Group chat: 500 messages\\nMe: 3 hours later... “কি হইছে?” 👀',
    '🤣 আমার brain: Sleep\\nMy phone: One more video\\nMe: Okay 😭📱',
    '😂 Crush না, এখন শুধু cash দরকার। 💸😎',
    '💀 Teacher: এটা খুব easy question.\\nMe: Sir, আপনার জন্য। 😭',
    '🤣 আমি খুব responsible... তাই সব কাজ শেষ মুহূর্তের জন্য রেখে দিই। ⏳😂'
  ];

  const meme =
    memes[Math.floor(Math.random() * memes.length)];

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗠𝗘𝗠𝗘 𝗧𝗜𝗠𝗘 ❖╮\\n\\n' +
        meme +
        '\\n\\n╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}


// DARE_COMMAND_V3
if (/^\.dare$/i.test(cleanText)) {
  const dares = [
    '😎 Dare: Group এ তোমার সবচেয়ে বেশি ব্যবহার করা emoji পাঠাও!',
    '😂 Dare: ৩০ সেকেন্ড শুধু emoji দিয়ে কথা বলো!',
    '🤣 Dare: নিজের জন্য একটা funny nickname বানাও!',
    '🔥 Dare: Group এ তোমার আজকের mood শুধু ৩টা শব্দে বলো!',
    '😆 Dare: তোমার last used emoji দিয়ে একটা sentence বানাও!',
    '👑 Dare: নিজেকে ১টা funny title দাও!',
    '😂 Dare: Group এ সবচেয়ে funny একটা joke বলো!',
    '😎 Dare: আজকের দিনটাকে একটা movie title দাও!',
    '🤣 Dare: ১০ সেকেন্ডে ৫টা ফলের নাম লিখে ফেলো!',
    '🔥 Dare: তোমার favourite song-এর নাম শুধু emoji দিয়ে বোঝাও!',
    '😆 Dare: নিজের নাম দিয়ে একটা funny rhyme বানাও!',
    '😂 Dare: Group এ “আমি আজ খুব ব্যস্ত” লিখে তারপর ৫ মিনিট online থাকো! 😭',
    '👀 Dare: তোমার favourite colour-এর ৩টা emoji পাঠাও!',
    '🥳 Dare: Group এ সবাইকে একটা positive message দাও!',
    '💯 Dare: নিজের সম্পর্কে একটা মজার কিন্তু harmless fact বলো!'
  ];

  const dare =
    dares[Math.floor(Math.random() * dares.length)];

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗗𝗔𝗥𝗘 𝗧𝗜𝗠𝗘 ❖╮\\n\\n' +
        dare +
        '\\n\\n╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}


// TRUTH_COMMAND_V3
if (/^\.truth$/i.test(cleanText)) {
  const truths = [
    '😄 Truth: তোমার সবচেয়ে বেশি ব্যবহার করা emoji কোনটা?',
    '😂 Truth: Group এ সবচেয়ে বেশি কার সাথে কথা বলো?',
    '😎 Truth: তোমার favourite hobby কী?',
    '🤣 Truth: কখনো ভুল মানুষকে message পাঠিয়েছ?',
    '👀 Truth: তোমার favourite movie কোনটা?',
    '🔥 Truth: কোন গানটা তুমি বারবার শুনতে পারো?',
    '🥳 Truth: তোমার সবচেয়ে memorable day কোনটা?',
    '😂 Truth: তোমার সবচেয়ে funny habit কী?',
    '😆 Truth: কখনো পড়ার বদলে পুরো সময় ফোন ব্যবহার করেছ?',
    '👑 Truth: তুমি নিজের কোন গুণটা সবচেয়ে বেশি পছন্দ করো?',
    '💯 Truth: তোমার dream destination কোথায়?',
    '🤣 Truth: কখনো বন্ধুর joke বুঝতে না পেরে শুধু হেসেছ?',
    '😎 Truth: তোমার favourite food কী?',
    '✨ Truth: কোন skillটা তুমি শিখতে চাও?',
    '😂 Truth: ছোটবেলায় তোমার favourite cartoon কোনটা?'
  ];

  const truth =
    truths[Math.floor(Math.random() * truths.length)];

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗧𝗥𝗨𝗧𝗛 𝗧𝗜𝗠𝗘 ❖╮\\n\\n' +
        truth +
        '\\n\\n╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}


// ROAST_COMMAND_V3
if (/^\.roast$/i.test(cleanText)) {
  const roasts = [
    '😂 তোমার confidence 100%, কিন্তু loading speed 1%! 🗿',
    '🤣 তোমাকে দেখে মনে হয় Wi-Fi full signal, কিন্তু internet নেই! 📶💀',
    '😎 তোমার plan অনেক, execution এখনো loading... ⏳',
    '😂 তুমি এত late reply দাও যে message-ও retirement নিয়ে নেয়! 😭',
    '🤣 তোমার brain-এর RAM আছে, কিন্তু অনেক tab একসাথে open! 🧠💀',
    '😆 তোমার “৫ মিনিট” মানে কোন time zone? 😂',
    '🔥 তুমি এত শান্ত যে alarm-ও তোমাকে উঠাতে ভয় পায়! ⏰🤣',
    '😂 তোমার typing speed দেখে মনে হয় প্রতিটা letter permission নিয়ে আসে! 🐢',
    '🤣 তুমি online থাকো, কিন্তু reply দিলে মনে হয় offline ছিলে! 👻',
    '😎 তোমার attitude premium, কিন্তু network free version! 📶😂',
    '😂 তোমার memory এত selective যে নিজের কাজের কথা মনে থাকে না! 😭',
    '🤣 তুমি এত busy যে নিজের সাথে দেখা করার সময়ও পাও না! 🗿',
    '😆 তোমার phone তোমার থেকে বেশি productive! 📱😂',
    '🔥 তুমি problem solve করো না, problem-কে নতুন problem দাও! 🤣',
    '😂 তোমার logic মাঝে মাঝে airplane mode-এ চলে যায়! ✈️💀'
  ];

  const roast =
    roasts[Math.floor(Math.random() * roasts.length)];

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗥𝗢𝗔𝗦𝗧 𝗧𝗜𝗠𝗘 ❖╮\\n\\n' +
        roast +
        '\\n\\n╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}


// COMPLIMENT_COMMAND_V3
if (/^\.compliment$/i.test(cleanText)) {
  const compliments = [
    '✨ তোমার positive energy সত্যিই আলাদা!',
    '😎 তোমার confidence অনেক সুন্দর একটা quality!',
    '🔥 তোমার vibe সবসময়ই energetic মনে হয়!',
    '👑 নিজের মতো থাকতে পারাটাই তোমার একটা strong quality!',
    '💯 তুমি চেষ্টা করলে অনেক কিছুই করতে পারো!',
    '🌟 তোমার creativity সত্যিই impressive!',
    '😊 তোমার friendly attitude মানুষকে comfortable করে!',
    '✨ তোমার হাসি পুরো moodটাই ভালো করে দিতে পারে!',
    '🫶 তুমি যেভাবে অন্যদের respect করো, সেটা প্রশংসার যোগ্য!',
    '😎 তোমার personality-তে একটা আলাদা charm আছে!',
    '🔥 তোমার determination সত্যিই inspiring!',
    '👑 তুমি নিজের goals নিয়ে serious হলে অনেক দূর যেতে পারবে!',
    '💎 তোমার uniqueness-টাই তোমার সবচেয়ে সুন্দর দিক!',
    '🌟 তোমার positive mindset ধরে রাখো—এটাই তোমার strength!',
    '🥳 তোমার presence group-এর vibe আরও fun করে!'
  ];

  const compliment =
    compliments[
      Math.floor(Math.random() * compliments.length)
    ];

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗖𝗢𝗠𝗣𝗟𝗜𝗠𝗘𝗡𝗧 ❖╮\\n\\n' +
        compliment +
        '\\n\\n╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}


// FORTUNE_COMMAND_V3
if (/^\.fortune$/i.test(cleanText)) {
  const fortunes = [
    '🍀 আজকের lucky vibe: নতুন কিছু শেখার জন্য দারুণ সময়!',
    '✨ Fortune: আজ ছোট একটা ভালো কাজ তোমার mood ভালো করে দিতে পারে।',
    '🌟 Fortune: ধৈর্য ধরে এগিয়ে গেলে তোমার কাজ আরও সুন্দরভাবে এগোবে।',
    '🔥 Fortune: আজকের challenge-টা confidence নিয়ে handle করো!',
    '💎 Fortune: তোমার creativity আজ কাজে লাগতে পারে।',
    '😎 Fortune: আজ নিজের goal-এর দিকে একটা ছোট step নাও।',
    '🌈 Fortune: ভালো একটা surprise তোমার দিনটাকে আরও fun করতে পারে!',
    '👑 Fortune: আজ leadership দেখানোর একটা সুযোগ আসতে পারে।',
    '⚡ Fortune: energy ভালোভাবে ব্যবহার করলে অনেক কাজ শেষ করতে পারবে!',
    '🥳 Fortune: আজ হাসি-আনন্দের একটা moment আসতেই পারে!',
    '🌟 Fortune: পুরোনো কোনো idea আবার নতুনভাবে কাজে লাগতে পারে।',
    '🍀 Fortune: আজ lucky number নয়—lucky action গুরুত্বপূর্ণ!',
    '✨ Fortune: নিজের ওপর বিশ্বাস রাখো এবং ধীরে ধীরে এগিয়ে যাও।',
    '🔥 Fortune: আজকের best move হতে পারে—হাল না ছাড়া!',
    '💯 Fortune: ছোট progress-ও progress—আজ সেটাই celebrate করো!'
  ];

  const fortune =
    fortunes[Math.floor(Math.random() * fortunes.length)];

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗙𝗢𝗥𝗧𝗨𝗡𝗘 ❖╮\\n\\n' +
        fortune +
        '\\n\\n╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}



// RIDDLE_COMMAND_V3
let lastRiddleAnswer = '';

if (/^\.riddle$/i.test(cleanText)) {
  const riddles = [
    ['কোন জিনিসের চাবি আছে, কিন্তু কোনো তালা খুলতে পারে না?', 'কীবোর্ড'],
    ['কোন জিনিসের হাত আছে, কিন্তু তালি দিতে পারে না?', 'ঘড়ি'],
    ['কোন জিনিস শুকাতে গেলে আরও ভিজে যায়?', 'তোয়ালে'],
    ['কোন জিনিসের একটি চোখ আছে, কিন্তু দেখতে পারে না?', 'সুঁই'],
    ['কোন জিনিসের গলা আছে, কিন্তু মাথা নেই?', 'বোতল'],
    ['কোন জিনিস এক কোণে থেকেও সারা পৃথিবী ঘুরতে পারে?', 'ডাকটিকিট'],
    ['কোন জিনিসের অনেক দাঁত আছে, কিন্তু কামড়াতে পারে না?', 'চিরুনি'],
    ['কোন জিনিস নিচে নামে, কিন্তু কখনো উপরে ওঠে না?', 'বৃষ্টি'],
    ['কোন জিনিসের অনেক কথা আছে, কিন্তু কথা বলতে পারে না?', 'বই'],
    ['কোন জিনিসের পা আছে, কিন্তু হাঁটতে পারে না?', 'টেবিল'],
    ['কোন জিনিসে অনেক ছিদ্র আছে, তবুও পানি ধরে রাখতে পারে?', 'স্পঞ্জ'],
    ['কোন জিনিসের মুখ ও দুই হাত আছে, কিন্তু হাত-পা নেই?', 'ঘড়ি'],
    ['কোন জিনিস ধরতে পারো, কিন্তু ছুঁড়ে দিতে পারো না?', 'সর্দি'],
    ['কোন জিনিস শুধু বাড়তেই থাকে, কখনো কমে না?', 'বয়স'],
    ['কোন জিনিসের একটি বৃদ্ধাঙ্গুলি ও চারটি আঙুল আছে, কিন্তু জীবিত নয়?', 'দস্তানা']
  ];

  const selected =
    riddles[Math.floor(Math.random() * riddles.length)];

  lastRiddleAnswer = selected[1];

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗥𝗜𝗗𝗗𝗟𝗘 𝗧𝗜𝗠𝗘 ❖╮\n\n' +
        '🧩 ধাঁধা:\n\n' +
        selected[0] +
        '\n\n' +
        '💡 উত্তর জানতে পরে ব্যবহার করুন:\n' +
        '.riddleanswer\n\n' +
        '╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}

if (/^\.riddleanswer$/i.test(cleanText)) {
  if (!lastRiddleAnswer) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ আগে .riddle দিয়ে একটি ধাঁধা নিন!'
      },
      { quoted: msg }
    );
    return;
  }

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗥𝗜𝗗𝗗𝗟𝗘 𝗔𝗡𝗦𝗪𝗘𝗥 ❖╮\n\n' +
        '💡 উত্তর: ' +
        lastRiddleAnswer +
        '\n\n' +
        '╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}


// RATE_COMMAND_V3
if (/^\.rate$/i.test(cleanText)) {
  const ratings = [
    ['🔥 আজকের ভাইব', '৯৫%'],
    ['😎 আজকের কুলনেস', '৯২%'],
    ['⚡ আজকের এনার্জি', '৯৮%'],
    ['😂 আজকের ফান', '৯১%'],
    ['✨ আজকের লাক', '৮৭%'],
    ['💯 আজকের অ্যাক্টিভনেস', '৯৬%'],
    ['👑 আজকের বস মুড', '৯৪%'],
    ['🚀 আজকের স্পিড', '৯৯%'],
    ['🎯 আজকের ফোকাস', '৯০%'],
    ['🥳 আজকের মুড', '৯৭%']
  ];

  const selected =
    ratings[Math.floor(Math.random() * ratings.length)];

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗙𝗨𝗡 𝗥𝗔𝗧𝗜𝗡𝗚 ❖╮\n\n' +
        '🎲 আজকের Random Rating\n\n' +
        selected[0] + ' ─ ' + selected[1] +
        '\n\n' +
        '😄 এটা শুধু মজার জন্য!\n\n' +
        '╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}


// DICE_COMMAND_V3
if (/^\.dice$/i.test(cleanText)) {
  const diceNumber =
    Math.floor(Math.random() * 6) + 1;

  const diceFaces = {
    1: '⚀',
    2: '⚁',
    3: '⚂',
    4: '⚃',
    5: '⚄',
    6: '⚅'
  };

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗗𝗜𝗖𝗘 𝗥𝗢𝗟𝗟 ❖╮\n\n' +
        '🎲 পাশা ঘোরানো হয়েছে!\n\n' +
        diceFaces[diceNumber] +
        ' 𝗙𝗮𝗰𝗲 ─ ' +
        diceNumber +
        '\n\n' +
        '✨ আবার খেলতে .dice লিখুন!\n\n' +
        '╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}


// SLOT_COMMAND_V3
if (/^\.slot$/i.test(cleanText)) {
  const emojis = ['🍎', '🍋', '🍉', '🍇', '🥝', '🍒'];

  const a = emojis[Math.floor(Math.random() * emojis.length)];
  const b = emojis[Math.floor(Math.random() * emojis.length)];
  const c = emojis[Math.floor(Math.random() * emojis.length)];

  let result;

  if (a === b && b === c) {
    result = '🎉 তিনটিই মিলে গেছে! দারুণ!';
  } else if (a === b || b === c || a === c) {
    result = '✨ দুইটা মিলেছে! ভালো হয়েছে!';
  } else {
    result = '😄 এবার মেলেনি! আবার চেষ্টা করো।';
  }

  await sock.sendMessage(
    chatId,
    {
      text:
        '╭❖ 𝗘𝗠𝗢𝗝𝗜 𝗠𝗔𝗧𝗖𝗛 ❖╮\n\n' +
        '🎰 ' + a + '  |  ' + b + '  |  ' + c + '\n\n' +
        result +
        '\n\n' +
        '🎮 আবার খেলতে .slot লিখুন!\n\n' +
        '╰❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖╯'
    },
    { quoted: msg }
  );

  return;
}




// NAMAZTIME_COMMAND_V3
if (/^\.namaztime$/i.test(cleanText)) {

  if (!chatId || !chatId.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ 𝗧𝗵𝗶𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱 𝗶𝘀 𝗳𝗼𝗿 𝗴𝗿𝗼𝘂𝗽𝘀 𝗼𝗻𝗹𝘆.'
      },
      { quoted: msg }
    );
    return;
  }

  try {

    // Confirmation reaction on .namaztime command
    try {
      await sock.sendMessage(
        chatId,
        {
          react: {
            text: '🕌',
            key: msg.key
          }
        }
      );
    } catch (reactErr) {
      console.log(
        '⚠️ NamazTime reaction error:',
        reactErr?.message || reactErr
      );
    }

    // Close group
    await sock.groupSettingUpdate(
      chatId,
      'announcement'
    );

    // Premium Namaz message
    const namazMessage = await sock.sendMessage(
      chatId,
      {
        text:
          '╭─❖ 🕌 𝗡𝗔𝗠𝗔𝗭 𝗧𝗜𝗠𝗘 ❖─╮\n\n' +
          '🤲 𝗜𝘁\'𝘀 𝗡𝗮𝗺𝗮𝘇 𝗧𝗶𝗺𝗲\n\n' +
          '🕌 𝗣𝗹𝗲𝗮𝘀𝗲 𝗣𝗿𝗲𝗽𝗮𝗿𝗲 𝗳𝗼𝗿 𝗡𝗮𝗺𝗮𝘇\n' +
          '🤍 𝗥𝗲𝗺𝗲𝗺𝗯𝗲𝗿 𝗔𝗹𝗹𝗮𝗵\n' +
          '📿 𝗡𝗮𝗺𝗮𝘇 𝗶𝘀 𝗣𝗿𝗲𝗰𝗶𝗼𝘂𝘀\n\n' +
          '🔒 𝗚𝗿𝗼𝘂𝗽 𝗖𝗹𝗼𝘀𝗲𝗱 𝗳𝗼𝗿 𝗡𝗮𝗺𝗮𝘇\n\n' +
          '⏰ 𝗪𝗶𝗹𝗹 𝗢𝗽𝗲𝗻 𝗔𝗳𝘁𝗲𝗿 𝗡𝗮𝗺𝗮𝘇\n\n' +
          '╰─❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖─╯'
      },
      { quoted: msg }
    );

    // Reaction on bot's Namaz message
    if (namazMessage?.key) {
      try {
        await sock.sendMessage(
          chatId,
          {
            react: {
              text: '🕌',
              key: namazMessage.key
            }
          }
        );
      } catch (reactErr) {
        console.log(
          '⚠️ Namaz message reaction error:',
          reactErr?.message || reactErr
        );
      }
    }

    console.log('🕌 NamazTime: group closed successfully');

  } catch (err) {

    console.log(
      '❌ NamazTime error:',
      err?.message || err
    );

    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗡𝗮𝗺𝗮𝘇 𝗧𝗶𝗺𝗲 𝗳𝗮𝗶𝗹𝗲𝗱.\n\n' +
          '⚠️ 𝗕𝗼𝘁 𝗺𝘂𝘀𝘁 𝗯𝗲 𝗮 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻.'
      },
      { quoted: msg }
    );
  }

  return;
}


// NAMAZTIME_END_COMMAND_V3
if (/^\.namaztime\s+end$/i.test(cleanText)) {

  if (!chatId || !chatId.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ 𝗧𝗵𝗶𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱 𝗶𝘀 𝗳𝗼𝗿 𝗴𝗿𝗼𝘂𝗽𝘀 𝗼𝗻𝗹𝘆.'
      },
      { quoted: msg }
    );
    return;
  }

  try {

    // Confirmation reaction
    try {
      await sock.sendMessage(
        chatId,
        {
          react: {
            text: '🕌',
            key: msg.key
          }
        }
      );
    } catch (reactErr) {
      console.log(
        '⚠️ NamazTime End reaction error:',
        reactErr?.message || reactErr
      );
    }

    // Open group
    await sock.groupSettingUpdate(
      chatId,
      'not_announcement'
    );

    const endMessage = await sock.sendMessage(
      chatId,
      {
        text:
          '╭─❖ 🔓 𝗡𝗔𝗠𝗔𝗭 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘 ❖─╮\n\n' +
          '🤲 𝗡𝗮𝗺𝗮𝘇 𝗶𝘀 𝗖𝗼𝗺𝗽𝗹𝗲𝘁𝗲\n\n' +
          '🕌 𝗠𝗮𝘆 𝗔𝗹𝗹𝗮𝗵 𝗔𝗰𝗰𝗲𝗽𝘁 𝗢𝘂𝗿 𝗡𝗮𝗺𝗮𝘇\n' +
          '🤍 𝗠𝗮𝘆 𝗔𝗹𝗹𝗮𝗵 𝗕𝗹𝗲𝘀𝘀 𝗘𝘃𝗲𝗿𝘆𝗼𝗻𝗲\n\n' +
          '🔓 𝗚𝗿𝗼𝘂𝗽 𝗜𝘀 𝗡𝗼𝘄 𝗢𝗽𝗲𝗻\n' +
          '💬 𝗬𝗼𝘂 𝗖𝗮𝗻 𝗡𝗼𝘄 𝗦𝗲𝗻𝗱 𝗠𝗲𝘀𝘀𝗮𝗴𝗲𝘀\n\n' +
          '╰─❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖─╯'
      },
      { quoted: msg }
    );

    // Reaction on bot message
    if (endMessage?.key) {
      try {
        await sock.sendMessage(
          chatId,
          {
            react: {
              text: '🔓',
              key: endMessage.key
            }
          }
        );
      } catch (reactErr) {
        console.log(
          '⚠️ Namaz end message reaction error:',
          reactErr?.message || reactErr
        );
      }
    }

    console.log('🔓 NamazTime End: group opened successfully');

  } catch (err) {

    console.log(
      '❌ NamazTime End error:',
      err?.message || err
    );

    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗙𝗮𝗶𝗹𝗲𝗱 𝘁𝗼 𝗼𝗽𝗲𝗻 𝘁𝗵𝗲 𝗴𝗿𝗼𝘂𝗽.\n\n' +
          '⚠️ 𝗕𝗼𝘁 𝗺𝘂𝘀𝘁 𝗯𝗲 𝗮 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻.'
      },
      { quoted: msg }
    );
  }

  return;
}


// SURAH_AUDIO_COMMAND_V3
if (/^\.surah\s+(\d{1,3})$/i.test(cleanText)) {

  const surahNumber = Number(
    cleanText.match(/^\.surah\s+(\d{1,3})$/i)[1]
  );

  if (surahNumber < 1 || surahNumber > 114) {
    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗦𝘂𝗿𝗮𝗵 𝗻𝘂𝗺𝗯𝗲𝗿 𝗺𝘂𝘀𝘁 𝗯𝗲𝘁𝘄𝗲𝗲𝗻 𝟭 𝗮𝗻𝗱 𝟭𝟭𝟰.'
      },
      { quoted: msg }
    );
    return;
  }

  const surahFile = path.resolve(
    config.DOWNLOAD_DIR || './downloads',
    `surah_${surahNumber}_${Date.now()}.mp3`
  );

  let statusMessage = null;

  try {

    statusMessage = await sock.sendMessage(
      chatId,
      {
        text: '⬇️ 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱𝗶𝗻𝗴...'
      },
      { quoted: msg }
    );

    const audioUrl =
      `https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/${surahNumber}.mp3`;

    const response = await fetch(audioUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    if (!buffer.length) {
      throw new Error('Empty audio');
    }

    fs.writeFileSync(surahFile, buffer);

    // Download শেষ হলে আগের message edit
    if (statusMessage?.key) {
      await sock.sendMessage(
        chatId,
        {
          text: '✅ 𝗔𝘂𝗱𝗶𝗼 𝗦𝗲𝗻𝘁',
          edit: statusMessage.key
        }
      );
    }

    // Send audio
    await sock.sendMessage(
      chatId,
      {
        audio: fs.readFileSync(surahFile),
        mimetype: 'audio/mpeg',
        fileName: `Surah-${surahNumber}.mp3`,
        ptt: false,
        caption:
          '🤍 𝗝𝗮𝗺𝗶𝗹 𝗔𝗵𝗺𝗲𝗱\n\n' +
          `🕌 𝗦𝘂𝗿𝗮𝗵 : ${surahNumber}\n` +
          '✨ 𝗦𝘂𝗿𝗮𝗵 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱𝗲𝗱\n' +
          '📖 𝗦𝘂𝗿𝗮𝗵 𝗔𝘂𝗱𝗶𝗼 ✅'
      },
      { quoted: msg }
    );

    console.log(`🕌 Surah ${surahNumber} audio sent`);

  } catch (err) {

    console.log(
      '❌ Surah error:',
      err?.message || err
    );

    if (statusMessage?.key) {
      try {
        await sock.sendMessage(
          chatId,
          {
            text: '❌ 𝗔𝘂𝗱𝗶𝗼 𝗦𝗲𝗻𝗱 𝗙𝗮𝗶𝗹𝗲𝗱',
            edit: statusMessage.key
          }
        );
      } catch {}
    }

  } finally {

    try {
      if (fs.existsSync(surahFile)) {
        fs.unlinkSync(surahFile);
      }
    } catch {}

  }

  return;
}

if (/^\.surah$/i.test(cleanText)) {

  await sock.sendMessage(
    chatId,
    {
      text:
        '📖 𝗦𝗲𝗻𝗱 𝗦𝘂𝗿𝗮𝗵 𝗡𝘂𝗺𝗯𝗲𝗿\n\n' +
        'Example:\n' +
        '.surah 1\n' +
        '.surah 36\n' +
        '.surah 112\n\n' +
        '🔢 𝗔𝘃𝗮𝗶𝗹𝗮𝗯𝗹𝗲: 1-114'
    },
    { quoted: msg }
  );

  return;
}


// MAGIC_COMMAND_V3
if (/^\.magic(?:\s+.*)?$/i.test(cleanText)) {

  const magicEmojis = [
    '🤧', '🎀', '👀', '😂', '🔥',
    '😎', '🤍', '😭', '🤣', '😈',
    '🥶', '✨', '🙈', '🤭', '😳'
  ];

  let targetJid = null;

  // Get mentioned user
  const mentioned =
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    [];

  if (mentioned.length > 0) {
    targetJid = mentioned[0];
  }

  // Get replied user
  if (!targetJid) {
    const context =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      msg.message?.documentMessage?.contextInfo ||
      {};

    targetJid = context.participant || null;
  }

  // No target
  if (!targetJid || !targetJid.includes('@')) {

    await sock.sendMessage(
      chatId,
      {
        text:
          '✨ 𝗠𝗔𝗚𝗜𝗖\n\n' +
          '👤 একজনকে reply করে `.magic` লিখুন\n' +
          'অথবা `.magic @user` ব্যবহার করুন।'
      },
      { quoted: msg }
    );

    return;
  }

  const displayNumber = targetJid.split('@')[0];

  try {

    // 🪄 Confirmation reaction on the .magic command
    try {
      await sock.sendMessage(
        chatId,
        {
          react: {
            text: '🪄',
            key: msg.key
          }
        }
      );
    } catch (reactionErr) {
      console.log(
        '⚠️ Magic reaction error:',
        reactionErr?.message || reactionErr
      );
    }

    // Random 10-15 messages
    const totalMessages =
      Math.floor(Math.random() * 6) + 10;

    // Shuffle emojis
    const shuffled = [...magicEmojis].sort(
      () => Math.random() - 0.5
    );

    for (let i = 0; i < totalMessages; i++) {

      const emoji =
        shuffled[i % shuffled.length];

      // IMPORTANT:
      // No quoted message here.
      // So these messages will NOT appear
      // as replies to .magic.
      await sock.sendMessage(
        chatId,
        {
          text: `${emoji} @${displayNumber}`,
          mentions: [targetJid]
        }
      );

      // Small delay
      await new Promise(resolve =>
        setTimeout(resolve, 500)
      );
    }

    console.log(
      `✨ Magic sent ${totalMessages} serial messages to ${targetJid}`
    );

  } catch (err) {

    console.log(
      '❌ Magic command error:',
      err?.message || err
    );

  }

  return;
}

// PING_COMMAND_V3
if (/^\.ping$/i.test(cleanText)) {

  await sock.sendMessage(chatId, {
    react: {
      text: '🏓',
      key: msg.key
    }
  }).catch(() => {});

  const start = Date.now();

  try {
    const sent = await sock.sendMessage(
      chatId,
      { text: '🏓 𝗣𝗶𝗻𝗴...' },
      { quoted: msg }
    );

    const ping = Date.now() - start;

    await sock.sendMessage(
      chatId,
      {
        text: `🏓 𝗣𝗼𝗻𝗴! ⚡ ${ping}ms 🚀 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧`
      }
    );
  } catch (err) {
    console.log('❌ Ping error:', err?.message || err);
  }

  return;
}

// STATUSLIKE_COMMAND_ENGINE_V3
const statusLikeCommand = cleanText.match(
  /^\.statuslike(?:\s+(on|off|status))?$/i
);

if (statusLikeCommand) {
  const action =
    (statusLikeCommand[1] || 'status').toLowerCase();

  if (action === 'status') {
    await sock.sendMessage(
      chatId,
      {
        text: statusLikeEnabled
          ? '❤️ 𝗦𝗧𝗔𝗧𝗨𝗦𝗟𝗜𝗞𝗘 ─ 🟢 𝗢𝗡'
          : '❤️ 𝗦𝗧𝗔𝗧𝗨𝗦𝗟𝗜𝗞𝗘 ─ 🔴 𝗢𝗙𝗙'
      },
      { quoted: msg }
    );

    return;
  }

  let statusAllowed = false;

  if (chatId?.endsWith('@g.us')) {
    const slSender =
      msg.key?.participant ||
      msg.participant ||
      msg.key?.remoteJid;

    try {
      const metadata =
        await sock.groupMetadata(chatId);

      const participant =
        metadata?.participants?.find(
          item =>
            item?.id === slSender ||
            item?.phoneNumber === slSender ||
            item?.jid === slSender
        );

      statusAllowed =
        participant?.admin === 'admin' ||
        participant?.admin === 'superadmin' ||
        participant?.isAdmin === true ||
        participant?.isSuperAdmin === true;
    } catch (err) {
      console.log(
        '⚠️ StatusLike admin check:',
        err?.message || err
      );
    }
  }

  if (!statusAllowed) {
    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗢𝗻𝗹𝘆 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻𝘀 𝗰𝗮𝗻 𝗰𝗵𝗮𝗻𝗴𝗲 𝗦𝘁𝗮𝘁𝘂𝘀𝗟𝗶𝗸𝗲.'
      },
      { quoted: msg }
    );

    return;
  }

  if (action === 'on') {
    statusLikeEnabled = true;
    saveStatusLikeState(true);

    const statusLikeConfirmation =
      await sock.sendMessage(
        chatId,
        {
          text:
            '❤️ 𝗦𝗧𝗔𝗧𝗨𝗦𝗟𝗜𝗞𝗘 𝗘𝗡𝗔𝗕𝗟𝗘𝗗 🟢\n\n' +
            '👀 𝗡𝗲𝘄 𝗦𝘁𝗮𝘁𝘂𝘀 𝗪𝗶𝗹𝗹 𝗚𝗲𝘁 ❤️ 𝗥𝗲𝗮𝗰𝘁𝗶𝗼𝗻\n' +
            '💾 𝗦𝗲𝘁𝘁𝗶𝗻𝗴 𝗪𝗶𝗹𝗹 𝗦𝘁𝗮𝘆 𝗢𝗡 𝗔𝗳𝘁𝗲𝗿 𝗥𝗲𝘀𝘁𝗮𝗿𝘁'
        },
        { quoted: msg }
      );

    try {
      if (statusLikeConfirmation?.key) {
        await sock.sendMessage(
          chatId,
          {
            react: {
              text: '✅',
              key: statusLikeConfirmation.key
            }
          }
        );
      }
    } catch (reactErr) {
      console.log(
        '⚠️ StatusLike confirmation reaction failed:',
        reactErr?.message || reactErr
      );
    }

    return;
  }

  if (action === 'off') {
    statusLikeEnabled = false;
    saveStatusLikeState(false);

    const statusLikeOffConfirmation =
      await sock.sendMessage(
        chatId,
        {
          text:
            '❤️ 𝗦𝗧𝗔𝗧𝗨𝗦𝗟𝗜𝗞𝗘 𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗 🔴'
        },
        { quoted: msg }
      );

    try {
      if (statusLikeOffConfirmation?.key) {
        await sock.sendMessage(
          chatId,
          {
            react: {
              text: '✅',
              key: statusLikeOffConfirmation.key
            }
          }
        );
      }
    } catch (reactErr) {
      console.log(
        '⚠️ StatusLike OFF confirmation reaction failed:',
        reactErr?.message || reactErr
      );
    }

    return;
  }
}

// AUTOREACT_COMMAND_ENGINE_V3

// AUTOREACT_COMMAND_ENGINE_V3
const autoReactCommand = cleanText.match(
  /^\.autoreact(?:\s+(on|off|status))?$/i
);

if (autoReactCommand) {
  const action =
    (autoReactCommand[1] || 'status').toLowerCase();

  if (action === 'status') {
    await sock.sendMessage(
      chatId,
      {
        text: autoReactEnabled
          ? '🤖 𝗔𝗨𝗧𝗢𝗥𝗘𝗔𝗖𝗧 ─ 🟢 𝗢𝗡'
          : '🤖 𝗔𝗨𝗧𝗢𝗥𝗘𝗔𝗖𝗧 ─ 🔴 𝗢𝗙𝗙'
      },
      { quoted: msg }
    );
    return;
  }

  let allowed = false;

  if (chatId?.endsWith('@g.us')) {
    const arSender =
      msg.key?.participant ||
      msg.participant ||
      msg.key?.remoteJid;

    try {
      const metadata =
        await sock.groupMetadata(chatId);

      const participant =
        metadata?.participants?.find(
          item =>
            item?.id === arSender ||
            item?.phoneNumber === arSender ||
            item?.jid === arSender
        );

      allowed =
        participant?.admin === 'admin' ||
        participant?.admin === 'superadmin' ||
        participant?.isAdmin === true ||
        participant?.isSuperAdmin === true;
    } catch (err) {
      console.log(
        '⚠️ AutoReact admin check:',
        err?.message || err
      );
    }
  }

  if (!allowed) {
    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗢𝗻𝗹𝘆 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻𝘀 𝗰𝗮𝗻 𝗰𝗵𝗮𝗻𝗴𝗲 𝗔𝘂𝘁𝗼𝗥𝗲𝗮𝗰𝘁.'
      },
      { quoted: msg }
    );
    return;
  }

  if (action === 'on') {
    autoReactEnabled = true;
    saveAutoReactState(true);

    const autoReactConfirmation = await sock.sendMessage(
      chatId,
      {
        text:
          '🤖 𝗔𝗨𝗧𝗢𝗥𝗘𝗔𝗖𝗧 𝗘𝗡𝗔𝗕𝗟𝗘𝗗 🟢\n\n' +
          '🎲 𝗥𝗮𝗻𝗱𝗼𝗺 𝗿𝗲𝗮𝗰𝘁𝗶𝗼𝗻 𝗺𝗼𝗱𝗲 𝗶𝘀 𝗔𝗖𝗧𝗜𝗩𝗘!\n' +
          '👑 💀 🗿 ⚡ 🔥 😈 ✨'
      },
      { quoted: msg }
    );

    // React to the AutoReact ON confirmation itself
    try {
      if (autoReactConfirmation?.key) {
        await sock.sendMessage(chatId, {
          react: {
            text: '✅',
            key: autoReactConfirmation.key
          }
        });
      }
    } catch (reactErr) {
      console.log(
        '⚠️ AutoReact confirmation reaction failed:',
        reactErr?.message || reactErr
      );
    }

    return;
  }

  if (action === 'off') {
    autoReactEnabled = false;
    saveAutoReactState(false);

    await sock.sendMessage(
      chatId,
      {
        text:
          '🤖 𝗔𝗨𝗧𝗢𝗥𝗘𝗔𝗖𝗧 𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗 🔴'
      },
      { quoted: msg }
    );
    return;
  }
}

// GOODBYE_COMMAND_V3
if (/^\.goodbye(?:\s+(on|off))?$/i.test(cleanText)) {
  try {
    if (!chatId.endsWith('@g.us')) {
      await sock.sendMessage(
        chatId,
        { text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬' },
        { quoted: msg }
      );
      return;
    }

    const metadata = await sock.groupMetadata(chatId);

    const sender = metadata.participants?.find(
      p => p.id === msg.key.participant
    );

    if (!sender?.admin) {
      await sock.sendMessage(
        chatId,
        { text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬' },
        { quoted: msg }
      );
      return;
    }

    const setting = getGroupSettings(chatId);
    const mode =
      cleanText.trim().split(/\s+/)[1]?.toLowerCase();

    if (!mode) {
      await sock.sendMessage(
        chatId,
        {
          text:
            '👋 𝗚𝗢𝗢𝗗𝗕𝗬𝗘 𝗦𝗬𝗦𝗧𝗘𝗠\n\n' +
            `📌 Status ─ ${setting.goodbye ? 'ON 🟢' : 'OFF 🔴'}\n\n` +
            'Use:\n' +
            '• .goodbye on\n' +
            '• .goodbye off'
        },
        { quoted: msg }
      );
      return;
    }

    if (mode !== 'on' && mode !== 'off') {
      await sock.sendMessage(
        chatId,
        {
          text:
            '❌ 𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗨𝗦𝗔𝗚𝗘\n\n' +
            'Use:\n' +
            '• .goodbye on\n' +
            '• .goodbye off'
        },
        { quoted: msg }
      );
      return;
    }

    setting.goodbye = mode === 'on';
    saveGroupSettings();

    await sock.sendMessage(
      chatId,
      {
        react: {
          text: setting.goodbye ? '👋' : '🔕',
          key: msg.key
        }
      }
    ).catch(() => {});

    await sock.sendMessage(
      chatId,
      {
        text: setting.goodbye
          ? '👋 𝗚𝗢𝗢𝗗𝗕𝗬𝗘 𝗘𝗡𝗔𝗕𝗟𝗘𝗗 🟢'
          : '🔕 𝗚𝗢𝗢𝗗𝗕𝗬𝗘 𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗 🔴'
      },
      { quoted: msg }
    );

  } catch (err) {
    console.log(
      'Goodbye command error:',
      err?.message || err
    );

    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗚𝗢𝗢𝗗𝗕𝗬𝗘 𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
          `${err?.message || 'Unknown error'}`
      },
      { quoted: msg }
    ).catch(() => {});
  }

  return;
}


    
    // WELCOME_SYSTEM_V3
    if (/^\.welcome(?:\s+(on|off))?$/i.test(cleanText)) {
      try {
        if (!chatId.endsWith('@g.us')) {
          await sock.sendMessage(
            chatId,
            { text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬' },
            { quoted: msg }
          );
          return;
        }

        const metadata = await sock.groupMetadata(chatId);

        const sender = metadata.participants?.find(
          p => p.id === msg.key.participant
        );

        if (!sender?.admin) {
          await sock.sendMessage(
            chatId,
            { text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬' },
            { quoted: msg }
          );
          return;
        }

        const botId = sock.user?.id || '';
        const botLid = sock.user?.lid || '';

        const cleanJid = jid =>
          String(jid || '')
            .split(':')[0]
            .split('@')[0];

        const botNumber = cleanJid(botId);
        const botLidNumber = cleanJid(botLid);

        const botParticipant =
          metadata.participants?.find(p => {
            const id = p.id || '';
            const number = cleanJid(id);

            return (
              id === botId ||
              id === botLid ||
              number === botNumber ||
              (botLidNumber && number === botLidNumber)
            );
          });

        if (!botParticipant?.admin) {
          await sock.sendMessage(
            chatId,
            {
              text:
                '⚠️ 𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡 𝗥𝗘𝗤𝗨𝗜𝗥𝗘𝗗\n\n' +
                '🤖 𝗕𝗼𝘁-কে group admin করতে হবে।'
            },
            { quoted: msg }
          );
          return;
        }

        const setting = getGroupSettings(chatId);

        const mode =
          cleanText.trim().split(/\s+/)[1]?.toLowerCase();

        if (!mode) {
          const status = setting.welcome ? 'ON 🟢' : 'OFF 🔴';

          await sock.sendMessage(
            chatId,
            {
              text:
                '👋 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗦𝗬𝗦𝗧𝗘𝗠\n\n' +
                `📌 Status ─ ${status}\n\n` +
                'Use:\n' +
                '• .welcome on\n' +
                '• .welcome off'
            },
            { quoted: msg }
          );

          return;
        }

        if (mode !== 'on' && mode !== 'off') {
          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗨𝗦𝗔𝗚𝗘\n\n' +
                'Use:\n' +
                '• .welcome on\n' +
                '• .welcome off'
            },
            { quoted: msg }
          );
          return;
        }

        setting.welcome = mode === 'on';
        saveGroupSettings();

        await sock.sendMessage(
          chatId,
          {
            react: {
              text: setting.welcome ? '👋' : '🔕',
              key: msg.key
            }
          }
        ).catch(() => {});

        await sock.sendMessage(
          chatId,
          {
            text: setting.welcome
              ? '👋 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗘𝗡𝗔𝗕𝗟𝗘𝗗 🟢'
              : '🔕 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗 🔴'
          },
          { quoted: msg }
        );

      } catch (err) {
        console.log(
          'Welcome command error:',
          err?.message || err
        );

        await sock.sendMessage(
          chatId,
          {
            text:
              '❌ 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
              `${err?.message || 'Unknown error'}`
          },
          { quoted: msg }
        ).catch(() => {});
      }

      return;
    }


// TAGALL_COMMAND_V3
    if (cleanText.trim().toLowerCase().startsWith('.tagall')) {
      try {
        if (!chatId.endsWith('@g.us')) {
          await sock.sendMessage(
            chatId,
            { text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬' },
            { quoted: msg }
          );
          return;
        }

        const metadata = await sock.groupMetadata(chatId);

        const sender = metadata.participants?.find(
          p => p.id === msg.key.participant
        );

        if (!sender?.admin) {
          await sock.sendMessage(
            chatId,
            { text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬' },
            { quoted: msg }
          );
          return;
        }

        const cleanJid = jid =>
          String(jid || '')
            .split(':')[0]
            .split('@')[0];

        const botId = sock.user?.id || '';
        const botLid = sock.user?.lid || '';

        const botNumber = cleanJid(botId);
        const botLidNumber = cleanJid(botLid);

        const botParticipant =
          metadata.participants?.find(p => {
            const id = p.id || '';
            const number = cleanJid(id);

            return (
              id === botId ||
              id === botLid ||
              number === botNumber ||
              (botLidNumber && number === botLidNumber)
            );
          });

        if (!botParticipant?.admin) {
          await sock.sendMessage(
            chatId,
            {
              text:
                '⚠️ 𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡 𝗥𝗘𝗤𝗨𝗜𝗥𝗘𝗗\n\n' +
                '🤖 𝗕𝗼𝘁-কে group admin করতে হবে।'
            },
            { quoted: msg }
          );
          return;
        }

        const participants = metadata.participants || [];

        if (!participants.length) {
          await sock.sendMessage(
            chatId,
            { text: '❌ 𝗡𝗢 𝗠𝗘𝗠𝗕𝗘𝗥𝗦 𝗙𝗢𝗨𝗡𝗗' },
            { quoted: msg }
          );
          return;
        }

        const mentions = participants
          .map(p => p.id)
          .filter(Boolean);

        const customText = cleanText
          .trim()
          .replace(/^\.tagall\s*/i, '')
          .trim();

        const groupName =
          metadata.subject || 'Unknown Group';

        const memberCount =
          participants.length;

        const memberLines = mentions
          .map(jid => `✦ @${cleanJid(jid)}`)
          .join('\n');

        const messageText =
          '╭─❖ 𝗚𝗥𝗢𝗨𝗣 𝗔𝗟𝗘𝗥𝗧 ❖─╮\n\n' +
          `🏠 𝗚𝗿𝗼𝘂𝗽 ─ ${groupName}\n` +
          `👥 𝗠𝗲𝗺𝗯𝗲𝗿𝘀 ─ ${memberCount} জন\n` +
          `💬 𝗠𝗲𝘀𝘀𝗮𝗴𝗲 ─ ${customText || 'সবাই একটু active হও 🔥'}\n\n` +
          '🔔 𝗛𝗲𝘆 𝗘𝘃𝗲𝗿𝘆𝗼𝗻𝗲!\n\n' +
          memberLines +
          '\n\n' +
          '╰─❖ 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 ❖─╯';

        await sock.sendMessage(
          chatId,
          {
            react: {
              text: '📢',
              key: msg.key
            }
          }
        ).catch(() => {});

        await sock.sendMessage(
          chatId,
          {
            text: messageText,
            mentions
          },
          { quoted: msg }
        );

      } catch (err) {
        console.log(
          'Tagall error:',
          err?.message || err
        );

        await sock.sendMessage(
          chatId,
          {
            text:
              '❌ 𝗧𝗔𝗚𝗔𝗟𝗟 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
              `${err?.message || 'Unknown error'}`
          },
          { quoted: msg }
        ).catch(() => {});
      }

      return;
    }


      // ================================================

      // =========================================================
      // FACEBOOK DOWNLOADER — .fb
      // =========================================================

      const fbMatch = cleanText.match(
        /^\.fb\s+(.+)$/i
      );

      if (fbMatch) {
        const fbUrl = fbMatch[1].trim();

        let fbFile = '';

        try {
          const status = await sock.sendMessage(
            chatId,
            {
              text:
                '📥 𝗙𝗔𝗖𝗘𝗕𝗢𝗢𝗞 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗\n\n' +
                '🔎 𝗣𝗿𝗼𝗰𝗲𝘀𝘀𝗶𝗻𝗴...\n\n' +
                '⚡ 𝗣𝗹𝗲𝗮𝘀𝗲 𝗪𝗮𝗶𝘁...'
            }
          );

          const fileBase =
            path.join(
              config.DOWNLOAD_DIR || './downloads',
              `fb_${Date.now()}`
            );

          fbFile = fileBase;

          await runCommand(
            'yt-dlp',
            [
              '--no-playlist',
              '--quiet',
              '--no-warnings',
              '--merge-output-format',
              'mp4',
              '--retries',
              '2',
              '--fragment-retries',
              '2',
              '-o',
              fileBase + '.%(ext)s',
              fbUrl
            ]
          );

          let finalFile = fileBase + '.mp4';

          if (!fs.existsSync(finalFile)) {
            const files = fs.readdirSync(
              path.dirname(fileBase)
            );

            const found = files.find(
              f => f.startsWith(path.basename(fileBase) + '.')
            );

            if (found) {
              finalFile = path.join(
                path.dirname(fileBase),
                found
              );
            }
          }

          if (!fs.existsSync(finalFile)) {
            throw new Error('Video file তৈরি হয়নি');
          }

          const video = fs.readFileSync(finalFile);

          await sock.sendMessage(
            chatId,
            {
              video,
              mimetype: 'video/mp4',
              fileName: 'facebook_video.mp4',
              caption: '🎬 𝗙𝗮𝗰𝗲𝗯𝗼𝗼𝗸 𝗩𝗶𝗱𝗲𝗼'
            },
            {
              quoted: msg
            }
          );

          if (status?.key) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '✅ 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱 𝗖𝗼𝗺𝗽𝗹𝗲𝘁𝗲',
                edit: status.key
              }
            ).catch(() => {});
          }

          try {
            fs.unlinkSync(finalFile);
          } catch (_) {}

        } catch (err) {
          console.log(
            'Facebook download error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text: '❌ 𝗙𝗮𝗰𝗲𝗯𝗼𝗼𝗸 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱 𝗙𝗮𝗶𝗹𝗲𝗱'
            }
          ).catch(() => {});

        } finally {
          if (fbFile) {
            try {
              const files = fs.readdirSync(
                path.dirname(fbFile)
              );

              for (const file of files) {
                if (
                  file.startsWith(
                    path.basename(fbFile) + '.'
                  )
                ) {
                  fs.unlinkSync(
                    path.join(
                      path.dirname(fbFile),
                      file
                    )
                  );
                }
              }
            } catch (_) {}
          }
        }

        return;
      }


      // =========================================================
      // INSTAGRAM DOWNLOADER — .ig
      // =========================================================

      const igMatch = cleanText.match(
        /^\.ig\s+(.+)$/i
      );

      if (igMatch) {
        const igUrl = igMatch[1].trim();

        let igFile = '';

        try {
          const status = await sock.sendMessage(
            chatId,
            {
              text:
                '📥 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗\n\n' +
                '🔎 𝗣𝗿𝗼𝗰𝗲𝘀𝘀𝗶𝗻𝗴...\n\n' +
                '⚡ 𝗣𝗹𝗲𝗮𝘀𝗲 𝗪𝗮𝗶𝘁...'
            }
          );

          const fileBase = path.join(
            config.DOWNLOAD_DIR || './downloads',
            `ig_${Date.now()}`
          );

          igFile = fileBase;

          await runCommand(
            'yt-dlp',
            [
              '--no-playlist',
              '--quiet',
              '--no-warnings',
              '--merge-output-format',
              'mp4',
              '--retries',
              '2',
              '--fragment-retries',
              '2',
              '-o',
              fileBase + '.%(ext)s',
              igUrl
            ]
          );

          let finalFile = fileBase + '.mp4';

          if (!fs.existsSync(finalFile)) {
            const files = fs.readdirSync(
              path.dirname(fileBase)
            );

            const found = files.find(
              f => f.startsWith(path.basename(fileBase) + '.')
            );

            if (found) {
              finalFile = path.join(
                path.dirname(fileBase),
                found
              );
            }
          }

          if (!fs.existsSync(finalFile)) {
            throw new Error('Instagram video file তৈরি হয়নি');
          }

          const video = fs.readFileSync(finalFile);

          await sock.sendMessage(
            chatId,
            {
              video,
              mimetype: 'video/mp4',
              fileName: 'instagram_video.mp4',
              caption: '📸 𝗜𝗻𝘀𝘁𝗮𝗴𝗿𝗮𝗺 𝗩𝗶𝗱𝗲𝗼'
            },
            {
              quoted: msg
            }
          );

          if (status?.key) {
            await sock.sendMessage(
              chatId,
              {
                text: '✅ 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱 𝗖𝗼𝗺𝗽𝗹𝗲𝘁𝗲',
                edit: status.key
              }
            ).catch(() => {});
          }

          try {
            fs.unlinkSync(finalFile);
          } catch (_) {}

        } catch (err) {
          console.log(
            'Instagram download error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text: '❌ 𝗜𝗻𝘀𝘁𝗮𝗴𝗿𝗮𝗺 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱 𝗙𝗮𝗶𝗹𝗲𝗱'
            }
          ).catch(() => {});

        } finally {
          if (igFile) {
            try {
              const files = fs.readdirSync(
                path.dirname(igFile)
              );

              for (const file of files) {
                if (
                  file.startsWith(
                    path.basename(igFile) + '.'
                  )
                ) {
                  fs.unlinkSync(
                    path.join(
                      path.dirname(igFile),
                      file
                    )
                  );
                }
              }
            } catch (_) {}
          }
        }

        return;
      }


      // =========================================================
      // TIKTOK DOWNLOADER — .tt
      // =========================================================

      const ttMatch = cleanText.match(
        /^\.tt\s+(.+)$/i
      );

      if (ttMatch) {
        const ttUrl = ttMatch[1].trim();

        let ttFile = '';

        try {
          const status = await sock.sendMessage(
            chatId,
            {
              text:
                '📥 𝗧𝗜𝗞𝗧𝗢𝗞 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗\n\n' +
                '🔎 𝗣𝗿𝗼𝗰𝗲𝘀𝘀𝗶𝗻𝗴...\n\n' +
                '⚡ 𝗣𝗹𝗲𝗮𝘀𝗲 𝗪𝗮𝗶𝘁...'
            }
          );

          const fileBase = path.join(
            config.DOWNLOAD_DIR || './downloads',
            `tt_${Date.now()}`
          );

          ttFile = fileBase;

          await runCommand(
            'yt-dlp',
            [
              '--no-playlist',
              '--quiet',
              '--no-warnings',
              '--merge-output-format',
              'mp4',
              '--retries',
              '2',
              '--fragment-retries',
              '2',
              '-o',
              fileBase + '.%(ext)s',
              ttUrl
            ]
          );

          let finalFile = fileBase + '.mp4';

          if (!fs.existsSync(finalFile)) {
            const files = fs.readdirSync(
              path.dirname(fileBase)
            );

            const found = files.find(
              f => f.startsWith(path.basename(fileBase) + '.')
            );

            if (found) {
              finalFile = path.join(
                path.dirname(fileBase),
                found
              );
            }
          }

          if (!fs.existsSync(finalFile)) {
            throw new Error('TikTok video file তৈরি হয়নি');
          }

          const video = fs.readFileSync(finalFile);

          await sock.sendMessage(
            chatId,
            {
              video,
              mimetype: 'video/mp4',
              fileName: 'tiktok_video.mp4',
              caption: '🎬 𝗧𝗶𝗸𝗧𝗼𝗸 𝗩𝗶𝗱𝗲𝗼'
            },
            {
              quoted: msg
            }
          );

          if (status?.key) {
            await sock.sendMessage(
              chatId,
              {
                text: '✅ 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱 𝗖𝗼𝗺𝗽𝗹𝗲𝘁𝗲',
                edit: status.key
              }
            ).catch(() => {});
          }

        } catch (err) {

          console.log(
            'TikTok download error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text: '❌ 𝗧𝗶𝗸𝗧𝗼𝗸 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱 𝗙𝗮𝗶𝗹𝗲𝗱'
            }
          ).catch(() => {});

        } finally {

          if (ttFile) {
            try {
              const files = fs.readdirSync(
                path.dirname(ttFile)
              );

              for (const file of files) {
                if (
                  file.startsWith(
                    path.basename(ttFile) + '.'
                  )
                ) {
                  fs.unlinkSync(
                    path.join(
                      path.dirname(ttFile),
                      file
                    )
                  );
                }
              }
            } catch (_) {}
          }
        }

        return;
      }


      // =========================================================
      // STICKER MAKER — .st
      // Reply to an image/video
      // =========================================================

      if (/^\.st$/i.test(cleanText)) {

        const quotedMessage =
          msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quotedMessage) {
          await sock.sendMessage(
            chatId,
            {
              text:
                '🖼️ 𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗠𝗔𝗞𝗘𝗥\n\n' +
                'Reply to an image or video with .st'
            },
            { quoted: msg }
          );
          return;
        }

        try {
          const { downloadContentFromMessage } =
            require('@whiskeysockets/baileys');

          let mediaMessage = null;
          let mediaType = null;

          if (quotedMessage.imageMessage) {
            mediaMessage = quotedMessage.imageMessage;
            mediaType = 'image';
          } else if (quotedMessage.videoMessage) {
            mediaMessage = quotedMessage.videoMessage;
            mediaType = 'video';
          }

          if (!mediaMessage) {
            await sock.sendMessage(
              chatId,
              {
                text: '❌ শুধু image অথবা video-তে .st ব্যবহার করো।'
              },
              { quoted: msg }
            );
            return;
          }

          const stream =
            await downloadContentFromMessage(
              mediaMessage,
              mediaType
            );

          const chunks = [];

          for await (const chunk of stream) {
            chunks.push(chunk);
          }

          const inputBuffer =
            Buffer.concat(chunks);

          const inputFile = path.join(
            config.TEMP_DIR || './temp',
            `st_${Date.now()}.${
              mediaType === 'image' ? 'jpg' : 'mp4'
            }`
          );

          const outputFile = path.join(
            config.TEMP_DIR || './temp',
            `st_${Date.now()}.webp`
          );

          fs.mkdirSync(
            config.TEMP_DIR || './temp',
            { recursive: true }
          );

          fs.writeFileSync(
            inputFile,
            inputBuffer
          );

          await runCommand(
            'ffmpeg',
            [
              '-y',
              '-i',
              inputFile,
              '-vf',
              'scale=512:512:force_original_aspect_ratio=decrease,' +
              'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0',
              '-vcodec',
              'libwebp',
              '-loop',
              '0',
              '-an',
              '-vsync',
              '0',
              outputFile
            ]
          );

          if (!fs.existsSync(outputFile)) {
            throw new Error('Sticker তৈরি হয়নি');
          }

          const sticker = fs.readFileSync(
            outputFile
          );

          await sock.sendMessage(
            chatId,
            {
              sticker
            },
            {
              quoted: msg
            }
          );

          try {
            fs.unlinkSync(inputFile);
            fs.unlinkSync(outputFile);
          } catch (_) {}

        } catch (err) {

          console.log(
            'Sticker error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text: '❌ Sticker তৈরি করা যায়নি।'
            },
            { quoted: msg }
          ).catch(() => {});
        }

        return;
      }


      // =========================================================
      // VIEW-ONCE MEDIA — .vv
      // Reply to view-once image/video
      // =========================================================

      


// OWNER_CONTACT_V1_START
// .owner — OWNER CONTACT CARD
if (/^\.owner$/i.test(cleanText)) {

  const ownerNumber = "8801600513579";
  const ownerJid = ownerNumber + "@s.whatsapp.net";

  await sock.sendMessage(
    chatId,
    {
      contacts: {
        displayName: "Jamil Ahmed",
        contacts: [
          {
            vcard:
`BEGIN:VCARD
VERSION:3.0
FN:Jamil Ahmed
TEL;type=CELL;type=VOICE;waid=${ownerNumber}:${ownerNumber}
END:VCARD`
          }
        ]
      }
    },
    { quoted: msg }
  );

  return;
}
// OWNER_CONTACT_V1_END


// UPTIME_V1_START
// .uptime command
if (/^\.uptime$/i.test(cleanText)) {

  // UPTIME_REACTION_V1
  await sock.sendMessage(chatId, {
    react: {
      text: '⏱️',
      key: msg.key
    }
  }).catch(() => {});



  const uptimeSeconds = Math.floor(process.uptime());

  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  const uptimeText =
    `${days}d ${hours}h ${minutes}m ${seconds}s`;

  await sock.sendMessage(
    chatId,
    {
      text:
`⏱️ 𝗕𝗢𝗧 𝗨𝗣𝗧𝗜𝗠𝗘

🤖 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 𝗩𝟯

⏳ 𝗥𝗨𝗡𝗡𝗜𝗡𝗚:
${uptimeText}

✅ 𝗦𝗧𝗔𝗧𝗨𝗦: 𝗢𝗡𝗟𝗜𝗡𝗘`
    },
    { quoted: msg }
  );

  return;
}
// UPTIME_V1_END

if (/^\.vv$/i.test(cleanText)) {

  // VV_REACTION_V1
  await sock.sendMessage(chatId, {
    react: {
      text: '👁️',
      key: msg.key
    }
  }).catch(() => {});



  

// VV_OWNER_LOCK_FINAL
  const vvOwnerNumber = '8801600513579';

  const vvSenderLid =
    msg.key?.participant ||
    msg.participant ||
    '';

  let vvIsOwner = false;

  // Direct LID match
  if (vvSenderLid === '69183987548267@lid') {
    vvIsOwner = true;
  }

  // Group LID -> phone number mapping
  if (!vvIsOwner && chatId.endsWith('@g.us')) {
    try {
      const vvGroupMeta = await sock.groupMetadata(chatId);

      const vvParticipant =
        vvGroupMeta.participants?.find(
          p =>
            p.id === vvSenderLid ||
            p.id?.split(':')[0] === vvSenderLid.split(':')[0]
        );

      const vvPhone =
        String(vvParticipant?.phoneNumber || '')
          .split(':')[0]
          .split('@')[0];

      if (vvPhone === vvOwnerNumber) {
        vvIsOwner = true;
      }
    } catch (e) {
      console.log(
        'VV owner mapping error:',
        e?.message || e
      );
    }
  }

  // Normal JID fallback
  const vvSenderNumber =
    String(vvSenderLid)
      .split(':')[0]
      .split('@')[0];

  if (vvSenderNumber === vvOwnerNumber) {
    vvIsOwner = true;
  }

  if (!vvIsOwner) {
    await sock.sendMessage(
      chatId,
      {
        text:
          '*📛 This is an owner command.*'
      },
      { quoted: msg }
    );
    return;
  }


  console.log('\n========== VV OWNER DEBUG ==========');
  console.log('msg.key:', JSON.stringify(msg.key, null, 2));
  console.log('participant:', msg.key?.participant);
  console.log('participantAlt:', msg.key?.participantAlt);
  console.log('remoteJid:', msg.key?.remoteJid);
  console.log('remoteJidAlt:', msg.key?.remoteJidAlt);
  console.log('msg.participant:', msg.participant);
  console.log('====================================\n');
}

if (/^\.vv$/i.test(cleanText)) {

        // VV_OWNER_LOCK_END_V4




        const context =
          msg.message?.extendedTextMessage?.contextInfo;

        const quotedMessage =
          context?.quotedMessage;

        if (!quotedMessage) {
          await sock.sendMessage(
            chatId,
            {
              text:
                '👁️ 𝗩𝗜𝗘𝗪 𝗢𝗡𝗖𝗘\n\n' +
                'Reply to a view-once image/video with .vv'
            },
            { quoted: msg }
          );
          return;
        }

        try {

          const {
            downloadContentFromMessage
          } = require('@whiskeysockets/baileys');

          let media = null;
          let type = null;

          if (quotedMessage.imageMessage) {
            media = quotedMessage.imageMessage;
            type = 'image';
          }

          else if (quotedMessage.videoMessage) {
            media = quotedMessage.videoMessage;
            type = 'video';
          }

          if (!media) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '❌ শুধু image অথবা video view-once media-তে .vv ব্যবহার করো।'
              },
              { quoted: msg }
            );
            return;
          }

          const stream =
            await downloadContentFromMessage(
              media,
              type
            );

          const chunks = [];

          for await (const chunk of stream) {
            chunks.push(chunk);
          }

          const buffer =
            Buffer.concat(chunks);

          if (type === 'image') {

            await sock.sendMessage(
              chatId,
              {
                image: buffer,
                caption:
                  '👁️ 𝗩𝗜𝗘𝗪 𝗢𝗡𝗖𝗘 𝗠𝗘𝗗𝗜𝗔\n\n' +
                  '👑 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧'
              },
              { quoted: msg }
            );

          } else {

            await sock.sendMessage(
              chatId,
              {
                video: buffer,
                mimetype: 'video/mp4',
                caption:
                  '👁️ 𝗩𝗜𝗘𝗪 𝗢𝗡𝗖𝗘 𝗠𝗘𝗗𝗜𝗔\n\n' +
                  '👑 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧'
              },
              { quoted: msg }
            );
          }

        } catch (err) {

          console.log(
            'View-once error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗩𝗶𝗲𝘄-𝗢𝗻𝗰𝗲 𝗠𝗲𝗱𝗶𝗮 𝗙𝗮𝗶𝗹𝗲𝗱\n\n' +
                '⚠️ ' +
                (err?.message || 'Unknown error')
            },
            { quoted: msg }
          ).catch(() => {});
        }

        return;
      }


      // =========================================================
      // IMAGE UPSCALE 2X — .upscale
      // Reply to an image
      // =========================================================

      if (/^\.upscale$/i.test(cleanText)) {

        const quotedMessage =
          msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quotedMessage?.imageMessage) {
          await sock.sendMessage(
            chatId,
            {
              text:
                '🖼️ 𝗨𝗣𝗦𝗖𝗔𝗟𝗘\n\n' +
                'Reply to an image with .upscale'
            },
            { quoted: msg }
          );
          return;
        }

        let inputFile = '';
        let outputFile = '';

        try {
          const {
            downloadContentFromMessage
          } = require('@whiskeysockets/baileys');

          const stream =
            await downloadContentFromMessage(
              quotedMessage.imageMessage,
              'image'
            );

          const chunks = [];

          for await (const chunk of stream) {
            chunks.push(chunk);
          }

          const inputBuffer =
            Buffer.concat(chunks);

          const tempDir =
            config.TEMP_DIR || './temp';

          fs.mkdirSync(
            tempDir,
            { recursive: true }
          );

          const stamp = Date.now();

          inputFile =
            path.join(
              tempDir,
              `upscale_${stamp}.jpg`
            );

          outputFile =
            path.join(
              tempDir,
              `upscale_${stamp}_out.jpg`
            );

          fs.writeFileSync(
            inputFile,
            inputBuffer
          );

          await runCommand(
            'ffmpeg',
            [
              '-y',
              '-i',
              inputFile,
              '-vf',
              'scale=iw*2:ih*2:flags=lanczos',
              '-q:v',
              '2',
              outputFile
            ]
          );

          if (!fs.existsSync(outputFile)) {
            throw new Error(
              'Upscale image তৈরি হয়নি'
            );
          }

          const image =
            fs.readFileSync(outputFile);

          await sock.sendMessage(
            chatId,
            {
              image,
              caption:
                '🔍 𝗨𝗣𝗦𝗖𝗔𝗟𝗘 𝟮𝗫 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘'
            },
            { quoted: msg }
          );

        } catch (err) {

          console.log(
            'Upscale error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗨𝗽𝘀𝗰𝗮𝗹𝗲 𝗙𝗮𝗶𝗹𝗲𝗱'
            },
            { quoted: msg }
          ).catch(() => {});

        } finally {

          for (const file of [
            inputFile,
            outputFile
          ]) {
            if (file) {
              try {
                if (fs.existsSync(file)) {
                  fs.unlinkSync(file);
                }
              } catch (_) {}
            }
          }
        }

        return;
      }


      // =========================================================
      // IMAGE UPSCALE 4X — .upscale1
      // Reply to an image
      // =========================================================

      if (/^\.upscale1$/i.test(cleanText)) {

        const quotedMessage =
          msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quotedMessage?.imageMessage) {
          await sock.sendMessage(
            chatId,
            {
              text:
                '🖼️ 𝗨𝗣𝗦𝗖𝗔𝗟𝗘 𝟰𝗫\n\n' +
                'Reply to an image with .upscale1'
            },
            { quoted: msg }
          );
          return;
        }

        let inputFile = '';
        let outputFile = '';

        try {
          const {
            downloadContentFromMessage
          } = require('@whiskeysockets/baileys');

          const stream =
            await downloadContentFromMessage(
              quotedMessage.imageMessage,
              'image'
            );

          const chunks = [];

          for await (const chunk of stream) {
            chunks.push(chunk);
          }

          const inputBuffer =
            Buffer.concat(chunks);

          const tempDir =
            config.TEMP_DIR || './temp';

          fs.mkdirSync(
            tempDir,
            { recursive: true }
          );

          const stamp = Date.now();

          inputFile =
            path.join(
              tempDir,
              `upscale1_${stamp}.jpg`
            );

          outputFile =
            path.join(
              tempDir,
              `upscale1_${stamp}_out.jpg`
            );

          fs.writeFileSync(
            inputFile,
            inputBuffer
          );

          await runCommand(
            'ffmpeg',
            [
              '-y',
              '-i',
              inputFile,
              '-vf',
              'scale=iw*4:ih*4:flags=lanczos',
              '-q:v',
              '2',
              outputFile
            ]
          );

          if (!fs.existsSync(outputFile)) {
            throw new Error(
              '4X upscale image তৈরি হয়নি'
            );
          }

          const image =
            fs.readFileSync(outputFile);

          await sock.sendMessage(
            chatId,
            {
              image,
              caption:
                '🔍 𝗨𝗣𝗦𝗖𝗔𝗟𝗘 𝟰𝗫 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘'
            },
            { quoted: msg }
          );

        } catch (err) {

          console.log(
            'Upscale1 error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗨𝗽𝘀𝗰𝗮𝗹𝗲 𝟰𝗫 𝗙𝗮𝗶𝗹𝗲𝗱'
            },
            { quoted: msg }
          ).catch(() => {});

        } finally {

          for (const file of [
            inputFile,
            outputFile
          ]) {
            if (file) {
              try {
                if (fs.existsSync(file)) {
                  fs.unlinkSync(file);
                }
              } catch (_) {}
            }
          }
        }

        return;
      }


      // =========================================================
      // VIDEO UPSCALE 2X — .vupscale
      // Reply to a video
      // =========================================================

      if (/^\.vupscale$/i.test(cleanText)) {

        const quotedMessage =
          msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quotedMessage?.videoMessage) {
          await sock.sendMessage(
            chatId,
            {
              text:
                '🎬 𝗩𝗜𝗗𝗘𝗢 𝗨𝗣𝗦𝗖𝗔𝗟𝗘\n\n' +
                'Reply to a video with .vupscale'
            },
            { quoted: msg }
          );
          return;
        }

        let inputFile = '';
        let outputFile = '';

        try {
          const {
            downloadContentFromMessage
          } = require('@whiskeysockets/baileys');

          const stream =
            await downloadContentFromMessage(
              quotedMessage.videoMessage,
              'video'
            );

          const chunks = [];

          for await (const chunk of stream) {
            chunks.push(chunk);
          }

          const inputBuffer =
            Buffer.concat(chunks);

          const tempDir =
            config.TEMP_DIR || './temp';

          fs.mkdirSync(
            tempDir,
            { recursive: true }
          );

          const stamp = Date.now();

          inputFile =
            path.join(
              tempDir,
              `vupscale_${stamp}.mp4`
            );

          outputFile =
            path.join(
              tempDir,
              `vupscale_${stamp}_out.mp4`
            );

          fs.writeFileSync(
            inputFile,
            inputBuffer
          );

          await runCommand(
            'ffmpeg',
            [
              '-y',
              '-i',
              inputFile,
              '-vf',
              'scale=iw*2:ih*2:flags=lanczos',
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '23',
              '-c:a',
              'aac',
              '-movflags',
              '+faststart',
              outputFile
            ]
          );

          if (!fs.existsSync(outputFile)) {
            throw new Error(
              'Upscale video তৈরি হয়নি'
            );
          }

          const video =
            fs.readFileSync(outputFile);

          await sock.sendMessage(
            chatId,
            {
              video,
              mimetype: 'video/mp4',
              fileName: 'upscaled_video.mp4',
              caption:
                '🔍 𝗩𝗜𝗗𝗘𝗢 𝗨𝗣𝗦𝗖𝗔𝗟𝗘 𝟮𝗫 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘'
            },
            { quoted: msg }
          );

        } catch (err) {

          console.log(
            'Video upscale error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗩𝗶𝗱𝗲𝗼 𝗨𝗽𝘀𝗰𝗮𝗹𝗲 𝗙𝗮𝗶𝗹𝗲𝗱'
            },
            { quoted: msg }
          ).catch(() => {});

        } finally {

          for (const file of [
            inputFile,
            outputFile
          ]) {
            if (file) {
              try {
                if (fs.existsSync(file)) {
                  fs.unlinkSync(file);
                }
              } catch (_) {}
            }
          }
        }

        return;
      }


      // =========================================================
      // UNMUTE_COMMAND_V3
      if (cleanText.trim().toLowerCase() === '.unmute') {
        try {
          if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(
              chatId,
              { text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const metadata = await sock.groupMetadata(chatId);

          const senderParticipant =
            metadata.participants?.find(
              p => p.id === msg.key.participant
            );

          if (!senderParticipant?.admin) {
            await sock.sendMessage(
              chatId,
              { text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const cleanJid = jid =>
            String(jid || '')
              .split(':')[0]
              .split('@')[0];

          const botId = sock.user?.id || '';
          const botLid = sock.user?.lid || '';

          const botNumber = cleanJid(botId);
          const botLidNumber = cleanJid(botLid);

          const botParticipant =
            metadata.participants?.find(p => {
              const participantId = p.id || '';
              const participantNumber = cleanJid(participantId);

              return (
                participantId === botId ||
                participantId === botLid ||
                participantNumber === botNumber ||
                (
                  botLidNumber &&
                  participantNumber === botLidNumber
                )
              );
            });

          if (!botParticipant?.admin) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '⚠️ 𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡 𝗥𝗘𝗤𝗨𝗜𝗥𝗘𝗗\n\n' +
                  '🤖 𝗕𝗼𝘁-কে group admin করতে হবে।'
              },
              { quoted: msg }
            );
            return;
          }

          await sock.groupSettingUpdate(
            chatId,
            'not_announcement'
          );

          await sock.sendMessage(
            chatId,
            {
              react: {
                text: '🔊',
                key: msg.key
              }
            }
          ).catch(() => {});

          await sock.sendMessage(
            chatId,
            {
              text:
                '🔊 𝗚𝗥𝗢𝗨𝗣 𝗨𝗡𝗠𝗨𝗧𝗘𝗗\n\n' +
                '👥 𝗔𝗹𝗹 𝗺𝗲𝗺𝗯𝗲𝗿𝘀 𝗰𝗮𝗻 𝘀𝗲𝗻𝗱 𝗺𝗲𝘀𝘀𝗮𝗴𝗲𝘀 𝗻𝗼𝘄.'
            },
            { quoted: msg }
          );

        } catch (err) {
          console.log(
            'Unmute error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗨𝗡𝗠𝗨𝗧𝗘 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
                `${err?.message || 'Unknown error'}`
            },
            { quoted: msg }
          ).catch(() => {});
        }

        return;
      }

      // MUTE_COMMAND_V3
      if (cleanText.trim().toLowerCase() === '.mute') {
        try {
          if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(
              chatId,
              { text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const metadata = await sock.groupMetadata(chatId);

          const senderParticipant =
            metadata.participants?.find(
              p => p.id === msg.key.participant
            );

          if (!senderParticipant?.admin) {
            await sock.sendMessage(
              chatId,
              { text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const cleanJid = jid =>
            String(jid || '')
              .split(':')[0]
              .split('@')[0];

          const botId = sock.user?.id || '';
          const botLid = sock.user?.lid || '';

          const botNumber = cleanJid(botId);
          const botLidNumber = cleanJid(botLid);

          const botParticipant =
            metadata.participants?.find(p => {
              const participantId = p.id || '';
              const participantNumber = cleanJid(participantId);

              return (
                participantId === botId ||
                participantId === botLid ||
                participantNumber === botNumber ||
                (
                  botLidNumber &&
                  participantNumber === botLidNumber
                )
              );
            });

          if (!botParticipant?.admin) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '⚠️ 𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡 𝗥𝗘𝗤𝗨𝗜𝗥𝗘𝗗\n\n' +
                  '🤖 𝗕𝗼𝘁-কে group admin করতে হবে।'
              },
              { quoted: msg }
            );
            return;
          }

          await sock.groupSettingUpdate(
            chatId,
            'announcement'
          );

          await sock.sendMessage(
            chatId,
            {
              react: {
                text: '🔇',
                key: msg.key
              }
            }
          ).catch(() => {});

          await sock.sendMessage(
            chatId,
            {
              text:
                '🔇 𝗚𝗥𝗢𝗨𝗣 𝗠𝗨𝗧𝗘𝗗\n\n' +
                '👑 𝗢𝗻𝗹𝘆 𝗮𝗱𝗺𝗶𝗻𝘀 𝗰𝗮𝗻 𝘀𝗲𝗻𝗱 𝗺𝗲𝘀𝘀𝗮𝗴𝗲𝘀 𝗻𝗼𝘄.'
            },
            { quoted: msg }
          );

        } catch (err) {
          console.log(
            'Mute error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗠𝗨𝗧𝗘 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
                `${err?.message || 'Unknown error'}`
            },
            { quoted: msg }
          ).catch(() => {});
        }

        return;
      }

      // GROUP ADD — .add
      // Usage: .add 8801XXXXXXXXX
      // =========================================================

      const addMatch = cleanText.match(
        /^\.add\s+(.+)$/i
      );

      if (addMatch) {

        if (!chatId.endsWith('@g.us')) {
          await sock.sendMessage(
            chatId,
            {
              text: '❌ এই command শুধু group-এ ব্যবহার করা যাবে।'
            },
            { quoted: msg }
          );
          return;
        }

        const number = addMatch[1]
          .replace(/[^\d]/g, '');

        if (!number || number.length < 8) {
          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ সঠিক phone number দাও।\n\n' +
                'Example: .add 8801XXXXXXXXX'
            },
            { quoted: msg }
          );
          return;
        }

        try {

          const metadata =
            await sock.groupMetadata(chatId);

          const cleanJid = jid =>
            String(jid || '')
              .split(':')[0]
              .split('@')[0];

          const botId = sock.user?.id || '';
          const botLid = sock.user?.lid || '';

          const botNumber = cleanJid(botId);
          const botLidNumber = cleanJid(botLid);

          const botParticipant =
            metadata.participants?.find(p => {
              const participantId = p.id || '';
              const participantNumber = cleanJid(participantId);

              return (
                participantId === botId ||
                participantId === botLid ||
                participantNumber === botNumber ||
                (
                  botLidNumber &&
                  participantNumber === botLidNumber
                )
              );
            });

          const botIsAdmin =
            !!botParticipant?.admin;

          if (!botIsAdmin) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '⚠️ 𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡 𝗥𝗘𝗤𝗨𝗜𝗥𝗘𝗗\n\n' +
                  '🤖 𝗧𝗵𝗲 𝗯𝗼𝘁 𝗺𝘂𝘀𝘁 𝗯𝗲 𝗮 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻 𝘁𝗼 𝗮𝗱𝗱 𝗺𝗲𝗺𝗯𝗲𝗿𝘀.'
              },
              { quoted: msg }
            );
            return;
          }

          const targetJid =
            number + '@s.whatsapp.net';

          const result =
            await sock.groupParticipantsUpdate(
              chatId,
              [targetJid],
              'add'
            );

          const action =
            result?.[0]?.status;

          if (
            action === '200' ||
            action === 200
          ) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '✅ 𝗠𝗲𝗺𝗯𝗲𝗿 𝗔𝗱𝗱𝗲𝗱\n\n' +
                  `👤 +${number}`
              },
              { quoted: msg }
            );
          } else {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '⚠️ 𝗔𝗱𝗱 𝗥𝗲𝗾𝘂𝗲𝘀𝘁 𝗦𝗲𝗻𝘁\n\n' +
                  `👤 +${number}\n` +
                  'WhatsApp group privacy/settings-এর কারণে সরাসরি add নাও হতে পারে।'
              },
              { quoted: msg }
            );
          }

        } catch (err) {

          console.log(
            'Group add error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗔𝗱𝗱 𝗙𝗮𝗶𝗹𝗲𝗱\n\n' +
                `${err?.message || 'Unknown error'}`
            },
            { quoted: msg }
          ).catch(() => {});
        }

        return;
      }

      
// ADMINS
if (/^\.admins$/i.test(cleanText)) {
  if (!chatId.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      { text: '❌ এই command শুধু group-এ ব্যবহার করা যাবে।' },
      { quoted: msg }
    );
    return;
  }

  try {
    const metadata = await sock.groupMetadata(chatId);
    const admins = (metadata.participants || []).filter(p => p.admin);

    if (!admins.length) {
      await sock.sendMessage(
        chatId,
        { text: '❌ কোনো group admin পাওয়া যায়নি।' },
        { quoted: msg }
      );
      return;
    }

    const lines = admins.map((p, i) => {
      const jid = p.id || '';
      const number = jid.split('@')[0].split(':')[0];
      return `${i + 1}. @${number}`;
    });

    await sock.sendMessage(
      chatId,
      {
        text:
          '👥 𝗚𝗥𝗢𝗨𝗣 𝗔𝗗𝗠𝗜𝗡𝗦\n\n' +
          lines.join('\n'),
        mentions: admins.map(p => p.id)
      },
      { quoted: msg }
    );

  } catch (err) {
    console.log('Admins error:', err?.message || err);

    await sock.sendMessage(
      chatId,
      { text: '❌ Admin list পাওয়া যায়নি।' },
      { quoted: msg }
    ).catch(() => {});
  }

  return;
}



// PROMOTE_COMMAND_V3
      if (cleanText.trim().toLowerCase().startsWith('.promote')) {
        try {
          if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(
              chatId,
              { text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const metadata = await sock.groupMetadata(chatId);

          const sender = metadata.participants?.find(
            p => p.id === msg.key.participant
          );

          if (!sender?.admin) {
            await sock.sendMessage(
              chatId,
              { text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const cleanJid = jid =>
            String(jid || '')
              .split(':')[0]
              .split('@')[0];

          const botId = sock.user?.id || '';
          const botLid = sock.user?.lid || '';

          const botNumber = cleanJid(botId);
          const botLidNumber = cleanJid(botLid);

          const botParticipant = metadata.participants?.find(p => {
            const id = p.id || '';
            const number = cleanJid(id);

            return (
              id === botId ||
              id === botLid ||
              number === botNumber ||
              (botLidNumber && number === botLidNumber)
            );
          });

          if (!botParticipant?.admin) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '⚠️ 𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡 𝗥𝗘𝗤𝗨𝗜𝗥𝗘𝗗\n\n' +
                  '🤖 𝗕𝗼𝘁-কে group admin করতে হবে।'
              },
              { quoted: msg }
            );
            return;
          }

          let targetJid = null;

          const mentioned =
            msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

          if (mentioned.length) {
            targetJid = mentioned[0];
          }

          const quotedParticipant =
            msg.message?.extendedTextMessage?.contextInfo?.participant;

          if (!targetJid && quotedParticipant) {
            targetJid = quotedParticipant;
          }

          const args = cleanText.trim().split(/\s+/);

          if (!targetJid && args[1]) {
            let number = args[1].replace(/[^\d]/g, '');

            if (number.startsWith('01')) {
              number = '88' + number;
            }

            if (!number.startsWith('88')) {
              number = '88' + number;
            }

            targetJid = number + '@s.whatsapp.net';
          }

          if (!targetJid) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '🎯 𝗧𝗔𝗥𝗚𝗘𝗧 𝗠𝗜𝗦𝗦𝗜𝗡𝗚\n\n' +
                  'Reply to a member or mention them.\n' +
                  'Example: .promote @user'
              },
              { quoted: msg }
            );
            return;
          }

          const target = metadata.participants?.find(
            p => cleanJid(p.id) === cleanJid(targetJid)
          );

          if (!target) {
            await sock.sendMessage(
              chatId,
              { text: '🔎 𝗨𝗦𝗘𝗥 𝗡𝗢𝗧 𝗙𝗢𝗨𝗡𝗗' },
              { quoted: msg }
            );
            return;
          }

          if (target.admin) {
            await sock.sendMessage(
              chatId,
              { text: 'ℹ️ 𝗔𝗟𝗥𝗘𝗔𝗗𝗬 𝗔𝗗𝗠𝗜𝗡' },
              { quoted: msg }
            );
            return;
          }

          await sock.groupParticipantsUpdate(
            chatId,
            [target.id],
            'promote'
          );

          await sock.sendMessage(
            chatId,
            {
              react: {
                text: '⬆️',
                key: msg.key
              }
            }
          ).catch(() => {});

          await sock.sendMessage(
            chatId,
            {
              text:
                '⬆️ 𝗣𝗥𝗢𝗠𝗢𝗧𝗘 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘\n\n' +
                `👤 @${cleanJid(target.id)}\n` +
                '👑 𝗡𝗼𝘄 𝗚𝗿𝗼𝘂𝗽 𝗔𝗱𝗺𝗶𝗻'
              ,
              mentions: [target.id]
            },
            { quoted: msg }
          );

        } catch (err) {
          console.log(
            'Promote error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗣𝗥𝗢𝗠𝗢𝗧𝗘 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
                `${err?.message || 'Unknown error'}`
            },
            { quoted: msg }
          ).catch(() => {});
        }

        return;
      }

// WARN_COMMAND_V3
      if (cleanText.trim().toLowerCase().startsWith('.warn')) {
        try {
          if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(
              chatId,
              { text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const metadata = await sock.groupMetadata(chatId);

          const sender = metadata.participants?.find(
            p => p.id === msg.key.participant
          );

          if (!sender?.admin) {
            await sock.sendMessage(
              chatId,
              { text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const cleanJid = jid =>
            String(jid || '')
              .split(':')[0]
              .split('@')[0];

          const botId = sock.user?.id || '';
          const botLid = sock.user?.lid || '';

          const botNumber = cleanJid(botId);
          const botLidNumber = cleanJid(botLid);

          const botParticipant =
            metadata.participants?.find(p => {
              const id = p.id || '';
              const number = cleanJid(id);

              return (
                id === botId ||
                id === botLid ||
                number === botNumber ||
                (botLidNumber && number === botLidNumber)
              );
            });

          if (!botParticipant?.admin) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '⚠️ 𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡 𝗥𝗘𝗤𝗨𝗜𝗥𝗘𝗗\n\n' +
                  '🤖 𝗕𝗼𝘁-কে group admin করতে হবে।'
              },
              { quoted: msg }
            );
            return;
          }

          let targetJid = null;

          const context =
            msg.message?.extendedTextMessage?.contextInfo;

          const mentioned = context?.mentionedJid || [];

          if (mentioned.length) {
            targetJid = mentioned[0];
          }

          if (!targetJid && context?.participant) {
            targetJid = context.participant;
          }

          const args = cleanText.trim().split(/\s+/);

          if (!targetJid && args[1]) {
            let number = args[1].replace(/[^\d]/g, '');

            if (number.startsWith('01')) {
              number = '88' + number;
            }

            if (!number.startsWith('88')) {
              number = '88' + number;
            }

            targetJid = number + '@s.whatsapp.net';
          }

          if (!targetJid) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '🎯 𝗧𝗔𝗥𝗚𝗘𝗧 𝗠𝗜𝗦𝗦𝗜𝗡𝗚\n\n' +
                  'Reply to a member or mention them.\n' +
                  'Example: .warn @user'
              },
              { quoted: msg }
            );
            return;
          }

          const target = metadata.participants?.find(
            p => cleanJid(p.id) === cleanJid(targetJid)
          );

          if (!target) {
            await sock.sendMessage(
              chatId,
              { text: '🔎 𝗨𝗦𝗘𝗥 𝗡𝗢𝗧 𝗙𝗢𝗨𝗡𝗗' },
              { quoted: msg }
            );
            return;
          }

          if (target.admin) {
            await sock.sendMessage(
              chatId,
              { text: '🛡️ 𝗔𝗗𝗠𝗜𝗡 𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗜𝗢𝗡\n\nAdmin cannot be warned.' },
              { quoted: msg }
            );
            return;
          }

          if (!global.warnCounts) {
            global.warnCounts = {};
          }

          if (!global.warnCounts[chatId]) {
            global.warnCounts[chatId] = {};
          }

          const key = cleanJid(target.id);

          global.warnCounts[chatId][key] =
            (global.warnCounts[chatId][key] || 0) + 1;

          const count = global.warnCounts[chatId][key];

          await sock.sendMessage(
            chatId,
            {
              react: {
                text: '⚠️',
                key: msg.key
              }
            }
          ).catch(() => {});

          if (count >= 3) {
            await sock.groupParticipantsUpdate(
              chatId,
              [target.id],
              'remove'
            );

            delete global.warnCounts[chatId][key];

            await sock.sendMessage(
              chatId,
              {
                text:
                  '⛔ 𝗪𝗔𝗥𝗡 𝗟𝗜𝗠𝗜𝗧 𝗥𝗘𝗔𝗖𝗛𝗘𝗗\n\n' +
                  `👤 @${key}\n` +
                  '⚠️ 𝟯/𝟯 𝗪𝗮𝗿𝗻𝗶𝗻𝗴𝘀\n' +
                  '🚫 𝗠𝗲𝗺𝗯𝗲𝗿 𝗥𝗲𝗺𝗼𝘃𝗲𝗱',
                mentions: [target.id]
              },
              { quoted: msg }
            );

            return;
          }

          await sock.sendMessage(
            chatId,
            {
              text:
                '⚠️ 𝗪𝗔𝗥𝗡𝗜𝗡𝗚\n\n' +
                `👤 @${key}\n` +
                `⚠️ 𝗪𝗮𝗿𝗻𝗶𝗻𝗴: ${count}/3\n\n` +
                '3 warnings হলে member remove হবে।',
              mentions: [target.id]
            },
            { quoted: msg }
          );

        } catch (err) {
          console.log(
            'Warn error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗪𝗔𝗥𝗡 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
                `${err?.message || 'Unknown error'}`
            },
            { quoted: msg }
          ).catch(() => {});
        }

        return;
      }

// RESETWARN_COMMAND_V3
      if (cleanText.trim().toLowerCase().startsWith('.resetwarn')) {
        try {
          if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(
              chatId,
              { text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const metadata = await sock.groupMetadata(chatId);

          const sender = metadata.participants?.find(
            p => p.id === msg.key.participant
          );

          if (!sender?.admin) {
            await sock.sendMessage(
              chatId,
              { text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          let targetJid = null;

          const context =
            msg.message?.extendedTextMessage?.contextInfo;

          const mentioned = context?.mentionedJid || [];

          if (mentioned.length) {
            targetJid = mentioned[0];
          }

          if (!targetJid && context?.participant) {
            targetJid = context.participant;
          }

          const args = cleanText.trim().split(/\s+/);

          if (!targetJid && args[1]) {
            let number = args[1].replace(/[^\d]/g, '');

            if (number.startsWith('01')) {
              number = '88' + number;
            }

            if (!number.startsWith('88')) {
              number = '88' + number;
            }

            targetJid = number + '@s.whatsapp.net';
          }

          if (!targetJid) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  '🎯 𝗧𝗔𝗥𝗚𝗘𝗧 𝗠𝗜𝗦𝗦𝗜𝗡𝗚\n\n' +
                  'Reply to a member or mention them.\n' +
                  'Example: .resetwarn @user'
              },
              { quoted: msg }
            );
            return;
          }

          const cleanJid = jid =>
            String(jid || '')
              .split(':')[0]
              .split('@')[0];

          const target = metadata.participants?.find(
            p => cleanJid(p.id) === cleanJid(targetJid)
          );

          if (!target) {
            await sock.sendMessage(
              chatId,
              { text: '🔎 𝗨𝗦𝗘𝗥 𝗡𝗢𝗧 𝗙𝗢𝗨𝗡𝗗' },
              { quoted: msg }
            );
            return;
          }

          const key = cleanJid(target.id);

          if (!global.warnCounts) {
            global.warnCounts = {};
          }

          if (!global.warnCounts[chatId]) {
            global.warnCounts[chatId] = {};
          }

          const oldCount =
            global.warnCounts[chatId][key] || 0;

          if (oldCount === 0) {
            await sock.sendMessage(
              chatId,
              {
                text:
                  'ℹ️ 𝗡𝗢 𝗪𝗔𝗥𝗡𝗜𝗡𝗚𝗦\n\n' +
                  `👤 @${key}\n` +
                  'The warning count is already 0.',
                mentions: [target.id]
              },
              { quoted: msg }
            );
            return;
          }

          global.warnCounts[chatId][key] = 0;

          await sock.sendMessage(
            chatId,
            {
              react: {
                text: '♻️',
                key: msg.key
              }
            }
          ).catch(() => {});

          await sock.sendMessage(
            chatId,
            {
              text:
                '♻️ 𝗪𝗔𝗥𝗡𝗜𝗡𝗚𝗦 𝗥𝗘𝗦𝗘𝗧\n\n' +
                `👤 @${key}\n` +
                `⚠️ 𝗢𝗹𝗱: ${oldCount}/3\n` +
                '✅ 𝗡𝗲𝘄: 0/3',
              mentions: [target.id]
            },
            { quoted: msg }
          );

        } catch (err) {
          console.log(
            'Resetwarn error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗥𝗘𝗦𝗘𝗧𝗪𝗔𝗥𝗡 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
                `${err?.message || 'Unknown error'}`
            },
            { quoted: msg }
          ).catch(() => {});
        }

        return;
      }

// WARNINGS_COMMAND_V3
      if (cleanText.trim().toLowerCase().startsWith('.warnings')) {
        try {
          if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(
              chatId,
              { text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          const metadata = await sock.groupMetadata(chatId);

          const sender = metadata.participants?.find(
            p => p.id === msg.key.participant
          );

          if (!sender?.admin) {
            await sock.sendMessage(
              chatId,
              { text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬' },
              { quoted: msg }
            );
            return;
          }

          let targetJid = null;

          const context =
            msg.message?.extendedTextMessage?.contextInfo;

          const mentioned = context?.mentionedJid || [];

          if (mentioned.length) {
            targetJid = mentioned[0];
          }

          if (!targetJid && context?.participant) {
            targetJid = context.participant;
          }

          const args = cleanText.trim().split(/\s+/);

          if (!targetJid && args[1]) {
            let number = args[1].replace(/[^\d]/g, '');

            if (number.startsWith('01')) {
              number = '88' + number;
            }

            if (!number.startsWith('88')) {
              number = '88' + number;
            }

            targetJid = number + '@s.whatsapp.net';
          }

          if (!targetJid) {
            targetJid = msg.key.participant;
          }

          const cleanJid = jid =>
            String(jid || '')
              .split(':')[0]
              .split('@')[0];

          const target = metadata.participants?.find(
            p => cleanJid(p.id) === cleanJid(targetJid)
          );

          if (!target) {
            await sock.sendMessage(
              chatId,
              { text: '🔎 𝗨𝗦𝗘𝗥 𝗡𝗢𝗧 𝗙𝗢𝗨𝗡𝗗' },
              { quoted: msg }
            );
            return;
          }

          const key = cleanJid(target.id);

          const count =
            global.warnCounts?.[chatId]?.[key] || 0;

          await sock.sendMessage(
            chatId,
            {
              react: {
                text: '📋',
                key: msg.key
              }
            }
          ).catch(() => {});

          await sock.sendMessage(
            chatId,
            {
              text:
                '📋 𝗪𝗔𝗥𝗡𝗜𝗡𝗚 𝗦𝗧𝗔𝗧𝗨𝗦\n\n' +
                `👤 @${key}\n` +
                `⚠️ 𝗪𝗮𝗿𝗻𝗶𝗻𝗴𝘀: ${count}/3\n\n` +
                (
                  count >= 3
                    ? '⛔ 𝗟𝗶𝗺𝗶𝘁 𝗿𝗲𝗮𝗰𝗵𝗲𝗱'
                    : '✅ 𝗦𝘁𝗶𝗹𝗹 𝘄𝗶𝘁𝗵𝗶𝗻 𝗹𝗶𝗺𝗶𝘁'
                ),
              mentions: [target.id]
            },
            { quoted: msg }
          );

        } catch (err) {
          console.log(
            'Warnings error:',
            err?.message || err
          );

          await sock.sendMessage(
            chatId,
            {
              text:
                '❌ 𝗪𝗔𝗥𝗡𝗜𝗡𝗚𝗦 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
                `${err?.message || 'Unknown error'}`
            },
            { quoted: msg }
          ).catch(() => {});
        }

        return;
      }

// GROUPINFO_COMMAND_V3
if (/^\.groupinfo$/i.test(cleanText)) {
  if (!chatId.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗧𝗵𝗶𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱 𝗼𝗻𝗹𝘆 𝘄𝗼𝗿𝗸𝘀 𝗶𝗻 𝗴𝗿𝗼𝘂𝗽𝘀.'
      },
      { quoted: msg }
    );
    return;
  }

  try {
    const metadata =
      await sock.groupMetadata(chatId);

    const participants =
      metadata.participants || [];

    const admins =
      participants.filter(p => p.admin);

    const groupName =
      metadata.subject || 'Unknown Group';

    const description =
      metadata.desc ||
      'No description';

    const createdAt =
      metadata.creation
        ? new Date(metadata.creation * 1000)
            .toLocaleString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
        : 'Unknown';

    const owner =
      metadata.owner ||
      'Unknown';

    const ownerNumber =
      owner !== 'Unknown'
        ? owner.split('@')[0].split(':')[0]
        : 'Unknown';

    const text =
      '👥 𝗚𝗥𝗢𝗨𝗣 𝗜𝗡𝗙𝗢\n\n' +
      `🏷️ 𝗡𝗮𝗺𝗲: ${groupName}\n` +
      `👤 𝗠𝗲𝗺𝗯𝗲𝗿𝘀: ${participants.length}\n` +
      `👑 𝗔𝗱𝗺𝗶𝗻𝘀: ${admins.length}\n` +
      `🆔 𝗚𝗿𝗼𝘂𝗽 𝗜𝗗: ${chatId}\n` +
      `📅 𝗖𝗿𝗲𝗮𝘁𝗲𝗱: ${createdAt}\n` +
      `👤 𝗖𝗿𝗲𝗮𝘁𝗼𝗿: @${ownerNumber}\n\n` +
      `📝 𝗗𝗲𝘀𝗰𝗿𝗶𝗽𝘁𝗶𝗼𝗻:\n${description}`;

    const mentions =
      owner !== 'Unknown'
        ? [owner]
        : [];

    await sock.sendMessage(
      chatId,
      {
        text,
        mentions
      },
      { quoted: msg }
    );

    await sock.sendMessage(
      chatId,
      {
        react: {
          text: '👥',
          key: msg.key
        }
      }
    ).catch(() => {});

  } catch (err) {
    console.log(
      'Groupinfo error:',
      err?.message || err
    );

    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗙𝗮𝗶𝗹𝗲𝗱 𝘁𝗼 𝗴𝗲𝘁 𝗴𝗿𝗼𝘂𝗽 𝗶𝗻𝗳𝗼.'
      },
      { quoted: msg }
    ).catch(() => {});
  }

  return;
}

// KICK_COMMAND_V3
if (/^\.kick(?:\s+.*)?$/i.test(cleanText)) {
  if (!chatId.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ 𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬\n\n𝗧𝗵𝗶𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱 𝗼𝗻𝗹𝘆 𝘄𝗼𝗿𝗸𝘀 𝗶𝗻 𝗴𝗿𝗼𝘂𝗽𝘀.'
      },
      { quoted: msg }
    );
    return;
  }

  try {
    const metadata = await sock.groupMetadata(chatId);

    const sender =
      msg.key?.participant ||
      msg.participant ||
      '';

    const requester = metadata.participants?.find(
      p =>
        p.id === sender ||
        p.id?.split(':')[0] === sender.split(':')[0]
    );

    if (!requester?.admin) {
      await sock.sendMessage(
        chatId,
        {
          text: '🔐 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬\n\n👑 𝗢𝗻𝗹𝘆 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻𝘀 𝗰𝗮𝗻 𝘂𝘀𝗲 .kick.'
        },
        { quoted: msg }
      );
      return;
    }

    /*
     * BOT ADMIN CHECK
     * Supports normal JID and LID based sessions.
     */
    const botId = sock.user?.id || '';
    const botLid = sock.user?.lid || '';

    const cleanJid = jid =>
      String(jid || '')
        .split(':')[0]
        .split('@')[0];

    const botNumber = cleanJid(botId);
    const botLidNumber = cleanJid(botLid);

    const botParticipant = metadata.participants?.find(p => {
      const participantId = p.id || '';
      const participantNumber = cleanJid(participantId);

      return (
        participantId === botId ||
        participantId === botLid ||
        participantNumber === botNumber ||
        (
          botLidNumber &&
          participantNumber === botLidNumber
        )
      );
    });

    const botIsAdmin =
      !!botParticipant &&
      !!botParticipant.admin;

    if (!botIsAdmin) {
      console.log('BOT ID:', botId);
      console.log('BOT LID:', botLid);
      console.log(
        'BOT GROUP ROLE:',
        botParticipant?.admin || 'not-found'
      );

      await sock.sendMessage(
        chatId,
        {
          text: '⚠️ 𝗕𝗢𝗧 𝗔𝗗𝗠𝗜𝗡 𝗣𝗘𝗥𝗠𝗜𝗦𝗦𝗜𝗢𝗡\n\n🤖 𝗧𝗵𝗲 𝗯𝗼𝘁 𝗺𝘂𝘀𝘁 𝗯𝗲 𝗮 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻 𝘁𝗼 𝗸𝗶𝗰𝗸 𝗺𝗲𝗺𝗯𝗲𝗿𝘀.'
        },
        { quoted: msg }
      );
      return;
    }

    const context =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      {};

    let target =
      context.participant ||
      context.mentionedJid?.[0] ||
      '';

    if (!target) {
      const parts = cleanText.trim().split(/\s+/);
      const number = parts[1]?.replace(/\D/g, '');

      if (number) {
        target = number + '@s.whatsapp.net';
      }
    }

    if (!target) {
      await sock.sendMessage(
        chatId,
        {
          text: '🎯 𝗧𝗔𝗥𝗚𝗘𝗧 𝗠𝗜𝗦𝗦𝗜𝗡𝗚\n\n↳ 𝗥𝗲𝗽𝗹𝘆 𝘁𝗼 𝗮 𝗺𝗲𝗺𝗯𝗲𝗿 𝗮𝗻𝗱 𝘀𝗲𝗻𝗱 .kick\n↳ 𝗢𝗿 𝘂𝘀𝗲 .kick @user'
        },
        { quoted: msg }
      );
      return;
    }

    const targetParticipant = metadata.participants?.find(
      p =>
        p.id === target ||
        p.id?.split(':')[0] === target.split(':')[0]
    );

    if (!targetParticipant) {
      await sock.sendMessage(
        chatId,
        {
          text: '🔎 𝗨𝗦𝗘𝗥 𝗡𝗢𝗧 𝗙𝗢𝗨𝗡𝗗\n\n𝗧𝗵𝗲 𝘀𝗲𝗹𝗲𝗰𝘁𝗲𝗱 𝘂𝘀𝗲𝗿 𝗶𝘀 𝗻𝗼𝘁 𝗶𝗻 𝘁𝗵𝗶𝘀 𝗴𝗿𝗼𝘂𝗽.'
        },
        { quoted: msg }
      );
      return;
    }

    const targetJid = targetParticipant.id;
    const targetNumber = cleanJid(targetJid);

    if (targetNumber === botNumber) {
      await sock.sendMessage(
        chatId,
        {
          text: '🤖 𝗕𝗢𝗧 𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗜𝗢𝗡\n\n𝗧𝗵𝗲 𝗯𝗼𝘁 𝗰𝗮𝗻𝗻𝗼𝘁 𝗸𝗶𝗰𝗸 𝗶𝘁𝘀𝗲𝗹𝗳.'
        },
        { quoted: msg }
      );
      return;
    }

    const isCreator =
      metadata.owner &&
      (
        metadata.owner === targetJid ||
        metadata.owner.split(':')[0] === targetJid.split(':')[0]
      );

    if (isCreator) {
      await sock.sendMessage(
        chatId,
        {
          text: '🛡️ 𝗖𝗥𝗘𝗔𝗧𝗢𝗥 𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗜𝗢𝗡\n\n👑 𝗧𝗵𝗲 𝗴𝗿𝗼𝘂𝗽 𝗰𝗿𝗲𝗮𝘁𝗼𝗿 𝗰𝗮𝗻𝗻𝗼𝘁 𝗯𝗲 𝗿𝗲𝗺𝗼𝘃𝗲𝗱.'
        },
        { quoted: msg }
      );
      return;
    }

    await sock.sendMessage(
      chatId,
      {
        text:
          '⚡ 𝗞𝗜𝗖𝗞 𝗣𝗥𝗢𝗖𝗘𝗦𝗦\n\n' +
          `👤 @${targetNumber}\n` +
          '⏳ 𝗥𝗲𝗺𝗼𝘃𝗮𝗹 𝗽𝗿𝗼𝗰𝗲𝘀𝘀𝗶𝗻𝗴...',
        mentions: [targetJid]
      },
      { quoted: msg }
    );

    if (targetParticipant.admin) {
      await sock.sendMessage(
        chatId,
        {
          text:
            '👑 𝗔𝗗𝗠𝗜𝗡 𝗗𝗘𝗠𝗢𝗧𝗘\n\n' +
            `@${targetNumber} 𝗶𝘀 𝗯𝗲𝗶𝗻𝗴 𝗱𝗲𝗺𝗼𝘁𝗲𝗱 𝗯𝗲𝗳𝗼𝗿𝗲 𝗿𝗲𝗺𝗼𝘃𝗮𝗹.`,
          mentions: [targetJid]
        }
      );

      await sock.groupParticipantsUpdate(
        chatId,
        [targetJid],
        'demote'
      );

      await new Promise(
        resolve => setTimeout(resolve, 700)
      );
    }

    await sock.groupParticipantsUpdate(
      chatId,
      [targetJid],
      'remove'
    );

    await sock.sendMessage(
      chatId,
      {
        text:
          '⛔ 𝗞𝗜𝗖𝗞 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘\n\n' +
          `👤 @${targetNumber}\n` +
          '🚫 𝗠𝗲𝗺𝗯𝗲𝗿 𝘄𝗮𝘀 𝘀𝘂𝗰𝗰𝗲𝘀𝘀𝗳𝘂𝗹𝗹𝘆 𝗿𝗲𝗺𝗼𝘃𝗲𝗱.',
        mentions: [targetJid]
      }
    );

  } catch (err) {
    console.log('Kick error:', err?.message || err);

    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗞𝗜𝗖𝗞 𝗙𝗔𝗜𝗟𝗘𝗗\n\n' +
          '⚠️ 𝗥𝗲𝗺𝗼𝘃𝗮𝗹 𝗰𝗼𝘂𝗹𝗱 𝗻𝗼𝘁 𝗯𝗲 𝗰𝗼𝗺𝗽𝗹𝗲𝘁𝗲𝗱.'
      },
      { quoted: msg }
    ).catch(() => {});
  }

  return;
}

// LINK_WARNING_SYSTEM_V3
if (!global.antiLinkWarnings) {
  global.antiLinkWarnings = {};
}

// ANTILINK ON / OFF / STATUS
const antiLinkCommand =
  cleanText.match(/^\.antilink(?:\s+(on|off))?$/i);

if (antiLinkCommand) {
  if (!chatId.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ 𝗧𝗵𝗶𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱 𝗼𝗻𝗹𝘆 𝘄𝗼𝗿𝗸𝘀 𝗶𝗻 𝗴𝗿𝗼𝘂𝗽𝘀.'
      },
      { quoted: msg }
    );
    return;
  }

  try {
    const metadata = await sock.groupMetadata(chatId);

    const sender =
      msg.key?.participant ||
      msg.participant ||
      '';

    const requester = metadata.participants?.find(
      p => p.id === sender
    );

    if (!requester?.admin) {
      await sock.sendMessage(
        chatId,
        {
          text:
            '❌ 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬\n\n' +
            '𝗢𝗻𝗹𝘆 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻𝘀 𝗰𝗮𝗻 𝗰𝗵𝗮𝗻𝗴𝗲 𝗔𝗻𝘁𝗶𝗹𝗶𝗻𝗸 𝘀𝗲𝘁𝘁𝗶𝗻𝗴𝘀.'
        },
        { quoted: msg }
      );
      return;
    }

    const action = antiLinkCommand[1]?.toLowerCase();

    if (!action) {
      await sock.sendMessage(
        chatId,
        {
          text:
            '🔗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞 𝗦𝗬𝗦𝗧𝗘𝗠\n\n' +
            `📊 𝗦𝘁𝗮𝘁𝘂𝘀: ${settings.antilink ? '🟢 𝗢𝗡' : '🔴 𝗢𝗙𝗙'}\n\n` +
            '⚠️ 𝟭𝘀𝘁 𝗟𝗶𝗻𝗸 → 𝗪𝗮𝗿𝗻𝗶𝗻𝗴\n' +
            '🚨 𝟮𝗻𝗱 𝗟𝗶𝗻𝗸 → 𝗙𝗶𝗻𝗮𝗹 𝗪𝗮𝗿𝗻𝗶𝗻𝗴\n' +
            '⛔ 𝟯𝗿𝗱 𝗟𝗶𝗻𝗸 → 𝗞𝗶𝗰𝗸\n\n' +
            '👑 𝗔𝗱𝗺𝗶𝗻𝘀 𝗮𝗿𝗲 𝗮𝗹𝘀𝗼 𝗶𝗻𝗰𝗹𝘂𝗱𝗲𝗱.'
        },
        { quoted: msg }
      );

      return;
    }

    settings.antilink = action === 'on';

    if (!global.antiLinkWarnings[chatId]) {
      global.antiLinkWarnings[chatId] = {};
    }

    saveGroupSettings();

    await sock.sendMessage(
      chatId,
      {
        text: settings.antilink
          ? '🔗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞 𝗘𝗡𝗔𝗕𝗟𝗘𝗗\n\n' +
            '🔗 𝗟𝗶𝗻𝗸𝘀 𝗮𝗿𝗲 𝗻𝗼𝘄 𝗽𝗿𝗼𝗵𝗶𝗯𝗶𝘁𝗲𝗱.\n' +
            '⚠️ 𝟭𝘀𝘁 → 𝗪𝗮𝗿𝗻𝗶𝗻𝗴\n' +
            '🚨 𝟮𝗻𝗱 → 𝗙𝗶𝗻𝗮𝗹 𝗪𝗮𝗿𝗻𝗶𝗻𝗴\n' +
            '⛔ 𝟯𝗿𝗱 → 𝗞𝗶𝗰𝗸\n' +
            '👑 𝗔𝗱𝗺𝗶𝗻𝘀 𝗮𝗿𝗲 𝗮𝗹𝘀𝗼 𝗶𝗻𝗰𝗹𝘂𝗱𝗲𝗱.'
          : '🔕 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞 𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗'
      },
      { quoted: msg }
    );

    await sock.sendMessage(
      chatId,
      {
        react: {
          text: settings.antilink ? '🔗' : '🔕',
          key: msg.key
        }
      }
    ).catch(() => {});

  } catch (err) {
    console.log(
      'Antilink setting error:',
      err?.message || err
    );
  }

  return;
}


// ANTILINK DETECTOR — 3 STRIKE SYSTEM
if (
  chatId.endsWith('@g.us') &&
  settings.antilink
) {
  const text =
    cleanText ||
    '';

  const linkRegex =
    /(https?:\/\/|www\.|t\.me\/|chat\.whatsapp\.com\/|wa\.me\/|facebook\.com\/|instagram\.com\/|youtube\.com\/|youtu\.be\/|tiktok\.com\/)/i;

  if (linkRegex.test(text)) {
    const sender =
      msg.key?.participant ||
      msg.participant ||
      '';

    if (!sender) return;

    try {
      if (!global.antiLinkWarnings[chatId]) {
        global.antiLinkWarnings[chatId] = {};
      }

      const warnings =
        global.antiLinkWarnings[chatId];

      warnings[sender] =
        (warnings[sender] || 0) + 1;

      const count = warnings[sender];

      // DELETE LINK MESSAGE
      await sock.sendMessage(
        chatId,
        {
          delete: msg.key
        }
      ).catch(() => {});


      // 3RD STRIKE
      if (count >= 3) {
        await sock.sendMessage(
          chatId,
          {
            text:
              '⛔ 𝗨𝗦𝗘𝗥 𝗥𝗘𝗠𝗢𝗩𝗘𝗗\n\n' +
              `👤 @${sender.split('@')[0].split(':')[0]}\n` +
              '🔗 𝟯𝗿𝗱 𝗹𝗶𝗻𝗸 𝘃𝗶𝗼𝗹𝗮𝘁𝗶𝗼𝗻 𝗱𝗲𝘁𝗲𝗰𝘁𝗲𝗱.\n\n' +
              '❌ 𝗦𝘁𝗿𝗶𝗸𝗲: 𝟯/𝟯\n\n' +
              '𝗚𝗿𝗼𝘂𝗽 𝗿𝘂𝗹𝗲𝘀 𝘃𝗶𝗼𝗹𝗮𝘁𝗲𝗱.\n' +
              '🚫 𝗥𝗲𝗺𝗼𝘃𝗶𝗻𝗴 𝘂𝘀𝗲𝗿 𝗳𝗿𝗼𝗺 𝘁𝗵𝗲 𝗴𝗿𝗼𝘂𝗽...',
            mentions: [sender]
          },
          { quoted: msg }
        );

        await sock.sendMessage(
          chatId,
          {
            react: {
              text: '⛔',
              key: msg.key
            }
          }
        ).catch(() => {});

        await new Promise(
          resolve => setTimeout(resolve, 800)
        );

        await sock.groupParticipantsUpdate(
          chatId,
          [sender],
          'remove'
        ).catch(() => {});

        delete warnings[sender];

        return;
      }


      // 1ST STRIKE
      if (count === 1) {
        await sock.sendMessage(
          chatId,
          {
            react: {
              text: '⚠️',
              key: msg.key
            }
          }
        ).catch(() => {});

        await sock.sendMessage(
          chatId,
          {
            text:
              '⚠️ 𝗟𝗜𝗡𝗞 𝗪𝗔𝗥𝗡𝗜𝗡𝗚\n\n' +
              `👤 @${sender.split('@')[0].split(':')[0]}\n` +
              '🔗 𝗨𝗻𝗮𝘂𝘁𝗵𝗼𝗿𝗶𝘇𝗲𝗱 𝗹𝗶𝗻𝗸 𝗱𝗲𝘁𝗲𝗰𝘁𝗲𝗱 & 𝗿𝗲𝗺𝗼𝘃𝗲𝗱.\n\n' +
              '⚠️ 𝗦𝘁𝗿𝗶𝗸𝗲: 𝟭/𝟯\n\n' +
              '𝗣𝗹𝗲𝗮𝘀𝗲 𝗱𝗼𝗻’𝘁 𝘀𝗲𝗻𝗱 𝗹𝗶𝗻𝗸𝘀 𝗶𝗻 𝘁𝗵𝗶𝘀 𝗴𝗿𝗼𝘂𝗽.\n' +
              '𝟮 𝗺𝗼𝗿𝗲 𝘃𝗶𝗼𝗹𝗮𝘁𝗶𝗼𝗻𝘀 → 𝗞𝗶𝗰𝗸',
            mentions: [sender]
          },
          { quoted: msg }
        );

        return;
      }


      // 2ND STRIKE
      if (count === 2) {
        await sock.sendMessage(
          chatId,
          {
            react: {
              text: '🚨',
              key: msg.key
            }
          }
        ).catch(() => {});

        await sock.sendMessage(
          chatId,
          {
            text:
              '🚨 𝗙𝗜𝗡𝗔𝗟 𝗪𝗔𝗥𝗡𝗜𝗡𝗚\n\n' +
              `👤 @${sender.split('@')[0].split(':')[0]}\n` +
              '🔗 𝗨𝗻𝗮𝘂𝘁𝗵𝗼𝗿𝗶𝘇𝗲𝗱 𝗹𝗶𝗻𝗸 𝗱𝗲𝘁𝗲𝗰𝘁𝗲𝗱 & 𝗿𝗲𝗺𝗼𝘃𝗲𝗱.\n\n' +
              '⚠️ 𝗦𝘁𝗿𝗶𝗸𝗲: 𝟮/𝟯\n\n' +
              '𝗧𝗵𝗶𝘀 𝗶𝘀 𝘆𝗼𝘂𝗿 𝗳𝗶𝗻𝗮𝗹 𝘄𝗮𝗿𝗻𝗶𝗻𝗴.\n' +
              '𝗡𝗲𝘅𝘁 𝘃𝗶𝗼𝗹𝗮𝘁𝗶𝗼𝗻 → 𝗞𝗶𝗰𝗸',
            mentions: [sender]
          },
          { quoted: msg }
        );

        return;
      }

    } catch (err) {
      console.log(
        'Antilink detector error:',
        err?.message || err
      );
    }

    return;
  }
}


// ANTISTICKER_SYSTEM_V3
if (!global.antiStickerWarnings) {
  global.antiStickerWarnings = {};
}


// ANTISTICKER ON / OFF / STATUS
const antiStickerCommand =
  cleanText.match(/^\.antisticker(?:\s+(on|off))?$/i);

if (antiStickerCommand) {
  if (!chatId.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ 𝗧𝗵𝗶𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱 𝗼𝗻𝗹𝘆 𝘄𝗼𝗿𝗸𝘀 𝗶𝗻 𝗴𝗿𝗼𝘂𝗽𝘀.'
      },
      { quoted: msg }
    );
    return;
  }

  try {
    const metadata = await sock.groupMetadata(chatId);

    const sender =
      msg.key?.participant ||
      msg.participant ||
      '';

    const requester = metadata.participants?.find(
      p => p.id === sender
    );

    if (!requester?.admin) {
      await sock.sendMessage(
        chatId,
        {
          text:
            '❌ 𝗔𝗗𝗠𝗜𝗡 𝗢𝗡𝗟𝗬\n\n' +
            '𝗢𝗻𝗹𝘆 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻𝘀 𝗰𝗮𝗻 𝗰𝗵𝗮𝗻𝗴𝗲 𝗔𝗻𝘁𝗶𝘀𝘁𝗶𝗰𝗸𝗲𝗿 𝘀𝗲𝘁𝘁𝗶𝗻𝗴𝘀.'
        },
        { quoted: msg }
      );
      return;
    }

    const action =
      antiStickerCommand[1]?.toLowerCase();

    if (!action) {
      await sock.sendMessage(
        chatId,
        {
          text:
            '🎭 𝗔𝗡𝗧𝗜𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗦𝗬𝗦𝗧𝗘𝗠\n\n' +
            `📊 𝗦𝘁𝗮𝘁𝘂𝘀: ${settings.antisticker ? '🟢 𝗢𝗡' : '🔴 𝗢𝗙𝗙'}\n\n` +
            '⚠️ 𝟭𝘀𝘁 𝗦𝘁𝗶𝗰𝗸𝗲𝗿 → 𝗪𝗮𝗿𝗻𝗶𝗻𝗴\n' +
            '🚨 𝟮𝗻𝗱 𝗦𝘁𝗶𝗰𝗸𝗲𝗿 → 𝗙𝗶𝗻𝗮𝗹 𝗪𝗮𝗿𝗻𝗶𝗻𝗴\n' +
            '⛔ 𝟯𝗿𝗱 𝗦𝘁𝗶𝗰𝗸𝗲𝗿 → 𝗞𝗶𝗰𝗸\n\n' +
            '👑 𝗔𝗱𝗺𝗶𝗻𝘀 𝗮𝗿𝗲 𝗮𝗹𝘀𝗼 𝗶𝗻𝗰𝗹𝘂𝗱𝗲𝗱.'
        },
        { quoted: msg }
      );
      return;
    }

    settings.antisticker =
      action === 'on';

    if (!global.antiStickerWarnings[chatId]) {
      global.antiStickerWarnings[chatId] = {};
    } else {
      global.antiStickerWarnings[chatId] = {};
    }

    saveGroupSettings();

    await sock.sendMessage(
      chatId,
      {
        text: settings.antisticker
          ? '🎭 𝗔𝗡𝗧𝗜𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗘𝗡𝗔𝗕𝗟𝗘𝗗\n\n' +
            '🚫 𝗦𝘁𝗶𝗰𝗸𝗲𝗿𝘀 𝗮𝗿𝗲 𝗻𝗼𝘄 𝗽𝗿𝗼𝗵𝗶𝗯𝗶𝘁𝗲𝗱.\n' +
            '⚠️ 𝟭𝘀𝘁 → 𝗪𝗮𝗿𝗻𝗶𝗻𝗴\n' +
            '🚨 𝟮𝗻𝗱 → 𝗙𝗶𝗻𝗮𝗹 𝗪𝗮𝗿𝗻𝗶𝗻𝗴\n' +
            '⛔ 𝟯𝗿𝗱 → 𝗞𝗶𝗰𝗸\n' +
            '👑 𝗔𝗱𝗺𝗶𝗻𝘀 𝗮𝗿𝗲 𝗮𝗹𝘀𝗼 𝗶𝗻𝗰𝗹𝘂𝗱𝗲𝗱.'
          : '🔕 𝗔𝗡𝗧𝗜𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗'
      },
      { quoted: msg }
    );

    await sock.sendMessage(
      chatId,
      {
        react: {
          text: settings.antisticker ? '🎭' : '🔕',
          key: msg.key
        }
      }
    ).catch(() => {});

  } catch (err) {
    console.log(
      'Antisticker setting error:',
      err?.message || err
    );

    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗙𝗮𝗶𝗹𝗲𝗱 𝘁𝗼 𝗰𝗵𝗮𝗻𝗴𝗲 𝗔𝗻𝘁𝗶𝘀𝘁𝗶𝗰𝗸𝗲𝗿 𝘀𝗲𝘁𝘁𝗶𝗻𝗴.'
      },
      { quoted: msg }
    ).catch(() => {});
  }

  return;
}


// ANTISTICKER DETECTOR — ADMINS INCLUDED
if (
  chatId.endsWith('@g.us') &&
  settings.antisticker &&
  msg.message?.stickerMessage
) {
  const sender =
    msg.key?.participant ||
    msg.participant ||
    '';

  if (!sender) return;

  try {
    if (!global.antiStickerWarnings[chatId]) {
      global.antiStickerWarnings[chatId] = {};
    }

    const warnings =
      global.antiStickerWarnings[chatId];

    warnings[sender] =
      (warnings[sender] || 0) + 1;

    const count = warnings[sender];

    // DELETE STICKER
    await sock.sendMessage(
      chatId,
      {
        delete: msg.key
      }
    ).catch(() => {});


    // 3RD STRIKE → KICK
    if (count >= 3) {
      await sock.sendMessage(
        chatId,
        {
          text:
            '⛔ 𝗨𝗦𝗘𝗥 𝗥𝗘𝗠𝗢𝗩𝗘𝗗\n\n' +
            `👤 @${sender.split('@')[0].split(':')[0]}\n` +
            '🎭 𝟯𝗿𝗱 𝘀𝘁𝗶𝗰𝗸𝗲𝗿 𝘃𝗶𝗼𝗹𝗮𝘁𝗶𝗼𝗻 𝗱𝗲𝘁𝗲𝗰𝘁𝗲𝗱.\n\n' +
            '❌ 𝗦𝘁𝗿𝗶𝗸𝗲: 𝟯/𝟯\n\n' +
            '𝗚𝗿𝗼𝘂𝗽 𝗿𝘂𝗹𝗲𝘀 𝘃𝗶𝗼𝗹𝗮𝘁𝗲𝗱.\n' +
            '🚫 𝗥𝗲𝗺𝗼𝘃𝗶𝗻𝗴 𝘂𝘀𝗲𝗿 𝗳𝗿𝗼𝗺 𝘁𝗵𝗲 𝗴𝗿𝗼𝘂𝗽...',
          mentions: [sender]
        },
        { quoted: msg }
      );

      await sock.sendMessage(
        chatId,
        {
          react: {
            text: '⛔',
            key: msg.key
          }
        }
      ).catch(() => {});

      await new Promise(
        resolve => setTimeout(resolve, 800)
      );

      await sock.groupParticipantsUpdate(
        chatId,
        [sender],
        'remove'
      ).catch(() => {});

      delete warnings[sender];

      return;
    }


    // 1ST STRIKE
    if (count === 1) {
      await sock.sendMessage(
        chatId,
        {
          react: {
            text: '⚠️',
            key: msg.key
          }
        }
      ).catch(() => {});

      await sock.sendMessage(
        chatId,
        {
          text:
            '⚠️ 𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗪𝗔𝗥𝗡𝗜𝗡𝗚\n\n' +
            `👤 @${sender.split('@')[0].split(':')[0]}\n` +
            '🎭 𝗦𝘁𝗶𝗰𝗸𝗲𝗿 𝗱𝗲𝘁𝗲𝗰𝘁𝗲𝗱 & 𝗿𝗲𝗺𝗼𝘃𝗲𝗱.\n\n' +
            '⚠️ 𝗦𝘁𝗿𝗶𝗸𝗲: 𝟭/𝟯\n\n' +
            '𝗣𝗹𝗲𝗮𝘀𝗲 𝗱𝗼𝗻’𝘁 𝘀𝗲𝗻𝗱 𝘀𝘁𝗶𝗰𝗸𝗲𝗿𝘀 𝗶𝗻 𝘁𝗵𝗶𝘀 𝗴𝗿𝗼𝘂𝗽.\n' +
            '𝟮 𝗺𝗼𝗿𝗲 𝘃𝗶𝗼𝗹𝗮𝘁𝗶𝗼𝗻𝘀 → 𝗞𝗶𝗰𝗸',
          mentions: [sender]
        },
        { quoted: msg }
      );

      return;
    }


    // 2ND STRIKE
    if (count === 2) {
      await sock.sendMessage(
        chatId,
        {
          react: {
            text: '🚨',
            key: msg.key
          }
        }
      ).catch(() => {});

      await sock.sendMessage(
        chatId,
        {
          text:
            '🚨 𝗙𝗜𝗡𝗔𝗟 𝗪𝗔𝗥𝗡𝗜𝗡𝗚\n\n' +
            `👤 @${sender.split('@')[0].split(':')[0]}\n` +
            '🎭 𝗦𝘁𝗶𝗰𝗸𝗲𝗿 𝗱𝗲𝘁𝗲𝗰𝘁𝗲𝗱 & 𝗿𝗲𝗺𝗼𝘃𝗲𝗱.\n\n' +
            '⚠️ 𝗦𝘁𝗿𝗶𝗸𝗲: 𝟮/𝟯\n\n' +
            '𝗧𝗵𝗶𝘀 𝗶𝘀 𝘆𝗼𝘂𝗿 𝗳𝗶𝗻𝗮𝗹 𝘄𝗮𝗿𝗻𝗶𝗻𝗴.\n' +
            '𝗡𝗲𝘅𝘁 𝘃𝗶𝗼𝗹𝗮𝘁𝗶𝗼𝗻 → 𝗞𝗶𝗰𝗸',
          mentions: [sender]
        },
        { quoted: msg }
      );

      return;
    }

  } catch (err) {
    console.log(
      'Antisticker detector error:',
      err?.message || err
    );
  }

  return;
}


// SHORT SONG TITLE CLEANER
function getShortSongTitle(title) {
  let name = String(title || 'Song').trim();

  // Remove common YouTube title separators and everything after them
  name = name.split(/\s+[-|•·]\s+/)[0].trim();

  // Remove common bracket information
  name = name.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();

  // Remove common suffixes
  name = name.replace(
    /\s+(official|lyrics?|lyric|video|audio|music video|slowed|reverb|sped up|remix|version|visualizer).*$/i,
    ''
  ).trim();

  // Clean repeated spaces
  name = name.replace(/\s+/g, ' ').trim();

  // Keep it readable
  return name.slice(0, 80) || 'Song';
}

// SONG / PLAY / MUSIC

// GOODMORNING_AUTO_OPEN_V3
const goodMorningMatch = cleanText.match(/^\.goodmorning$/i);

if (goodMorningMatch) {
  if (!chatId?.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ 𝗧𝗵𝗶𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱 𝗼𝗻𝗹𝘆 𝘄𝗼𝗿𝗸𝘀 𝗶𝗻 𝗴𝗿𝗼𝘂𝗽𝘀.'
      },
      { quoted: msg }
    );
    return;
  }

  const gmSender =
    msg.key?.participant ||
    msg.participant ||
    msg.key?.remoteJid;

  let metadata = null;
  let gmAdmin = false;

  try {
    metadata = await sock.groupMetadata(chatId);

    const participant = metadata?.participants?.find(
      p =>
        p?.id === gmSender ||
        p?.phoneNumber === gmSender ||
        p?.jid === gmSender
    );

    gmAdmin =
      participant?.admin === 'admin' ||
      participant?.admin === 'superadmin' ||
      participant?.isAdmin === true ||
      participant?.isSuperAdmin === true;
  } catch (adminErr) {
    console.log(
      '⚠️ GoodMorning admin check failed:',
      adminErr?.message || adminErr
    );
  }

  if (!gmAdmin) {
    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗢𝗻𝗹𝘆 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻𝘀 𝗰𝗮𝗻 𝘂𝘀𝗲 .goodmorning'
      },
      { quoted: msg }
    );
    return;
  }

  // 🔓 Open group for everyone
  try {
    await sock.groupSettingUpdate(
      chatId,
      'not_announcement'
    );

    console.log(
      '🔓 GoodMorning: group opened for everyone'
    );
  } catch (openErr) {
    console.log(
      '⚠️ Could not open group:',
      openErr?.message || openErr
    );
  }

  const participants =
    metadata?.participants || [];

  const allMentions = participants
    .map(p =>
      p?.id ||
      p?.phoneNumber ||
      p?.jid
    )
    .filter(Boolean);

  const gmNumber = String(gmSender)
    .split(':')[0]
    .split('@')[0];


  const goodMorningText =
    '🔓 𝗚𝗥𝗢𝗨𝗣 𝗢𝗣𝗘𝗡𝗘𝗗\n\n' +
    '🌅 𝗚𝗢𝗢𝗗 𝗠𝗢𝗥𝗡𝗜𝗡𝗚\n\n' +
    '☀️ 𝗚𝗼𝗼𝗱 𝗠𝗼𝗿𝗻𝗶𝗻𝗴 𝗘𝘃𝗲𝗿𝘆𝗼𝗻𝗲!\n' +
    '💬 𝗡𝗼𝘄 𝗘𝘃𝗲𝗿𝘆𝗼𝗻𝗲 𝗖𝗮𝗻 𝗦𝗲𝗻𝗱 𝗠𝗲𝘀𝘀𝗮𝗴𝗲𝘀!\n' +
    '✨ 𝗚𝗿𝗼𝘂𝗽 𝗶𝘀 𝗢𝗽𝗲𝗻 — 𝗘𝗻𝗷𝗼𝘆 & 𝗦𝘁𝗮𝘆 𝗔𝗰𝘁𝗶𝘃𝗲 🔥\n\n' +
    '🔔 𝗛𝗲𝘆 𝗘𝘃𝗲𝗿𝘆𝗼𝗻𝗲!\n\n' +
    '👤 𝗢𝗽𝗲𝗻𝗲𝗱 𝗯𝘆 𝗔𝗱𝗺𝗶𝗻: @' +
    gmNumber +
    '\n\n' +
    '👨‍💻 𝗗𝗲𝘃𝗲𝗹𝗼𝗽𝗲𝗱 𝗯𝘆 𝗝𝗮𝗺𝗶𝗹 𝗔𝗵𝗺𝗲𝗱';

  let sentMessage = null;

  try {
    sentMessage = await sock.sendMessage(
      chatId,
      {
        text: goodMorningText,
        mentions: [gmSender]
      },
      { quoted: msg }
    );

    console.log(
      '✅ GoodMorning message sent with @all'
    );
  } catch (sendErr) {
    console.log(
      '❌ GoodMorning message error:',
      sendErr?.message || sendErr
    );
    return;
  }

  // 🌅 Reaction
  try {
    if (sentMessage?.key) {
      await sock.sendMessage(chatId, {
        react: {
          text: '🌅',
          key: sentMessage.key
        }
      });

      console.log(
        '🌅 GoodMorning reaction added'
      );
    }
  } catch (reactErr) {
    console.log(
      '⚠️ GoodMorning reaction failed:',
      reactErr?.message || reactErr
    );
  }

  return;
}

// DEMOTE_COMMAND_V3
const demoteMatch = cleanText.match(/^\.demote(?:\s+(.+))?$/i);

if (demoteMatch) {
  if (!chatId?.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      { text: '❌ 𝗧𝗵𝗶𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱 𝗼𝗻𝗹𝘆 𝘄𝗼𝗿𝗸𝘀 𝗶𝗻 𝗴𝗿𝗼𝘂𝗽𝘀.' },
      { quoted: msg }
    );
    return;
  }

  const demoteSender =
    msg.key?.participant ||
    msg.participant ||
    msg.key?.remoteJid;

  let groupMeta;

  try {
    groupMeta = await sock.groupMetadata(chatId);
  } catch (err) {
    await sock.sendMessage(
      chatId,
      { text: '❌ 𝗖𝗼𝘂𝗹𝗱 𝗻𝗼𝘁 𝗴𝗲𝘁 𝗴𝗿𝗼𝘂𝗽 𝗶𝗻𝗳𝗼.' },
      { quoted: msg }
    );
    return;
  }

  const senderParticipant =
    groupMeta?.participants?.find(
      p =>
        p?.id === demoteSender ||
        p?.phoneNumber === demoteSender ||
        p?.jid === demoteSender
    );

  const senderIsAdmin =
    senderParticipant?.admin === 'admin' ||
    senderParticipant?.admin === 'superadmin' ||
    senderParticipant?.isAdmin === true ||
    senderParticipant?.isSuperAdmin === true;

  if (!senderIsAdmin) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ 𝗢𝗻𝗹𝘆 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻𝘀 𝗰𝗮𝗻 𝘂𝘀𝗲 .demote'
      },
      { quoted: msg }
    );
    return;
  }

  // Target: reply first, otherwise mention
  let targetJid = null;

  const quotedParticipant =
    msg.message?.extendedTextMessage?.contextInfo?.participant;

  if (quotedParticipant) {
    targetJid = quotedParticipant;
  }

  if (!targetJid) {
    const mentioned =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
      msg.message?.imageMessage?.contextInfo?.mentionedJid ||
      msg.message?.videoMessage?.contextInfo?.mentionedJid;

    if (mentioned?.length) {
      targetJid = mentioned[0];
    }
  }

  if (!targetJid && demoteMatch[1]) {
    const number = demoteMatch[1]
      .replace(/[^0-9]/g, '');

    if (number) {
      targetJid = number + '@s.whatsapp.net';
    }
  }

  if (!targetJid) {
    await sock.sendMessage(
      chatId,
      {
        text:
          '⚠️ 𝗨𝘀𝗲 .demote by replying to an admin message or mentioning an admin.'
      },
      { quoted: msg }
    );
    return;
  }

  const targetParticipant =
    groupMeta?.participants?.find(
      p =>
        p?.id === targetJid ||
        p?.phoneNumber === targetJid ||
        p?.jid === targetJid
    );

  if (!targetParticipant) {
    await sock.sendMessage(
      chatId,
      { text: '❌ 𝗧𝗵𝗶𝘀 𝗺𝗲𝗺𝗯𝗲𝗿 𝗶𝘀 𝗻𝗼𝘁 𝗶𝗻 𝘁𝗵𝗲 𝗴𝗿𝗼𝘂𝗽.' },
      { quoted: msg }
    );
    return;
  }

  const targetAdmin =
    targetParticipant?.admin === 'admin' ||
    targetParticipant?.admin === 'superadmin' ||
    targetParticipant?.isAdmin === true ||
    targetParticipant?.isSuperAdmin === true;

  if (!targetAdmin) {
    await sock.sendMessage(
      chatId,
      { text: 'ℹ️ 𝗧𝗵𝗶𝘀 𝗺𝗲𝗺𝗯𝗲𝗿 𝗶𝘀 𝗻𝗼𝘁 𝗮𝗻 𝗮𝗱𝗺𝗶𝗻.' },
      { quoted: msg }
    );
    return;
  }

  try {
    await sock.groupParticipantsUpdate(
      chatId,
      [targetJid],
      'demote'
    );

    const targetNumber = String(targetJid)
      .split(':')[0]
      .split('@')[0];

    await sock.sendMessage(
      chatId,
      {
        text:
          '⬇️ 𝗗𝗘𝗠𝗢𝗧𝗘𝗗\n\n' +
          '👤 𝗠𝗲𝗺𝗯𝗲𝗿: @' + targetNumber + '\n' +
          '👑 𝗦𝘁𝗮𝘁𝘂𝘀: 𝗔𝗱𝗺𝗶𝗻 𝗥𝗲𝗺𝗼𝘃𝗲𝗱\n\n' +
          '👨‍💻 𝗗𝗲𝘃𝗲𝗹𝗼𝗽𝗲𝗱 𝗯𝘆 𝗝𝗮𝗺𝗶𝗹 𝗔𝗵𝗺𝗲𝗱',
        mentions: [targetJid]
      },
      { quoted: msg }
    );

    console.log(
      '✅ Demoted:',
      targetJid
    );
  } catch (err) {
    console.log(
      '❌ Demote error:',
      err?.stack || err?.message || err
    );

    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗗𝗲𝗺𝗼𝘁𝗲 𝗳𝗮𝗶𝗹𝗲𝗱. Make sure the bot is a group admin.'
      },
      { quoted: msg }
    );
  }

  return;
}


// GOODNIGHT_AUTO_CLOSE_V3
const goodNightMatch = cleanText.match(/^\.goodnight$/i);

if (goodNightMatch) {
  if (!chatId?.endsWith('@g.us')) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ 𝗧𝗵𝗶𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱 𝗼𝗻𝗹𝘆 𝘄𝗼𝗿𝗸𝘀 𝗶𝗻 𝗴𝗿𝗼𝘂𝗽𝘀.'
      },
      { quoted: msg }
    );
    return;
  }

  const gnSender =
    msg.key?.participant ||
    msg.participant ||
    msg.key?.remoteJid;

  let gnAdmin = false;

  try {
    const metadata = await sock.groupMetadata(chatId);

    const participant = metadata?.participants?.find(
      p =>
        p?.id === gnSender ||
        p?.phoneNumber === gnSender ||
        p?.jid === gnSender
    );

    gnAdmin =
      participant?.admin === 'admin' ||
      participant?.admin === 'superadmin' ||
      participant?.isAdmin === true ||
      participant?.isSuperAdmin === true;
  } catch (adminErr) {
    console.log(
      '⚠️ GoodNight admin check failed:',
      adminErr?.message || adminErr
    );
  }

  if (!gnAdmin) {
    await sock.sendMessage(
      chatId,
      {
        text:
          '❌ 𝗢𝗻𝗹𝘆 𝗴𝗿𝗼𝘂𝗽 𝗮𝗱𝗺𝗶𝗻𝘀 𝗰𝗮𝗻 𝘂𝘀𝗲 .goodnight'
      },
      { quoted: msg }
    );
    return;
  }

  try {
    // Close group so only admins can send messages
    await sock.groupSettingUpdate(
      chatId,
      'announcement'
    );
  } catch (err) {
    console.log(
      '⚠️ Could not close group:',
      err?.message || err
    );
  }

  const gnNumber = String(gnSender)
    .split(':')[0]
    .split('@')[0];

  const goodNightText =
    '🔒 𝗚𝗥𝗢𝗨𝗣 𝗖𝗟𝗢𝗦𝗘𝗗\n\n' +
    '🌙 𝗚𝗢𝗢𝗗 𝗡𝗜𝗚𝗛𝗧\n\n' +
    '🌃 𝗚𝗼𝗼𝗱 𝗡𝗶𝗴𝗵𝘁 𝗘𝘃𝗲𝗿𝘆𝗼𝗻𝗲!\n' +
    '💤 𝗡𝗼𝘄 𝗢𝗻𝗹𝘆 𝗔𝗱𝗺𝗶𝗻𝘀 𝗖𝗮𝗻 𝗦𝗲𝗻𝗱 𝗠𝗲𝘀𝘀𝗮𝗴𝗲𝘀!\n' +
    '✨ 𝗦𝘄𝗲𝗲𝘁 𝗗𝗿𝗲𝗮𝗺𝘀 & 𝗛𝗮𝘃𝗲 𝗔 𝗣𝗲𝗮𝗰𝗲𝗳𝘂𝗹 𝗡𝗶𝗴𝗵𝘁 🌌\n\n' +
    '👤 𝗖𝗹𝗼𝘀𝗲𝗱 𝗯𝘆 𝗔𝗱𝗺𝗶𝗻: @' + gnNumber + '\n\n' +
    '👨‍💻 𝗗𝗲𝘃𝗲𝗹𝗼𝗽𝗲𝗱 𝗯𝘆 𝗝𝗮𝗺𝗶𝗹 𝗔𝗵𝗺𝗲𝗱';

  await sock.sendMessage(
    chatId,
    {
      text: goodNightText,
      mentions: [gnSender]
    },
    { quoted: msg }
  );

  return;
}


// =========================================================
// DYNAMIC MENU — V1
// =========================================================

function buildDynamicMenu() {

  const categories = {

    "📥 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗": [
      ".fb",
      ".ig",
      ".tt"
    ],

    "🖼️ 𝗜𝗠𝗔𝗚𝗘 & 𝗩𝗜𝗗𝗘𝗢": [
      ".st",
      ".upscale",
      ".upscale1",
      ".vupscale",
      ".vv"
    ],

    "👥 𝗚𝗥𝗢𝗨𝗣 𝗠𝗔𝗡𝗔𝗚𝗘𝗠𝗘𝗡𝗧": [
      ".add",
      ".admins",
      ".antilink",
      ".antisticker",
      ".demote",
      ".groupinfo",
      ".kick",
      ".tagall"
    ],

    "⚙️ 𝗔𝗨𝗧𝗢 𝗙𝗘𝗔𝗧𝗨𝗥𝗘𝗦": [
      ".autoreact",
      ".goodbye",
      ".goodmorning",
      ".goodnight",
      ".statuslike",
      ".welcome"
    ],

    "🎭 𝗘𝗡𝗧𝗘𝗥𝗧𝗔𝗜𝗡𝗠𝗘𝗡𝗧": [
      ".compliment",
      ".dare",
      ".dice",
      ".fortune",
      ".joke",
      ".magic",
      ".meme",
      ".rate",
      ".riddle",
      ".riddleanswer",
      ".roast",
      ".slot",
      ".truth"
    ],

    "🕌 𝗜𝗦𝗟𝗔𝗠𝗜𝗖": [
      ".namaztime",
      ".namaztime end",
      ".surah"
    ],

    "🛠️ 𝗨𝗧𝗜𝗟𝗜𝗧𝗜𝗘𝗦": [
      ".ping"
    ]
  };

  // Commands intentionally hidden from the menu
  const hiddenCommands = new Set([
    ".song",
    ".play",
    ".music",
    ".menu"
  ]);

  const source = require("fs").readFileSync(__filename, "utf8");

  const detected = new Set();

  // Detect commands written as /^\.command
  const regex1 = /\\\^\\\.([a-z0-9]+)(?:\\b|\\\?)/gi;

  let match;

  while ((match = regex1.exec(source))) {
    detected.add("." + match[1].toLowerCase());
  }

  // Detect common cleanText.match(/^\.command
  const regex2 = /cleanText\.match\(\s*\/\^\\\.([a-z0-9]+)/gi;

  while ((match = regex2.exec(source))) {
    detected.add("." + match[1].toLowerCase());
  }

  // Existing menu commands
  const knownCommands = new Set();

  for (const list of Object.values(categories)) {
    for (const cmd of list) {
      knownCommands.add(cmd);
    }
  }

  // Add newly detected commands automatically
  const newCommands = [];

  for (const cmd of detected) {
    if (
      !hiddenCommands.has(cmd) &&
      !knownCommands.has(cmd)
    ) {
      newCommands.push(cmd);
    }
  }

  newCommands.sort();

  if (newCommands.length) {
    categories["🆕 𝗡𝗘𝗪 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦"] = newCommands;
  }

  let total = 0;

  let menu =
    '🤖 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 𝗩𝟯\n\n' +
    '👑 𝗢𝗪𝗡𝗘𝗥: 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗠𝗘𝗗\n' +
    '📱 𝗡𝗨𝗠𝗕𝗘𝗥: +𝟴𝟴𝟬𝟭𝟲𝟬𝟬𝟱𝟭𝟯𝟱𝟳𝟵\n';

  for (const [category, commands] of Object.entries(categories)) {

    menu += '\n' + category + '\n';

    for (const command of commands) {
      menu += `✦ ${command}\n`;

      // Count base commands only
      if (command !== ".namaztime end") {
        total++;
      }
    }
  }

  menu +=
    '\n📊 𝗧𝗢𝗧𝗔𝗟 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦: ' +
    String(total) +
    '\n\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    '👑 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗\n' +
    '━━━━━━━━━━━━━━━━━━';

  return menu;
}

// .menu command


// GSTATUS_COMMAND_V1_START
// .gstatus — OWNER ONLY
if (/^\.gstatus$/i.test(cleanText)) {

  const gstatusOwnerNumber = "8801600513579";

  const gstatusSender =
    String(
      msg.key?.participant ||
      msg.participant ||
      msg.key?.remoteJid ||
      ""
    )
      .split(":")[0]
      .split("@")[0];

  let gstatusIsOwner = gstatusSender === gstatusOwnerNumber;

  if (!gstatusIsOwner && chatId.endsWith("@g.us")) {
    try {
      const gstatusMeta = await sock.groupMetadata(chatId);

      const participant =
        gstatusMeta.participants?.find(
          p =>
            p.id === (msg.key?.participant || msg.participant) ||
            p.id?.split(":")[0] ===
              String(msg.key?.participant || msg.participant)
                .split(":")[0]
        );

      const phone =
        String(participant?.phoneNumber || "")
          .split(":")[0]
          .split("@")[0];

      if (phone === gstatusOwnerNumber) {
        gstatusIsOwner = true;
      }
    } catch (e) {
      console.log("GSTSTATUS owner mapping error:", e?.message || e);
    }
  }

  if (!gstatusIsOwner) {
    await sock.sendMessage(
      chatId,
      {
        text: "📛 This is an owner command."
      },
      { quoted: msg }
    );
    return;
  }

  await sock.sendMessage(chatId, {
    react: {
      text: "📢",
      key: msg.key
    }
  }).catch(() => {});

  if (!chatId.endsWith("@g.us")) {
    await sock.sendMessage(
      chatId,
      {
        text:
`📢 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦

❌ এই command শুধু Group-এ ব্যবহার করতে হবে।

একটি ছবি/ভিডিওতে Reply করে:
.gstatus`
      },
      { quoted: msg }
    );
    return;
  }

  const quotedMessage =
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  const imageMessage = quotedMessage?.imageMessage;
  const videoMessage = quotedMessage?.videoMessage;

  if (!imageMessage && !videoMessage) {
    await sock.sendMessage(
      chatId,
      {
        text:
`📢 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦

একটি ছবি অথবা ভিডিওতে Reply করে:

.gstatus

দাও।`
      },
      { quoted: msg }
    );
    return;
  }

  try {
    const {
      downloadContentFromMessage
    } = require("@whiskeysockets/baileys");

    const groupMeta = await sock.groupMetadata(chatId);

    const statusJidList = [];

    for (const participant of groupMeta.participants || []) {

      let jid = "";

      if (participant.phoneNumber) {
        jid = String(participant.phoneNumber)
          .split(":")[0]
          .split("@")[0] + "@s.whatsapp.net";
      } else if (
        participant.id &&
        participant.id.endsWith("@s.whatsapp.net")
      ) {
        jid = participant.id;
      }

      if (
        jid &&
        !statusJidList.includes(jid)
      ) {
        statusJidList.push(jid);
      }
    }

    if (!statusJidList.length) {
      throw new Error("No WhatsApp phone JIDs found for group members.");
    }

    const mediaMessage =
      imageMessage || videoMessage;

    const mediaType =
      imageMessage ? "image" : "video";

    const stream =
      await downloadContentFromMessage(
        mediaMessage,
        mediaType
      );

    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const mediaBuffer = Buffer.concat(chunks);

    const statusPayload = imageMessage
      ? {
          image: mediaBuffer,
          caption:
            "📢 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦"
        }
      : {
          video: mediaBuffer,
          caption:
            "📢 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦"
        };

    await sock.sendMessage(
      "status@broadcast",
      statusPayload,
      {
        statusJidList
      }
    );

    await sock.sendMessage(
      chatId,
      {
        text:
`✅ 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦 𝗦𝗘𝗡𝗧

📢 Group members-দের Status audience হিসেবে সেট করে পাঠানো হয়েছে।
👥 Members: ${statusJidList.length}`
      },
      { quoted: msg }
    );

  } catch (e) {

    console.log(
      "GSTSTATUS error:",
      e?.message || e
    );

    await sock.sendMessage(
      chatId,
      {
        text:
`❌ 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦 𝗙𝗔𝗜𝗟𝗘𝗗

${e?.message || "Unknown error"}`
      },
      { quoted: msg }
    );
  }

  return;
}
// GSTATUS_COMMAND_V1_END


// MENUDP_SYSTEM_V1_START
// .menudp — OWNER ONLY

// TOP10_COMMAND_V1_START
if (/^\.top\s+10$/i.test(cleanText)) {

  if (!chatId.endsWith("@g.us")) {
    await sock.sendMessage(
      chatId,
      {
        text:
`🏆 𝗧𝗢𝗣 𝟭𝟬

❌ এই command শুধু Group-এ ব্যবহার করা যাবে।`
      },
      { quoted: msg }
    );

    return;
  }

  await sock.sendMessage(chatId, {
    react: {
      text: "🏆",
      key: msg.key
    }
  }).catch(() => {});

  try {
    const fs = require("fs");
    const pathModule = require("path");

    const statsPath = pathModule.join(
      process.cwd(),
      "data",
      "message_stats.json"
    );

    if (!fs.existsSync(statsPath)) {
      await sock.sendMessage(
        chatId,
        {
          text:
`🏆 𝗧𝗢𝗣 𝟭𝟬

📊 এখনো কোনো message count পাওয়া যায়নি।

নতুন message আসার পর আবার:
.top 10`
        },
        { quoted: msg }
      );

      return;
    }

    const stats =
      JSON.parse(
        fs.readFileSync(
          statsPath,
          "utf8"
        )
      );

    const groupStats =
      stats[chatId] || {};

    const entries =
      Object.entries(groupStats)
        .filter(
          ([jid, count]) =>
            jid &&
            Number(count) > 0
        )
        .sort(
          (a, b) =>
            Number(b[1]) -
            Number(a[1])
        )
        .slice(0, 10);

    if (!entries.length) {
      await sock.sendMessage(
        chatId,
        {
          text:
`🏆 𝗧𝗢𝗣 𝟭𝟬

📊 এখনো কোনো message count নেই।`
        },
        { quoted: msg }
      );

      return;
    }

    let memberNames = {};

    try {
      const metadata =
        await sock.groupMetadata(chatId);

      for (const p of metadata.participants || []) {

        const possibleIds = [
          p.id,
          p.phoneNumber
        ].filter(Boolean);

        for (const id of possibleIds) {
          const cleanId =
            String(id)
              .split(":")[0];

          memberNames[cleanId] =
            p.notify ||
            p.name ||
            p.pushName ||
            cleanId;
        }
      }
    } catch (e) {
      console.log(
        "TOP10 group metadata error:",
        e?.message || e
      );
    }

    const medals = [
      "🥇",
      "🥈",
      "🥉",
      "4️⃣",
      "5️⃣",
      "6️⃣",
      "7️⃣",
      "8️⃣",
      "9️⃣",
      "🔟"
    ];

    let text =
`🏆 𝗧𝗢𝗣 𝟭𝟬 𝗠𝗘𝗦𝗦𝗔𝗚𝗘 𝗦𝗘𝗡𝗗𝗘𝗥𝗦

📊 𝗡𝗲𝘄 𝗰𝗼𝘂𝗻𝘁𝗶𝗻𝗴 𝗳𝗿𝗼𝗺 𝗻𝗼𝘄

`;

    let totalMessages = 0;

    entries.forEach(
      ([jid, count], index) => {

        const name =
          memberNames[jid] ||
          jid;

        const number =
          String(jid)
            .replace(
              /@s\.whatsapp\.net$/,
              ""
            );

        const displayName =
          name !== jid
            ? name
            : "+" + number;

        totalMessages +=
          Number(count);

        text +=
`${medals[index]} ${displayName}
   💬 ${Number(count).toLocaleString()} messages

`;
      }
    );

    text +=
`📈 𝗧𝗼𝗽 𝟭𝟬 𝗠𝗲𝘀𝘀𝗮𝗴𝗲𝘀:
${totalMessages.toLocaleString()}`;

    await sock.sendMessage(
      chatId,
      {
        text
      },
      { quoted: msg }
    );

  } catch (e) {

    console.log(
      "TOP10 command error:",
      e?.message || e
    );

    await sock.sendMessage(
      chatId,
      {
        text:
`❌ 𝗧𝗢𝗣 𝟭𝟬 𝗘𝗥𝗥𝗢𝗥

${e?.message || "Unknown error"}`
      },
      { quoted: msg }
    );
  }

  return;
}
// TOP10_COMMAND_V1_END






if (/^\.menudp$/i.test(cleanText)) {

  const menudpOwnerNumber = "8801600513579";

  const menudpSender =
    String(
      msg.key?.participant ||
      msg.participant ||
      msg.key?.remoteJid ||
      ""
    )
      .split(":")[0]
      .split("@")[0];

  let menudpIsOwner = menudpSender === menudpOwnerNumber;

  // LID -> phone mapping for group chats
  if (!menudpIsOwner && chatId.endsWith("@g.us")) {
    try {
      const menudpMeta = await sock.groupMetadata(chatId);

      const menudpParticipant =
        menudpMeta.participants?.find(
          p =>
            p.id === (msg.key?.participant || msg.participant) ||
            p.id?.split(":")[0] ===
              String(msg.key?.participant || msg.participant)
                .split(":")[0]
        );

      const menudpPhone =
        String(menudpParticipant?.phoneNumber || "")
          .split(":")[0]
          .split("@")[0];

      if (menudpPhone === menudpOwnerNumber) {
        menudpIsOwner = true;
      }
    } catch (e) {
      console.log("MENUDP owner mapping error:", e?.message || e);
    }
  }

  if (!menudpIsOwner) {
    await sock.sendMessage(
      chatId,
      {
        text: "📛 This is an owner command."
      },
      { quoted: msg }
    );
    return;
  }

  // Reaction
  await sock.sendMessage(chatId, {
    react: {
      text: "⚙️",
      key: msg.key
    }
  }).catch(() => {});

  // Find replied image
  const quotedMessage =
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  const imageMessage =
    quotedMessage?.imageMessage;

  if (!imageMessage) {
    await sock.sendMessage(
      chatId,
      {
        text:
`📸 𝗠𝗘𝗡𝗨 𝗗𝗣

একটি ছবিতে Reply করে
.menudp
দাও।

⚙️ এই ছবিটিই Menu DP হিসেবে Save হবে।`
      },
      { quoted: msg }
    );
    return;
  }

  try {
    const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
    const fs = require("fs");
    const pathModule = require("path");

    const dpDir = pathModule.join(process.cwd(), "data");
    const dpPath = pathModule.join(dpDir, "menu_dp.jpg");

    if (!fs.existsSync(dpDir)) {
      fs.mkdirSync(dpDir, { recursive: true });
    }

    const stream = await downloadContentFromMessage(
      imageMessage,
      "image"
    );

    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    fs.writeFileSync(dpPath, Buffer.concat(chunks));

    await sock.sendMessage(
      chatId,
      {
        text:
`✅ 𝗠𝗘𝗡𝗨 𝗗𝗣 𝗦𝗔𝗩𝗘𝗗

📸 নতুন Menu DP সেট করা হয়েছে।
⚙️ এখন থেকে .menu দিলে এই ছবিটা Menu-এর উপরে থাকবে।`
      },
      { quoted: msg }
    );

  } catch (e) {
    console.log("MENUDP save error:", e);

    await sock.sendMessage(
      chatId,
      {
        text: "❌ Menu DP save করতে সমস্যা হয়েছে।"
      },
      { quoted: msg }
    );
  }

  return;
}
// MENUDP_SYSTEM_V1_END


// LYRICS_COMMAND_V1_START

if (/^\.lyrics(?:\s+(.+))?$/i.test(cleanText)) {

  const lyricsMatch =
    cleanText.match(/^\.lyrics(?:\s+(.+))?$/i);

  const lyricsQuery =
    lyricsMatch?.[1]?.trim();

  // Reaction
  await sock.sendMessage(chatId, {
    react: {
      text: "🎵",
      key: msg.key
    }
  }).catch(() => {});

  if (!lyricsQuery) {
    await sock.sendMessage(
      chatId,
      {
        text:
`🎵 𝗟𝗬𝗥𝗜𝗖𝗦

Usage:
.lyrics <song name>

Example:
.lyrics Believer`
      },
      { quoted: msg }
    );
    return;
  }

  try {
    const { GoogleGenAI } = require("@google/genai");

    const apiKey =
      process.env.GEMINI_API_KEY ||
      global.GEMINI_API_KEY;

    if (!apiKey) {
      await sock.sendMessage(
        chatId,
        {
          text:
`❌ Gemini API key সেট করা হয়নি।

Termux:
export GEMINI_API_KEY="YOUR_API_KEY"

তারপর:
bot restart`
        },
        { quoted: msg }
      );
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents:
`Give concise information about this song:

${lyricsQuery}

Return:
🎵 Song Title
👤 Artist
💿 Album
📅 Release Year
🎼 Genre

Do NOT provide the full copyrighted lyrics.`
    });

    const result =
      response?.text ||
      "❌ Song information পাওয়া যায়নি।";

    await sock.sendMessage(
      chatId,
      {
        text:
`🎵 𝗦𝗢𝗡𝗚 𝗜𝗡𝗙𝗢

${result}

━━━━━━━━━━━━━━━━━━
👑 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 𝗩𝟯`
      },
      { quoted: msg }
    );

  } catch (e) {

    console.log(
      "Lyrics error:",
      e?.message || e
    );

    await sock.sendMessage(
      chatId,
      {
        text:
`❌ 𝗟𝗬𝗥𝗜𝗖𝗦 𝗘𝗥𝗥𝗢𝗥

Song information পাওয়া যায়নি।
আবার চেষ্টা করো।`
      },
      { quoted: msg }
    );
  }

  return;
}

// LYRICS_COMMAND_V1_END



// TRANSLATE_COMMAND_V1_START

if (/^\.translate(?:\s+(.+))?$/i.test(cleanText)) {

  const translateMatch =
    cleanText.match(/^\.translate(?:\s+(.+))?$/i);

  const translateText =
    translateMatch?.[1]?.trim();

  // Reaction
  await sock.sendMessage(chatId, {
    react: {
      text: "🌐",
      key: msg.key
    }
  }).catch(() => {});

  if (!translateText) {
    await sock.sendMessage(
      chatId,
      {
        text:
`🌐 𝗧𝗥𝗔𝗡𝗦𝗟𝗔𝗧𝗘

Usage:
.translate <text>

Examples:
.translate Hello, how are you?
.translate আমি বাংলাদেশকে ভালোবাসি`
      },
      { quoted: msg }
    );
    return;
  }

  try {

    const { GoogleGenAI } =
      require("@google/genai");

    const apiKey =
      process.env.GEMINI_API_KEY ||
      global.GEMINI_API_KEY;

    if (!apiKey) {
      await sock.sendMessage(
        chatId,
        {
          text:
`❌ Gemini API key সেট করা হয়নি।

Termux:
export GEMINI_API_KEY="YOUR_API_KEY"

তারপর:
bot restart`
        },
        { quoted: msg }
      );
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey
    });

    const response =
      await ai.models.generateContent({
        model: "gemini-3.8-flash",

        contents:
`Translate the following text.

Rules:
- English → Bengali
- Bengali → English
- Other languages → Bengali
- Keep the original meaning.
- Do not add explanations.
- Return ONLY the translated text.

Text:
${translateText}`
      });

    const translated =
      response?.text?.trim();

    if (!translated) {
      throw new Error(
        "Empty translation response"
      );
    }

    await sock.sendMessage(
      chatId,
      {
        text:
`🌐 𝗧𝗥𝗔𝗡𝗦𝗟𝗔𝗧𝗜𝗢𝗡

${translated}

━━━━━━━━━━━━━━━━━━
👑 𝗝𝗔𝗠𝗜𝗟 𝗔𝗛𝗠𝗘𝗗 𝗕𝗢𝗧 𝗩𝟯`
      },
      { quoted: msg }
    );

  } catch (e) {

    console.log(
      "Translate error:",
      e?.message || e
    );

    await sock.sendMessage(
      chatId,
      {
        text:
`❌ 𝗧𝗥𝗔𝗡𝗦𝗟𝗔𝗧𝗘 𝗘𝗥𝗥𝗢𝗥

Translation করতে সমস্যা হয়েছে।
আবার চেষ্টা করো।`
      },
      { quoted: msg }
    );
  }

  return;
}

// TRANSLATE_COMMAND_V1_END


if (/^\.menu$/i.test(cleanText)) {





  const menuText = buildDynamicMenu();

  // MENU_DP_CAPTION_V2
  try {
    const fs = require("fs");
    const pathModule = require("path");

    const menuDpPath = pathModule.join(
      process.cwd(),
      "data",
      "menu_dp.jpg"
    );

    if (fs.existsSync(menuDpPath)) {
      await sock.sendMessage(
        chatId,
        {
          image: fs.readFileSync(menuDpPath),
          caption: menuText
        },
        { quoted: msg }
      );
    } else {
      await sock.sendMessage(
        chatId,
        {
          text: menuText
        },
        { quoted: msg }
      );
    }
  } catch (e) {
    console.log("Menu DP caption error:", e?.message || e);

    await sock.sendMessage(
      chatId,
      {
        text: menuText
      },
      { quoted: msg }
    );
  }

  return;
}

const songMatch = cleanText.match(
  /^\.(song|play|music)\s+(.+)$/i
);

if (songMatch) {
  if (songBusy) {
    await sock.sendMessage(chatId, {
      text: '⏳ 𝗢𝗻𝗲 𝘀𝗼𝗻𝗴 𝗶𝘀 𝗮𝗹𝗿𝗲𝗮𝗱𝘆 𝗱𝗼𝘄𝗻𝗹𝗼𝗮𝗱𝗶𝗻𝗴...'
    }, { quoted: msg });
    return;
  }

  songBusy = true;

  let outputBase = null;
  let statusMsg = null;

  try {
    const query = songMatch[2].trim();

    // Simple status
    statusMsg = await sock.sendMessage(chatId, {
      text: '⬇️ 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱𝗶𝗻𝗴...'
    }, { quoted: msg });

    // YouTube search
    const result = await ytSearch(query);
    const video = result?.videos?.[0];

    if (!video?.url) {
      throw new Error('Song not found');
    }

    const title = video.title || query;
    const thumbnail =
      video.thumbnail ||
      video.image ||
      null;

    const fileName =
      `song_${Date.now()}_${safeFileName(title)}`;

    outputBase = path.join(
      songDownloadDir,
      fileName
    );

    const outputMp3 =
      outputBase + '.mp3';

    // Fast download
    await downloadSong(
      video.url,
      outputBase + '.%(ext)s'
    );

    if (!fs.existsSync(outputMp3)) {
      throw new Error('MP3 file was not created');
    }

    // Status update
    if (statusMsg?.key) {
      await sock.sendMessage(chatId, {
        text: '✅ 𝗔𝘂𝗱𝗶𝗼 𝗦𝗲𝗻𝘁',
        edit: statusMsg.key
      });
    }

    // Premium thumbnail caption
    const shortTitle = getShortSongTitle(title);

    const caption =
      '🤍 𝗝𝗮𝗺𝗶𝗹 𝗔𝗵𝗺𝗲𝗱\n\n' +
      `🎵 𝐒𝐨𝐧𝐠 : ${shortTitle}\n` +
      '✨ 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱 𝗖𝗼𝗺𝗽𝗹𝗲𝘁𝗲\n' +
      '🎧 𝗠𝘂𝘀𝗶𝗰 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱𝗲𝗱 ✅';

    // Actual YouTube thumbnail
    if (thumbnail) {
      try {
        await sock.sendMessage(chatId, {
          image: {
            url: thumbnail
          },
          caption
        }, { quoted: msg });
      } catch (imageErr) {
        console.log(
          '⚠️ Thumbnail send failed:',
          imageErr?.message || imageErr
        );
      }
    }

    // Send MP3
    const audio = fs.readFileSync(outputMp3);

    await sock.sendMessage(chatId, {
      audio,
      mimetype: 'audio/mpeg',
      fileName: `${safeFileName(title)}.mp3`,
      ptt: false
    }, { quoted: msg });

    console.log(
      '✅ Song sent:',
      title
    );

  } catch (err) {
    console.log(
      '❌ Song error:',
      err?.stack || err?.message || err
    );

    if (statusMsg?.key) {
      try {
        await sock.sendMessage(chatId, {
          text: '❌ 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱 𝗙𝗮𝗶𝗹𝗲𝗱',
          edit: statusMsg.key
        });
      } catch (_) {}
    }

  } finally {
    if (outputBase) {
      cleanupSongFiles(outputBase);
    }

    songBusy = false;
  }

  return;
}
    } catch (err) {
      console.log(
        'Message handler error:',
        err?.message || err
      );
    }
  });
}

startBot().catch((err) => {

  console.error('🔥 Bot startup error:', err);
});
