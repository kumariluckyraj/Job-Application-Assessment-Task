import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { extractResumeText } from "@/lib/resume";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    if (!process.env.GROQ_API_KEY) {
      console.error("GROQ_API_KEY is missing. Check .env.local and restart the dev server.");
      return NextResponse.json({ error: "Server is missing the GROQ_API_KEY setting." }, { status: 500 });
    }

    let body: any;
    let resume: { name: string; text: string } | null = null;

    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      body = JSON.parse(String(form.get("payload") ?? "{}"));
      const file = form.get("file");

      if (file instanceof File) {
        if (file.size > 5 * 1024 * 1024)
          return NextResponse.json({ error: "That file is over 5 MB. Please upload a smaller resume." }, { status: 413 });

        let text = "";
        try {
          text = await extractResumeText(file);
        } catch (e: any) {
          if (e?.message === "UNSUPPORTED")
            return NextResponse.json({ error: "Unsupported file type. Please upload a PDF or DOCX resume." }, { status: 400 });
          console.error("extractResumeText failed:", e?.message ?? e);
          return NextResponse.json({ error: "I couldn't read that file. It may be corrupted or password-protected." }, { status: 422 });
        }
        if (text.trim().length < 80)
          return NextResponse.json(
            { error: "I couldn't find readable text in this resume (it may be a scanned image). Please upload a text-based PDF or DOCX." },
            { status: 422 }
          );
        resume = { name: file.name, text };
      }
    } else {
      body = await req.json();
    }

    if (!Array.isArray(body.messages) || !body.userId)
      return NextResponse.json({ error: "Bad request." }, { status: 400 });

    const out = await runAgent({
      messages: body.messages,
      profile: body.profile ?? null,
      userId: String(body.userId),
      shownJobIds: Array.isArray(body.shownJobIds) ? body.shownJobIds : [],
      filters: body.filters ?? {},
      resume,
    });
    return NextResponse.json(out);
  } catch (e: any) {
    console.error("chat route failed:", e?.status, e?.code, e?.message ?? e);
    if (e?.stack) console.error(e.stack.split("\n").slice(0, 6).join("\n"));
    const msg = String(e?.message ?? "");

    if (e?.status === 429)
      return NextResponse.json({ error: "The AI is rate-limited right now. Please wait a few seconds and try again." }, { status: 429 });
    if (e?.status === 401)
      return NextResponse.json({ error: "The Groq API key is invalid. Check GROQ_API_KEY in .env.local and restart the server." }, { status: 502 });
    if (e?.status === 404)
      return NextResponse.json({ error: "The AI model is not available. Check MODEL in lib/groq.ts." }, { status: 502 });
    if (e?.status === 400)
      return NextResponse.json({ error: "The AI had trouble with that request. Please try rephrasing it." }, { status: 502 });
    if (e?.code === "ENOENT" || msg.includes("jobs.json"))
      return NextResponse.json({ error: "The jobs dataset (data/jobs.json) was not found. Run: npx tsx scripts/fetchJobs.ts" }, { status: 500 });
    if (/mongo|libsql|turso|database|ECONNREFUSED|ENOTFOUND/i.test(msg))
      return NextResponse.json({ error: "I couldn't reach the database. Check your database settings in .env.local." }, { status: 500 });

    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}