/**
 * DB connection setup. SQLite for speed during the hackathon — zero setup,
 * just a file on disk. This is the JS equivalent of app/database.py.
 */

const { Sequelize } = require("sequelize");

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: "./compliance.db",
  logging: false,
});

module.exports = sequelize;
