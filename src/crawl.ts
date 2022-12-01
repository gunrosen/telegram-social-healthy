import * as dotenv from 'dotenv'

dotenv.config()
import {Client} from 'pg'
import {Api, TelegramClient} from "telegram";
import ChannelFull = Api.ChannelFull;
import TypeMessages = Api.messages.TypeMessages;
import ChannelMessages = Api.messages.ChannelMessages;
import Message = Api.Message;
import {convertTimestamp, getIsoDate} from "./utils/times";
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
import {TELEGRAM_TYPE} from "./utils/constants";
import {StringSession} from "telegram/sessions";
import User = Api.User;
import PeerChannel = Api.PeerChannel;
import MessageService = Api.MessageService;

/*
  Get list of group/channel from telegrams table.
  Then get information daily from START_TIME
 */
const START_TIME = parseInt(process.env.START_TIME) || 1641006129
const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
const apiHash = process.env.TELEGRAM_API_HASH || "";
const session = process.env.TELEGRAM_SESSION || "";
const stringSession = new StringSession(session);


// By limitation of API, we only fetch 100 records each time
const crawl = async () => {
  const clientPg = new Client(process.env.DATABASE_URL)
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
      const {slug, link, type, bot} = cg
      if (type === TELEGRAM_TYPE.GROUP) {
        await crawlGroup(clientPg, clientTelegram, slug, 'https://t.me/test_group_hulk', bot, 1638245349, 1669894575)
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
const crawlGroup = async (clientPg: Client, clientTelegram: TelegramClient, slug: string, link: string, bot: string, from: number, to: number) => {
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
      if (msg instanceof Message) {
        const {date, fromId, media} = msg
        if (date < from) {
          // Messages are sorted desc by date.
          temp = date
          break
        }
        const isoDate = getIsoDate(convertTimestamp(date))
        let agg: GroupAggregationByDay = mapAggregation.get(isoDate) || new GroupAggregationByDay()

        // MEDIA
        if (media instanceof MessageMediaPhoto) {
          agg.numberMediaPhoto++
        } else if (media instanceof MessageMediaDocument) {
          agg.numberMediaDocument++
        } else if (media instanceof MessageMediaPoll) {
          agg.numberMediaPoll++
        }

        // MESSAGE
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
        mapAggregation.set(isoDate, agg)
      } else if (msg instanceof MessageService) {
        const {date, action} = msg
        if (date < from) {
          // Messages are sorted desc by date.
          temp = date
          break
        }
        const isoDate = getIsoDate(convertTimestamp(date))
        let agg: GroupAggregationByDay = mapAggregation.get(isoDate) || new GroupAggregationByDay()

        // ACTION
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

        mapAggregation.set(isoDate, agg)
      }
    }
    const oldestMessage = msgArr[msgArr.length - 1]
    temp = (oldestMessage as Message).date
  } while (temp >= from)
  console.log(mapAggregation)
}

crawl()