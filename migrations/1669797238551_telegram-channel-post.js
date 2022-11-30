/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
    pgm.createTable('telegram_channel_posts', {
        id: 'id',
        published_at: {type: 'timestamp'},
        content: {type: 'text'},
        count_view: {type: 'integer'},
        count_reply: {type: 'integer'},
        count_forward: {type: 'integer'},
        count_reaction: {type: 'integer'},

        updated_at: {type: 'timestamp'}
    })
};

exports.down = pgm => {
    pgm.dropTable('telegram_channel_posts');
};
