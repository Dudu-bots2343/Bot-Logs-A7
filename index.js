// index.js - A7 Logs (único arquivo)
// Dependências: discord.js v14, dotenv, express, @discordjs/voice
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  AuditLogEvent
} = require("discord.js");
const express = require("express");
const { joinVoiceChannel } = require("@discordjs/voice");

// ---------- CONFIG / ENV ----------
const TOKEN = process.env.DISCORD_TOKEN;

const GUILD_MAIN_ID = process.env.SERVIDOR_PRINCIPAL_ID;
const GUILD_LOGS_ID = process.env.SERVIDOR_LOGS_ID;

const CHANNEL_BUTTON_ID = process.env.CANAL_BOTAO_VINCULO;
const VOICE_CHANNEL_24H_ID = process.env.CANAL_VOZ_24H;
const PORT = process.env.PORT || 3000;

// Channels for logs (use your env vars)
const CH = {
  MENSAGEM_ENVIADA: process.env.LOG_MENSAGEM_ENVIADA,
  MENSAGEM_APAGADA: process.env.LOG_MENSAGEM_APAGADA,
  MENSAGEM_EDITADA: process.env.LOG_MENSAGEM_EDITADA,
  ADICIONOU_CARGO: process.env.LOG_ADICIONOU_CARGO,
  REMOVEU_CARGO: process.env.LOG_REMOVEU_CARGO,
  CRIAR_CARGO: process.env.LOG_CRIAR_CARGO,
  DELETOU_CARGO: process.env.LOG_DELETOU_CARGO,
  CRIAR_CANAL: process.env.LOG_CRIAR_CANAL,
  DELETOU_CANAL: process.env.LOG_DELETOU_CANAL,
  MOVEU_CANAL: process.env.LOG_MOVEU_CANAL,
  ENTROU_CALL: process.env.LOG_ENTROU_CALL,
  SAIU_CALL: process.env.LOG_SAIU_CALL,
  MOVEU_CALL: process.env.LOG_MOVEU_USUARIO_CALL,
  MUTOU: process.env.LOG_MUTOU_DESMUTOU,
  ENTROU_SERVIDOR: process.env.LOG_MENSAGEM_ENVIADA,
  SAIU_SERVIDOR: process.env.LOG_MENSAGEM_EDITADA,
  BOT_FALHA: process.env.LOG_MENSAGEM_APAGADA
};

// ROLE MAP (principal ID -> logs ID). Add as many as you want in .env using the *_LOGS pattern.
const ROLE_MAP = {
  [process.env.FOUNDER]: process.env.FOUNDER_LOGS,
  [process.env.DIRETOR_GERAL]: process.env.DIRETOR_GERAL_LOGS,
  [process.env.DIRETORIA_A7]: process.env.DIRETORIA_A7_LOGS,
  [process.env.ALTA_CUPULA_A7]: process.env.ALTA_CUPULA_A7_LOGS,
  [process.env.LEGADO_A7]: process.env.LEGADO_A7_LOGS
};
// For watching additions/removals in main:
const WATCHED_ROLE_IDS = Object.keys(ROLE_MAP);

// ---------- CLIENT ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember]
});

// ---------- HELPERS ----------
function getChannel(id) {
  if (!id) return null;
  return client.channels.cache.get(id) || null;
}

function sendEmbed(channelId, embed) {
  try {
    const ch = getChannel(channelId);
    if (!ch) return;
    ch.send({ embeds: [embed] }).catch(() => {});
  } catch (e) {
    console.error("sendEmbed error:", e);
  }
}

function formatDateBrazil(d = new Date()) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function makeEmbed(title, fields = [], color = 0x2b2d31) {
  const e = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp(new Date());
  if (fields && fields.length) e.addFields(...fields);
  return e;
}

// Fetch audit log executor with optional filter
async function fetchExecutor(guild, type, filterFn = null) {
  try {
    if (!guild || !type) return null;
    const logs = await guild.fetchAuditLogs({ type, limit: 10 }).catch(() => null);
    if (!logs) return null;
    const entry = logs.entries.find(e => (filterFn ? filterFn(e) : true));
    return entry ? entry.executor : null;
  } catch {
    return null;
  }
}

