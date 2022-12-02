import * as dotenv from 'dotenv'

dotenv.config()
import {Client} from 'pg'
import {Api, TelegramClient} from "telegram";
import Redis from 'ioredis'
import TypeMessages = Api.messages.TypeMessages;
import ChannelMessages = Api.messages.ChannelMessages;
import Message = Api.Message;
import {convertTimestamp, getFirstMomentOfDate, getIsoDate} from "./utils/times";
import {GroupAggregationByDay, ChannelAggregationByDay} from "./types";
import MessageActionChatAddUser = Api.MessageActionChatAddUser;
import MessageActionChatDeleteUser = Api.MessageActionChatDeleteUser;
import MessageActionChatJoinedByLink = Api.MessageActionChatJoinedByLink;
import MessageActionChatJoinedByRequest = Api.MessageActionChatJoinedByRequest;
import MessageActionPinMessage = Api.MessageActionPinMessage;
import MessageMediaPhoto = Api.MessageMediaPhoto;
import MessageMediaDocument = Api.MessageMediaDocument;
import MessageMediaPoll = Api.MessageMediaPoll;
import PeerUser = Api.PeerUser;
import {TELEGRAM_LANGUAGE, TELEGRAM_TYPE} from "./utils/constants";
import {StringSession} from "telegram/sessions";
import User = Api.User;
import PeerChannel = Api.PeerChannel;
import MessageService = Api.MessageService;
import {wait} from "./utils/util";

/*
  Get list of group/channel from telegrams table.
  Then get information daily from START_TIME
 */
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/social'
const START_TIME = parseInt(process.env.START_TIME) || 1641006129
const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
const apiHash = process.env.TELEGRAM_API_HASH || "";
const session = process.env.TELEGRAM_SESSION || "";
const stringSession = new StringSession(session);


// By limitation of API, we only fetch 100 records each time
const crawl = async () => {
  const clientPg = new Client(DATABASE_URL)
  const redis = new Redis(REDIS_URL)
  try {
    await clientPg.connect()
    const clientTelegram = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });
    await clientTelegram.connect()
    const me = await clientTelegram.getMe()
    if (me instanceof User) {
      console.log(`You logged in as : ${me.username}`)
    }
    const resTelegramChannelGroup = (await clientPg.query('SELECT slug, type, link, bot FROM telegrams')).rows
    for (const cg of resTelegramChannelGroup) {
      const {slug, type, bot} = cg
      let from = parseInt(await redis.get(`${type}:${slug}:latest`))
      let to = Math.floor(Date.now() / 1000)
      if (type === TELEGRAM_TYPE.GROUP) {
        await crawlGroup(clientPg, clientTelegram, redis, slug, 'https://t.me/test_group_hulk', bot, from, to)
      } else if (type === TELEGRAM_TYPE.CHANNEL){

      }

    }
  } catch (err) {
    console.error(err)
  } finally {
    await clientPg.end()
  }
}

/*
Crawl with time range (from/to)
100-record is a limit of api
 */
const crawlGroup = async (clientPg: Client, clientTelegram: TelegramClient, redis: Redis, slug: string, link: string, bot: string, from: number, to: number): Promise<number> => {
  const now = Date.now()
  if (from > now) {
    console.error(`From time is greater than now, from: ${from}`)
    return
  }
  to = to > now ? now : to
  let temp = to
  let mapAggregation = new Map<string, GroupAggregationByDay>()
  const botIds = bot.split(',')
  do {
    const history: TypeMessages = await clientTelegram.invoke(
      new Api.messages.GetHistory({
        peer: link,
        offsetDate: temp,
        limit: 100,
      })
    )
    const msgArr = (history as ChannelMessages).messages.sort((a, b) => {
      const msgA = a as Message
      const msgB = b as Message
      return (msgB.date || Number.MAX_SAFE_INTEGER) - (msgA.date || Number.MAX_SAFE_INTEGER)
    })

    for (const msg of msgArr) {
      let date = 0
      if (!(msg instanceof Api.MessageEmpty)) {
        date = msg.date
      }
      // date is mandatory, if date does not set, just skip
      if (date === 0) continue

      // Messages are sorted desc by date.
      if (date < from) {
        temp = date
        break
      }
      const isoDate = getIsoDate(convertTimestamp(date))
      if (msg instanceof Message) {
        const {fromId, media} = msg
        let agg: GroupAggregationByDay = mapAggregation.get(isoDate) || new GroupAggregationByDay()
        checkMedia(agg, media)
        checkMessage(agg, fromId, botIds)

        mapAggregation.set(isoDate, agg)
      } else if (msg instanceof MessageService) {
        const {action} = msg
        let agg: GroupAggregationByDay = mapAggregation.get(isoDate) || new GroupAggregationByDay()
        checkAction(agg, action)

        mapAggregation.set(isoDate, agg)
      }
    }
    const oldestMessage = msgArr[msgArr.length - 1]
    temp = (oldestMessage as Message).date
    if (msgArr.length < 100) {
      // it means it does not have any history messages
      break
    }
    await wait(300)
  } while (temp >= from)
  console.log(`Latest message date : ${temp}`)
  for (const [isoDate, agg] of mapAggregation) {
    await upsertGroupLog(clientPg, slug, link, isoDate, agg)
  }
  await redis.set(`group:${slug}:latest`, to)
  return temp
}


