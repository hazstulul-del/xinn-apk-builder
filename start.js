require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const AdmZip = require("adm-zip");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_IDS = String(process.env.OWNER_IDS || "7562630960").split(",").map(x => x.trim());
const OWNER_USERNAME = process.env.OWNER_USERNAME || "@Xinn29";
const BOT_NAME = process.env.BOT_NAME || "XINN Web2APK Pro GitHub Builder";
const BANNER_URL = process.env.BANNER_URL || "https://files.catbox.moe/js64bo.png";
const FREE_CREDIT = Number(process.env.FREE_CREDIT || 5);
const MAX_ZIP_MB = Number(process.env.MAX_ZIP_MB || 100);
const BUILD_TIMEOUT_MINUTES = Number(process.env.BUILD_TIMEOUT_MINUTES || 35);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

if (!BOT_TOKEN) {
  console.log("BOT_TOKEN belum diisi di .env");
  process.exit(1);
}
if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.log("GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO belum diisi di .env");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, "database", "db.json");
const DOWNLOADS = path.join(ROOT, "downloads");
fs.ensureDirSync(path.dirname(DB_PATH));
fs.ensureDirSync(DOWNLOADS);

let workerBusy = false;

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { users: {}, queue: [], current: null, stats: { success: 0, failed: 0 } };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function isOwner(id) {
  return OWNER_IDS.includes(String(id));
}

function getUser(db, ctx) {
  const id = String(ctx.from.id);
  if (!db.users[id]) {
    db.users[id] = {
      id,
      name: ctx.from.first_name || "User",
      username: ctx.from.username ? "@" + ctx.from.username : null,
      credit: FREE_CREDIT,
      role: isOwner(id) ? "OWNER" : "FREE"
    };
  }
  if (isOwner(ctx.from.id)) {
    db.users[id].role = "OWNER";
    db.users[id].credit = "UNLIMITED";
  }
  return db.users[id];
}

const github = axios.create({
  baseURL: "https://api.github.com",
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  },
  timeout: 60000
});

async function sendMenu(ctx) {
  const db = loadDB();
  const user = getUser(db, ctx);
  saveDB(db);
  const credit = user.role === "OWNER" ? "UNLIMITED" : user.credit;

  const caption = `🚀 ${BOT_NAME}

Halo, ${ctx.from.first_name || "User"}!

💳 Credit: ${credit}
👑 Owner: ${OWNER_USERNAME}

✅ Panel tetap NodeJS
✅ Build APK lewat GitHub Actions
✅ Tidak perlu install Flutter di panel

Cara pakai:
1. Kirim ZIP project Flutter
2. Reply file dengan /buildapk
3. Tunggu GitHub Actions build
4. APK dikirim otomatis`;

  try {
    await ctx.replyWithPhoto(BANNER_URL, {
      caption,
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🧾 Cek Antrian", "queue")],
        [Markup.button.callback("📋 Bantuan", "help")]
      ])
    });
  } catch {
    await ctx.reply(caption);
  }
}

bot.start(sendMenu);

bot.action("help", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`📋 Bantuan

/buildapk - build release APK
/builddebug - build debug APK
/queue - cek antrian
/status - cek credit

Syarat:
• ZIP harus project Flutter
• Ada pubspec.yaml
• Repo GitHub sudah dipasang workflow flutter-build.yml`);
});

bot.action("queue", async (ctx) => {
  await ctx.answerCbQuery();
  await sendQueue(ctx);
});

bot.command("status", async (ctx) => {
  const db = loadDB();
  const user = getUser(db, ctx);
  saveDB(db);
  await ctx.reply(`Status: ${user.role}\nCredit: ${user.role === "OWNER" ? "UNLIMITED" : user.credit}`);
});

bot.command("queue", sendQueue);

async function sendQueue(ctx) {
  const db = loadDB();
  let text = `🧾 Status Antrian

${db.current ? "⚠️ Server: Build berjalan" : "✅ Server: Kosong"}

`;
  if (db.current) text += `Sedang berjalan:\n• ${db.current.name} - ${db.current.buildType}\n`;
  if (db.queue.length) {
    text += `\nAntrian:\n`;
    db.queue.forEach((q, i) => text += `${i + 1}. ${q.name} - ${q.buildType}\n`);
  } else {
    text += "Antrian kosong.\n";
  }
  text += `\nStatistik: ✅ ${db.stats.success} | ❌ ${db.stats.failed}`;
  await ctx.reply(text);
}

bot.command("buildapk", async (ctx) => addBuildJob(ctx, "release"));
bot.command("builddebug", async (ctx) => addBuildJob(ctx, "debug"));

async function addBuildJob(ctx, buildType) {
  const doc = ctx.message.reply_to_message?.document;
  if (!doc) return ctx.reply("Reply file .zip project Flutter dengan command ini.");
  if (!doc.file_name.endsWith(".zip")) return ctx.reply("File harus .zip");

  const sizeMB = doc.file_size / 1024 / 1024;
  if (sizeMB > MAX_ZIP_MB) return ctx.reply(`File terlalu besar. Max ${MAX_ZIP_MB}MB`);

  const db = loadDB();
  const user = getUser(db, ctx);

  if (user.role !== "OWNER" && Number(user.credit || 0) <= 0) {
    saveDB(db);
    return ctx.reply(`Credit habis. Hubungi ${OWNER_USERNAME}`);
  }

  const job = {
    id: `${ctx.from.id}_${Date.now()}`,
    userId: ctx.from.id,
    chatId: ctx.chat.id,
    name: ctx.from.first_name || "User",
    username: ctx.from.username ? "@" + ctx.from.username : null,
    fileId: doc.file_id,
    fileName: doc.file_name,
    buildType,
    createdAt: Date.now()
  };

  db.queue.push(job);
  saveDB(db);

  await ctx.reply(`✅ Job masuk antrian.
📌 Posisi: #${db.queue.length}
🧪 Build: Flutter ${buildType}

Bot akan build lewat GitHub Actions.`);
  runWorker();
}

