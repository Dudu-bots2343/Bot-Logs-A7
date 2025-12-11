// index.js
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

// === ENV ===
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const SERVIDOR_PRINCIPAL = process.env.SERVIDOR_PRINCIPAL_ID;
const SERVIDOR_LOGS = process.env.SERVIDOR_LOGS_ID;

const CANAL_BOTAO_VINCULO = process.env.CANAL_BOTAO_VINCULO;
const CANAL_VOZ_24H = process.env.CANAL_VOZ_24H;

const CH_LOGS = {
  MENSAGEM_ENVIADA: process.env.LOG_MENSAGEM_ENVIADA,
  MENSAGEM_APAGADA: process.env.LOG_MENSAGEM_APAGADA,
  MENSAGEM_EDITADA: process.env.LOG_MENSAGEM_EDITADA,
  MENSAGEM_OUTRO_APAGADA: process.env.LOG_MENSAGEM_APAGADA /* pode ter canal separado se quiser */,
  APROVACAO_REJEICAO: process.env.LOG_ADICIONOU_CARGO /* reuse or new var */,
  NOME_ATUALIZADO: process.env.LOG_MENSAGEM_EDITADA /* reuse */,
  CRIAR_CARGO: process.env.LOG_CRIAR_CARGO,
  EDITAR_CARGO: process.env.LOG_CRIAR_CARGO /* reuse */,
  ADICIONOU_CARGO: process.env.LOG_ADICIONOU_CARGO,
  REMOVEU_CARGO: process.env.LOG_REMOVEU_CARGO,
  DELETOU_CARGO: process.env.LOG_DELETOU_CARGO,
  ENTROU_CALL: process.env.LOG_ENTROU_CALL,
  SAIU_CALL: process.env.LOG_SAIU_CALL,
  DESCONCT_CALL: process.env.LOG_SAIU_CALL,
  MOVEU_CALL: process.env.LOG_MOVEU_USUARIO_CALL,
  CRIOU_CANAL: process.env.LOG_CRIAR_CANAL,
  DELETOU_CANAL: process.env.LOG_DELETOU_CANAL,
  MOVEU_CANAL: process.env.LOG_MOVEU_CANAL,
  ENTROU_SERVIDOR: process.env.LOG_MENSAGEM_ENVIADA,
  SAIU_SERVIDOR: process.env.LOG_MENSAGEM_EDITADA,
  SPAM_SUSPEITO: process.env.LOG_MENSAGEM_APAGADA,
  BOT_FALHA: process.env.LOG_MENSAGEM_APAGADA,
  BAN: process.env.LOG_DELETOU_CARGO,
  EXPULSAO: process.env.LOG_DELETOU_CARGO,
  CASTIGO: process.env.LOG_DELETOU_CARGO,
  SILENCIO: process.env.LOG_MUTOU_DESMUTOU,
  MUTE: process.env.LOG_MUTOU_DESMUTOU
};

// === ROLE MAP (MAIN ID => LOGS ID) ===
// Você já colocou essas variáveis no .env; usamos a convenção *_LOGS para o servidor de logs
const ROLE_MAP = {
  [process.env.FOUNDER]: process.env.FOUNDER_LOGS,
  [process.env.DIRETOR_GERAL]: process.env.DIRETOR_GERAL_LOGS,
  [process.env.DIRETORIA_A7]: process.env.DIRETORIA_A7_LOGS,
  [process.env.ALTA_CUPULA_A7]: process.env.ALTA_CUPULA_A7_LOGS,
  [process.env.LEGADO_A7]: process.env.LEGADO_A7_LOGS
};

const WATCHED_ROLE_IDS = Object.keys(ROLE_MAP); // IDs no servidor principal que estamos observando

// === CLIENT ===
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

// === HELPERS ===
function getChannel(id) {
  if (!id) return null;
  return client.channels.cache.get(id) || null;
}

function sendEmbedTo(channelId, embed) {
  try {
    const ch = getChannel(channelId);
    if (!ch) return;
    ch.send({ embeds: [embed] }).catch(() => {});
  } catch (e) {
    console.error("Erro ao enviar embed:", e);
  }
}

