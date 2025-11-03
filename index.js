require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Database setup
const dbTotal = new Database('./donations_total.db');
dbTotal.prepare(`
CREATE TABLE IF NOT EXISTS donations_total (
    userId TEXT PRIMARY KEY,
    username TEXT,
    total INTEGER
)`).run();

const dbMonthly = new Database('./donations_monthly.db');
dbMonthly.prepare(`
CREATE TABLE IF NOT EXISTS donations_monthly (
    userId TEXT,
    username TEXT,
    total INTEGER,
    month TEXT,
    PRIMARY KEY(userId, month)
)`).run();

const DONATION_CHANNEL_ID = process.env.DONATION_CHANNEL_ID;
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID;
const OWNER_ID = process.env.OWNER_ID;

let previousTopTotal = [];
let previousTopMonthly = [];

// Helper
function getEmoji(pos) { return ['🥇','🥈','🥉'][pos-1] || ''; }
function getCurrentMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

// Update leaderboard Total Top 30
async function updateLeaderboardTotal(channel) {
    const top30 = dbTotal.prepare('SELECT * FROM donations_total ORDER BY total DESC LIMIT 30').all();
    const ids = top30.map(u=>u.userId);
    if(JSON.stringify(ids)===JSON.stringify(previousTopTotal)) return;
    previousTopTotal = ids;

    const embed = new EmbedBuilder()
        .setTitle('🏆 TOP 30 Donator')
        .setColor('#FFD700')
        .setFooter({ text:'created by @shdowtyrant_' });

    top30.forEach((u,index)=>{
        embed.addFields({ name:`${getEmoji(index+1)} ${index+1}. ${u.username}`, value:`Rp. ${u.total.toLocaleString()}`, inline:false });
    });

    await channel.send({ content:'@everyone', embeds:[embed] });
}

// Update leaderboard Monthly Top 10
async function updateLeaderboardMonthly(channel) {
    const month = getCurrentMonth();
    const top10 = dbMonthly.prepare('SELECT * FROM donations_monthly WHERE month=? ORDER BY total DESC LIMIT 10').all(month);
    const ids = top10.map(u=>u.userId);
    if(JSON.stringify(ids)===JSON.stringify(previousTopMonthly)) return;
    previousTopMonthly = ids;

    const embed = new EmbedBuilder()
        .setTitle('🏆 TOP 10 Donator Bulanan')
        .setColor('#FFD700')
        .setFooter({ text:'created by @shdowtyrant_' });

    top10.forEach((u,index)=>{
        embed.addFields({ name:`${getEmoji(index+1)} ${index+1}. ${u.username}`, value:`Rp. ${u.total.toLocaleString()}`, inline:false });
    });

    await channel.send({ content:'@everyone', embeds:[embed] });
}

// Auto reset leaderboard bulanan tiap bulan
function checkMonthlyReset() {
    const today = new Date();
    const currentMonth = getCurrentMonth();
    const lastMonthRow = dbMonthly.prepare('SELECT month FROM donations_monthly ORDER BY month DESC LIMIT 1').get();
    const lastMonth = lastMonthRow ? lastMonthRow.month : currentMonth;
    if(lastMonth !== currentMonth){
        dbMonthly.prepare('DELETE FROM donations_monthly WHERE month <> ?').run(currentMonth);
        previousTopMonthly = [];
        console.log('Leaderboard bulanan di-reset otomatis untuk bulan baru.');
    }
}
setInterval(checkMonthlyReset, 1000*60*60); // cek setiap jam

