import { NextResponse } from "next/server";
import { extractResumeText, parseResume } from "@/lib/resume";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    if (!process.env.GROQ_API_KEY) {
      console.error("GROQ_API_KEY is missing. Check .env.local and restart the dev server.");
      return NextResponse.json(
        { error: "Server is missing the GROQ_API_KEY setting." },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return NextResponse.json({ error: "No file received. Please upload a PDF or DOCX." }, { status: 400 });
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

    try {
      const profile = await parseResume(text);
      return NextResponse.json({ profile });
    } catch (e: any) {
      console.error("parseResume failed:", e?.status, e?.message ?? e);

      if (e?.message === "NOT_A_RESUME")
        return NextResponse.json({ error: "This doesn't look like a resume. Please upload your resume." }, { status: 422 });
      if (e?.status === 401)
        return NextResponse.json({ error: "The Groq API key is invalid. Check GROQ_API_KEY in .env.local and restart the server." }, { status: 502 });
      if (e?.status === 429)
        return NextResponse.json({ error: "The AI is rate-limited right now. Please wait a minute and try again." }, { status: 429 });
      if (e?.status === 400 || e?.status === 404)
        return NextResponse.json({ error: "The AI model name is not available. Check MODEL in lib/groq.ts." }, { status: 502 });
      if (e instanceof SyntaxError)
        return NextResponse.json({ error: "The AI returned an unreadable answer. Please try uploading again." }, { status: 502 });

      return NextResponse.json({ error: "The AI service had trouble parsing your resume. Please try again." }, { status: 502 });
    }
  } catch (e: any) {
    console.error("parse-resume route failed:", e?.message ?? e);
    return NextResponse.json({ error: "Something went wrong uploading your file." }, { status: 500 });
  }
}