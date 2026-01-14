const fs = require("fs/promises");
const path = require("path");
const { parse } = require("csv-parse/sync");
const initSqlJs = require("sql.js");

const ROOT = path.join(__dirname, "..");
const CSV_PATH = path.join(ROOT, "judo_competition_prep_program.csv");
const DATA_DIR = path.join(ROOT, "data");
const JSON_PATH = path.join(DATA_DIR, "data.json");
const SQLITE_PATH = path.join(DATA_DIR, "workouts.sqlite");
const VENDOR_DIR = path.join(ROOT, "vendor", "sqljs");
const SQLJS_DIST = path.join(ROOT, "node_modules", "sql.js", "dist");

const toIsoDate = (value) => {
  if (!value) {
    return "";
  }
  const [month, day, year] = value.split("/").map((part) => part.trim());
  if (!month || !day || !year) {
    return value;
  }
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

const normalizeRecord = (record) => ({
  date: toIsoDate(record.Date),
  day: record.Day || "",
  phase: record.Phase || "",
  week: record.Week ? Number(record.Week) : null,
  section: record.Section || "",
  exercise: record.Exercise || "",
  sets: record.Sets || "",
  reps: record.Reps || "",
  rest: record.Rest || "",
  notes: record.Notes || "",
});

const buildDatabase = async (rows) => {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(SQLJS_DIST, file),
  });

  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      day TEXT,
      phase TEXT,
      week INTEGER,
      section TEXT,
      exercise TEXT,
      sets TEXT,
      reps TEXT,
      rest TEXT,
      notes TEXT
    );
  `);

  const insert = db.prepare(`
    INSERT INTO workouts (
      date,
      day,
      phase,
      week,
      section,
      exercise,
      sets,
      reps,
      rest,
      notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  rows.forEach((row) => {
    insert.run([
      row.date,
      row.day,
      row.phase,
      row.week,
      row.section,
      row.exercise,
      row.sets,
      row.reps,
      row.rest,
      row.notes,
    ]);
  });

  insert.free();

  db.exec(`CREATE INDEX idx_workouts_phase ON workouts(phase);`);
  db.exec(`CREATE INDEX idx_workouts_day ON workouts(day);`);
  db.exec(`CREATE INDEX idx_workouts_section ON workouts(section);`);
  db.exec(`CREATE INDEX idx_workouts_date ON workouts(date);`);

  const data = db.export();
  await fs.writeFile(SQLITE_PATH, Buffer.from(data));
};

const copySqlJsAssets = async () => {
  await fs.mkdir(VENDOR_DIR, { recursive: true });
  await fs.copyFile(path.join(SQLJS_DIST, "sql-wasm.js"), path.join(VENDOR_DIR, "sql-wasm.js"));
  await fs.copyFile(
    path.join(SQLJS_DIST, "sql-wasm.wasm"),
    path.join(VENDOR_DIR, "sql-wasm.wasm")
  );
};

const main = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const csvText = await fs.readFile(CSV_PATH, "utf8");
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const rows = records.map(normalizeRecord);

  await fs.writeFile(JSON_PATH, `${JSON.stringify(rows, null, 2)}\n`);
  await buildDatabase(rows);
  await copySqlJsAssets();

  console.log(`Generated ${rows.length} rows.`);
  console.log(`Wrote ${path.relative(ROOT, JSON_PATH)} and ${path.relative(ROOT, SQLITE_PATH)}.`);
  console.log(`Copied sql.js assets to ${path.relative(ROOT, VENDOR_DIR)}.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
