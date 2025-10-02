/**
 * CommonJS wrapper for loading better-sqlite3
 * This is needed because better-sqlite3 is a native CommonJS module
 * that doesn't work well with ESM imports in Electron
 */

module.exports = {
  createKnex: function(config) {
    const knex = require('knex');
    return knex(config);
  }
};
