/**
 * Data models for the Coal Mine Compliance Monitoring System (SIH26024).
 * JS equivalent of app/models.py — same 4 entities, same relationships.
 */

const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const Subsidiary = sequelize.define("Subsidiary", {
  name: { type: DataTypes.STRING, allowNull: false }, // e.g. "BCCL", "CCL", "SECL"
});

const Mine = sequelize.define("Mine", {
  name: { type: DataTypes.STRING, allowNull: false },
  state: DataTypes.STRING,
  mineType: DataTypes.STRING, // "opencast" or "underground"

  // cached/derived — updated whenever risk is recalculated
  currentRiskScore: { type: DataTypes.FLOAT, defaultValue: 0.0 },
  currentRiskBand: { type: DataTypes.STRING, defaultValue: "LOW" },
  lastScoreExplanation: { type: DataTypes.STRING, defaultValue: "" },
});

const Violation = sequelize.define("Violation", {
  category: DataTypes.STRING, // "safety", "environmental", "labor", "equipment"
  severity: DataTypes.INTEGER, // 1 (minor) to 5 (critical)
  loggedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  resolved: { type: DataTypes.BOOLEAN, defaultValue: false },
  resolvedAt: { type: DataTypes.DATE, allowNull: true },
  description: { type: DataTypes.STRING, defaultValue: "" },
});

const Inspection = sequelize.define("Inspection", {
  inspectedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  inspectorName: { type: DataTypes.STRING, defaultValue: "" },
  notes: { type: DataTypes.STRING, defaultValue: "" },
});

// Relationships — same structure as the SQLAlchemy relationships
Subsidiary.hasMany(Mine, { foreignKey: "subsidiaryId" });
Mine.belongsTo(Subsidiary, { foreignKey: "subsidiaryId" });

Mine.hasMany(Violation, { foreignKey: "mineId" });
Violation.belongsTo(Mine, { foreignKey: "mineId" });

Mine.hasMany(Inspection, { foreignKey: "mineId" });
Inspection.belongsTo(Mine, { foreignKey: "mineId" });

module.exports = { sequelize, Subsidiary, Mine, Violation, Inspection };
