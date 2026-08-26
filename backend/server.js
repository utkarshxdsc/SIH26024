/**
 * SIH26024 — Smart Coal Mine Compliance Monitoring — Backend API.
 * JS equivalent of app/main.py — identical endpoints, identical behavior.
 *
 * Endpoints:
 *   GET  /mines                    -> list all mines with current risk score
 *   GET  /mines/:id                -> mine detail incl. violations/inspections
 *   POST /mines/:id/violations     -> log a new violation, recalculates risk
 *   POST /mines/:id/inspections    -> log a new inspection, recalculates risk
 *   POST /whatif                   -> live "what-if" scoring, no DB write
 *
 * Run: node server.js   (from backend/ directory)
 */

const express = require("express");
const cors = require("cors");
const { Op } = require("sequelize");
const { sequelize, Mine, Subsidiary, Violation, Inspection } = require("./models");
const { computeRiskScore } = require("./riskEngine");

const app = express();
app.use(cors()); // wide-open for hackathon speed, same as the Python CORSMiddleware
app.use(express.json());

// ---------------------------------------------------------------------------
// Core scoring helper — pulls a mine's real signals from the DB and calls
// the pure computeRiskScore function. Same role as score_mine_from_db in main.py.
// ---------------------------------------------------------------------------

async function scoreMineFromDb(mine) {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const violations = await Violation.findAll({ where: { mineId: mine.id } });
  const inspections = await Inspection.findAll({ where: { mineId: mine.id } });

  const unresolved = violations.filter((v) => !v.resolved);
  const resolved = violations.filter((v) => v.resolved && v.resolvedAt);

  const unresolvedCount = unresolved.length;
  const severitySumUnresolved = unresolved.reduce((sum, v) => sum + v.severity, 0);

  const lastInspection = inspections.length
    ? new Date(Math.max(...inspections.map((i) => new Date(i.inspectedAt).getTime())))
    : null;
  const daysSinceLastInspection = lastInspection
    ? Math.floor((now - lastInspection.getTime()) / DAY)
    : null;

  const cutoff = now - 90 * DAY;
  const violationsLast90Days = violations.filter(
    (v) => new Date(v.loggedAt).getTime() >= cutoff
  ).length;

  let avgResolutionDelayDays = null;
  if (resolved.length) {
    const delays = resolved.map(
      (v) => (new Date(v.resolvedAt).getTime() - new Date(v.loggedAt).getTime()) / DAY
    );
    avgResolutionDelayDays = delays.reduce((a, b) => a + b, 0) / delays.length;
  }

  const result = computeRiskScore({
    unresolvedCount,
    severitySumUnresolved,
    daysSinceLastInspection,
    violationsLast90Days,
    avgResolutionDelayDays,
  });

  // cache onto the mine row, same as the Python version
  mine.currentRiskScore = result.score;
  mine.currentRiskBand = result.band;
  mine.lastScoreExplanation = result.explanation;
  await mine.save();

  return result;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

app.get("/mines", async (req, res) => {
  const mines = await Mine.findAll({ include: Subsidiary });
  const out = [];
  for (const m of mines) {
    const result = await scoreMineFromDb(m);
    out.push({
      id: m.id,
      name: m.name,
      subsidiary: m.Subsidiary ? m.Subsidiary.name : null,
      state: m.state,
      mine_type: m.mineType,
      risk_score: result.score,
      risk_band: result.band,
      explanation: result.explanation,
    });
  }
  out.sort((a, b) => b.risk_score - a.risk_score); // highest risk first
  res.json(out);
});

app.get("/mines/:id", async (req, res) => {
  const mine = await Mine.findByPk(req.params.id, { include: Subsidiary });
  if (!mine) return res.status(404).json({ detail: "Mine not found" });

  const result = await scoreMineFromDb(mine);
  const violations = await Violation.findAll({
    where: { mineId: mine.id },
    order: [["loggedAt", "DESC"]],
  });
  const inspections = await Inspection.findAll({
    where: { mineId: mine.id },
    order: [["inspectedAt", "DESC"]],
  });

  res.json({
    id: mine.id,
    name: mine.name,
    subsidiary: mine.Subsidiary ? mine.Subsidiary.name : null,
    state: mine.state,
    mine_type: mine.mineType,
    risk_score: result.score,
    risk_band: result.band,
    explanation: result.explanation,
    breakdown: result.breakdown,
    violations: violations.map((v) => ({
      id: v.id, category: v.category, severity: v.severity,
      logged_at: v.loggedAt, resolved: v.resolved, description: v.description,
    })),
    inspections: inspections.map((i) => ({
      id: i.id, inspected_at: i.inspectedAt,
      inspector_name: i.inspectorName, notes: i.notes,
    })),
  });
});

app.post("/mines/:id/violations", async (req, res) => {
  const mine = await Mine.findByPk(req.params.id);
  if (!mine) return res.status(404).json({ detail: "Mine not found" });

  const { category, severity, description = "" } = req.body;
  await Violation.create({
    mineId: mine.id, category, severity, description,
    loggedAt: new Date(), resolved: false,
  });

  const result = await scoreMineFromDb(mine);
  res.json({ message: "Violation logged", new_risk: result });
});

app.post("/mines/:id/inspections", async (req, res) => {
  const mine = await Mine.findByPk(req.params.id);
  if (!mine) return res.status(404).json({ detail: "Mine not found" });

  const { inspector_name = "", notes = "" } = req.body;
  await Inspection.create({
    mineId: mine.id, inspectedAt: new Date(),
    inspectorName: inspector_name, notes,
  });

  const result = await scoreMineFromDb(mine);
  res.json({ message: "Inspection logged", new_risk: result });
});

app.post("/whatif", (req, res) => {
  // No DB write. Powers the live judge-facing slider — same contract as
  // the Python /whatif endpoint, same request/response shape.
  const {
    unresolved_count, severity_sum_unresolved,
    days_since_last_inspection = null, violations_last_90_days,
    avg_resolution_delay_days = null,
  } = req.body;

  const result = computeRiskScore({
    unresolvedCount: unresolved_count,
    severitySumUnresolved: severity_sum_unresolved,
    daysSinceLastInspection: days_since_last_inspection,
    violationsLast90Days: violations_last_90_days,
    avgResolutionDelayDays: avg_resolution_delay_days,
  });

  res.json(result);
});

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Coal Mine Compliance API - SIH26024 (Node/Express)" });
});

const PORT = 8000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
