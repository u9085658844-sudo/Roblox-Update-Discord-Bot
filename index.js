// Load environment variables from .env FIRST — required for Pella.app
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, Colors, PermissionFlagsBits } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs = require('fs');
const https = require('https');

// ─── Token (loaded from .env file) ────────────────────────────────────────────
const token = process.env.TOKEN;

if (!token) {
  console.error('❌ FATAL: No TOKEN found in .env file! Add TOKEN=your_token_here to your .env');
  process.exit(1);
}

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG_FILE = './config.json';

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ guilds: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ─── Slash Commands ────────────────────────────────────────────────────────────
const commands = [
  {
    name: 'setup',
    description: '🛠️ Quick setup: configure channel and ping in one command',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      {
        name: 'channel',
        description: 'The channel to send updates to',
        type: 7,
        required: true,
        channel_types: [0],
      },
      {
        name: 'ping',
        description: 'Who to ping when an update is detected',
        type: 3,
        required: true,
        choices: [
          { name: '@everyone', value: 'everyone' },
          { name: 'Specific Role', value: 'role' },
          { name: 'No Ping', value: 'none' },
        ],
      },
      {
        name: 'role',
        description: 'Role to ping (only if ping is set to "Specific Role")',
        type: 8,
        required: false,
      },
    ],
  },
  {
    name: 'setchannel',
    description: '📡 Set the channel where Roblox update alerts will be sent',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      {
        name: 'channel',
        description: 'The channel to send updates to',
        type: 7,
        required: true,
        channel_types: [0],
      },
    ],
  },
  {
    name: 'setping',
    description: '🔔 Set which role (or @everyone) to ping on Roblox updates',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    options: [
      {
        name: 'type',
        description: 'Who to ping when an update is detected',
        type: 3,
        required: true,
        choices: [
          { name: '@everyone', value: 'everyone' },
          { name: 'Specific Role', value: 'role' },
          { name: 'No Ping', value: 'none' },
        ],
      },
      {
        name: 'role',
        description: 'Role to ping (only needed if type is "Specific Role")',
        type: 8,
        required: false,
      },
    ],
  },
  {
    name: 'status',
    description: '📊 View current bot configuration for this server',
  },
  {
    name: 'testupdate',
    description: '🧪 Send a test Roblox update embed to the configured channel',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
  },
  {
    name: 'reset',
    description: '🗑️ Reset all bot settings for this server',
    default_member_permissions: String(PermissionFlagsBits.Administrator),
  },
];

// ─── Roblox Fetcher ────────────────────────────────────────────────────────────
let lastKnownVersion = null;

function fetchRobloxVersion() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'clientsettingscdn.roblox.com',
        path: '/v2/client-version/WindowsPlayer',
        method: 'GET',
        headers: { 'User-Agent': 'RobloxTrackerBot/1.0' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Failed to parse Roblox API response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function buildUpdateEmbed(versionData, isTest = false) {
  const version = versionData.clientVersionUpload || versionData.version || 'Unknown';
  const bootstrapVersion = versionData.bootstrapperVersion || 'N/A';

  return new EmbedBuilder()
    .setTitle(isTest ? '🧪 [TEST] Roblox Update Detected!' : '🎮 Roblox Update Detected!')
    .setDescription(
      isTest
        ? 'This is a test embed. No actual update was detected.'
        : 'A new Roblox client version has been released!'
    )
    .setColor(isTest ? Colors.Yellow : 0xe8414d)
    .setThumbnail(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Roblox_2022_logo.png/320px-Roblox_2022_logo.png'
    )
    .addFields(
      { name: '📦 Version', value: `\`${version}\``, inline: true },
      { name: '🔧 Bootstrapper', value: `\`${bootstrapVersion}\``, inline: true },
      { name: '🕒 Detected At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
      {
        name: '🔗 Links',
        value:
          '[Download Roblox](https://www.roblox.com/download) • [Roblox Status](https://status.roblox.com/) • [Dev Forum](https://devforum.roblox.com/)',
        inline: false,
      }
    )
    .setFooter({
      text: 'Roblox Update Tracker • Powered by Haunter',
      iconURL:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Roblox_2022_logo.png/320px-Roblox_2022_logo.png',
    })
    .setTimestamp();
}

// ─── Discord Client ────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📡 Serving ${client.guilds.cache.size} guild(s)`);

  // Register slash commands globally
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered globally!');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }

  // Fetch initial Roblox version
  try {
    const data = await fetchRobloxVersion();
    lastKnownVersion = data.clientVersionUpload || data.version;
    console.log(`🎮 Current Roblox version: ${lastKnownVersion}`);
  } catch (e) {
    console.warn('⚠️  Could not fetch initial Roblox version:', e.message);
  }

  // Poll every 5 minutes
  setInterval(checkForUpdate, 5 * 60 * 1000);
});

