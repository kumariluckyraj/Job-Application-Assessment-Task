import { NextResponse } from "next/server";
import { matchJobs } from "@/lib/matching";
import type { JobFilters } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.profile) return NextResponse.json({ error: "Upload a resume first." }, { status: 400 });
    const filters: JobFilters = body.filters ?? {};

    const { results, total, hiddenByExperience } = await matchJobs(body.profile, filters);
    return NextResponse.json({
      jobs: results,
      total,
      hiddenByExperience,
      shownJobIds: results.map((r) => r.id),
    });
  } catch (e: any) {
    console.error("search route failed:", e?.status, e?.message ?? e);
    const rate = e?.status === 429;
    return NextResponse.json(
      { error: rate ? "The AI is rate-limited right now. Please wait a few seconds and try again." : "Something went wrong. Please try again." },
      { status: rate ? 429 : 500 }
    );
  }
}