// ---------------- PRIVATE ZONE ---------------------------------
// MEDIA
const checkMedia = (agg: GroupAggregationByDay, media: any) => {
  if (media instanceof MessageMediaPhoto) {
    agg.numberMediaPhoto++
  } else if (media instanceof MessageMediaDocument) {
    agg.numberMediaDocument++
  } else if (media instanceof MessageMediaPoll) {
    agg.numberMediaPoll++
  }
}

// MESSAGE
const checkMessage = (agg: GroupAggregationByDay, fromId: any, botIds: string[]) => {
  if (fromId instanceof PeerUser) {
    const {userId} = fromId
    if (botIds.includes(String(userId))) {
      agg.numberMessageByBot++
    } else {
      agg.numberMessage++
    }
  } else if (fromId instanceof PeerChannel) {
    agg.numberMessageForwardFromChannel++
  }
}

// ACTION
const checkAction = (agg: GroupAggregationByDay, action: any) => {
  if (action instanceof MessageActionChatAddUser) {
    agg.numberActionChatAddUser++
  } else if (action instanceof MessageActionChatDeleteUser) {
    agg.numberActionChatDeleteUser++
  } else if (action instanceof MessageActionChatJoinedByLink) {
    agg.numberActionChatJoinedByLink++
  } else if (action instanceof MessageActionChatJoinedByRequest) {
    agg.numberActionChatJoinedByRequest++
  } else if (action instanceof MessageActionPinMessage) {
    agg.numberActionPinMessage++
  }
}

const upsertGroupLog = async (clientPg: Client, slug: string, link: string, isoDate: string, agg: GroupAggregationByDay) => {
  const query = {
    name: 'get-telegram-logs-by-slug-isoDate',
    text: 'SELECT * FROM telegram_logs where slug = $1::text and type= $2::text and iso_date = $3::text',
    values: [slug, TELEGRAM_TYPE.GROUP, isoDate],
    rowMode: 'array',
  }
  const [year, month, day] = isoDate.split('-').map(x => parseInt(x))
  const createdDate = convertTimestamp(getFirstMomentOfDate(year, month, day))
  let existRecord = await clientPg.query(query)
  if (existRecord.rows.length === 0) {
    const insertQuery = {
      name: 'insert-telegram-log',
      text: 'INSERT INTO telegram_logs(slug, link, type, sub_type, iso_date, ' +
        'number_action_chat_add_user, ' +
        'number_action_chat_delete_user, ' +
        'number_action_chat_joined_by_link, ' +
        'number_action_chat_joined_by_request, ' +
        'number_action_pin_message, ' +
        'number_message, ' +
        'number_message_by_bot, ' +
        'number_message_forward_from_channel, ' +
        'number_media_photo, ' +
        'number_media_document, ' +
        'number_media_poll, ' +
        'created_at ' +
        ' ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, $11, $12, $13, $14, $15, $16, $17)',
      values: [
        slug, link, TELEGRAM_TYPE.GROUP, null, isoDate,
        agg.numberActionChatAddUser,
        agg.numberActionChatDeleteUser,
        agg.numberActionChatJoinedByLink,
        agg.numberActionChatJoinedByRequest,
        agg.numberActionPinMessage,
        agg.numberMessage,
        agg.numberMessageByBot,
        agg.numberMessageForwardFromChannel,
        agg.numberMediaPhoto,
        agg.numberMediaDocument,
        agg.numberMediaPoll,
        createdDate
      ],
      rowMode: 'array',
    }
    await clientPg.query(insertQuery)
  } else {
    const updateQuery = {
      name: 'update-telegrams',
      text: 'UPDATE telegram_logs SET number_action_chat_add_user=$1, ' +
        'number_action_chat_delete_user=$2, ' +
        'number_action_chat_joined_by_link=$3, ' +
        'number_action_chat_joined_by_request=$4, ' +
        'number_action_pin_message=$5, ' +
        'number_message=$6, ' +
        'number_message_by_bot=$7, ' +
        'number_message_forward_from_channel=$8, ' +
        'number_media_photo=$9, ' +
        'number_media_document=$10, ' +
        'number_media_poll=$11 ' +
        'WHERE slug=$12 and type=$13  and iso_date=$14',
      values: [
        agg.numberActionChatAddUser,
        agg.numberActionChatDeleteUser,
        agg.numberActionChatJoinedByLink,
        agg.numberActionChatJoinedByRequest,
        agg.numberActionPinMessage,
        agg.numberMessage,
        agg.numberMessageByBot,
        agg.numberMessageForwardFromChannel,
        agg.numberMediaPhoto,
        agg.numberMediaDocument,
        agg.numberMediaPoll,
        slug, TELEGRAM_TYPE.GROUP, isoDate],
      rowMode: 'array',
    }
    await clientPg.query(updateQuery)
  }
}

crawl()