// ─── Update Checker ────────────────────────────────────────────────────────────
async function checkForUpdate() {
  try {
    const data = await fetchRobloxVersion();
    const version = data.clientVersionUpload || data.version;

    if (lastKnownVersion && version !== lastKnownVersion) {
      console.log(`🚀 New version detected: ${lastKnownVersion} → ${version}`);
      lastKnownVersion = version;
      await broadcastUpdate(data, false, null);
    } else {
      console.log(`🔍 [${new Date().toLocaleTimeString()}] No update. Version: ${version}`);
      lastKnownVersion = version;
    }
  } catch (e) {
    console.error('❌ Error checking Roblox version:', e.message);
  }
}

// ─── Broadcaster ───────────────────────────────────────────────────────────────
async function broadcastUpdate(versionData, isTest = false, targetGuildId = null) {
  const cfg = loadConfig();
  const embed = buildUpdateEmbed(versionData, isTest);

  const guildsToNotify = targetGuildId
    ? cfg.guilds[targetGuildId]
      ? [[targetGuildId, cfg.guilds[targetGuildId]]]
      : []
    : Object.entries(cfg.guilds);

  for (const [guildId, guildCfg] of guildsToNotify) {
    if (!guildCfg?.channelId) continue;
    try {
      const channel = await client.channels.fetch(guildCfg.channelId);
      if (!channel) continue;

      let pingText = '';
      if (guildCfg.pingType === 'everyone') pingText = '@everyone';
      else if (guildCfg.pingType === 'role' && guildCfg.roleId) pingText = `<@&${guildCfg.roleId}>`;

      await channel.send({ content: pingText || undefined, embeds: [embed] });
      console.log(`📨 Sent update to guild ${guildId} in #${channel.name}`);
    } catch (err) {
      console.error(`❌ Failed to send to guild ${guildId}:`, err.message);
    }
  }
}