// ---------- SYNC: when user joins LOGS server give mapped roles from MAIN ----------
client.on("guildMemberAdd", async (member) => {
  try {
    if (member.guild.id !== GUILD_LOGS_ID) return;

    const mainGuild = await client.guilds.fetch(GUILD_MAIN_ID).catch(() => null);
    if (!mainGuild) {
      sendEmbed(CH.BOT_FALHA, makeEmbed("Erro: guild principal não encontrado", [{ name: "Info", value: `${GUILD_MAIN_ID}` }]));
      return;
    }

    // find same user in main
    const mainMember = await mainGuild.members.fetch(member.id).catch(() => null);
    if (!mainMember) {
      // kick if not in main
      await member.kick("Usuário não encontrado no servidor principal.").catch(() => {});
      sendEmbed(CH.SAIU_SERVIDOR, makeEmbed("Expulso do logs", [
        { name: "Usuário", value: `<@${member.id}>` },
        { name: "Motivo", value: "Não está no servidor principal" },
        { name: "Data/Hora", value: formatDateBrazil() }
      ]));
      return;
    }

    // collect watched roles the user has on main (but user asked: all roles of main -> we'll map only the ones present in ROLE_MAP)
    const rolesMain = mainMember.roles.cache.filter(r => WATCHED_ROLE_IDS.includes(r.id));
    if (!rolesMain || rolesMain.size === 0) {
      // If no mapped roles, kick
      await member.kick("Sem cargos mapeados no servidor principal.").catch(() => {});
      sendEmbed(CH.SAIU_SERVIDOR, makeEmbed("Expulso do logs", [
        { name: "Usuário", value: `<@${member.id}>` },
        { name: "Motivo", value: "Não possui cargos mapeados no servidor principal" },
        { name: "Data/Hora", value: formatDateBrazil() }
      ]));
      return;
    }

    // add mapped roles in logs guild
    const logsGuild = member.guild;
    const addedRoles = [];
    for (const [, r] of rolesMain) {
      const mapped = ROLE_MAP[r.id];
      if (!mapped) continue;
      const roleInLogs = logsGuild.roles.cache.get(mapped);
      if (roleInLogs) {
        await member.roles.add(roleInLogs).catch(() => {});
        addedRoles.push(roleInLogs.name);
      }
    }

    sendEmbed(CH.ENTROU_SERVIDOR, makeEmbed("Entrou no servidor de logs", [
      { name: "Usuário", value: `<@${member.id}>` },
      { name: "Cargos adicionados", value: addedRoles.length ? addedRoles.join(", ") : "Nenhum" },
      { name: "Data/Hora", value: formatDateBrazil() }
    ]));
  } catch (err) {
    console.error("guildMemberAdd error:", err);
  }
});

// ---------- WHEN USER LEAVES MAIN -> KICK FROM LOGS ----------
client.on("guildMemberRemove", async (member) => {
  try {
    if (member.guild.id !== GUILD_MAIN_ID) return;
    const logsGuild = await client.guilds.fetch(GUILD_LOGS_ID).catch(() => null);
    if (!logsGuild) return;
    const logsMember = await logsGuild.members.fetch(member.id).catch(() => null);
    if (logsMember) {
      await logsMember.kick("Saiu do servidor principal.").catch(() => {});
      sendEmbed(CH.SAIU_SERVIDOR, makeEmbed("Removido do logs", [
        { name: "Usuário", value: `<@${member.id}>` },
        { name: "Motivo", value: "Saiu do servidor principal" },
        { name: "Data/Hora", value: formatDateBrazil() }
      ]));
    }
  } catch (err) {
    console.error("guildMemberRemove error:", err);
  }
});