async function runWorker() {
  if (workerBusy) return;
  workerBusy = true;

  while (true) {
    const db = loadDB();
    if (!db.queue.length) {
      db.current = null;
      saveDB(db);
      workerBusy = false;
      return;
    }

    const job = db.queue.shift();
    job.startedAt = Date.now();
    db.current = job;
    saveDB(db);

    let progressMsg;
    try {
      progressMsg = await bot.telegram.sendMessage(job.chatId, `🚀 Giliran ${job.name} tiba!

📥 Menyiapkan file Telegram...
🧪 Mode: Flutter ${job.buildType}`);

      const fileLink = await bot.telegram.getFileLink(job.fileId);

      await bot.telegram.editMessageText(job.chatId, progressMsg.message_id, null,
`🚀 Build dimulai

📤 Mengirim job ke GitHub Actions...
🧪 Mode: Flutter ${job.buildType}`);

      await dispatchGitHubBuild(job, fileLink.href);

      await bot.telegram.editMessageText(job.chatId, progressMsg.message_id, null,
`⚙️ GitHub Actions sedang build APK...

Biasanya 5–15 menit.
Bot akan cek artifact otomatis.`);

      const artifact = await waitForArtifact(job.id);

      await bot.telegram.editMessageText(job.chatId, progressMsg.message_id, null,
`✅ Artifact APK ditemukan.

📥 Download APK dari GitHub...`);

      const apkPath = await downloadArtifactZip(artifact, job.id);

      const db2 = loadDB();
      const user = db2.users[String(job.userId)];
      if (user && user.role !== "OWNER") user.credit = Math.max(0, Number(user.credit || 0) - 1);
      db2.stats.success += 1;
      db2.current = null;
      saveDB(db2);

      const sizeMB = (fs.statSync(apkPath).size / 1024 / 1024).toFixed(2);

      await bot.telegram.sendDocument(job.chatId, {
        source: apkPath,
        filename: `xinn_flutter_${job.buildType}.apk`
      }, {
        caption: `✅ APK Build Success

📱 Type: Flutter
🎁 Build: ${job.buildType}
📦 Size: ${sizeMB} MB

Generated by ${BOT_NAME}`
      });

      await fs.remove(apkPath);
    } catch (err) {
      const db3 = loadDB();
      db3.stats.failed += 1;
      db3.current = null;
      saveDB(db3);

      const msg = `❌ Build gagal

${err.message}

Cek:
1. Workflow sudah ada di repo
2. GitHub Token punya akses repo + workflow
3. ZIP adalah project Flutter
4. GitHub Actions tidak disabled`;

      try {
        if (progressMsg) await bot.telegram.editMessageText(job.chatId, progressMsg.message_id, null, msg);
        else await bot.telegram.sendMessage(job.chatId, msg);
      } catch {
        await bot.telegram.sendMessage(job.chatId, msg);
      }
    }
  }
}

async function dispatchGitHubBuild(job, zipUrl) {
  await github.post(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`, {
    event_type: "build_flutter",
    client_payload: {
      build_id: job.id,
      zip_url: zipUrl,
      build_type: job.buildType
    }
  });
}

async function waitForArtifact(buildId) {
  const deadline = Date.now() + BUILD_TIMEOUT_MINUTES * 60 * 1000;
  const artifactName = `apk-${buildId}`;

  while (Date.now() < deadline) {
    const res = await github.get(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/artifacts?per_page=100`);
    const artifact = res.data.artifacts.find(a => a.name === artifactName && !a.expired);
    if (artifact) return artifact;
    await new Promise(r => setTimeout(r, 30000));
  }

  throw new Error(`Timeout menunggu artifact GitHub Actions lebih dari ${BUILD_TIMEOUT_MINUTES} menit.`);
}

async function downloadArtifactZip(artifact, buildId) {
  const zipPath = path.join(DOWNLOADS, `${buildId}-artifact.zip`);
  const extractDir = path.join(DOWNLOADS, `${buildId}-artifact`);

  const res = await github.get(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/artifacts/${artifact.id}/zip`, {
    responseType: "arraybuffer",
    maxRedirects: 5
  });

  await fs.writeFile(zipPath, res.data);
  await fs.ensureDir(extractDir);

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractDir, true);

  const apk = await findApk(extractDir);
  if (!apk) throw new Error("Artifact berhasil didownload tapi APK tidak ditemukan.");

  const finalPath = path.join(DOWNLOADS, `${buildId}.apk`);
  await fs.copy(apk, finalPath);
  await fs.remove(zipPath);
  await fs.remove(extractDir);

  return finalPath;
}

async function findApk(dir) {
  const items = await fs.readdir(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = await fs.stat(full);
    if (stat.isFile() && item.endsWith(".apk")) return full;
    if (stat.isDirectory()) {
      const found = await findApk(full);
      if (found) return found;
    }
  }
  return null;
}

bot.catch(err => console.error("BOT ERROR:", err));
bot.launch().then(() => console.log(`${BOT_NAME} running...`));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
