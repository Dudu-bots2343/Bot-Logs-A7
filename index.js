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

const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus
} = require("@discordjs/voice");

const express = require("express");

/* =======================================================
   VARIÁVEIS DO .ENV
======================================================= */
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
const LOG_MUTOU_DESMUTOU = process.env.LOG_MUTOU_DESMUTOU;
const LOG_MOVEU_USUARIO_CALL = process.env.LOG_MOVEU_USUARIO_CALL;

const LOG_CRIAR_CARGO = process.env.LOG_CRIAR_CARGO;
const LOG_ADICIONOU_CARGO = process.env.LOG_ADICIONOU_CARGO;
const LOG_REMOVEU_CARGO = process.env.LOG_REMOVEU_CARGO;
const LOG_DELETOU_CARGO = process.env.LOG_DELETOU_CARGO;

const LOG_CRIAR_CANAL = process.env.LOG_CRIAR_CANAL;
const LOG_DELETOU_CANAL = process.env.LOG_DELETOU_CANAL;
const LOG_MOVEU_CANAL = process.env.LOG_MOVEU_CANAL;

/* =======================================================
   CARGOS DO SERVIDOR PRINCIPAL → SERVIDOR DE LOGS
======================================================= */

const ROLE_MAP = {
  [process.env.ROLE_FOUNDER]: process.env.ROLE_FOUNDER,
  [process.env.ROLE_DIRETOR_GERAL]: process.env.ROLE_DIRETOR_GERAL,
  [process.env.ROLE_DIRETORIA_A7]: process.env.ROLE_DIRETORIA_A7,
  [process.env.ROLE_ALTA_CUPULA_A7]: process.env.ROLE_ALTA_CUPULA_A7,
  [process.env.ROLE_LEGADO_A7]: process.env.ROLE_LEGADO_A7
};

/* =======================================================
   BOT CONFIG
======================================================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildBans
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

/* =======================================================
   FUNÇÕES AUXILIARES
======================================================= */

function log(channelId, embed) {
  if (!channelId) return;
  const channel = client.channels.cache.get(channelId);
  if (channel) channel.send({ embeds: [embed] }).catch(() => {});
}

function embed(title, desc, color = 0x2b2d31) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(color)
    .setTimestamp();
}

/* =======================================================
   SINCRONIZAÇÃO AUTOMÁTICA DE CARGOS AO ENTRAR NO LOGS
======================================================= */

async function syncRoles(member) {
  try {
    const guildMain = await client.guilds.fetch(SERVIDOR_PRINCIPAL);
    const mainMember = await guildMain.members.fetch(member.id).catch(() => null);

    if (!mainMember) {
      await member.kick("Não está no servidor principal.");
      return;
    }

    // pega apenas os cargos que estão no MAP
    const rolesToGive = mainMember.roles.cache
      .filter(r => ROLE_MAP[r.id])
      .map(r => ROLE_MAP[r.id]);

    if (rolesToGive.length === 0) {
      await member.kick("Sem cargos válidos no servidor principal.");
      return;
    }

    await member.roles.add(rolesToGive);

    return true;
  } catch (e) {
    console.log("Erro ao sincronizar cargos:", e);
  }
}

/* =======================================================
   EVENTO: Entrou no servidor de LOGS
======================================================= */

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== SERVIDOR_LOGS) return;

  const ok = await syncRoles(member);
  if (!ok) return;

  log(
    LOG_MENSAGEM_ENVIADA,
    embed("Cargos sincronizados", `O usuário <@${member.id}> recebeu seus cargos automaticamente.`)
  );
});

/* =======================================================
   EVENTO: Usuário saiu do servidor principal → expulsar do LOGS
======================================================= */
client.on("guildMemberRemove", async (member) => {
  if (member.guild.id !== SERVIDOR_PRINCIPAL) return;

  const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS);
  const logsMember = await logsGuild.members.fetch(member.id).catch(() => null);

  if (logsMember) logsMember.kick("Saiu do servidor principal.");
});

/* =======================================================
   BOTÃO PARA VINCULAR CARGOS MANUALMENTE
======================================================= */

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "vincular_cargos") return;

  await interaction.deferReply({ ephemeral: true });

  const logsGuild = client.guilds.cache.get(SERVIDOR_LOGS);
  const logsMember = logsGuild.members.cache.get(interaction.user.id);

  const ok = await syncRoles(logsMember);

  if (!ok) {
    await interaction.editReply("❌ Não foi possível vincular cargos.");
    return;
  }

  await interaction.editReply("✅ Cargos sincronizados com sucesso!");
});

