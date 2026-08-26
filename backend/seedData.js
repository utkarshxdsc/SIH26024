/**
 * Seed data generator. Run once to populate compliance.db with realistic
 * fake mines across a few real Coal India subsidiaries, plus a spread of
 * violation/inspection history — JS equivalent of app/seed_data.py.
 *
 * Run: node seedData.js   (from backend/ directory)
 */

const { sequelize, Subsidiary, Mine, Violation, Inspection } = require("./models");

const SUBSIDIARIES = ["BCCL", "CCL", "SECL", "MCL"];

const MINE_NAMES_BY_SUB = {
  BCCL: ["Kusunda", "Bastacolla", "Sudamdih"],
  CCL: ["Piparwar", "Ashok", "Kathara"],
  SECL: ["Gevra", "Kusmunda", "Dipka"],
  MCL: ["Lakhanpur", "Bharatpur", "Ananta"],
};

const VIOLATION_CATEGORIES = ["safety", "environmental", "labor", "equipment"];

// simple deterministic PRNG so seed data is reproducible across the team,
// same intent as random.seed(42) in the Python version
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const choice = (arr) => arr[Math.floor(rand() * arr.length)];
const randint = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

async function seed() {
  await sequelize.sync({ force: true }); // wipes and recreates tables

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  for (const subName of SUBSIDIARIES) {
    const sub = await Subsidiary.create({ name: subName });

    for (const mineName of MINE_NAMES_BY_SUB[subName]) {
      const mine = await Mine.create({
        name: mineName,
        subsidiaryId: sub.id,
        state: choice(["Jharkhand", "Chhattisgarh", "Odisha"]),
        mineType: choice(["opencast", "underground"]),
      });

      // risk profile so seed data spans LOW/MEDIUM/HIGH realistically
      const profile = choice(["clean", "moderate", "risky"]);
      let nViolations, unresolvedChance, lastInspectDaysAgo;
      if (profile === "clean") {
        [nViolations, unresolvedChance, lastInspectDaysAgo] = [1, 0.1, randint(1, 15)];
      } else if (profile === "moderate") {
        [nViolations, unresolvedChance, lastInspectDaysAgo] = [4, 0.4, randint(20, 50)];
      } else {
        [nViolations, unresolvedChance, lastInspectDaysAgo] = [8, 0.7, randint(60, 100)];
      }

      await Inspection.create({
        mineId: mine.id,
        inspectedAt: new Date(now - lastInspectDaysAgo * DAY),
        inspectorName: choice(["R. Sharma", "A. Verma", "S. Nayak"]),
        notes: "Routine compliance inspection.",
      });

      for (let i = 0; i < nViolations; i++) {
        const daysAgo = randint(1, 120);
        const loggedAt = new Date(now - daysAgo * DAY);
        const resolved = rand() > unresolvedChance;
        const resolvedAt = resolved
          ? new Date(loggedAt.getTime() + randint(2, 25) * DAY)
          : null;
        const category = choice(VIOLATION_CATEGORIES);

        await Violation.create({
          mineId: mine.id,
          category,
          severity: randint(1, 5),
          loggedAt,
          resolved,
          resolvedAt,
          description: `${category[0].toUpperCase()}${category.slice(1)} compliance issue flagged during field check.`,
        });
      }
    }
  }

  const totalMines = Object.values(MINE_NAMES_BY_SUB).flat().length;
  console.log(`Seeded ${SUBSIDIARIES.length} subsidiaries and ${totalMines} mines with violation/inspection history.`);
  await sequelize.close();
}

seed();
