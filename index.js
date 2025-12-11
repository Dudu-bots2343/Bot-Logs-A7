require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const express = require('express');

const BOT_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_SOURCE_ID = process.env.GUILD_SOURCE_ID;
const GUILD_LOGS_ID = process.env.GUILD_LOGS_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const CHANNEL_ROLE_LINK = process.env.CHANNEL_ROLE_LINK;
const VOICE_REJOIN_MS = parseInt(process.env.VOICE_REJOIN_MS || '10000', 10);

if (!BOT_TOKEN || !GUILD_SOURCE_ID || !GUILD_LOGS_ID) {
  console.error('⚠️ Missing required .env values. Veja .env.example');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,           // necessário para sincronizar cargos / membros
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,         // para registrar conteúdo das mensagens (habilitar no dev portal)
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildPresences
  ],
  partials: [ Partials.Message, Partials.Channel, Partials.Reaction ]
});

// Helper: get channel by env var name
function getLogChannel(envName) {
  const id = process.env[envName];
  if (!id) return null;
  return client.channels.cache.get(id) || null;
}

function sendEmbedToChannel(channelId, embed) {
  if (!channelId) return;
  const ch = client.channels.cache.get(channelId);
  if (!ch) return;
  ch.send({ embeds: [embed] }).catch(console.error);
}

function formatTimestamp(date = new Date()) {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function makeBasicEmbed(title, description, color = 0x2f3136) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setTimestamp(new Date())
    .setColor(color);
}

/* -------------------
   ROLE SYNC LOGIC
   ------------------- */

// When a member joins the logs guild, we attempt to assign roles from the source guild
async function handleMemberJoinInLogs(member) {
  try {
    const sourceGuild = await client.guilds.fetch(GUILD_SOURCE_ID);
    const sourceMember = await sourceGuild.members.fetch(member.id).catch(() => null);

    if (!sourceMember) {
      // user not in source guild -> kick from logs guild
      const ch = getLogChannel('CHANNEL_LOG_MEMBER_JOIN');
      const emb = makeBasicEmbed('Membro entrou nos logs', `Usuário <@${member.id}> **não** pertence ao servidor principal. Expulsando do servidor de logs.`, 0xffcc00);
      sendEmbedToChannel(process.env.CHANNEL_LOG_MEMBER_JOIN, emb);
      await member.kick('Não pertence ao servidor principal');
      return;
    }

    // collect role names from sourceMember (exclude @everyone)
    const roleNames = sourceMember.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name);
    if (roleNames.length === 0) {
      // no roles -> expel
      const emb = makeBasicEmbed('Membro sem cargos', `Usuário <@${member.id}> não possui cargos no servidor principal. Expulsando do logs.`, 0xff0000);
      sendEmbedToChannel(process.env.CHANNEL_LOG_MEMBER_JOIN, emb);
      await member.kick('Sem cargos no servidor principal');
      return;
    }

    // For each role name, find role in logs guild and add
    const rolesToAdd = [];
    roleNames.forEach(name => {
      const r = member.guild.roles.cache.find(x => x.name === name);
      if (r) rolesToAdd.push(r);
    });

    if (rolesToAdd.length > 0) {
      await member.roles.add(rolesToAdd.map(r => r.id), 'Sync roles from source guild');
      const emb = makeBasicEmbed('Cargos sincronizados', `Cargos atribuidos ao usuário <@${member.id}>: ${rolesToAdd.map(r=>r.name).join(', ')}`, 0x00ff00);
      sendEmbedToChannel(process.env.CHANNEL_LOG_MEMBER_JOIN, emb);
    } else {
      // If no matching roles in logs guild, optionally add fallback role or expel
      if (process.env.FALLBACK_ROLE_ID) {
        await member.roles.add(process.env.FALLBACK_ROLE_ID, 'Fallback role');
        const emb = makeBasicEmbed('Fallback role atribuída', `Fallback role atribuída a <@${member.id}>.`, 0x00ff00);
        sendEmbedToChannel(process.env.CHANNEL_LOG_MEMBER_JOIN, emb);
      } else {
        const emb = makeBasicEmbed('Nenhum cargo correspondente', `Não foi possível encontrar cargos correspondentes para <@${member.id}> no servidor de logs. Expulsando.`, 0xff0000);
        sendEmbedToChannel(process.env.CHANNEL_LOG_MEMBER_JOIN, emb);
        await member.kick('Nenhum cargo correspondente');
      }
    }

  } catch (err) {
    console.error('Erro em handleMemberJoinInLogs:', err);
  }
}

