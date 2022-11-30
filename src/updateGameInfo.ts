import * as dotenv from 'dotenv'

dotenv.config()
import {Client} from 'pg'
import {mockGameData} from './utils/mock'
import {TELEGRAM_LANGUAGE, TELEGRAM_TYPE, UPSERT} from "./utils/constants";
import {StringSession} from "telegram/sessions";
import {Api, TelegramClient} from "telegram";
import User = Api.User;
import fsPromises from "fs/promises";
import ChannelFull = Api.ChannelFull;
import Channel = Api.Channel;

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
const apiHash = process.env.TELEGRAM_API_HASH || "";
const session = process.env.TELEGRAM_SESSION || "";
const stringSession = new StringSession(session);

const isMock = true
/*
  Get game information from core db (directus)
  Information contains of telegram group/channel mapping with game slug
 */
const getGameInfo = async () => {
  const clientSource = new Client({
    host: process.env.SOURCE_DB_HOST || 'localhost',
    port: parseInt(process.env.SOURCE_DB_PORT) || 5432,
    database: process.env.SOURCE_DB_DATABASE || 'backend',
    user: process.env.SOURCE_DB_USER || 'postgres',
    password: process.env.SOURCE_DB_PASSWORD || 'secretpassword!!',
  })
  const client = new Client(process.env.DATABASE_URL)
  try {
    await clientSource.connect()
    await client.connect()
    const resGames = isMock ? mockGameData : (await clientSource.query('SELECT slug, name, links FROM games')).rows
    let countInsert = 0, countUpdate = 0
    for (const game of resGames) {
      const slug = game.slug
      const name = game.name
      const links = game.links
      if (!links) {
        // skip
        console.log(`Skip slug: ${slug}`)
        continue
      }
      // Upsert games table
      const upsertSign = await upsertGamesInfo(client, name, slug, links)
      if (upsertSign === UPSERT.INSERT) {
        countInsert++
      } else if (upsertSign === UPSERT.UPDATE) {
        countUpdate++
      }
    }
    console.log(`games insert: ${countInsert} update:${countUpdate} total:${resGames.length}`)

    // Upsert telegram general info
    const clientTelegram = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });
    await clientTelegram.connect()
    const me = await clientTelegram.getMe()
    if (me instanceof User) {
      console.log(`You logged in as : ${me.username}`)
    }
    for (const game of resGames) {
      const slug = game.slug
      // TODO: Assume a game have only one group and one channel. It should be update in the future
      await upsertGamesCrawlInfo(client, clientTelegram, slug, TELEGRAM_TYPE.GROUP, game)
      await upsertGamesCrawlInfo(client, clientTelegram, slug, TELEGRAM_TYPE.CHANNEL, game)
    }
    console.log(`social_telegram insert: ${countInsert} update:${countUpdate} total:${resGames.length}`)
  } catch (e) {
    console.error(e)
  } finally {
    await clientSource.end()
  }
}

const upsertGamesInfo = async (client: Client, name: string, slug: string, links: any): Promise<number> => {
  const query = {
    name: 'get-game-by-slug',
    text: 'SELECT * FROM games where slug = $1::text ',
    values: [slug],
    rowMode: 'array',
  }
  let existRecord = await client.query(query)
  if (existRecord.rows.length === 0) {
    const insertQuery = {
      name: 'insert-game',
      text: 'INSERT INTO games(slug, name, website, telegram_group, telegram_channel, discord, twitter) VALUES ($1::text, $2::text, $3::text, $4::text,$5::text, $6::text,$7::text )',
      values: [slug, name, links.website, links.telegram, links.telegramAnnouncementChannel, links.discord, links.twitter],
      rowMode: 'array',
    }
    await client.query(insertQuery)
    return UPSERT.INSERT
  } else {
    const updateQuery = {
      name: 'update-game',
      text: 'UPDATE games set name=$1::text, website=$2::text, telegram_group=$3::text, telegram_channel=$4::text, discord=$5::text, twitter=$6::text where slug=$7::text',
      values: [name, links.website, links.telegram, links.telegramAnnouncementChannel, links.discord, links.twitter, slug],
      rowMode: 'array',
    }
    await client.query(updateQuery)
    return UPSERT.UPDATE
  }
}

const upsertGamesCrawlInfo = async (clientPg: Client, clientTelegram: TelegramClient, slug: string, type: string, gameInfo: any): Promise<any> => {
  const links = gameInfo?.links
  const link = type === TELEGRAM_TYPE.GROUP ? links?.telegram : links?.telegramAnnouncementChannel
  if (!link || !clientPg || !clientTelegram) {
    console.error(`upsertGamesCrawlInfo error: slug ${slug} type: ${type}`)
    return
  }
  const result = await clientTelegram.invoke(
    new Api.channels.GetFullChannel({
      channel: link,
    })
  );
  const fullChat: ChannelFull = result.fullChat as ChannelFull
  const telegramId = fullChat.id
  const about = fullChat.about
  const participantsCount = fullChat.participantsCount
  const onlineCount = fullChat.onlineCount
  const botInfo = fullChat.botInfo.map((item) => item.userId).join(',')

  let createdDate = 0
  const chats = result.chats.filter((item) => item.id == telegramId)
  if (chats.length > 0 && chats[0] instanceof Channel) {
    createdDate = chats[0].date
  }
  const query = {
    name: 'get-telegram-info-by-slug',
    text: 'SELECT * FROM telegrams where slug = $1::text and type= $2::text',
    values: [slug, type],
    rowMode: 'array',
  }
  let existRecord = await clientPg.query(query)
  if (existRecord.rows.length === 0) {
    const insertQuery = {
      name: 'insert-telegrams',
      text: 'INSERT INTO telegrams(slug, link, type, sub_type, language, about, number_participant, bot, number_online, date ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      values: [slug, link, type, null, TELEGRAM_LANGUAGE.DEFAULT, about, participantsCount, botInfo, onlineCount, createdDate],
      rowMode: 'array',
    }
    await clientPg.query(insertQuery)
  } else {
    const updateQuery = {
      name: 'update-telegrams',
      text: 'UPDATE telegrams SET link=$1, about=$2, number_participant=$3, bot=$4, number_online=$5, updated_at=$6 WHERE slug=$7 and type=$8 ',
      values: [link, about, participantsCount, botInfo, onlineCount, new Date(), slug, type],
      rowMode: 'array',
    }
    await clientPg.query(updateQuery)
  }
}

getGameInfo()