// ---------- SYNC ROLE CHANGES MAIN -> LOGS (add/remove watched roles) ----------
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    // only for main server
    if (newMember.guild.id !== GUILD_MAIN_ID) return;

    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id) && WATCHED_ROLE_IDS.includes(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id) && WATCHED_ROLE_IDS.includes(r.id));

    if (added.size === 0 && removed.size === 0) return;

    const logsGuild = await client.guilds.fetch(GUILD_LOGS_ID).catch(() => null);
    if (!logsGuild) return;
    const logsMember = await logsGuild.members.fetch(newMember.id).catch(() => null);
    if (!logsMember) return; // user not in logs -> nothing to sync

    // For added roles -> add mapped role in logs + try to fetch who did it
    for (const [, r] of added) {
      const mapped = ROLE_MAP[r.id];
      if (!mapped) continue;
      const roleInLogs = logsGuild.roles.cache.get(mapped);
      if (roleInLogs) {
        await logsMember.roles.add(roleInLogs).catch(() => {});
        // fetch executor
        const executor = await fetchExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, (e) => e.targetId === newMember.id);
        sendEmbed(CH.ADICIONOU_CARGO, makeEmbed("Cargo adicionado (sync)", [
          { name: "Cargo", value: `${roleInLogs.name}`, inline: true },
          { name: "Executado por", value: executor ? `${executor.tag} (${executor.id})` : "Desconhecido", inline: true },
          { name: "Usuário", value: `<@${newMember.id}>`, inline: true },
          { name: "Data/Hora", value: formatDateBrazil() }
        ]));
      }
    }

    // For removed roles -> remove mapped role in logs
    for (const [, r] of removed) {
      const mapped = ROLE_MAP[r.id];
      if (!mapped) continue;
      const roleInLogs = logsGuild.roles.cache.get(mapped);
      if (roleInLogs) {
        await logsMember.roles.remove(roleInLogs).catch(() => {});
        const executor = await fetchExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, (e) => e.targetId === newMember.id);
        sendEmbed(CH.REMOVEU_CARGO, makeEmbed("Cargo removido (sync)", [
          { name: "Cargo", value: `${roleInLogs.name}`, inline: true },
          { name: "Executado por", value: executor ? `${executor.tag} (${executor.id})` : "Desconhecido", inline: true },
          { name: "Usuário", value: `<@${newMember.id}>`, inline: true },
          { name: "Data/Hora", value: formatDateBrazil() }
        ]));
      }
    }
  } catch (err) {
    console.error("guildMemberUpdate sync error:", err);
  }
});

// ---------- MANUAL SYNC BUTTON ----------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    if (interaction.customId !== "vincular_cargos") return;

    await interaction.deferReply({ ephemeral: true });

    const logsGuild = await client.guilds.fetch(GUILD_LOGS_ID).catch(() => null);
    const logsMember = logsGuild ? await logsGuild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!logsMember) {
      await interaction.editReply("❌ Você não está no servidor de logs.");
      return;
    }

    const mainGuild = await client.guilds.fetch(GUILD_MAIN_ID).catch(() => null);
    const mainMember = mainGuild ? await mainGuild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!mainMember) {
      await interaction.editReply("❌ Você não está no servidor principal.");
      return;
    }

    // find roles in main that are in ROLE_MAP
    const rolesMain = mainMember.roles.cache.filter(r => WATCHED_ROLE_IDS.includes(r.id));
    if (!rolesMain || rolesMain.size === 0) {
      // Kick from logs if requested
      await logsMember.kick("Sem cargos mapeados no servidor principal.").catch(() => {});
      await interaction.editReply("❌ Você não possui cargos mapeados no servidor principal. Você foi removido do servidor de logs.");
      return;
    }

    const synced = [];
    for (const [, r] of rolesMain) {
      const mapped = ROLE_MAP[r.id];
      if (!mapped) continue;
      const roleObj = logsMember.guild.roles.cache.get(mapped);
      if (roleObj) {
        await logsMember.roles.add(roleObj).catch(() => {});
        synced.push(roleObj.name);
      }
    }

    await interaction.editReply(synced.length ? `✅ Cargos sincronizados: ${synced.join(", ")}` : "❌ Nenhum cargo sincronizado.");
  } catch (err) {
    console.error("button sync error:", err);
  }
});

