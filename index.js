// ========================================================
//  BOT DE LOGS — SISTEMA COMPLETO
//  Render + GitHub + UptimeRobot + Call 24h
// ========================================================

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

// ========================================================
// ENV
// ========================================================
const TOKEN = process.env.DISCORD_TOKEN;

const SERVIDOR_PRINCIPAL = process.env.SERVIDOR_PRINCIPAL_ID;
const SERVIDOR_LOGS = process.env.SERVIDOR_LOGS_ID;

const CANAL_BOTAO = process.env.CANAL_BOTAO_VINCULO;
const CANAL_VOZ = process.env.CANAL_VOZ_24H;

const LOG_MENSAGEM_ENVIADA = process.env.LOG_MENSAGEM_ENVIADA;
const LOG_MENSAGEM_APAGADA = process.env.LOG_MENSAGEM_APAGADA;
const LOG_MENSAGEM_EDITADA = process.env.LOG_MENSAGEM_EDITADA;

const LOG_ENTROU_CALL = process.env.LOG_ENTROU_CALL;
const LOG_SAIU_CALL = process.env.LOG_SAIU_CALL;
const LOG_MOVEU_USUARIO_CALL = process.env.LOG_MOVEU_USUARIO_CALL;
const LOG_MUTOU_DESMUTOU = process.env.LOG_MUTOU_DESMUTOU;

const LOG_CRIAR_CARGO = process.env.LOG_CRIAR_CARGO;
const LOG_ADICIONOU_CARGO = process.env.LOG_ADICIONOU_CARGO;
const LOG_REMOVEU_CARGO = process.env.LOG_REMOVEU_CARGO;
const LOG_DELETOU_CARGO = process.env.LOG_DELETOU_CARGO;

const LOG_CRIAR_CANAL = process.env.LOG_CRIAR_CANAL;
const LOG_DELETOU_CANAL = process.env.LOG_DELETOU_CANAL;
const LOG_MOVEU_CANAL = process.env.LOG_MOVEU_CANAL;

// ========================================================
// MAPEAMENTO DE CARGOS (SERVIDOR PRINCIPAL → SERVIDOR DE LOGS)
// ========================================================
const ROLE_MAP = {
  [process.env.FOUNDER]: process.env.FOUNDER,
  [process.env.DIRETOR_GERAL]: process.env.DIRETOR_GERAL,
  [process.env.DIRETORIA_A7]: process.env.DIRETORIA_A7,
  [process.env.ALTA_CUPULA_A7]: process.env.ALTA_CUPULA_A7,
  [process.env.LEGADO_A7]: process.env.LEGADO_A7
};

// ========================================================
// CLIENT
// ========================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

// ========================================================
// FUNÇÕES AUXILIARES
// ========================================================
function getChannel(id) {
  return client.channels.cache.get(id);
}

function sendEmbed(channelId, embed) {
  const channel = getChannel(channelId);
  if (!channel) return;
  channel.send({ embeds: [embed] }).catch(() => {});
}

function makeEmbed(title, desc) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(0x2b2d31)
    .setTimestamp();
}

// ========================================================
// SINCRONIZAÇÃO DE CARGOS AO ENTRAR NO SERVIDOR DE LOGS
// ========================================================
async function syncRoles(memberLogs) {
  try {
    const guildMain = await client.guilds.fetch(SERVIDOR_PRINCIPAL);
    const mainMember = await guildMain.members.fetch(memberLogs.id).catch(() => null);

    if (!mainMember) {
      await memberLogs.kick("Não está no servidor principal.");
      return false;
    }

    const rolesToGive = mainMember.roles.cache
      .filter(r => ROLE_MAP[r.id])
      .map(r => ROLE_MAP[r.id]);

    if (rolesToGive.length === 0) {
      await memberLogs.kick("Sem cargos válidos no servidor principal.");
      return false;
    }

    await memberLogs.roles.add(rolesToGive);
    return true;

  } catch (err) {
    console.error("Erro sync →", err);
  }
}

// ========================================================
// EVENTOS DE ENTRADA / SAÍDA DOS SERVIDORES
// ========================================================

// Usuário entrou no servidor de logs
client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== SERVIDOR_LOGS) return;

  const ok = await syncRoles(member);

  if (ok) {
    sendEmbed(
      LOG_MENSAGEM_ENVIADA,
      makeEmbed("Cargos sincronizados", `Usuário <@${member.id}> recebeu automaticamente os cargos do servidor principal.`)
    );
  }
});

// Usuário saiu do servidor principal → remover do servidor de logs
client.on("guildMemberRemove", async (member) => {
  if (member.guild.id !== SERVIDOR_PRINCIPAL) return;

  const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS);
  const logsMember = await logsGuild.members.fetch(member.id).catch(() => null);

  if (logsMember) {
    await logsMember.kick("Saiu do servidor principal.");
    sendEmbed(
      LOG_MENSAGEM_EDITADA,
      makeEmbed("Removido do servidor de logs", `Usuário <@${member.id}> saiu do servidor principal.`)
    );
  }
});

// ========================================================
// LOGS DE MENSAGENS
// ========================================================
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  sendEmbed(LOG_MENSAGEM_ENVIADA,
    makeEmbed("Mensagem enviada",
      `👤 Autor: **${msg.author.tag}**\n📌 Canal: ${msg.channel}\n\n💬 Conteúdo:\n${msg.content || "[embed/imagem]"}`
    )
  );
});

