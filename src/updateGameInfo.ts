import * as dotenv from 'dotenv'

dotenv.config()
import {Client} from 'pg'

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
    const resGames = await clientSource.query('SELECT slug, name, links FROM games')
    let countInsert = 0, countUpdate = 0
    for (const game of resGames.rows) {
      const slug = game.slug
      const name = game.name
      const links = game.links
      if (!links){
        // skip
        console.log(`Skip slug: ${slug}`)
        continue
      }
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
        countInsert++
      } else {
        const updateQuery = {
          name: 'update-game',
          text: 'UPDATE games set name=$1::text, website=$2::text, telegram_group=$3::text, telegram_channel=$4::text, discord=$5::text, twitter=$6::text where slug=$7::text',
          values: [name, links.website, links.telegram, links.telegramAnnouncementChannel, links.discord, links.twitter, slug],
          rowMode: 'array',
        }
        await client.query(updateQuery)
        countUpdate++
      }
    }
    console.log(`insert: ${countInsert} update:${countUpdate} total:${resGames.rows.length}`)
  } catch (e) {
    console.error(e)
  } finally {
    await clientSource.end()
  }


}

getGameInfo()