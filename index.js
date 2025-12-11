// =======================
// index.js
// =======================
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require("discord.js");
const express = require("express");

/* ============================
    VARIÁVEIS DO .ENV
============================ */
const TOKEN = process.env.DISCORD_TOKEN;

const SERVIDOR_PRINCIPAL = process.env.SERVIDOR_PRINCIPAL_ID;
const SERVIDOR_LOGS = process.env.SERVIDOR_LOGS_ID;

const CANAL_BOTAO = process.env.CANAL_BOTAO_VINCULO;
const CANAL_VOZ = process.env.CANAL_VOZ_24H;

// canais de logs
const LOG_MENSAGEM_ENVIADA = process.env.LOG_MENSAGEM_ENVIADA;
const LOG_MENSAGEM_APAGADA = process.env.LOG_MENSAGEM_APAGADA;
const LOG_MENSAGEM_EDITADA = process.env.LOG_MENSAGEM_EDITADA;

const LOG_ENTROU_CALL = process.env.LOG_ENTROU_CALL;
const LOG_SAIU_CALL = process.env.LOG_SAIU_CALL;
const LOG_MOVEU_USUARIO_CALL = process.env.LOG_MOVEU_USUARIO_CALL;

const LOG_CRIAR_CARGO = process.env.LOG_CRIAR_CARGO;
const LOG_DELETOU_CARGO = process.env.LOG_DELETOU_CARGO;

const LOG_CRIAR_CANAL = process.env.LOG_CRIAR_CANAL;
const LOG_DELETOU_CANAL = process.env.LOG_DELETOU_CANAL;

/* ============================
    ROLE MAP
============================ */
const ROLE_MAP = {
  [process.env.ROLE_FOUNDER]: process.env.ROLE_FOUNDER,
  [process.env.ROLE_DIRETOR_GERAL]: process.env.ROLE_DIRETOR_GERAL,
  [process.env.ROLE_DIRETORIA_A7]: process.env.ROLE_DIRETORIA_A7,
  [process.env.ROLE_ALTA_CUPULA_A7]: process.env.ROLE_ALTA_CUPULA_A7,
  [process.env.ROLE_LEGADO_A7]: process.env.ROLE_LEGADO_A7
};

/* ============================
      CLIENT
============================ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

/* ============================
   HELPERS
============================ */
function getChannel(id) {
  return client.channels.cache.get(id) || null;
}

function sendLog(channelId, embed) {
  const ch = getChannel(channelId);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

function makeEmbed(title, desc, color = 0x2b2d31) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(color)
    .setTimestamp();
}

/* ============================
   SYNC DE CARGOS (ID)
============================ */
async function syncRolesById(memberLogs) {
  try {
    const guildMain = await client.guilds.fetch(SERVIDOR_PRINCIPAL);
    const mainMember = await guildMain.members.fetch(memberLogs.id).catch(() => null);

    if (!mainMember) {
      await memberLogs.kick("Não está no servidor principal");
      return false;
    }

    const rolesToGive = mainMember.roles.cache
      .filter(r => ROLE_MAP[r.id])
      .map(r => ROLE_MAP[r.id]);

    if (rolesToGive.length === 0) {
      await memberLogs.kick("Sem cargos válidos");
      return false;
    }

    await memberLogs.roles.add(rolesToGive).catch(() => {});
    return true;
  } catch (err) {
    console.error("syncRolesById error:", err);
    return false;
  }
}

/* ============================
    EVENTOS
============================ */

// quando alguém entra NO SERVIDOR DE LOGS
client.on("guildMemberAdd", async member => {
  if (member.guild.id !== SERVIDOR_LOGS) return;

  const ok = await syncRolesById(member);
  if (ok) {
    sendLog(LOG_MENSAGEM_ENVIADA, makeEmbed(
      "Cargos sincronizados",
      `Usuário <@${member.id}> recebeu cargos automaticamente.`
    ));
  } else {
    sendLog(LOG_MENSAGEM_APAGADA, makeEmbed(
      "Expulso",
      `Usuário <@${member.id}> foi expulso do servidor de logs por não ter cargos válidos no servidor principal.`
    ));
  }
});

// saiu do servidor principal → expulsar do de logs
client.on("guildMemberRemove", async member => {
  if (member.guild.id !== SERVIDOR_PRINCIPAL) return;

  const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS).catch(() => null);
  const logsMember = logsGuild ? await logsGuild.members.fetch(member.id).catch(() => null) : null;

  if (logsMember) {
    await logsMember.kick("Saiu do servidor principal");
    sendLog(LOG_MENSAGEM_EDITADA, makeEmbed(
      "Removido do servidor de logs",
      `Usuário <@${member.id}> saiu do servidor principal e foi removido do servidor de logs.`
    ));
  }
});

