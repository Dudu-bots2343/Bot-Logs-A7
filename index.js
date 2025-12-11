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
  Events
} = require("discord.js");
const express = require("express");

/* ENV */
const TOKEN = process.env.DISCORD_TOKEN;

const SERVIDOR_PRINCIPAL = process.env.SERVIDOR_PRINCIPAL_ID;
const SERVIDOR_LOGS = process.env.SERVIDOR_LOGS_ID;

const CANAL_BOTAO = process.env.CANAL_BOTAO_VINCULO;
const CANAL_VOZ = process.env.CANAL_VOZ_24H;

/* canais de logs */
const LOG_MENSAGEM_ENVIADA = process.env.LOG_MENSAGEM_ENVIADA;
const LOG_MENSAGEM_APAGADA = process.env.LOG_MENSAGEM_APAGADA;
const LOG_MENSAGEM_EDITADA = process.env.LOG_MENSAGEM_EDITADA;

const LOG_ENTROU_CALL = process.env.LOG_ENTROU_CALL;
const LOG_SAIU_CALL = process.env.LOG_SAIU_CALL;
const LOG_MUTOU_DESMUTOU = process.env.LOG_MUTOU_DESMUTOU;
const LOG_MOVEU_USUARIO_CALL = process.env.LOG_MOVEU_USUARIO_CALL;

const LOG_CRIAR_CARGO = process.env.LOG_CRIAR_CARGO;
const LOG_ADICIONOU_CARGO = process.env.LOG_ADICIONOU_CARGO;
const LOG_REMOVEU_CARGO = process.env.LOG_REMOVEU_CARGO;
const LOG_DELETOU_CARGO = process.env.LOG_DELETOU_CARGO;

const LOG_CRIAR_CANAL = process.env.LOG_CRIAR_CANAL;
const LOG_DELETOU_CANAL = process.env.LOG_DELETOU_CANAL;
const LOG_MOVEU_CANAL = process.env.LOG_MOVEU_CANAL;

/* ROLE MAP por ID */
const ROLE_MAP = {
  [process.env.ROLE_FOUNDER]: process.env.ROLE_FOUNDER,
  [process.env.ROLE_DIRETOR_GERAL]: process.env.ROLE_DIRETOR_GERAL,
  [process.env.ROLE_DIRETORIA_A7]: process.env.ROLE_DIRETORIA_A7,
  [process.env.ROLE_ALTA_CUPULA_A7]: process.env.ROLE_ALTA_CUPULA_A7,
  [process.env.ROLE_LEGADO_A7]: process.env.ROLE_LEGADO_A7
};

/* Client */
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

/* Helpers */
function getChannel(id) {
  if (!id) return null;
  return client.channels.cache.get(id) || null;
}
function sendEmbed(channelId, embed) {
  const ch = getChannel(channelId);
  if (!ch) return;
  ch.send({ embeds: [embed] }).catch(() => {});
}
function makeEmbed(title, description, color = 0x2b2d31) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

/* Sync cargos por ID (servidor principal -> servidor de logs)
   memberLogs: GuildMember do servidor de logs */
async function syncRolesById(memberLogs) {
  if (!memberLogs) return false;
  try {
    const guildMain = await client.guilds.fetch(SERVIDOR_PRINCIPAL);
    if (!guildMain) return false;

    const mainMember = await guildMain.members.fetch(memberLogs.id).catch(() => null);
    if (!mainMember) return false;

    const rolesToGive = mainMember.roles.cache
      .filter(r => ROLE_MAP[r.id])
      .map(r => ROLE_MAP[r.id]);

    if (!rolesToGive || rolesToGive.length === 0) return false;

    await memberLogs.roles.add(rolesToGive).catch(() => {});
    return true;
  } catch (err) {
    console.error("syncRolesById error:", err);
    return false;
  }
}

/* EVENTOS */

/* Quando alguém entra no servidor de logs */
client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== SERVIDOR_LOGS) return;

  const ok = await syncRolesById(member);
  if (ok) {
    sendEmbed(LOG_MENSAGEM_ENVIADA, makeEmbed(
      "Cargos sincronizados",
      `Usuário <@${member.id}> recebeu cargos automaticamente (copiados do servidor principal).`
    ));
  } else {
    try {
      await member.kick("Sem cargos válidos no servidor principal");
      sendEmbed(LOG_MENSAGEM_APAGADA, makeEmbed(
        "Expulso do logs",
        `Usuário <@${member.id}> expulso por não possuir cargos no servidor principal.`
      ));
    } catch (e) {
      console.warn("Falha ao kickar membro sem cargos:", e);
    }
  }
});

/* Se alguém sair do servidor principal, remove do servidor de logs */
client.on("guildMemberRemove", async (member) => {
  if (member.guild.id !== SERVIDOR_PRINCIPAL) return;

  const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS).catch(()=>null);
  if (!logsGuild) return;

  const logsMember = await logsGuild.members.fetch(member.id).catch(()=>null);
  if (logsMember) {
    await logsMember.kick("Usuário deixou o servidor principal").catch(()=>{});
    sendEmbed(LOG_MENSAGEM_EDITADA, makeEmbed(
      "Removido do logs",
      `Usuário <@${member.id}> removido do servidor de logs pois saiu do principal.`
    ));
  }
});