// Post the button (on ready)
async function postButtonIfNeeded() {
  try {
    const ch = getChannel(CHANNEL_BUTTON_ID);
    if (!ch || !ch.isTextBased?.()) return;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vincular_cargos").setLabel("🔗 Vincular cargos").setStyle(ButtonStyle.Primary)
    );
    await ch.send({
      embeds: [ makeEmbed("Vincular cargos", [{ name: "Instruções", value: "Clique para sincronizar seus cargos com o servidor principal." }]) ],
      components: [row]
    }).catch(() => {});
  } catch (e) {
    console.error("postButton error:", e);
  }
}

// ---------- MESSAGE LOGS (create / update / delete) ----------
client.on("messageCreate", (msg) => {
  if (msg.author?.bot) return;
  const embed = makeEmbed("Mensagem enviada", [
    { name: "Autor", value: `${msg.author.tag} (${msg.author.id})`, inline: true },
    { name: "Canal", value: `${msg.channel?.name || msg.channelId}`, inline: true },
    { name: "Conteúdo", value: msg.content?.slice(0,1024) || "[embed/imagem]" },
    { name: "Data/Hora", value: formatDateBrazil() }
  ]);
  sendEmbed(CH.MENSAGEM_ENVIADA, embed);
});

client.on("messageUpdate", (oldMsg, newMsg) => {
  if (newMsg.author?.bot) return;
  const embed = makeEmbed("Mensagem editada", [
    { name: "Autor", value: `${newMsg.author.tag} (${newMsg.author.id})`, inline: true },
    { name: "Canal", value: `${newMsg.channel?.name || newMsg.channelId}`, inline: true },
    { name: "Antes", value: oldMsg.content?.slice(0,1024) || "[indisponível]" },
    { name: "Depois", value: newMsg.content?.slice(0,1024) || "[indisponível]" },
    { name: "Data/Hora", value: formatDateBrazil() }
  ]);
  sendEmbed(CH.MENSAGEM_EDITADA, embed);
});

client.on("messageDelete", async (msg) => {
  try {
    let deleter = null;
    if (msg.guild) {
      const exec = await fetchExecutor(msg.guild, AuditLogEvent.MessageDelete);
      if (exec) deleter = `${exec.tag} (${exec.id})`;
    }
    const embed = makeEmbed("Mensagem apagada", [
      { name: "Autor da mensagem", value: `${msg.author?.tag || "Desconhecido"} (${msg.author?.id || "N/A"})`, inline: true },
      { name: "Apagado por", value: deleter || "Desconhecido", inline: true },
      { name: "Canal", value: `${msg.channel?.name || msg.channelId}`, inline: true },
      { name: "Conteúdo", value: msg.content?.slice(0,1024) || "[embed/imagem]" },
      { name: "Data/Hora", value: formatDateBrazil() }
    ]);
    sendEmbed(CH.MENSAGEM_APAGADA, embed);
  } catch (err) {
    console.error("messageDelete error:", err);
  }
});