function makeLogEmbed(title, description, author) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description || "\u200b")
    .setColor(0x2b2d31)
    .setTimestamp();
  if (author) embed.setAuthor(author);
  return embed;
}

// Try to fetch who deleted a message (audit log). May be unreliable for old events.
async function fetchAuditExecutor(guild, type, filterFn) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find((e) => (filterFn ? filterFn(e) : true));
    return entry ? entry.executor : null;
  } catch {
    return null;
  }
}

// === SYNC ROLES WHEN MEMBER JOINS LOGS SERVER ===
client.on("guildMemberAdd", async (member) => {
  try {
    // Only handle when joined into the logs server
    if (member.guild.id !== SERVIDOR_LOGS) return;

    // Find member in main server
    const mainGuild = await client.guilds.fetch(SERVIDOR_PRINCIPAL).catch(() => null);
    if (!mainGuild) {
      // can't find main
      sendEmbedTo(CH_LOGS.BOT_FALHA, makeLogEmbed("Erro: Main guild não encontrado", `ID: ${SERVIDOR_PRINCIPAL}`));
      return;
    }

    const mainMember = await mainGuild.members.fetch(member.id).catch(() => null);
    if (!mainMember) {
      // Not on main — kick from logs as requested
      await member.kick("Usuário não encontrado no servidor principal.").catch(() => {});
      sendEmbedTo(CH_LOGS.SAIU_SERVIDOR, makeLogEmbed("Expulso do servidor de logs", `<@${member.id}> expulso porque não está no servidor principal.`));
      return;
    }

    // Collect roles in main that are watched
    const rolesToGiveMain = mainMember.roles.cache.filter(r => WATCHED_ROLE_IDS.includes(r.id));
    if (!rolesToGiveMain || rolesToGiveMain.size === 0) {
      // If no A7 roles on main, remove from logs (per your rule)
      await member.kick("Sem cargos A7 no servidor principal.");
      sendEmbedTo(CH_LOGS.SAIU_SERVIDOR, makeLogEmbed("Expulso do logs", `<@${member.id}> expulso porque não tem cargos A7 no servidor principal.`));
      return;
    }

    // Map and add roles in logs
    const rolesToAddInLogs = [];
    rolesToGiveMain.forEach(r => {
      const mapped = ROLE_MAP[r.id];
      if (mapped) rolesToAddInLogs.push(mapped);
    });

    // Apply roles in logs guild (ensure roles exist)
    const logsGuild = member.guild;
    for (const roleId of rolesToAddInLogs) {
      const roleObj = logsGuild.roles.cache.get(roleId);
      if (roleObj) {
        await member.roles.add(roleObj).catch(() => {});
      }
    }

    sendEmbedTo(CH_LOGS.ENTROU_SERVIDOR,
      makeLogEmbed("Usuário entrou e recebeu cargos A7", `<@${member.id}> recebeu cargos no servidor de logs automaticamente.`)
    );
  } catch (err) {
    console.error("Erro guildMemberAdd:", err);
  }
});

// === WHEN SOMEONE LEAVES THE MAIN SERVER, KICK FROM LOGS ===
client.on("guildMemberRemove", async (member) => {
  try {
    // If someone leaves the main server
    if (member.guild.id !== SERVIDOR_PRINCIPAL) return;

    const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS).catch(() => null);
    if (!logsGuild) return;
    const logsMember = await logsGuild.members.fetch(member.id).catch(() => null);
    if (logsMember) {
      await logsMember.kick("Saiu do servidor principal.").catch(() => {});
      sendEmbedTo(CH_LOGS.SAIU_SERVIDOR, makeLogEmbed("Expulso do logs", `Usuário <@${member.id}> saiu do servidor principal e foi removido do logs.`));
    }
  } catch (err) {
    console.error("Erro guildMemberRemove:", err);
  }
});

