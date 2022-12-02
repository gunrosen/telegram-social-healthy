/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
    pgm.createTable('telegram_channel_messages', {
        id: 'id',
        slug: {type: 'varchar(1000)', notNull: true},
        link: {type: 'varchar(1000)', comments: 'Link to telegram. Ex: https://t.me/GameFi_Official'},
        telegram_id: {type: 'varchar(50)' },
        published_at: {type: 'timestamp'},
        last_edit_at: {type: 'timestamp'},
        post_author: {type: 'varchar(100)'},
        message: {type: 'text'},
        count_view: {type: 'integer'},
        count_reply: {type: 'integer'},
        count_forward: {type: 'integer'},
        count_reaction: {type: 'integer'},

        updated_at: {type: 'timestamp'}
    })
};

exports.down = pgm => {
    pgm.dropTable('telegram_channel_messages');
};
