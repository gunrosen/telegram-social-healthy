/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
    pgm.createTable('games', {
        id: 'id',
        name: {type: 'varchar(1000)', notNull: true},
        slug: {type: 'varchar(1000)', notNull: true},
        website: {type: 'varchar(1000)'},
        telegram_group: {type: 'varchar(1000)'},
        telegram_channel: {type: 'varchar(1000)'},
        discord: {type: 'varchar(1000)'},
        twitter: {type: 'varchar(1000)'},
        createdAt: {
            type: 'timestamp',
            notNull: true,
            default: pgm.func('current_timestamp'),
        },
    })
};

exports.down = pgm => {
};
