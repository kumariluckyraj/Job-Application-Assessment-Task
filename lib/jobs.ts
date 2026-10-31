import fs from "node:fs";
import path from "node:path";
import type { Job } from "./types";

let cache: Job[] | null = null;

export function getJobs(): Job[] {
  if (!cache) {
    const file = path.join(process.cwd(), "data", "jobs.json");
    cache = JSON.parse(fs.readFileSync(file, "utf8")) as Job[];
  }
  return cache;
}

export const getJobById = (id: number) => getJobs().find((j) => j.id === id);