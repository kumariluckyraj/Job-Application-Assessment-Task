import { MongoClient } from "mongodb";

// reuse one connection across hot reloads / serverless invocations
const g = globalThis as unknown as { _mongo?: Promise<MongoClient> };
const client = (g._mongo ??= new MongoClient(process.env.MONGODB_URI!).connect());

let indexReady: Promise<unknown> | null = null;

async function applications() {
  const col = (await client).db("jobassist").collection("applications");
  // unique index = no duplicate applications, even under concurrent requests
  indexReady ??= col.createIndex({ userId: 1, jobId: 1 }, { unique: true });
  await indexReady;
  return col;
}

export async function applyToJob(userId: string, jobId: number): Promise<"created" | "duplicate"> {
  const col = await applications();
  try {
    await col.insertOne({ userId, jobId, appliedAt: new Date().toISOString(), status: "Applied" });
    return "created";
  } catch (e: any) {
    if (e.code === 11000) return "duplicate"; // duplicate key error
    throw e;
  }
}

export async function listApplications(userId: string) {
  const col = await applications();
  const rows = await col.find({ userId }).sort({ appliedAt: -1 }).toArray();
  return rows.map((r) => ({
    jobId: Number(r.jobId),
    appliedAt: String(r.appliedAt),
    status: String(r.status),
  }));
}