// ─── Slash Command Handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guildId) {
    await interaction.reply({ content: '❌ This bot can only be used inside a server.', ephemeral: true });
    return;
  }

  const cfg = loadConfig();
  const guildId = interaction.guildId;
  if (!cfg.guilds[guildId]) cfg.guilds[guildId] = {};

  // /setup
  if (interaction.commandName === 'setup') {
    const channel = interaction.options.getChannel('channel');
    const pingType = interaction.options.getString('ping');
    const role = interaction.options.getRole('role');

    if (pingType === 'role' && !role) {
      await interaction.reply({ content: '❌ You must provide a role when selecting "Specific Role".', ephemeral: true });
      return;
    }

    cfg.guilds[guildId].channelId = channel.id;
    cfg.guilds[guildId].pingType = pingType;
    if (pingType === 'role' && role) cfg.guilds[guildId].roleId = role.id;
    else delete cfg.guilds[guildId].roleId;
    saveConfig(cfg);

    let pingDesc = 'No ping';
    if (pingType === 'everyone') pingDesc = '@everyone';
    else if (pingType === 'role' && role) pingDesc = `<@&${role.id}>`;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🛠️ Setup Complete!')
          .setDescription('Your server is now configured to receive Roblox update alerts.')
          .setColor(Colors.Green)
          .addFields(
            { name: '📡 Update Channel', value: `${channel}`, inline: true },
            { name: '🔔 Ping Setting', value: pingDesc, inline: true }
          )
          .setFooter({ text: 'Roblox Update Tracker • Powered by Haunter' })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
    return;
  }

  // /setchannel
  if (interaction.commandName === 'setchannel') {
    const channel = interaction.options.getChannel('channel');
    cfg.guilds[guildId].channelId = channel.id;
    saveConfig(cfg);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Update Channel Set!')
          .setDescription(`Roblox update alerts will now be sent to ${channel}.`)
          .setColor(Colors.Green)
          .setFooter({ text: 'Roblox Update Tracker • Powered by Haunter' })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
    return;
  }

  // /setping
  if (interaction.commandName === 'setping') {
    const type = interaction.options.getString('type');
    const role = interaction.options.getRole('role');

    if (type === 'role' && !role) {
      await interaction.reply({ content: '❌ You must provide a role when selecting "Specific Role".', ephemeral: true });
      return;
    }

    cfg.guilds[guildId].pingType = type;
    if (type === 'role' && role) cfg.guilds[guildId].roleId = role.id;
    else delete cfg.guilds[guildId].roleId;
    saveConfig(cfg);

    let description = 'No ping will be sent on update.';
    if (type === 'everyone') description = 'Will ping **@everyone** on update.';
    else if (type === 'role' && role) description = `Will ping **${role.name}** on update.`;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔔 Ping Settings Updated!')
          .setDescription(description)
          .setColor(Colors.Blue)
          .setFooter({ text: 'Roblox Update Tracker • Powered by Haunter' })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
    return;
  }

  // /status
  if (interaction.commandName === 'status') {
    const guildCfg = cfg.guilds[guildId] || {};
    const channelText = guildCfg.channelId ? `<#${guildCfg.channelId}>` : '❌ Not set';

    let pingText = '❌ Not set';
    if (guildCfg.pingType === 'everyone') pingText = '@everyone';
    else if (guildCfg.pingType === 'role' && guildCfg.roleId) pingText = `<@&${guildCfg.roleId}>`;
    else if (guildCfg.pingType === 'none') pingText = 'No ping';

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📊 Bot Configuration')
          .setColor(0xe8414d)
          .addFields(
            { name: '📡 Update Channel', value: channelText, inline: true },
            { name: '🔔 Ping Setting', value: pingText, inline: true },
            { name: '🎮 Last Known Version', value: lastKnownVersion ? `\`${lastKnownVersion}\`` : 'Fetching...', inline: true },
            { name: '⏱️ Poll Interval', value: 'Every 5 minutes', inline: true },
            { name: '🌐 Servers Tracked', value: `${Object.keys(cfg.guilds).length}`, inline: true }
          )
          .setFooter({ text: 'Roblox Update Tracker • Powered by Haunter' })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
    return;
  }

  // /testupdate
  if (interaction.commandName === 'testupdate') {
    const guildCfg = cfg.guilds[guildId] || {};
    if (!guildCfg.channelId) {
      await interaction.reply({ content: '❌ No channel set! Use `/setup` or `/setchannel` first.', ephemeral: true });
      return;
    }

    await interaction.reply({ content: '🧪 Sending test embed...', ephemeral: true });
    await broadcastUpdate(
      { clientVersionUpload: lastKnownVersion || 'version-abc123', bootstrapperVersion: '2.0.0' },
      true,
      guildId
    );
    return;
  }

  // /reset
  if (interaction.commandName === 'reset') {
    delete cfg.guilds[guildId];
    saveConfig(cfg);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🗑️ Configuration Reset')
          .setDescription('All settings for this server have been cleared. Use `/setup` to reconfigure.')
          .setColor(Colors.Red)
          .setFooter({ text: 'Roblox Update Tracker • Powered by Haunter' })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
    return;
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
client.login(token);