// === SYNC ROLE CHANGES MAIN -> LOGS WHEN ROLES CHANGED ON MAIN ===
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    // Only care about updates in the main server
    if (newMember.guild.id !== SERVIDOR_PRINCIPAL) return;

    // Compute added/removed watched roles
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id) && WATCHED_ROLE_IDS.includes(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id) && WATCHED_ROLE_IDS.includes(r.id));

    if (added.size === 0 && removed.size === 0) return;

    const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS).catch(() => null);
    if (!logsGuild) return;
    const logsMember = await logsGuild.members.fetch(newMember.id).catch(() => null);

    // If user is not in logs server, nothing to sync
    if (!logsMember) return;

    // For each added role on main, add mapped role on logs
    for (const [, role] of added) {
      const mapped = ROLE_MAP[role.id];
      if (!mapped) continue;
      const roleInLogs = logsGuild.roles.cache.get(mapped);
      if (roleInLogs) {
        await logsMember.roles.add(roleInLogs).catch(() => {});
        sendEmbedTo(CH_LOGS.ADICIONOU_CARGO, makeLogEmbed("Cargo adicionado (sync)", `<@${newMember.id}> recebeu **${roleInLogs.name}** no servidor de logs (por adição no principal).`));
      }
    }

    // For each removed role on main, remove mapped role on logs
    for (const [, role] of removed) {
      const mapped = ROLE_MAP[role.id];
      if (!mapped) continue;
      const roleInLogs = logsGuild.roles.cache.get(mapped);
      if (roleInLogs) {
        await logsMember.roles.remove(roleInLogs).catch(() => {});
        sendEmbedTo(CH_LOGS.REMOVEU_CARGO, makeLogEmbed("Cargo removido (sync)", `<@${newMember.id}> perdeu **${roleInLogs.name}** no servidor de logs (por remoção no principal).`));
      }
    }
  } catch (err) {
    console.error("Erro guildMemberUpdate sync:", err);
  }
});

// === INTERACTION (BUTTON) TO MANUALLY SYNC ===
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    if (interaction.customId !== "vincular_cargos") return;

    await interaction.deferReply({ ephemeral: true });

    const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS).catch(() => null);
    const logsMember = logsGuild ? await logsGuild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!logsMember) {
      await interaction.editReply("❌ Você não está no servidor de logs.");
      return;
    }

    // Fetch main member
    const mainGuild = await client.guilds.fetch(SERVIDOR_PRINCIPAL).catch(() => null);
    const mainMember = mainGuild ? await mainGuild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!mainMember) {
      await interaction.editReply("❌ Você não está no servidor principal.");
      // optional: kick from logs?
      return;
    }

    // Get roles to sync
    const rolesMain = mainMember.roles.cache.filter(r => WATCHED_ROLE_IDS.includes(r.id));
    if (!rolesMain || rolesMain.size === 0) {
      // Kick if no A7 roles (as you requested)
      await logsMember.kick("Sem cargos A7 no servidor principal.").catch(() => {});
      await interaction.editReply("❌ Você não possui cargos A7 no servidor principal. Você foi removido do servidor de logs.");
      return;
    }

    const rolesAdded = [];
    for (const [, r] of rolesMain) {
      const mapped = ROLE_MAP[r.id];
      if (!mapped) continue;
      const roleObj = logsMember.guild.roles.cache.get(mapped);
      if (roleObj) {
        await logsMember.roles.add(roleObj).catch(() => {});
        rolesAdded.push(roleObj.name);
      }
    }

    await interaction.editReply(rolesAdded.length > 0 ? `✅ Cargos sincronizados: ${rolesAdded.join(", ")}` : "❌ Nenhum cargo sincronizado.");
  } catch (err) {
    console.error("Erro no botão vincular:", err);
  }
});

// === POST BUTTON ON READY (if channel available) ===
async function postButtonIfNeeded() {
  try {
    const ch = getChannel(CANAL_BOTAO_VINCULO);
    if (!ch || !ch.isTextBased?.()) return;
    // Check if last few messages contain our button — to avoid spam we won't check, just post
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("vincular_cargos")
        .setLabel("🔗 Vincular cargos")
        .setStyle(ButtonStyle.Primary)
    );
    await ch.send({
      embeds: [ makeLogEmbed("Vincular cargos", "Clique no botão abaixo para sincronizar seus cargos com o servidor principal.") ],
      components: [row]
    }).catch(() => {});
  } catch (e) { console.error("postButtonIfNeeded:", e); }
}