client.on("messageDelete", async (msg) => {
  sendEmbed(LOG_MENSAGEM_APAGADA,
    makeEmbed("Mensagem apagada",
      `👤 Autor: **${msg.author?.tag || "Desconhecido"}**\n📌 Canal: ${msg.channel}\n\n💀 Conteúdo:\n${msg.content || "[indisponível]"}`
    )
  );
});

client.on("messageUpdate", (oldMsg, newMsg) => {
  sendEmbed(LOG_MENSAGEM_EDITADA,
    makeEmbed("Mensagem editada",
      `👤 Autor: **${newMsg.author.tag}**\n📌 Canal: ${newMsg.channel}\n\n✏️ **Antes:** ${oldMsg.content || "[indisponível]"}\n📝 **Depois:** ${newMsg.content || "[indisponível]"}`
    )
  );
});

// ========================================================
// LOGS DE CARGOS
// ========================================================
client.on("roleCreate", (role) => {
  sendEmbed(LOG_CRIAR_CARGO, makeEmbed("Cargo criado", `📌 Nome: **${role.name}**\n🆔 ID: ${role.id}`));
});

client.on("roleDelete", (role) => {
  sendEmbed(LOG_DELETOU_CARGO, makeEmbed("Cargo deletado", `📌 Nome: **${role.name}**\n🆔 ID: ${role.id}`));
});

// ========================================================
// LOGS DE CANAIS
// ========================================================
client.on("channelCreate", (c) => {
  sendEmbed(LOG_CRIAR_CANAL,
    makeEmbed("Canal criado", `📌 Nome: **${c.name}**\n🔧 Tipo: ${c.type}\n🆔 ID: ${c.id}`)
  );
});

client.on("channelDelete", (c) => {
  sendEmbed(LOG_DELETOU_CANAL,
    makeEmbed("Canal deletado", `📌 Nome: **${c.name}**\n🆔 ID: ${c.id}`)
  );
});

// ========================================================
// LOGS DE VOZ
// ========================================================
client.on("voiceStateUpdate", (oldState, newState) => {
  const user = newState.member?.user || oldState.member?.user;
  if (!user) return;

  if (!oldState.channel && newState.channel) {
    sendEmbed(LOG_ENTROU_CALL,
      makeEmbed("Entrou na call", `👤 **${user.tag}**\n📌 Canal: ${newState.channel.name}`)
    );
  } else if (oldState.channel && !newState.channel) {
    sendEmbed(LOG_SAIU_CALL,
      makeEmbed("Saiu da call", `👤 **${user.tag}**\n📌 Canal: ${oldState.channel.name}`)
    );
  } else if (oldState.channelId !== newState.channelId) {
    sendEmbed(LOG_MOVEU_USUARIO_CALL,
      makeEmbed("Movido de call",
        `👤 **${user.tag}**\n➡️ De: **${oldState.channel?.name || "N/A"}**\n➡️ Para: **${newState.channel?.name || "N/A"}**`
      )
    );
  }

  if (oldState.selfMute !== newState.selfMute) {
    sendEmbed(LOG_MUTOU_DESMUTOU,
      makeEmbed("Mute/Unmute",
        `👤 **${user.tag}**\n🎙️ Estado: **${newState.selfMute ? "Mutou" : "Desmutou"}**`
      )
    );
  }
});

// ========================================================
// BOTÃO PARA VINCULAR CARGOS MANUALMENTE
// ========================================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    if (interaction.customId !== "vincular_cargos") return;

    await interaction.deferReply({ flags: 64 }).catch(() => {});

    const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS);
    const logsMember = await logsGuild.members.fetch(interaction.user.id).catch(() => null);

    const ok = await syncRoles(logsMember);

    await interaction.editReply(ok ? "✅ Cargos sincronizados!" : "❌ Não foi possível sincronizar.");

  } catch (err) {
    console.warn("Erro no botão →", err);
  }
});

// postar o botão
async function postButtonIfNeeded() {
  const ch = getChannel(CANAL_BOTAO);
  if (!ch || !ch.isTextBased()) return;

  const button = new ButtonBuilder()
    .setCustomId("vincular_cargos")
    .setLabel("🔗 Vincular cargos")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  ch.send({
    embeds: [makeEmbed("Vincular cargos", "Clique no botão abaixo para sincronizar seus cargos com o servidor principal.")],
    components: [row]
  }).catch(() => {});
}

// ========================================================
// SISTEMA 24H NA CALL (SEM @discordjs/voice)
// ========================================================
async function connectVoice() {
  try {
    const ch = await client.channels.fetch(CANAL_VOZ);
    await ch.guild.members.me.voice.setChannel(ch);
    console.log("🔥 Conectado ao canal de voz (modo dummy)");
  } catch (err) {
    console.log("Erro ao conectar. Tentando novamente...");
    setTimeout(connectVoice, 5000);
  }
}

// ========================================================
// EXPRESS (KEEP ALIVE)
// ========================================================
const app = express();
app.get("/", (req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000, () =>
  console.log("HTTP server running")
);

// ========================================================
// READY (EVENTO CORRETO v14.15+)
// ========================================================
client.once("clientReady", async () => {
  console.log(`Bot logado como ${client.user.tag}`);
  await postButtonIfNeeded();
  connectVoice();
});

// ========================================================
// LOGIN
// ========================================================
client.login(TOKEN).catch(err => {
  console.error("Falha no login:", err);
  process.exit(1);
});