/* ============================
   LOGS DE MENSAGENS
============================ */
client.on("messageCreate", msg => {
  if (msg.author.bot) return;

  sendLog(
    LOG_MENSAGEM_ENVIADA,
    makeEmbed(
      "Mensagem enviada",
      `👤 **${msg.author.tag}**\n📌 ${msg.channel}\n\n${msg.content || "[sem conteúdo]"}`
    )
  );
});

client.on("messageDelete", msg => {
  sendLog(
    LOG_MENSAGEM_APAGADA,
    makeEmbed(
      "Mensagem apagada",
      `👤 **${msg.author?.tag}**\n📌 ${msg.channel}\n\n${msg.content || "[não disponível]"}`
    )
  );
});

client.on("messageUpdate", (oldMsg, newMsg) => {
  sendLog(
    LOG_MENSAGEM_EDITADA,
    makeEmbed(
      "Mensagem editada",
      `👤 **${newMsg.author?.tag}**\n📌 ${newMsg.channel}\n\n**Antes:** ${oldMsg.content || "[vazio]"}\n**Depois:** ${newMsg.content || "[vazio]"}`
    )
  );
});

/* ============================
   LOGS DE CANAIS E CARGOS
============================ */
client.on("roleCreate", r =>
  sendLog(LOG_CRIAR_CARGO, makeEmbed("Cargo criado", `**${r.name}** (ID: ${r.id})`))
);

client.on("roleDelete", r =>
  sendLog(LOG_DELETOU_CARGO, makeEmbed("Cargo deletado", `**${r.name}** (ID: ${r.id})`))
);

client.on("channelCreate", c =>
  sendLog(LOG_CRIAR_CANAL, makeEmbed("Canal criado", `**${c.name}** (ID: ${c.id})`))
);

client.on("channelDelete", c =>
  sendLog(LOG_DELETOU_CANAL, makeEmbed("Canal deletado", `**${c.name}** (ID: ${c.id})`))
);

/* ============================
   LOGS DE CALL
============================ */
client.on("voiceStateUpdate", (oldState, newState) => {
  const user = newState.member?.user || oldState.member?.user;
  if (!user) return;

  if (!oldState.channel && newState.channel) {
    sendLog(LOG_ENTROU_CALL, makeEmbed("Entrou na call", `${user.tag} entrou em **${newState.channel.name}**`));
  } else if (oldState.channel && !newState.channel) {
    sendLog(LOG_SAIU_CALL, makeEmbed("Saiu da call", `${user.tag} saiu de **${oldState.channel.name}**`));
  } else if (oldState.channelId !== newState.channelId) {
    sendLog(LOG_MOVEU_USUARIO_CALL, makeEmbed(
      "Movido entre calls",
      `${user.tag} foi movido de **${oldState.channel?.name}** para **${newState.channel?.name}**`
    ));
  }
});

/* ============================
   BOTÃO PARA VINCULAR CARGOS
============================ */
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "vincular_cargos") return;

  await interaction.deferReply({ ephemeral: true });

  const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS);
  const memberLogs = await logsGuild.members.fetch(interaction.user.id).catch(() => null);

  const ok = await syncRolesById(memberLogs);
  interaction.editReply(ok ? "✅ Cargos sincronizados!" : "❌ Não foi possível sincronizar.");
});

/* posta o botão */
async function postButtonIfNeeded() {
  const ch = getChannel(CANAL_BOTAO);
  if (!ch) return;

  const button = new ButtonBuilder()
    .setCustomId("vincular_cargos")
    .setLabel("🔗 Vincular cargos")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  await ch.send({
    embeds: [
      makeEmbed(
        "Vincular Cargos",
        "Clique no botão abaixo para vincular seus cargos automaticamente com o servidor principal."
      )
    ],
    components: [row]
  });
}

/* ============================
   24H NA CALL
============================ */
async function connectVoice() {
  if (!CANAL_VOZ) return;

  try {
    const ch = await client.channels.fetch(CANAL_VOZ);
    await ch.guild.members.me.voice.setChannel(ch);
    console.log("🔥 Conectado ao canal de voz!");
  } catch (err) {
    console.log("Erro ao conectar. Tentando novamente...");
    setTimeout(connectVoice, 5000);
  }
}

/* ============================
   EXPRESS KEEP-ALIVE
============================ */
const app = express();
app.get("/", (req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);

/* ============================
   READY
============================ */
client.on("ready", () => {
  console.log(`Bot logado como ${client.user.tag}`);
  postButtonIfNeeded();
  connectVoice();
});

/* ============================
   LOGIN
============================ */
client.login(TOKEN);