// === MESSAGE LOGS ===
client.on("messageCreate", (msg) => {
  if (msg.author?.bot) return;
  const embed = new EmbedBuilder()
    .setTitle("Mensagem enviada")
    .addFields(
      { name: "Autor", value: `${msg.author.tag} (${msg.author.id})`, inline: true },
      { name: "Canal", value: `${msg.channel?.name || msg.channelId}`, inline: true }
    )
    .setDescription(msg.content?.slice(0, 2048) || "[embed/imagem]")
    .setTimestamp();
  sendEmbedTo(CH_LOGS.MENSAGEM_ENVIADA, embed);
});

client.on("messageUpdate", (oldMsg, newMsg) => {
  if (newMsg.author?.bot) return;
  const embed = new EmbedBuilder()
    .setTitle("Mensagem editada")
    .addFields(
      { name: "Autor", value: `${newMsg.author.tag} (${newMsg.author.id})`, inline: true },
      { name: "Canal", value: `${newMsg.channel?.name || newMsg.channelId}`, inline: true }
    )
    .addFields(
      { name: "Antes", value: oldMsg.content?.slice(0,1024) || "[indisponível]" },
      { name: "Depois", value: newMsg.content?.slice(0,1024) || "[indisponível]" }
    )
    .setTimestamp();
  sendEmbedTo(CH_LOGS.MENSAGEM_EDITADA, embed);
});

client.on("messageDelete", async (msg) => {
  // Attempt to find who deleted via audit logs (may not be always reliable)
  let deleter = null;
  try {
    if (msg.guild) {
      const exec = await fetchAuditExecutor(msg.guild, AuditLogEvent.MessageDelete, (e) => {
        // we can't easily match message id here reliably, so just return the most recent
        return true;
      });
      deleter = exec ? `${exec.tag} (${exec.id})` : null;
    }
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle("Mensagem apagada")
    .addFields(
      { name: "Autor da mensagem", value: `${msg.author?.tag || "Desconhecido"} (${msg.author?.id || "N/A"})`, inline: true },
      { name: "Apagado por", value: deleter || "Desconhecido", inline: true },
      { name: "Canal", value: `${msg.channel?.name || msg.channelId}`, inline: true }
    )
    .setDescription(msg.content?.slice(0,2048) || "[embed/imagem]")
    .setTimestamp();
  sendEmbedTo(CH_LOGS.MENSAGEM_APAGADA, embed);
});

// === VOICE STATE LOGS ===
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const user = newState.member?.user || oldState.member?.user;
    if (!user) return;

    // Entered
    if (!oldState.channelId && newState.channelId) {
      sendEmbedTo(CH_LOGS.ENTROU_CALL, makeLogEmbed("Entrou na call", `Usuário: ${user.tag} (${user.id})\nCanal: ${newState.channel?.name || newState.channelId}`));
    }

    // Left
    if (oldState.channelId && !newState.channelId) {
      sendEmbedTo(CH_LOGS.SAIU_CALL, makeLogEmbed("Saiu da call", `Usuário: ${user.tag} (${user.id})\nCanal: ${oldState.channel?.name || oldState.channelId}`));
    }

    // Moved
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      sendEmbedTo(CH_LOGS.MOVEU_CALL, makeLogEmbed("Movido de call", `Usuário: ${user.tag} (${user.id})\nDe: ${oldState.channel?.name}\nPara: ${newState.channel?.name}`));
    }

    // Mute/Unmute self
    if (oldState.selfMute !== newState.selfMute) {
      sendEmbedTo(CH_LOGS.MUTE, makeLogEmbed("Mute/Unmute", `Usuário: ${user.tag} (${user.id})\nNovo estado mute: ${newState.selfMute}`));
    }

    // Deaf/Undeaf
    if (oldState.selfDeaf !== newState.selfDeaf) {
      sendEmbedTo(CH_LOGS.MUTE, makeLogEmbed("Deaf/Undeaf", `Usuário: ${user.tag} (${user.id})\nNovo estado deaf: ${newState.selfDeaf}`));
    }
  } catch (e) {
    console.error("voiceStateUpdate error:", e);
  }
});