// ---------- VOICE LOGS ----------
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const user = newState.member?.user || oldState.member?.user;
    if (!user) return;

    // Enter
    if (!oldState.channelId && newState.channelId) {
      sendEmbed(CH.ENTROU_CALL, makeEmbed("Entrou na call", [
        { name: "Usuário", value: `${user.tag} (${user.id})`, inline: true },
        { name: "Canal", value: `${newState.channel?.name || newState.channelId}`, inline: true },
        { name: "Data/Hora", value: formatDateBrazil() }
      ]));
    }

    // Left
    if (oldState.channelId && !newState.channelId) {
      // try to find executor (someone who disconnected them) -- audit logs may not list disconnects reliably
      const executor = newState.guild ? await fetchExecutor(newState.guild, AuditLogEvent.MemberMove) : null;
      sendEmbed(CH.SAIU_CALL, makeEmbed("Saiu da call", [
        { name: "Usuário", value: `${user.tag} (${user.id})`, inline: true },
        { name: "Canal", value: `${oldState.channel?.name || oldState.channelId}`, inline: true },
        { name: "Desconectado por", value: executor ? `${executor.tag} (${executor.id})` : "Usuário/Desconhecido", inline: true },
        { name: "Data/Hora", value: formatDateBrazil() }
      ]));
    }

    // Moved
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      const executor = newState.guild ? await fetchExecutor(newState.guild, AuditLogEvent.MemberMove) : null;
      sendEmbed(CH.MOVEU_CALL, makeEmbed("Movido de call", [
        { name: "Usuário", value: `${user.tag} (${user.id})`, inline: true },
        { name: "De", value: `${oldState.channel?.name || oldState.channelId}`, inline: true },
        { name: "Para", value: `${newState.channel?.name || newState.channelId}`, inline: true },
        { name: "Executado por", value: executor ? `${executor.tag} (${executor.id})` : "Usuário/Desconhecido", inline: true },
        { name: "Data/Hora", value: formatDateBrazil() }
      ]));
    }

    // Mute/Unmute
    if (oldState.selfMute !== newState.selfMute) {
      sendEmbed(CH.MUTOU, makeEmbed("Mute/Unmute", [
        { name: "Usuário", value: `${user.tag} (${user.id})`, inline: true },
        { name: "Mute", value: `${newState.selfMute}`, inline: true },
        { name: "Data/Hora", value: formatDateBrazil() }
      ]));
    }

    if (oldState.selfDeaf !== newState.selfDeaf) {
      sendEmbed(CH.MUTOU, makeEmbed("Deaf/Undeaf", [
        { name: "Usuário", value: `${user.tag} (${user.id})`, inline: true },
        { name: "Deaf", value: `${newState.selfDeaf}`, inline: true },
        { name: "Data/Hora", value: formatDateBrazil() }
      ]));
    }
  } catch (err) {
    console.error("voiceStateUpdate error:", err);
  }
});

// ---------- ROLE & CHANNEL ADMIN LOGS (with author via audit) ----------
client.on("roleCreate", async (role) => {
  const executor = await fetchExecutor(role.guild, AuditLogEvent.RoleCreate, (e) => e.targetId === role.id);
  sendEmbed(CH.CRIAR_CARGO, makeEmbed("Cargo criado", [
    { name: "Cargo", value: `${role.name}` },
    { name: "ID", value: `${role.id}` },
    { name: "Criado por", value: executor ? `${executor.tag} (${executor.id})` : "Desconhecido" },
    { name: "Data/Hora", value: formatDateBrazil() }
  ]));
});

client.on("roleDelete", async (role) => {
  const executor = await fetchExecutor(role.guild, AuditLogEvent.RoleDelete, (e) => e.targetId === role.id);
  sendEmbed(CH.DELETOU_CARGO, makeEmbed("Cargo deletado", [
    { name: "Cargo", value: `${role.name}` },
    { name: "ID", value: `${role.id}` },
    { name: "Deletado por", value: executor ? `${executor.tag} (${executor.id})` : "Desconhecido" },
    { name: "Data/Hora", value: formatDateBrazil() }
  ]));
});

client.on("roleUpdate", async (oldRole, newRole) => {
  const executor = await fetchExecutor(newRole.guild, AuditLogEvent.RoleUpdate, (e) => e.targetId === newRole.id);
  sendEmbed(CH.DELETOU_CARGO, makeEmbed("Cargo editado", [
    { name: "Antes", value: `${oldRole.name}` },
    { name: "Depois", value: `${newRole.name}` },
    { name: "Editado por", value: executor ? `${executor.tag} (${executor.id})` : "Desconhecido" },
    { name: "Data/Hora", value: formatDateBrazil() }
  ]));
});

// CHANNELS
client.on("channelCreate", async (ch) => {
  const executor = await fetchExecutor(ch.guild, AuditLogEvent.ChannelCreate, (e) => e.targetId === ch.id);
  sendEmbed(CH.CRIAR_CANAL, makeEmbed("Canal criado", [
    { name: "Canal", value: `${ch.name}` },
    { name: "ID", value: `${ch.id}` },
    { name: "Criado por", value: executor ? `${executor.tag} (${executor.id})` : "Desconhecido" },
    { name: "Data/Hora", value: formatDateBrazil() }
  ]));
});