/* Mensagens */
client.on("messageCreate", (msg) => {
  if (msg.author?.bot) return;
  sendEmbed(LOG_MENSAGEM_ENVIADA, makeEmbed(
    "Mensagem enviada",
    `Autor: **${msg.author.tag}**\nCanal: ${msg.channel?.toString()}\nConteúdo:\n${msg.content || "[embed/attachment]"}`
  ));
});

client.on("messageDelete", (msg) => {
  sendEmbed(LOG_MENSAGEM_APAGADA, makeEmbed(
    "Mensagem apagada",
    `Autor: **${msg.author?.tag || "desconhecido"}**\nCanal: ${msg.channel?.toString()}\nConteúdo:\n${msg.content || "[conteúdo não disponível]"}`
  ));
});

client.on("messageUpdate", (oldMsg, newMsg) => {
  sendEmbed(LOG_MENSAGEM_EDITADA, makeEmbed(
    "Mensagem editada",
    `Autor: **${newMsg.author?.tag || "desconhecido"}**\nCanal: ${newMsg.channel?.toString()}\n\n**Antes:** ${oldMsg?.content || "[não disponível]"}\n**Depois:** ${newMsg?.content || "[não disponível]"}`
  ));
});

/* Cargos / canais */
client.on("roleCreate", (r) => sendEmbed(LOG_CRIAR_CARGO, makeEmbed("Cargo criado", `Nome: ${r.name}\nID: ${r.id}`)));
client.on("roleDelete", (r) => sendEmbed(LOG_DELETOU_CARGO, makeEmbed("Cargo deletado", `Nome: ${r.name}\nID: ${r.id}`)));

client.on("channelCreate", (c) => sendEmbed(LOG_CRIAR_CANAL, makeEmbed("Canal criado", `Nome: ${c.name}\nTipo: ${c.type}\nID: ${c.id}`)));
client.on("channelDelete", (c) => sendEmbed(LOG_DELETOU_CANAL, makeEmbed("Canal deletado", `Nome: ${c.name}\nID: ${c.id}`)));

/* Voice events */
client.on("voiceStateUpdate", (oldState, newState) => {
  const user = newState.member?.user || oldState.member?.user;
  if (!user) return;

  if (!oldState.channel && newState.channel) {
    sendEmbed(LOG_ENTROU_CALL, makeEmbed("Entrou na call", `Usuário: ${user.tag} (${user.id})\nCanal: ${newState.channel.name}`));
  } else if (oldState.channel && !newState.channel) {
    sendEmbed(LOG_SAIU_CALL, makeEmbed("Saiu da call", `Usuário: ${user.tag} (${user.id})\nCanal: ${oldState.channel.name}`));
  } else if (oldState.channelId !== newState.channelId) {
    sendEmbed(LOG_MOVEU_USUARIO_CALL, makeEmbed("Movido entre calls", `Usuário: ${user.tag} (${user.id})\nDe: ${oldState.channel?.name || "—"}\nPara: ${newState.channel?.name || "—"}`));
  }
});

/* BOTÃO: vincular cargos manual */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "vincular_cargos") return;

  await interaction.deferReply({ ephemeral: true });

  const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS).catch(()=>null);
  const logsMember = logsGuild ? await logsGuild.members.fetch(interaction.user.id).catch(()=>null) : null;

  const ok = await syncRolesById(logsMember);
  await interaction.editReply(ok ? "✅ Cargos sincronizados!" : "❌ Não foi possível sincronizar (verifique seus cargos no servidor principal).");
});

/* posta o botão */
async function postButtonIfNeeded() {
  if (!CANAL_BOTAO) return;
  const ch = getChannel(CANAL_BOTAO);
  if (!ch || !ch.isTextBased()) return;
  const button = new ButtonBuilder().setCustomId("vincular_cargos").setLabel("🔗 Vincular cargos").setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(button);
  ch.send({ embeds: [makeEmbed("Vincular cargos","Clique para sincronizar seus cargos com o servidor principal.")], components: [row] }).catch(()=>{});
}

/* Mantém em call 24h (modo dummy, sem @discordjs/voice) */
async function connectVoice() {
  if (!CANAL_VOZ) return;
  try {
    const ch = await client.channels.fetch(CANAL_VOZ);
    if (!ch || !ch.guild) return console.warn("CANAL_VOZ inválido");
    await ch.guild.members.me.voice.setChannel(ch).catch(()=>{});
    console.log("🔥 Conectado ao canal de voz (modo dummy).");
  } catch (err) {
    console.warn("Erro ao conectar no canal de voz:", err);
    setTimeout(connectVoice, 5000);
  }
}

/* Express keep-alive */
const app = express();
app.get("/", (req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000, () => console.log("HTTP server running"));

/* Ready + Login */
client.once("ready", async () => {
  console.log(`Bot logado como ${client.user.tag}`);
  await postButtonIfNeeded();
  connectVoice();
});

client.login(TOKEN).catch(err => {
  console.error("Falha no login:", err);
  process.exit(1);
});