// === ROLE and CHANNEL events (create/edit/delete) ===
client.on("roleCreate", (role) => {
  sendEmbedTo(CH_LOGS.CRIAR_CARGO, makeLogEmbed("Cargo criado", `Nome: ${role.name}\nID: ${role.id}`));
});
client.on("roleDelete", (role) => {
  sendEmbedTo(CH_LOGS.DELETOU_CARGO, makeLogEmbed("Cargo deletado", `Nome: ${role.name}\nID: ${role.id}`));
});
client.on("roleUpdate", (oldRole, newRole) => {
  sendEmbedTo(CH_LOGS.EDITAR_CARGO, makeLogEmbed("Cargo editado", `Antes: ${oldRole.name}\nDepois: ${newRole.name}`));
});

client.on("channelCreate", (ch) => {
  sendEmbedTo(CH_LOGS.CRIOU_CANAL, makeLogEmbed("Canal criado", `Nome: ${ch.name}\nTipo: ${ch.type}\nID: ${ch.id}`));
});
client.on("channelDelete", (ch) => {
  sendEmbedTo(CH_LOGS.DELETOU_CANAL, makeLogEmbed("Canal deletado", `Nome: ${ch.name}\nID: ${ch.id}`));
});
client.on("channelUpdate", (oldC, newC) => {
  sendEmbedTo(CH_LOGS.MOVEU_CANAL, makeLogEmbed("Canal editado/movido", `Antes: ${oldC.name}\nDepois: ${newC.name}`));
});

// === BANS / KICKS / MEMBER NICKNAME / AVATAR CHANGES / MEMBER JOIN/LEAVE ===
client.on("guildBanAdd", async (guild, user) => {
  sendEmbedTo(CH_LOGS.BAN, makeLogEmbed("Usuário banido", `Usuário: ${user.tag} (${user.id})`));
});

client.on("guildMemberRemove", async (member) => {
  // already handled earlier for main -> logs kick; also log leaving
  sendEmbedTo(CH_LOGS.SAIU_SERVIDOR, makeLogEmbed("Usuário saiu do servidor", `${member.user.tag} (${member.user.id})`));
});

client.on("guildMemberAdd", (member) => {
  // small log in addition to sync logic
  sendEmbedTo(CH_LOGS.ENTROU_SERVIDOR, makeLogEmbed("Usuário entrou no servidor", `${member.user.tag} (${member.user.id})`));
});

client.on("guildMemberUpdate", (oldMember, newMember) => {
  // Detect nickname change
  if (oldMember.nickname !== newMember.nickname) {
    sendEmbedTo(CH_LOGS.NOME_ATUALIZADO, makeLogEmbed("Nickname alterado", `Antes: ${oldMember.nickname || oldMember.user.username}\nDepois: ${newMember.nickname || newMember.user.username}\nUsuario: ${newMember.user.tag}`));
  }
});

// === PROCESS ERROR LOGGING ===
process.on("unhandledRejection", (err) => {
  console.error("UnhandledRejection:", err);
  sendEmbedTo(CH_LOGS.BOT_FALHA, makeLogEmbed("UnhandledRejection", String(err).slice(0, 2000)));
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  sendEmbedTo(CH_LOGS.BOT_FALHA, makeLogEmbed("uncaughtException", String(err).slice(0,2000)));
});

// === VOICE 24H CONNECT ===
async function connectVoice24() {
  try {
    const channelId = CANAL_VOZ_24H;
    const guildId = SERVIDOR_PRINCIPAL;
    if (!channelId || !guildId) return;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    await joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator
    });
    console.log("Conectado no canal de voz 24h");
  } catch (e) {
    console.error("Erro connectVoice24:", e);
    setTimeout(connectVoice24, 10000);
  }
}

// === POST BUTTON / EXPRESS KEEPALIVE / READY
const app = express();
app.get("/", (req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000, () => console.log("HTTP server listening"));

client.once("ready", async () => {
  console.log(`Bot ready: ${client.user.tag}`);
  await postButtonIfNeeded();
  connectVoice24();
});

// === LOGIN ===
client.login(DISCORD_TOKEN).catch(err => {
  console.error("Falha no login:", err);
  process.exit(1);
});