client.on("channelDelete", async (ch) => {
  const executor = await fetchExecutor(ch.guild, AuditLogEvent.ChannelDelete, (e) => e.targetId === ch.id);
  sendEmbed(CH.DELETOU_CANAL, makeEmbed("Canal deletado", [
    { name: "Canal", value: `${ch.name}` },
    { name: "ID", value: `${ch.id}` },
    { name: "Deletado por", value: executor ? `${executor.tag} (${executor.id})` : "Desconhecido" },
    { name: "Data/Hora", value: formatDateBrazil() }
  ]));
});

client.on("channelUpdate", async (oldC, newC) => {
  const executor = await fetchExecutor(newC.guild, AuditLogEvent.ChannelUpdate, (e) => e.targetId === newC.id);
  sendEmbed(CH.MOVEU_CANAL, makeEmbed("Canal editado", [
    { name: "Antes", value: `${oldC.name}` },
    { name: "Depois", value: `${newC.name}` },
    { name: "Editado por", value: executor ? `${executor.tag} (${executor.id})` : "Desconhecido" },
    { name: "Data/Hora", value: formatDateBrazil() }
  ]));
});

// ---------- BAN / KICK / OTHER ADMIN ----------
client.on("guildBanAdd", async (guild, user) => {
  const executor = await fetchExecutor(guild, AuditLogEvent.MemberBanAdd, (e) => e.targetId === user.id);
  sendEmbed(CH.BOT_FALHA, makeEmbed("Usuário banido", [
    { name: "Usuário", value: `${user.tag} (${user.id})` },
    { name: "Banido por", value: executor ? `${executor.tag} (${executor.id})` : "Desconhecido" },
    { name: "Data/Hora", value: formatDateBrazil() }
  ]));
});

// ---------- PROCESS ERRORS ----------
process.on("unhandledRejection", (err) => {
  console.error("UnhandledRejection:", err);
  sendEmbed(CH.BOT_FALHA, makeEmbed("UnhandledRejection", [{ name: "Erro", value: String(err).slice(0, 2000) }, { name: "Data/Hora", value: formatDateBrazil() }]));
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  sendEmbed(CH.BOT_FALHA, makeEmbed("uncaughtException", [{ name: "Erro", value: String(err).slice(0, 2000) }, { name: "Data/Hora", value: formatDateBrazil() }]));
});

// ---------- VOICE 24H CONNECT ----------
async function connectVoice24() {
  try {
    if (!VOICE_CHANNEL_24H_ID || !GUILD_MAIN_ID) return;
    const guild = await client.guilds.fetch(GUILD_MAIN_ID).catch(() => null);
    if (!guild) return;
    await joinVoiceChannel({
      channelId: VOICE_CHANNEL_24H_ID,
      guildId: GUILD_MAIN_ID,
      adapterCreator: guild.voiceAdapterCreator
    });
    console.log("Conectado no canal de voz 24h.");
  } catch (e) {
    console.error("connectVoice24 error:", e);
    setTimeout(connectVoice24, 10000);
  }
}

// ---------- EXPRESS KEEPALIVE ----------
const app = express();
app.get("/", (req, res) => res.send("OK"));
app.listen(PORT, () => console.log(`HTTP server listening on ${PORT}`));

// ---------- READY ----------
client.once("ready", async () => {
  console.log(`Bot ready: ${client.user.tag}`);
  await postButtonIfNeeded().catch(() => {});
  connectVoice24().catch(() => {});
});

// helper to post button
async function postButtonIfNeeded() {
  try {
    const ch = getChannel(CHANNEL_BUTTON_ID);
    if (!ch || !ch.isTextBased?.()) return;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vincular_cargos").setLabel("🔗 Vincular cargos").setStyle(ButtonStyle.Primary)
    );
    await ch.send({
      embeds: [ makeEmbed("Vincular cargos", [{ name: "Info", value: "Clique para sincronizar cargos com o servidor principal" }]) ],
      components: [row]
    }).catch(() => {});
  } catch (e) {
    console.error("postButtonIfNeeded:", e);
  }
}

// ---------- LOGIN ----------
client.login(TOKEN).catch(err => {
  console.error("Login failed:", err);
  process.exit(1);
});