/* =======================================================
   POSTA O BOTÃO NO CANAL DEFINIDO
======================================================= */

async function postButton() {
  const channel = await client.channels.fetch(CANAL_BOTAO);
  const button = new ButtonBuilder()
    .setCustomId("vincular_cargos")
    .setLabel("🔗 Vincular cargos")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  await channel.send({
    embeds: [embed("Vincular Cargos", "Clique no botão para sincronizar seus cargos manualmente.")],
    components: [row]
  });
}

/* =======================================================
   LOGS DE MENSAGENS
======================================================= */

client.on("messageCreate", (msg) => {
  if (msg.author.bot) return;
  log(
    LOG_MENSAGEM_ENVIADA,
    embed("Mensagem enviada", `👤 **${msg.author.tag}**\n📌 ${msg.channel}\n\n💬 ${msg.content}`)
  );
});

client.on("messageDelete", (msg) => {
  log(
    LOG_MENSAGEM_APAGADA,
    embed("Mensagem apagada", `👤 ${msg.author?.tag}\n📌 ${msg.channel}\n\n💬 ${msg.content}`)
  );
});

client.on("messageUpdate", (oldMsg, newMsg) => {
  log(
    LOG_MENSAGEM_EDITADA,
    embed(
      "Mensagem editada",
      `👤 ${newMsg.author.tag}\n📌 ${newMsg.channel}\n\n**Antes:** ${oldMsg.content}\n**Depois:** ${newMsg.content}`
    )
  );
});

/* =======================================================
   LOGS DE VOZ
======================================================= */

client.on("voiceStateUpdate", (oldState, newState) => {
  const user = newState.member?.user || oldState.member?.user;
  if (!user) return;

  if (!oldState.channel && newState.channel) {
    return log(LOG_ENTROU_CALL, embed("Entrou na call", `👤 ${user.tag}\n📌 ${newState.channel.name}`));
  }

  if (oldState.channel && !newState.channel) {
    return log(LOG_SAIU_CALL, embed("Saiu da call", `👤 ${user.tag}\n📌 ${oldState.channel.name}`));
  }

  if (oldState.channelId !== newState.channelId) {
    return log(
      LOG_MOVEU_USUARIO_CALL,
      embed("Moveu de canal", `👤 ${user.tag}\n➡️ ${oldState.channel?.name} → ${newState.channel?.name}`)
    );
  }
});

/* =======================================================
   LOGS DE CARGOS
======================================================= */

client.on("roleCreate", (r) => {
  log(LOG_CRIAR_CARGO, embed("Cargo criado", `📌 **${r.name}**`));
});

client.on("roleDelete", (r) => {
  log(LOG_DELETOU_CARGO, embed("Cargo deletado", `📌 **${r.name}**`));
});

/* =======================================================
   LOGS DE CANAIS
======================================================= */

client.on("channelCreate", (c) => {
  log(LOG_CRIAR_CANAL, embed("Canal criado", `📌 ${c.name}`));
});

client.on("channelDelete", (c) => {
  log(LOG_DELETOU_CANAL, embed("Canal deletado", `📌 ${c.name}`));
});

/* =======================================================
   FICAR 24H NA CALL
======================================================= */

async function connectVoice() {
  try {
    const channel = await client.channels.fetch(CANAL_VOZ);

    const conn = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });

    entersState(conn, VoiceConnectionStatus.Ready, 20_000);

    conn.on(VoiceConnectionStatus.Disconnected, () => {
      setTimeout(connectVoice, 5000);
    });

  } catch (e) {
    setTimeout(connectVoice, 5000);
  }
}

/* =======================================================
   EXPRESS PARA RENDER / UPTIME ROBOT
======================================================= */

const app = express();
app.get("/", (req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);

/* =======================================================
   READY
======================================================= */

client.on("ready", () => {
  console.log(`Bot logado como ${client.user.tag}`);
  postButton();
  connectVoice();
});

/* =======================================================
   LOGIN
======================================================= */

client.login(TOKEN);
