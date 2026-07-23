import http from 'http';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HTTP server is listening on port ${PORT}`);
});

import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  REST,
  Routes,
} from "discord.js";

const GUILD_ID = process.env.GUILD_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const PANEL_CHANNEL_ID = process.env.PANEL_CHANNEL_ID;
const VERIFY_CHANNEL_ID = "1529877007217987795";
const TOKEN = process.env.DISCORD_BOT_TOKEN;

const STAFF_ROLE_ID = "1529565287584764117";
const VERIFY_ROLE_1 = "1529845381637214510";
const VERIFY_ROLE_2 = "1529881336733634774";
const CLEAR_MIN_ROLE_ID = "1529883118314721370";

const HELP_RATE_LIMIT = 5;
const HELP_WINDOW_MS = 60 * 60 * 1000;

const helpUsage = new Map();
const activeVerification = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

const TICKET_OPTIONS = [
  { label: "תמיכה כללית", value: "general", emoji: "💠" },
  { label: "דיווח", value: "report", emoji: "⚠️" },
  { label: "תמיכה במיינקראפט", value: "minecraft", emoji: "🥁" },
  { label: "בחינה לצוות דיסקורד", value: "discord-staff", emoji: "📋" },
  { label: "בחינה לצוות מיינקראפט", value: "minecraft-staff", emoji: "📋" },
];

async function isStaffOrHigher(member) {
  const staffRole = member.guild.roles.cache.get(STAFF_ROLE_ID);
  if (!staffRole) return false;
  return member.roles.cache.some((r) => r.position >= staffRole.position);
}

async function hasClearPermission(member) {
  const minRole = member.guild.roles.cache.get(CLEAR_MIN_ROLE_ID);
  if (!minRole) return false;
  return member.roles.cache.some((r) => r.position >= minRole.position);
}

function buildPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🎫 מרכז פתיחת טיקטים")
    .setDescription(
      "כדי לפתוח פנייה, אנא בחרו את הנושא המתאים מהתפריט למטה.\nצוות השרת יפנה אליכם בהקדם המרבי."
    )
    .setColor(0xffff00);

  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category")
    .setPlaceholder("תמיכה כללית")
    .addOptions(
      TICKET_OPTIONS.map((opt) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(opt.label)
          .setValue(opt.value)
          .setEmoji(opt.emoji)
      )
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

function buildVerifyPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🛡️ מערכת אימות רשמית")
    .setDescription("ברוכים הבאים לשרת DoubleIL!\nכדי לקבל גישה מלאה לכל חלקי השרת, יש לעבור תהליך אימות קצר.\n\nאנא לחצו על הכפתור המאומת למטה כדי להתחיל.")
    .setColor(0xffff00)
    .setFooter({ text: "מערכת אבטחה מתקדמת" });

  const button = new ButtonBuilder()
    .setCustomId("start_verify")
    .setLabel("התחל אימות")
    .setStyle(ButtonStyle.Success)
    .setEmoji("✅");

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

function buildTicketButtons(handled = false) {
  const handleBtn = new ButtonBuilder()
    .setCustomId("ticket_handle")
    .setLabel(handled ? "מטופל" : "טפל")
    .setStyle(handled ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(handled);

  const closeBtn = new ButtonBuilder()
    .setCustomId("ticket_close")
    .setLabel("סגור")
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder().addComponents(handleBtn, closeBtn);
}

function buildHelpEmbed(userId, reason, handledBy) {
  const handled = !!handledBy;
  return new EmbedBuilder()
    .setTitle("🆘 בקשת עזרה")
    .setColor(handled ? 0x95a5a6 : 0x5865f2)
    .addFields(
      { name: "👤 מבקש", value: `<@${userId}>`, inline: true },
      {
        name: "🛠️ מטפל",
        value: handledBy ? `<@${handledBy}>` : "ממתין לטיפול",
        inline: true,
      },
      { name: "📋 סיבה", value: `\`\`\`${reason}\`\`\``, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: handled ? "✅ הבקשה טופלה" : "⏳ ממתין לטיפול" });
}

