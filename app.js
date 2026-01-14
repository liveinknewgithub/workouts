const state = {
  rows: [],
  filters: {
    section: "All",
    date: "",
  },
  source: "",
};

const COMPLETION_KEY = "workouts-exercises-completed";
const completedExercises = new Set(JSON.parse(localStorage.getItem(COMPLETION_KEY) || "[]"));

const sectionFilter = document.getElementById("sectionFilter");
const dateFilter = document.getElementById("dateFilter");
const dateOptions = document.getElementById("dateOptions");
const scheduleEl = document.getElementById("schedule");
const filterSummary = document.getElementById("filterSummary");
const dataSource = document.getElementById("dataSource");

const summaryPhases = document.getElementById("summaryPhases");
const summaryWeeks = document.getElementById("summaryWeeks");
const summarySessions = document.getElementById("summarySessions");
const summaryExercises = document.getElementById("summaryExercises");

const sectionOrder = ["Warm-up", "Main", "Cool-down", "Mobility", "Rest", "Pre-comp"];
const dayOrder = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const openIndexedDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("workouts-sqlite", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readCachedDb = async () => {
  try {
    const db = await openIndexedDb();
    return await new Promise((resolve) => {
      const request = db.transaction("files").objectStore("files").get("workouts.sqlite");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    return null;
  }
};

const cacheDb = async (buffer) => {
  try {
    const db = await openIndexedDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(buffer, "workouts.sqlite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn("Unable to cache SQLite DB", error);
  }
};

const formatDate = (iso) => {
  if (!iso) return "";
  const parsed = new Date(`${iso}T00:00:00`);
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
};

const saveCompletion = () => {
  localStorage.setItem(COMPLETION_KEY, JSON.stringify(Array.from(completedExercises)));
};

const getExerciseKey = (exercise) =>
  [exercise.date, exercise.section, exercise.exercise, exercise.sets, exercise.reps, exercise.rest]
    .filter(Boolean)
    .join("::");

const buildOptionList = (select, values) => {
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "All";
  allOption.textContent = "All";
  select.appendChild(allOption);

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
};

const getDistinct = (rows, key) =>
  Array.from(new Set(rows.map((row) => row[key]).filter(Boolean)));

const sortSections = (values) =>
  [...values].sort((a, b) => {
    const indexA = sectionOrder.indexOf(a);
    const indexB = sectionOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

const sortDays = (values) =>
  [...values].sort((a, b) => {
    const indexA = dayOrder.indexOf(a);
    const indexB = dayOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

const summarizeData = (rows) => {
  summaryPhases.textContent = getDistinct(rows, "phase").length;
  summaryWeeks.textContent = getDistinct(rows, "week").length;
  summarySessions.textContent = getDistinct(rows, "date").length;
  summaryExercises.textContent = rows.length;
};

const applyFilters = () => {
  state.filters = {
    section: sectionFilter.value,
    date: dateFilter.value,
  };
  renderSchedule();
};

const filterRows = (rows, filters) =>
  rows.filter((row) => {
    if (filters.section !== "All" && row.section !== filters.section) return false;
    if (filters.date && row.date !== filters.date) return false;
    return true;
  });

const groupRowsByDate = (rows) => {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.date)) {
      grouped.set(row.date, {
        date: row.date,
        day: row.day,
        phase: row.phase,
        week: row.week,
        sections: new Map(),
      });
    }
    const group = grouped.get(row.date);
    if (!group.sections.has(row.section)) {
      group.sections.set(row.section, []);
    }
    group.sections.get(row.section).push(row);
  });
  return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
};

const renderSchedule = () => {
  const filtered = filterRows(state.rows, state.filters);
  filterSummary.textContent = `Showing ${filtered.length} exercises`;
  scheduleEl.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No sessions match these filters.";
    scheduleEl.appendChild(empty);
    return;
  }

  const grouped = groupRowsByDate(filtered);

  grouped.forEach((session) => {
    const card = document.createElement("article");
    card.className = "day-card";

    const header = document.createElement("div");
    header.className = "day-header";

    const title = document.createElement("div");
    title.innerHTML = `<h2>${formatDate(session.date)}</h2>`;

    const meta = document.createElement("div");
    meta.className = "day-meta";
    meta.innerHTML = `<span>${session.day}</span><span>Week ${session.week}</span>`;

    const pill = document.createElement("div");
    pill.className = "phase-pill";
    pill.textContent = session.phase;

    header.appendChild(title);
    header.appendChild(meta);
    header.appendChild(pill);
    card.appendChild(header);

    const sectionEntries = Array.from(session.sections.entries()).sort((a, b) =>
      sortSections([a[0], b[0]]).indexOf(a[0]) - sortSections([a[0], b[0]]).indexOf(b[0])
    );

    sectionEntries.forEach(([section, exercises]) => {
      const block = document.createElement("div");
      block.className = "section-block";

      const headerRow = document.createElement("div");
      headerRow.className = "section-header";

      const title = document.createElement("div");
      title.className = "section-title";
      title.textContent = section;

      headerRow.appendChild(title);
      block.appendChild(headerRow);

      exercises.forEach((exercise) => {
        const exerciseCard = document.createElement("div");
        exerciseCard.className = "exercise-card";

        const exerciseKey = getExerciseKey(exercise);
        const isComplete = completedExercises.has(exerciseKey);
        if (isComplete) {
          exerciseCard.classList.add("exercise-complete");
        }

        const header = document.createElement("div");
        header.className = "exercise-header";

        const name = document.createElement("div");
        name.className = "exercise-title";
        name.textContent = exercise.exercise;

        const meta = document.createElement("div");
        meta.className = "exercise-meta";
        meta.innerHTML = `
          <span>Sets: ${exercise.sets || "-"}</span>
          <span>Reps: ${exercise.reps || "-"}</span>
          <span>Rest: ${exercise.rest || "-"}</span>
        `;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "exercise-complete-button";
        button.textContent = isComplete ? "Completed" : "Mark Complete";
        button.addEventListener("click", () => {
          if (completedExercises.has(exerciseKey)) {
            completedExercises.delete(exerciseKey);
            exerciseCard.classList.remove("exercise-complete");
            button.textContent = "Mark Complete";
          } else {
            completedExercises.add(exerciseKey);
            exerciseCard.classList.add("exercise-complete");
            button.textContent = "Completed";
          }
          saveCompletion();
        });

        header.appendChild(name);
        header.appendChild(meta);
        exerciseCard.appendChild(header);
        exerciseCard.appendChild(button);

        if (exercise.notes) {
          const notes = document.createElement("div");
          notes.className = "exercise-notes";
          notes.textContent = exercise.notes;
          exerciseCard.appendChild(notes);
        }


        block.appendChild(exerciseCard);
      });

      card.appendChild(block);
    });

    scheduleEl.appendChild(card);
  });
};

const hydrateFilters = (rows) => {
  const sections = sortSections(getDistinct(rows, "section"));
  const dates = getDistinct(rows, "date").sort();

  buildOptionList(sectionFilter, sections);

  dateOptions.innerHTML = "";
  dates.forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    dateOptions.appendChild(option);
  });
};

const loadFromJson = async () => {
  const response = await fetch("data/data.json");
  if (!response.ok) {
    throw new Error("Unable to load fallback JSON data.");
  }
  const rows = await response.json();
  state.source = "JSON fallback";
  dataSource.textContent = "Data source: JSON fallback";
  return rows;
};

const loadFromSqlite = async () => {
  if (!window.initSqlJs) {
    throw new Error("sql.js failed to load.");
  }

  const SQL = await window.initSqlJs({
    locateFile: (file) => `vendor/sqljs/${file}`,
  });

  let buffer = await readCachedDb();
  if (!buffer) {
    const response = await fetch("data/workouts.sqlite");
    if (!response.ok) {
      throw new Error("Unable to fetch SQLite database.");
    }
    buffer = await response.arrayBuffer();
    await cacheDb(buffer);
    state.source = "SQLite (fresh)";
    dataSource.textContent = "Data source: SQLite (fresh load)";
  } else {
    state.source = "SQLite (cached)";
    dataSource.textContent = "Data source: SQLite (cached)";
  }

  const db = new SQL.Database(new Uint8Array(buffer));
  const stmt = db.prepare(
    "SELECT date, day, phase, week, section, exercise, sets, reps, rest, notes FROM workouts ORDER BY date, id"
  );
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
};

const getTodayISO = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const init = async () => {
  filterSummary.textContent = "Loading schedule…";
  try {
    state.rows = await loadFromSqlite();
  } catch (error) {
    console.warn("SQLite load failed, falling back to JSON.", error);
    state.rows = await loadFromJson();
  }

  summarizeData(state.rows);
  hydrateFilters(state.rows);

  // Auto-select today's date if it exists in the data
  const todayISO = getTodayISO();
  const availableDates = getDistinct(state.rows, "date");
  if (availableDates.includes(todayISO)) {
    dateFilter.value = todayISO;
    state.filters.date = todayISO;
  }

  renderSchedule();

  sectionFilter.addEventListener("change", applyFilters);
  dateFilter.addEventListener("change", applyFilters);
  dateFilter.addEventListener("keyup", (event) => {
    if (event.key === "Enter") {
      applyFilters();
    }
  });
};

init();
