import fs from "node:fs";
import path from "node:path";

let cache = null;

export function getJobs() {
  if (!cache) {
    const file = path.join(process.cwd(), "data", "jobs.json");
    cache = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return cache;
}

export const getJobById = (id) => getJobs().find((j) => j.id === id);