function buildHelpButton(handled = false) {
  const btn = new ButtonBuilder()
    .setCustomId("help_handle")
    .setLabel(handled ? "מטופל" : "טפל")
    .setStyle(handled ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(handled);

  return new ActionRowBuilder().addComponents(btn);
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST().setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
      body: [],
    });
  } catch (err) {
    console.error("Failed to clear slash commands:", err);
  }

  try {
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
    if (channel && channel.type === ChannelType.GuildText) {
      const recent = await channel.messages.fetch({ limit: 50 });
      const existing = recent.find(
        (msg) =>
          msg.author.id === client.user.id &&
          msg.embeds.some((e) => e.title === "🎫 מרכז פתיחת טיקטים")
      );
      if (existing) await existing.delete().catch(() => {});

      await channel.send(buildPanel());
      console.log("✅ Ticket panel sent");
    }
  } catch (err) {
    console.error("Failed to send panel:", err);
  }

  try {
    const verifyChannel = await client.channels.fetch(VERIFY_CHANNEL_ID);
    if (verifyChannel && verifyChannel.type === ChannelType.GuildText) {
      await verifyChannel.permissionOverwrites.set([
        {
          id: verifyChannel.guild.roles.everyone,
          allow: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: VERIFY_ROLE_1,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: VERIFY_ROLE_2,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
      ]).catch((err) => console.error("Failed to set channel overwrites:", err));

      const recent = await verifyChannel.messages.fetch({ limit: 50 });
      for (const msg of recent.values()) {
        if (msg.author.id === client.user.id) {
          await msg.delete().catch(() => {});
        }
      }

      await verifyChannel.send(buildVerifyPanel());
      console.log("✅ Professional Verify panel sent");
    }
  } catch (err) {
    console.error("Failed to send verify panel:", err);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (!message.guild && activeVerification.has(message.author.id)) {
    const data = activeVerification.get(message.author.id);
    const successEmbed = new EmbedBuilder()
      .setTitle("✅ אימות הושלם בהצלחה")
      .setDescription("תשובתך נמצאה נכונה. קיבלת את תפקידי הגישה לשרת DoubleIL. תוכל לסגור הודעה פרטית זו.")
      .setColor(0xffff00)
      .setTimestamp();

    const errorEmbed = new EmbedBuilder()
      .setTitle("❌ תשובה שגויה")
      .setDescription("התשובה שהזנת אינה נכונה.\nאנא נסה שוב והזן את התוצאה הנכונה לשאלה הקודמת:")
      .setColor(0xffff00)
      .setTimestamp();

    if (message.content.trim() === String(data.answer)) {
      activeVerification.delete(message.author.id);
      
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(message.author.id);
        await member.roles.add([VERIFY_ROLE_1, VERIFY_ROLE_2]);
        await message.reply({ embeds: [successEmbed] });
      } catch (err) {
        console.error("Failed to assign roles:", err);
        await message.reply("❌ תשובה נכונה, אך אירעה שגיאה בעת הענקת התפקידים. פנה לצוות השרת.");
      }
    } else {
      await message.reply({ embeds: [errorEmbed] });
    }
    return;
  }

  if (message.content.startsWith("!clear")) {
    if (!message.member) return;
    const hasPerms = await hasClearPermission(message.member);
    if (!hasPerms) {
      await message.reply({ content: "❌ אין לך הרשאה להשתמש בפקודה זו.", ephemeral: true }).catch(() => {});
      return;
    }

    const args = message.content.split(" ");
    const amount = parseInt(args[1]);

    if (isNaN(amount) || amount < 1 || amount > 100) {
      await message.reply({ content: "⚠️ אנא ספק מספר הודעות למחיקה בין 1 ל-100. שימוש: `!clear <1-100>`" }).catch(() => {});
      return;
    }

    try {
      await message.delete().catch(() => {});
      const fetched = await message.channel.messages.fetch({ limit: amount });
      const deleted = await message.channel.bulkDelete(fetched, true);
      
      if (deleted.size > 0) {
        const reply = await message.channel.send(`🧹 נמחקו בהצלחה ${deleted.size} הודעות.`);
        setTimeout(() => reply.delete().catch(() => {}), 4000);
      }
    } catch (err) {
      console.error("Failed to clear messages:", err);
    }
    return;
  }

  if (!message.content.startsWith("!h ") && message.content !== "!h") return;

  const reason = message.content.slice(3).trim();
  if (!reason) {
    await message.reply("אנא ציין סיבה. שימוש: `!h <סיבה>`");
    return;
  }

  if (/(@everyone|@here|<@[!&]?\d+>)/i.test(reason)) return;

  const userId = message.author.id;
  const now = Date.now();
  const timestamps = (helpUsage.get(userId) ?? []).filter(
    (t) => now - t < HELP_WINDOW_MS
  );

  if (timestamps.length >= HELP_RATE_LIMIT) {
    const oldest = Math.min(...timestamps);
    const nextAvailable = Math.floor((oldest + HELP_WINDOW_MS) / 1000);
    await message.reply(
      `הנה המתן <t:${nextAvailable}:R> עד שתוכל להשתמש ב !h שוב`
    );
    return;
  }

  timestamps.push(now);
  helpUsage.set(userId, timestamps);

  try {
    await message.channel.send({
      content: `<@&${STAFF_ROLE_ID}> | צוות יעזור בתוך זמן קצר`,
      allowedMentions: { roles: [STAFF_ROLE_ID] },
      embeds: [buildHelpEmbed(userId, reason)],
      components: [buildHelpButton(false)],
    });
    await message.delete().catch(() => {});
  } catch (err) {
    console.error("Failed to send help message:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId === "start_verify") {
    if (interaction.member.roles.cache.has(VERIFY_ROLE_1) && interaction.member.roles.cache.has(VERIFY_ROLE_2)) {
      await interaction.reply({
        content: "❌ אתה כבר מאומת!",
        ephemeral: true,
      });
      return;
    }

    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    const answer = num1 + num2;

    activeVerification.set(interaction.user.id, { answer, guildId: interaction.guildId });

    const dmEmbed = new EmbedBuilder()
      .setTitle("🔐 תהליך אימות אבטחה")
      .setDescription(`כדי לאשר שאינך בוט בשרת DoubleIL, אנא השב על התרגיל הבא:\n\n**כמה זה ${num1} + ${num2}?**\n\n*(שלח הודעה פרטית זו עם המספר בלבד)*`)
      .setColor(0xffff00)
      .setFooter({ text: "הודעה זו מיועדת עבורך בלבד" });

    const replyEmbed = new EmbedBuilder()
      .setTitle("📩 הודעת אימות נשלחה")
      .setDescription("נשלחה אליך הודעה פרטית (DM) המכילה את שאלת האימות.")
      .setColor(0xffff00);

    const errorEmbed = new EmbedBuilder()
      .setTitle("⚠️ שגיאה בשליחת הודעה")
      .setDescription("לא הצלחנו לשלוח אליך הודעה פרטית.\nאנא ודא שההודעות הפרטיות (DMs) שלך פתוחות מחברי השרת ונסה שוב.")
      .setColor(0xffff00);

    try {
      await interaction.user.send({ embeds: [dmEmbed] });
      await interaction.reply({ embeds: [replyEmbed], ephemeral: true });
    } catch (err) {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
    return;
  }

  if (interaction.isButton() && interaction.customId === "help_handle") {
    if (!(await isStaffOrHigher(interaction.member))) {
      await interaction.reply({ content: "אין לך הרשאה להשתמש בכפתור זה.", ephemeral: true });
      return;
    }
    const originalEmbed = interaction.message.embeds[0];
    if (!originalEmbed) return;
    const requesterMatch = originalEmbed.fields
      .find((f) => f.name === "👤 מבקש")?.value.match(/<@(\d+)>/);
    const requesterId = requesterMatch?.[1] ?? "?";
    const reason = originalEmbed.fields
      .find((f) => f.name === "📋 סיבה")?.value.replaceAll("```", "").trim() ?? "";
    await interaction.update({
      embeds: [buildHelpEmbed(requesterId, reason, interaction.user.id)],
      components: [buildHelpButton(true)],
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === "ticket_handle") {
    if (!(await isStaffOrHigher(interaction.member))) {
      await interaction.reply({ content: "אין לך הרשאה להשתמש בכפתור זה.", ephemeral: true });
      return;
    }
    await interaction.update({ components: [buildTicketButtons(true)] });
    await interaction.channel?.send({
      embeds: [
        new EmbedBuilder()
          .setDescription(`🔧 הטיקט יטופל על ידי <@${interaction.user.id}>`)
          .setColor(0x95a5a6),
      ],
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === "ticket_close") {
    if (!(await isStaffOrHigher(interaction.member))) {
      await interaction.reply({ content: "אין לך הרשאה להשתמש בכפתור זה.", ephemeral: true });
      return;
    }
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) return;
    await interaction.reply({ content: "🔒 הטיקט נסגר, הערוץ ימחק תוך 5 שניות." });
    setTimeout(() => channel.delete().catch(() => {}), 5000);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "ticket_category") {
    await interaction.deferReply({ flags: 64 });

    const option = TICKET_OPTIONS.find((o) => o.value === interaction.values[0]);
    const guild = interaction.guild;
    if (!guild || !option) return;

    const safeName = interaction.user.username
      .toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 20).replace(/-+$/, "");
    const channelName = `ticket-${safeName}`;

    const existing = guild.channels.cache.find(
      (ch) => ch.name === channelName && ch.parentId === TICKET_CATEGORY_ID
    );
    if (existing) {
      await interaction.editReply({ content: `כבר יש לך טיקט פתוח: <#${existing.id}>` });
      return;
    }

    try {
      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: STAFF_ROLE_ID,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.ManageMessages,
            ],
          },
        ],
      });

      await ticketChannel.send({
        content: `<@${interaction.user.id}> | <@&${STAFF_ROLE_ID}>`,
        embeds: [
          new EmbedBuilder()
            .setTitle(`${option.emoji} ${option.label}`)
            .setDescription("הטיקט שלך נפתח! צוות השרת יצור איתך קשר בהקדם.")
            .setColor(0x5865f2),
        ],
        components: [buildTicketButtons(false)],
      });

      await interaction.editReply({ content: `✅ הטיקט שלך נפתח ב <#${ticketChannel.id}>!` });
    } catch (err) {
      console.error("Failed to create ticket:", err);
      await interaction.editReply({ content: "אירעה שגיאה בעת יצירת הטיקט. נסה שוב מאוחר יותר." });
    }
  }
});

client.login(TOKEN);
