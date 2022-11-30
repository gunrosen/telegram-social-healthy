/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
    pgm.createTable('telegrams', {
        id: 'id',
        slug: {type: 'varchar(1000)', notNull: true},
        link: {type: 'varchar(1000)', comments: "Link to telegram. Ex: https://t.me/GameFi_Official"},
        type: {type: 'varchar(50)', notNull: true, comments: 'Type: channel/group'},
        sub_type: {type: 'varchar(50)', comments: 'SubType: sustainable field'},
        language: {type: 'varchar(50)', comments: 'global(en), vi, es, jp, cn'},
        about: {type: 'text'},
        number_participant: {type: 'integer'},
        bot: {type: 'text'},
        number_online: {type: 'integer'},
        date: {type: 'integer', comments: 'Channel/Group created date'},

        created_at: {
            type: 'timestamp',
            notNull: true,
            default: pgm.func('current_timestamp')
        },
        updated_at: {
            type: 'timestamp'
        },
    })
};

exports.down = pgm => {
    pgm.dropTable('telegrams');
};
