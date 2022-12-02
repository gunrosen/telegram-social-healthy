/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
    pgm.createTable('telegram_logs', {
        id: 'id',
        slug: {type: 'varchar(1000)', notNull: true},
        link: {type: 'varchar(1000)', comments: 'Link to telegram. Ex: https://t.me/GameFi_Official'},
        type: {type: 'varchar(50)', notNull: true, comments: 'Type: channel/group'},
        sub_type: {type: 'varchar(50)', comments: 'SubType: sustainable field'},

        number_action_chat_add_user: {type: 'integer'},
        number_action_chat_delete_user: {type: 'integer'},
        number_action_chat_joined_by_link: {type: 'integer'},
        number_action_chat_joined_by_request: {type: 'integer'},
        number_action_pin_message: {type: 'integer'},

        number_message: {type: 'integer'},
        number_message_by_bot: {type: 'integer'},
        number_message_forward_from_channel: {type: 'integer'},
        number_media_photo: {type: 'integer'},
        number_media_document: {type: 'integer'},
        number_media_poll: {type: 'integer'},

        number_reaction: {type: 'integer'},
        number_view: {type: 'integer'},
        number_forward: {type: 'integer'},
        number_reply: {type: 'integer'},

        created_at: {
            type: 'timestamp',
            notNull: true,
            default: pgm.func('current_timestamp'),
        },
        compared_old_at: {
            type: 'timestamp',
        },
    })
};

exports.down = pgm => {
    pgm.dropTable('telegram_logs');
};
