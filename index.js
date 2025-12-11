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
const LOG_MOVEU_USUARIO_CALL = process.env.LOG_MOVEU_USUARIO_CALL;

const LOG_CRIAR_CARGO = process.env.LOG_CRIAR_CARGO;
const LOG_DELETOU_CARGO = process.env.LOG_DELETOU_CARGO;

const LOG_CRIAR_CANAL = process.env.LOG_CRIAR_CANAL;
const LOG_DELETOU_CANAL = process.env.LOG_DELETOU_CANAL;

/* =======================================================
   ROLE MAP
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
   SYNC DE CARGOS
======================================================= */

async function syncRoles(member) {
  try {
    const guildMain = await client.guilds.fetch(SERVIDOR_PRINCIPAL);
    const mainMember = await guildMain.members.fetch(member.id).catch(() => null);

    if (!mainMember) return member.kick("Não está no servidor principal.");

    const rolesToGive = mainMember.roles.cache
      .filter(r => ROLE_MAP[r.id])
      .map(r => ROLE_MAP[r.id]);

    if (rolesToGive.length === 0) {
      return member.kick("Sem cargos válidos.");
    }

    await member.roles.add(rolesToGive);
    return true;

  } catch (e) {
    console.log("Erro sync:", e);
  }
}

/* =======================================================
   EVENTOS DE ENTRADA/SAÍDA NO SERVIDOR
======================================================= */

client.on("guildMemberAdd", async member => {
  if (member.guild.id !== SERVIDOR_LOGS) return;

  const ok = await syncRoles(member);
  if (ok) {
    log(LOG_MENSAGEM_ENVIADA, embed("Cargos sincronizados", `Usuário <@${member.id}> sincronizado.`));
  }
});

client.on("guildMemberRemove", async member => {
  if (member.guild.id !== SERVIDOR_PRINCIPAL) return;

  const logsGuild = await client.guilds.fetch(SERVIDOR_LOGS);
  const logsMember = await logsGuild.members.fetch(member.id).catch(() => null);

  if (logsMember) logsMember.kick("Saiu do servidor principal.");
});

/* =======================================================
   BOTÃO
======================================================= */

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "vincular_cargos") return;

  await interaction.deferReply({ ephemeral: true });

  const logsGuild = client.guilds.cache.get(SERVIDOR_LOGS);
  const logsMember = logsGuild.members.cache.get(interaction.user.id);

  const ok = await syncRoles(logsMember);
  interaction.editReply(ok ? "✅ Sincronizado!" : "❌ Falha ao sincronizar.");
});

/* =======================================================
   POSTAR BOTÃO
======================================================= */

async function postButton() {
  const channel = await client.channels.fetch(CANAL_BOTAO);

  const button = new ButtonBuilder()
    .setCustomId("vincular_cargos")
    .setLabel("🔗 Vincular cargos")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  channel.send({
    embeds: [embed("Vincular Cargos", "Clique para sincronizar seus cargos.")],
    components: [row]
  });
}

/* =======================================================
   LOGS DE MENSAGENS
======================================================= */

client.on("messageCreate", msg => {
  if (msg.author.bot) return;
  log(LOG_MENSAGEM_ENVIADA,
    embed("Mensagem enviada", `👤 ${msg.author.tag}\n📌 ${msg.channel}\n\n${msg.content}`)
  );
});

client.on("messageDelete", msg => {
  log(LOG_MENSAGEM_APAGADA,
    embed("Mensagem apagada", `👤 ${msg.author?.tag}\n📌 ${msg.channel}\n\n${msg.content}`)
  );
});

client.on("messageUpdate", (oldMsg, newMsg) => {
  log(LOG_MENSAGEM_EDITADA,
    embed("Mensagem editada",
      `👤 ${newMsg.author.tag}\n📌 ${newMsg.channel}\n\n**Antes:** ${oldMsg.content}\n**Depois:** ${newMsg.content}`
    )
  );
});

/* =======================================================
   LOGS DE CANAIS / CARGOS
======================================================= */

client.on("roleCreate", r => {
  log(LOG_CRIAR_CARGO, embed("Cargo criado", r.name));
});

client.on("roleDelete", r => {
  log(LOG_DELETOU_CARGO, embed("Cargo deletado", r.name));
});

client.on("channelCreate", c => {
  log(LOG_CRIAR_CANAL, embed("Canal criado", c.name));
});

client.on("channelDelete", c => {
  log(LOG_DELETOU_CANAL, embed("Canal deletado", c.name));
});

/* =======================================================
   FICAR 24H NA CALL (SEM @discordjs/voice)
======================================================= */

async function connectVoice() {
  try {
    const channel = await client.channels.fetch(CANAL_VOZ);
    await channel.guild.members.me.voice.setChannel(channel);
    console.log("🔥 Conectado ao canal de voz!");
  } catch (e) {
    console.log("Erro ao conectar, tentando novamente...");
    setTimeout(connectVoice, 5000);
  }
}

/* =======================================================
   EXPRESS / KEEP ALIVE
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
