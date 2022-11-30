/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
    pgm.createTable('telegram_logs', {
        id: 'id',
        slug: {type: 'varchar(1000)', notNull: true},
        link: {type: 'varchar(1000)', comments: 'Link to telegram. Ex: https://t.me/GameFi_Official'},
        type: {type: 'varchar(50)', notNull: true, comments: 'Type: channel/group'},
        sub_type: {type: 'varchar(50)', comments: 'SubType: sustainable field'},

        new_message: {type: 'integer'},
        new_message_by_admin: {type: 'integer'},
        new_message_by_bot: {type: 'integer'},

        new_reaction: {type: 'integer'},
        new_view: {type: 'integer'},
        new_forward: {type: 'integer'},
        new_reply: {type: 'integer'},

        created_at: {
            type: 'timestamp',
            notNull: true,
            default: pgm.func('current_timestamp'),
        },
    })
};

exports.down = pgm => {
    pgm.dropTable('telegram_logs');
};
