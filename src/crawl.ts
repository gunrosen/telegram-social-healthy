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
import ReactionCount = Api.ReactionCount;

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
      const {slug, type, bot, link} = cg
      // TODO: Should remove hardcode
      // let from = parseInt(await redis.get(`${type}:${slug}:latest`))
      // let to = Math.floor(Date.now() / 1000)
      const from = 1669360836
      const to = 1669879236
      if (type === TELEGRAM_TYPE.GROUP) {
        await crawlGroup(clientPg, clientTelegram, redis, slug, 'https://t.me/test_group_hulk', bot, from, to)
      } else if (type === TELEGRAM_TYPE.CHANNEL) {
        await crawlChannel(clientPg, clientTelegram, redis, slug, link, from, to)
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
    console.error(`crawlGroup: From time is greater than now, from: ${from}`)
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

const crawlChannel = async (clientPg: Client, clientTelegram: TelegramClient, redis: Redis, slug: string, link: string, from: number, to: number): Promise<number> => {
  const now = Date.now()
  if (from > now) {
    console.error(`crawlChannel: From time is greater than now, from: ${from}`)
    return
  }
  to = to > now ? now : to
  let temp = to
  let mapAggregation = new Map<string, ChannelAggregationByDay>()
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
        const {views, forwards, replies, reactions} = msg
        // Update aggregation of day
        let agg: ChannelAggregationByDay = mapAggregation.get(isoDate) || new ChannelAggregationByDay()

        // Upsert Channel Message
        await upsertChannelMessage(clientPg, slug, link, msg, agg)

        mapAggregation.set(isoDate, agg)
      }
    }
    await wait(300)
  } while (temp >= from)
  console.log(`Latest message date : ${temp}`)
  for (const [isoDate, agg] of mapAggregation) {
    await upsertChannelLog(clientPg, slug, link, isoDate, agg)
  }
  await redis.set(`channel:${slug}:latest`, to)
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
    name: 'get-telegram-group-logs-by-slug-isoDate',
    text: 'SELECT * FROM telegram_logs where slug = $1::text and type= $2::text and iso_date = $3::text',
    values: [slug, TELEGRAM_TYPE.GROUP, isoDate],
    rowMode: 'array',
  }
  const [year, month, day] = isoDate.split('-').map(x => parseInt(x))
  const createdDate = convertTimestamp(getFirstMomentOfDate(year, month, day))
  let existRecord = await clientPg.query(query)
  if (existRecord.rows.length === 0) {
    const insertQuery = {
      name: 'insert-telegram-group-log',
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
      name: 'update-telegrams-group-log',
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

const upsertChannelMessage = async (clientPg: Client, slug: string, link: string, msg: Message, agg: ChannelAggregationByDay) => {
  const {message, id, postAuthor, editDate, views, forwards, replies, reactions, date} = msg
  const publishedAt = convertTimestamp(date)
  const lastEditAt = convertTimestamp(editDate)
  const query = {
    name: 'get-tele-channel-message',
    text: 'SELECT * FROM telegram_channel_messages where slug = $1::text and id= $2',
    values: [slug, id],
    rowMode: 'array',
  }
  let existRecord = await clientPg.query(query)
  // Update telegram channel logs
  if (existRecord.rowCount === 0) {
    agg.numberMessage += 1
    agg.numberViews += views || 0
    agg.numberForward += forwards || 0
    agg.numberReply += replies?.replies || 0
    agg.numberReaction += reactions?.results[0]?.count || 0
  } else {
    const channelMessage = existRecord.rows[0]
    const {number_view, number_reaction, number_forward, number_reply} = channelMessage
    const deltaViews = views - number_view
    const deltaForward = forwards - number_forward
    const deltaReply = (replies?.replies || 0) - number_reply
    const deltaReaction = (reactions?.results[0]?.count || 0) - number_reaction
    agg.numberViews += deltaViews
    agg.numberForward += deltaForward
    agg.numberReply += deltaReply
    agg.numberReaction += deltaReaction
  }
  // Upsert database
  if (existRecord.rows.length === 0) {
    const insertQuery = {
      name: 'insert-telegram-channel-message',
      text: 'INSERT INTO telegram_channel_messages(slug, link, telegram_id, published_at, last_edit_at, ' +
        'post_author, ' +
        'message, ' +
        'count_view, ' +
        'count_reply, ' +
        'count_forward, ' +
        'count_reaction ' +
        ' ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, $11)',
      values: [
        slug, link, id, publishedAt, lastEditAt,
        postAuthor,
        message,
        views || 0,
        replies?.replies || 0,
        forwards || 0,
        reactions?.results[0]?.count || 0
      ],
      rowMode: 'array',
    }
    await clientPg.query(insertQuery)
  } else {
    const updateQuery = {
      name: 'update-telegrams',
      text: 'UPDATE telegram_channel_messages SET last_edit_at=$1, ' +
        'count_view=$2, ' +
        'count_reply=$3, ' +
        'count_forward=$4, ' +
        'count_reaction=$5, ' +
        'updated_at=$6 ' +
        'WHERE slug=$7 and telegram_id=$8',
      values: [
        lastEditAt,
        views || 0,
        replies?.replies || 0,
        forwards || 0,
        reactions?.results[0]?.count || 0,
        Date.now(),
        slug, id],
      rowMode: 'array',
    }
    await clientPg.query(updateQuery)
  }
}

const upsertChannelLog = async (clientPg: Client, slug: string, link: string, isoDate: string, agg: ChannelAggregationByDay) => {
  const query = {
    name: 'get-telegram-channel-logs-by-slug-isoDate',
    text: 'SELECT * FROM telegram_logs where slug = $1::text and type= $2::text and iso_date = $3::text',
    values: [slug, TELEGRAM_TYPE.CHANNEL, isoDate],
    rowMode: 'array',
  }
  const [year, month, day] = isoDate.split('-').map(x => parseInt(x))
  const createdDate = convertTimestamp(getFirstMomentOfDate(year, month, day))
  let existRecord = await clientPg.query(query)
  if (existRecord.rows.length === 0) {
    const insertQuery = {
      name: 'insert-telegram-channel-log',
      text: 'INSERT INTO telegram_logs(slug, link, type, sub_type, iso_date, ' +
        'number_view, ' +
        'number_reaction, ' +
        'number_forward, ' +
        'number_reply, ' +
        'number_message, ' +
        'created_at ' +
        ' ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      values: [
        slug, link, TELEGRAM_TYPE.CHANNEL, null, isoDate,
        agg.numberViews,
        agg.numberReaction,
        agg.numberForward,
        agg.numberReply,
        agg.numberMessage,
        createdDate
      ],
      rowMode: 'array',
    }
    await clientPg.query(insertQuery)
  } else {
    const updateQuery = {
      name: 'update-telegram-channel-logs',
      text: 'UPDATE telegram_logs SET number_view=$1, ' +
        'number_reaction=$2, ' +
        'number_forward=$3, ' +
        'number_reply=$4, ' +
        'number_message=$5 ' +
        'WHERE slug=$6 and type=$7  and iso_date=$8',
      values: [
        agg.numberViews,
        agg.numberReaction,
        agg.numberForward,
        agg.numberReply,
        agg.numberMessage,
        slug, TELEGRAM_TYPE.GROUP, isoDate],
      rowMode: 'array',
    }
    await clientPg.query(updateQuery)
  }
}

crawl()