// Button handler to sync roles manualmente
async function handleRoleLinkInteraction(interaction) {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'link_roles') return;

  await interaction.deferReply({ ephemeral: true });
  const logsGuild = await client.guilds.fetch(GUILD_LOGS_ID);
  const sourceGuild = await client.guilds.fetch(GUILD_SOURCE_ID);

  const logsMember = await logsGuild.members.fetch(interaction.user.id).catch(()=>null);
  const sourceMember = await sourceGuild.members.fetch(interaction.user.id).catch(()=>null);

  if (!logsMember) {
    await interaction.editReply('Você não está no servidor de logs.');
    return;
  }
  if (!sourceMember) {
    await interaction.editReply('Você não está no servidor principal, não posso vincular cargos.');
    // optionally kick
    await logsMember.kick('Tentou vincular cargos sem estar no servidor principal').catch(()=>{});
    return;
  }

  const roleNames = sourceMember.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name);
  if (roleNames.length === 0) {
    await interaction.editReply('Você não possui cargos no servidor principal (ou apenas @everyone).');
    await logsMember.kick('Sem cargos no servidor principal').catch(()=>{});
    return;
  }

  const rolesToAdd = [];
  roleNames.forEach(name => {
    const r = logsMember.guild.roles.cache.find(x => x.name === name);
    if (r) rolesToAdd.push(r);
  });

  if (rolesToAdd.length === 0 && process.env.FALLBACK_ROLE_ID) {
    await logsMember.roles.add(process.env.FALLBACK_ROLE_ID, 'Fallback assigned by button');
    await interaction.editReply('Nenhum cargo correspondente encontrado — fallback atribuído.');
    return;
  } else if (rolesToAdd.length === 0) {
    await interaction.editReply('Nenhum cargo correspondente encontrado no servidor de logs. Contate a administração.');
    return;
  }

  await logsMember.roles.add(rolesToAdd.map(r => r.id), 'Manual role link');
  await interaction.editReply(`Cargos atribuídos: ${rolesToAdd.map(r=>r.name).join(', ')}`);
}

/* -------------------
   LOG EVENT HANDLERS
   ------------------- */

client.on('messageCreate', message => {
  if (message.author.bot) return;
  const embed = new EmbedBuilder()
    .setTitle('Mensagem enviada')
    .setDescription(`Autor: ${message.author.tag} (${message.author.id})\nCanal: ${message.channel?.toString()}\nConteúdo:\n${message.content || '[embed/attachment]'}\n`)
    .setTimestamp(new Date())
    .setFooter({ text: `Guild: ${message.guild?.name || 'unknown'}`});
  sendEmbedToChannel(process.env.CHANNEL_LOG_MESSAGE_CREATE, embed);
});

client.on('messageDelete', message => {
  // partials may be present
  const content = message?.content || '[conteúdo não disponível]';
  const embed = makeBasicEmbed('Mensagem apagada', `Autor: ${message?.author?.tag || 'desconhecido'}\nCanal: ${message?.channel?.toString()}\nConteúdo: ${content}`);
  sendEmbedToChannel(process.env.CHANNEL_LOG_MESSAGE_DELETE, embed);
});

client.on('messageUpdate', (oldMessage, newMessage) => {
  const oldC = oldMessage?.content || '[não disponível]';
  const newC = newMessage?.content || '[não disponível]';
  const embed = new EmbedBuilder()
    .setTitle('Mensagem editada')
    .addFields(
      { name: 'Autor', value: `${newMessage?.author?.tag || 'desconhecido'}`, inline: true },
      { name: 'Canal', value: `${newMessage?.channel?.toString() || 'desconhecido'}`, inline: true },
      { name: 'Antes', value: oldC.slice(0, 1024) || '\u200b' },
      { name: 'Depois', value: newC.slice(0, 1024) || '\u200b' }
    )
    .setTimestamp(new Date());
  sendEmbedToChannel(process.env.CHANNEL_LOG_MESSAGE_UPDATE, embed);
});

// Another user's message deleted (webhook/mod purge detection is tricky) -- log as best-effort
client.on('messageDeleteBulk', messages => {
  const embed = makeBasicEmbed('Mensagens apagadas em massa', `Canal: ${messages.first()?.channel?.toString()}\nQuantidade: ${messages.size}`);
  sendEmbedToChannel(process.env.CHANNEL_LOG_MESSAGE_DELETE_OTHER, embed);
});

// Member join/leave
client.on('guildMemberAdd', member => {
  if (member.guild.id === GUILD_LOGS_ID) {
    handleMemberJoinInLogs(member);
  } else if (member.guild.id === GUILD_SOURCE_ID) {
    // someone joined the source guild - we log it
    const emb = makeBasicEmbed('Usuário entrou no servidor principal', `<@${member.id}> entrou no servidor principal.`);
    sendEmbedToChannel(process.env.CHANNEL_LOG_MEMBER_JOIN, emb);
  }
});