// Handle messages
client.on('messageCreate', async message=>{
    if(message.author.bot) return;

    // Auto parsing donasi
    if(message.channel.id === DONATION_CHANNEL_ID){
        const match = message.content.match(/Rp\.?\s?([\d.]+)/i);
        if(!match) return;
        const amount = parseInt(match[1].replace(/\./g,''));
        if(isNaN(amount)||amount<=0) return;
        const month = getCurrentMonth();

        // Total DB
        const totalRow = dbTotal.prepare('SELECT * FROM donations_total WHERE userId=?').get(message.author.id);
        if(totalRow) dbTotal.prepare('UPDATE donations_total SET total=total+?, username=? WHERE userId=?')
            .run(amount,message.author.username,message.author.id);
        else dbTotal.prepare('INSERT INTO donations_total(userId,username,total) VALUES(?,?,?)')
            .run(message.author.id,message.author.username,amount);

        // Monthly DB
        const monthRow = dbMonthly.prepare('SELECT * FROM donations_monthly WHERE userId=? AND month=?').get(message.author.id,month);
        if(monthRow) dbMonthly.prepare('UPDATE donations_monthly SET total=total+?, username=? WHERE userId=? AND month=?')
            .run(amount,message.author.username,message.author.id,month);
        else dbMonthly.prepare('INSERT INTO donations_monthly(userId,username,total,month) VALUES(?,?,?,?)')
            .run(message.author.id,message.author.username,amount,month);

        const lbChannel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
        updateLeaderboardTotal(lbChannel);
        updateLeaderboardMonthly(lbChannel);
    }

    if(!message.content.startsWith('%')) return;
    const args = message.content.slice(1).trim().split(/\s+/);
    const command = args.shift().toLowerCase();
    const member = message.member;
    const isAdmin = message.author.id===OWNER_ID || member.permissions.has(PermissionsBitField.Flags.ManageGuild);

    // Admin commands
    if(isAdmin){
        if(command==='resetdonation'){
            dbTotal.prepare('DELETE FROM donations_total').run();
            dbMonthly.prepare('DELETE FROM donations_monthly').run();
            previousTopTotal=[];
            previousTopMonthly=[];
            message.reply('Leaderboard total dan bulanan telah direset.');
        }

        if(command==='adddonation'){
            const userId = args[0].replace(/[<@!>]/g,'');
            const amount = parseInt(args[1]);
            if(!userId || isNaN(amount)||amount<=0) return message.reply('Format salah. %adddonation @user 50000');
            const month = getCurrentMonth();
            const user = await client.users.fetch(userId);

            // Total
            const totalRow = dbTotal.prepare('SELECT * FROM donations_total WHERE userId=?').get(userId);
            if(totalRow) dbTotal.prepare('UPDATE donations_total SET total=total+?, username=? WHERE userId=?')
                .run(amount,user.username,userId);
            else dbTotal.prepare('INSERT INTO donations_total(userId,username,total) VALUES(?,?,?)')
                .run(userId,user.username,amount);

            // Monthly
            const monthRow = dbMonthly.prepare('SELECT * FROM donations_monthly WHERE userId=? AND month=?').get(userId,month);
            if(monthRow) dbMonthly.prepare('UPDATE donations_monthly SET total=total+?, username=? WHERE userId=? AND month=?')
                .run(amount,user.username,userId,month);
            else dbMonthly.prepare('INSERT INTO donations_monthly(userId,username,total,month) VALUES(?,?,?,?)')
                .run(userId,user.username,amount,month);

            message.reply('Donasi berhasil ditambahkan.');
            const lbChannel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
            updateLeaderboardTotal(lbChannel);
            updateLeaderboardMonthly(lbChannel);
        }

        if(command==='removedonation'){
            const userId = args[0].replace(/[<@!>]/g,'');
            const amount = parseInt(args[1]);
            if(!userId || isNaN(amount) || amount <= 0) return message.reply('Format salah. %removedonation @user 50000');
            const month = getCurrentMonth();
            const user = await client.users.fetch(userId);

            // Total
            const totalRow = dbTotal.prepare('SELECT * FROM donations_total WHERE userId=?').get(userId);
            if(totalRow){
                const newTotal = Math.max(totalRow.total - amount, 0);
                dbTotal.prepare('UPDATE donations_total SET total=?, username=? WHERE userId=?')
                    .run(newTotal,user.username,userId);
            }

            // Monthly
            const monthRow = dbMonthly.prepare('SELECT * FROM donations_monthly WHERE userId=? AND month=?').get(userId,month);
            if(monthRow){
                const newMonth = Math.max(monthRow.total - amount, 0);
                dbMonthly.prepare('UPDATE donations_monthly SET total=?, username=? WHERE userId=? AND month=?')
                    .run(newMonth,user.username,userId,month);
            }

            const lbChannel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
            updateLeaderboardTotal(lbChannel);
            updateLeaderboardMonthly(lbChannel);
            message.reply(`Donasi ${user.username} telah dikurangi Rp. ${amount.toLocaleString()}`);
        }

        if(command==='resetuser'){
            const userId = args[0].replace(/[<@!>]/g,'');
            if(!userId) return message.reply('Format salah. %resetuser @user');
            const user = await client.users.fetch(userId);

            dbTotal.prepare('DELETE FROM donations_total WHERE userId=?').run(userId);
            dbMonthly.prepare('DELETE FROM donations_monthly WHERE userId=?').run(userId);

            const lbChannel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
            updateLeaderboardTotal(lbChannel);
            updateLeaderboardMonthly(lbChannel);
            message.reply(`Donasi ${user.username} telah di-reset.`);
        }
    }

    // Public commands
    if(command==='donators'){
        const lbChannel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
        updateLeaderboardTotal(lbChannel);
    }
    if(command==='monthly'){
        const lbChannel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
        updateLeaderboardMonthly(lbChannel);
    }
    if(command==='help'){
        const embed = new EmbedBuilder()
            .setTitle('📜 Command Help')
            .setColor('#00BFFF')
            .setFooter({ text:'created by @shdowtyrant_' })
            .setDescription(`
**Prefix:** %

**Commands:**
- %donators → Menampilkan Top 30 donasi total
- %monthly → Menampilkan Top 10 donasi bulan ini
- %adddonation @user <jumlah> → Tambah donasi manual (admin/mod only)
- %removedonation @user <jumlah> → Kurangi donasi user (admin/mod only)
- %resetuser @user → Reset donasi user (admin/mod only)
- %resetdonation → Reset leaderboard total & bulanan (admin/mod only)
- %help → Menampilkan panduan command
        `);
        message.channel.send({ embeds:[embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);