client.on('guildMemberRemove', async member => {
  // If they leave source server, remove from logs server
  if (member.guild.id === GUILD_SOURCE_ID) {
    const logsGuild = await client.guilds.fetch(GUILD_LOGS_ID);
    const inLogs = await logsGuild.members.fetch(member.id).catch(()=>null);
    if (inLogs) {
      await inLogs.kick('Usuário deixou o servidor principal');
      const emb = makeBasicEmbed('Removido do logs', `Usuário <@${member.id}> removido do servidor de logs pois saiu do principal.`);
      sendEmbedToChannel(process.env.CHANNEL_LOG_MEMBER_LEAVE, emb);
    }
  } else if (member.guild.id === GUILD_LOGS_ID) {
    const emb = makeBasicEmbed('Membro saiu do servidor de logs', `Usuário <@${member.id}> saiu dos logs.`);
    sendEmbedToChannel(process.env.CHANNEL_LOG_MEMBER_LEAVE, emb);
  }
});

client.on('guildMemberUpdate', (oldMember, newMember) => {
  // roles changed?
  const oldRoles = oldMember.roles.cache.map(r => r.name).filter(n => n !== '@everyone');
  const newRoles = newMember.roles.cache.map(r => r.name).filter(n => n !== '@everyone');
  if (oldRoles.join(',') !== newRoles.join(',')) {
    const emb = new EmbedBuilder()
      .setTitle('Cargos atualizados')
      .setDescription(`Usuário: ${newMember.user.tag} (${newMember.id})`)
      .addFields(
        { name: 'Antes', value: oldRoles.length ? oldRoles.join(', ') : 'Nenhum' },
        { name: 'Depois', value: newRoles.length ? newRoles.join(', ') : 'Nenhum' }
      )
      .setTimestamp(new Date());
    sendEmbedToChannel(process.env.CHANNEL_LOG_ROLE_UPDATE, emb);
  }
});

// Roles created/updated/deleted
client.on('roleCreate', role => {
  const emb = makeBasicEmbed('Cargo criado', `Nome: ${role.name}\nID: ${role.id}`);
  sendEmbedToChannel(process.env.CHANNEL_LOG_ROLE_CREATE, emb);
});
client.on('roleDelete', role => {
  const emb = makeBasicEmbed('Cargo deletado', `Nome: ${role.name}\nID: ${role.id}`);
  sendEmbedToChannel(process.env.CHANNEL_LOG_ROLE_DELETE, emb);
});
client.on('roleUpdate', (oldRole, newRole) => {
  const emb = new EmbedBuilder()
    .setTitle('Cargo atualizado')
    .addFields(
      { name: 'Antes', value: `${oldRole.name} (${oldRole.id})` },
      { name: 'Depois', value: `${newRole.name} (${newRole.id})` }
    )
    .setTimestamp(new Date());
  sendEmbedToChannel(process.env.CHANNEL_LOG_ROLE_UPDATE, emb);
});

// Channel events
client.on('channelCreate', channel => {
  const emb = makeBasicEmbed('Canal criado', `Nome: ${channel.name}\nTipo: ${channel.type}\nID: ${channel.id}`);
  sendEmbedToChannel(process.env.CHANNEL_LOG_CHANNEL_CREATE, emb);
});
client.on('channelDelete', channel => {
  const emb = makeBasicEmbed('Canal deletado', `Nome: ${channel?.name || 'desconhecido'}\nID: ${channel?.id || 'desconhecido'}`);
  sendEmbedToChannel(process.env.CHANNEL_LOG_CHANNEL_DELETE, emb);
});
client.on('channelUpdate', (oldC, newC) => {
  const emb = new EmbedBuilder()
    .setTitle('Canal atualizado')
    .addFields(
      { name: 'Antes', value: oldC.name || '—' },
      { name: 'Depois', value: newC.name || '—' }
    ).setTimestamp(new Date());
  sendEmbedToChannel(process.env.CHANNEL_LOG_CHANNEL_CREATE, emb);
});

// Voice events: join/leave/move/disconnect
client.on('voiceStateUpdate', (oldState, newState) => {
  const user = newState.member?.user || oldState.member?.user;
  if (!user) return;
  // joined a voice channel
  if (!oldState.channel && newState.channel) {
    const emb = makeBasicEmbed('Entrou em call', `Usuário: ${user.tag} (${user.id})\nCanal: ${newState.channel.name}`);
    sendEmbedToChannel(process.env.CHANNEL_LOG_VOICE, emb);
  } else if (oldState.channel && !newState.channel) {
    const emb = makeBasicEmbed('Saiu da call', `Usuário: ${user.tag} (${user.id})\nCanal: ${oldState.channel.name}`);
    sendEmbedToChannel(process.env.CHANNEL_LOG_VOICE, emb);
  } else if (oldState.channelId !== newState.channelId) {
    const emb = makeBasicEmbed('Movido entre calls', `Usuário: ${user.tag} (${user.id})\nDe: ${oldState.channel?.name}\nPara: ${newState.channel?.name}`);
    sendEmbedToChannel(process.env.CHANNEL_LOG_VOICE, emb);
  }

  // disconnected user forcibly? can't always detect who disconnected another user — moderation events needed
});

// Moderation (ban/kick) - we can log via guildAuditLogs but here simple hooks:
client.on('guildBanAdd', (guild, user) => {
  const emb = makeBasicEmbed('Usuário banido', `Usuário: ${user.tag} (${user.id})\nGuild: ${guild.name}`);
  sendEmbedToChannel(process.env.CHANNEL_LOG_MODERATION, emb);
});
client.on('guildBanRemove', (guild, user) => {
  const emb = makeBasicEmbed('Ban removido', `Usuário: ${user.tag} (${user.id})`);
  sendEmbedToChannel(process.env.CHANNEL_LOG_MODERATION, emb);
});

/* -------------
   INTERACTIONS
   ------------- */
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      await handleRoleLinkInteraction(interaction);
    }
  } catch (err) {
    console.error('Interaction handling error:', err);
  }
});

/* -------------
   READY + VOICE JOIN + POST BUTTON
   ------------- */
let voiceConnection;

client.once('ready', async () => {
  console.log(`Bot pronto. Logado como ${client.user.tag}`);

  // Post or update a message with a button in the configured channel to allow manual role linking
  if (CHANNEL_ROLE_LINK) {
    try {
      const ch = await client.channels.fetch(CHANNEL_ROLE_LINK);
      if (ch && ch.isTextBased && ch.permissionsFor(ch.guild.members.me).has(['SendMessages','EmbedLinks'])) {
        const button = new ButtonBuilder().setCustomId('link_roles').setLabel('Vincular cargos').setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(button);
        // send a new message with button
        await ch.send({ embeds: [makeBasicEmbed('Clique para vincular cargos', 'Se você não recebeu seu cargo automaticamente, clique no botão abaixo para vincular baseado no servidor principal.')], components: [row] });
      }
    } catch (err) {
      console.warn('Não foi possível postar message/button para LINK role:', err.message);
    }
  }

  // Attempt to join voice channel and stay in call
  tryJoinVoice();
});

// try to (re)join the configured voice channel and keep connection
async function tryJoinVoice() {
  if (!VOICE_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(VOICE_CHANNEL_ID);
    if (!channel || channel.type !== 2 && channel.type !== 'GUILD_VOICE' && channel.type !== 'Voice') {
      console.warn('VOICE_CHANNEL_ID não aponta para um canal de voz válido.');
      return;
    }
    voiceConnection = joinVoiceChannel({
      channelId: VOICE_CHANNEL_ID,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true
    });

    // await ready state
    entersState(voiceConnection, VoiceConnectionStatus.Ready, 20_000).then(() => {
      console.log('Bot conectado na call para manter-se online.');
    }).catch(() => {
      console.warn('Falha ao conectar ao voice. Tentando reenviar em breve.');
      voiceConnection.destroy();
      setTimeout(tryJoinVoice, VOICE_REJOIN_MS);
    });

    voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.warn('Voice desconectado, tentando reconectar...');
      try {
        await Promise.race([
          entersState(voiceConnection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5_000)
        ]);
        console.log('Reconectado ao voice.');
      } catch {
        voiceConnection.destroy();
        setTimeout(tryJoinVoice, VOICE_REJOIN_MS);
      }
    });

  } catch (err) {
    console.error('Erro ao tentar conectar na call:', err);
    setTimeout(tryJoinVoice, VOICE_REJOIN_MS);
  }
}

/* -------------
   Express (ping) -> para UptimeRobot / render health
   ------------- */
const app = express();
app.get('/', (req,res) => res.send('OK'));
app.get('/ping', (req,res) => res.send('pong'));
app.listen(process.env.PORT || 3000, () => {
  console.log('Express server running for health checks.');
});

client.login(BOT_TOKEN).catch(err => {
  console.error('Erro ao logar no discord:', err);
  process.exit(1);
});
