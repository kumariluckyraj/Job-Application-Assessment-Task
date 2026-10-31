import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { groqChat, LIGHT_MODEL } from "./groq";
import type { Profile } from "./types";

export async function extractResumeText(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  throw new Error("UNSUPPORTED");
}

const SYSTEM = `You extract structured data from resumes. Return ONLY a JSON object with exactly these keys:
name (string), email (string), phone (string), location (string),
designation (string: current or most recent job title, or the target role),
totalExperienceYears (number: estimate from work history, 0 for a fresher),
skills (string[]: technical skills only),
targetRoles (string[]: 3 to 6 standard job titles this person should be matched with, inferred from their skills, projects and designation, e.g. "Full Stack Developer", "AI Engineer"),
education ([{degree, institution, year}]),
projects ([{name, description}]).
Use "" or [] when something is missing. Never invent data.`;
export async function parseResume(text: string): Promise<Profile> {
   const res = await groqChat({
    model: LIGHT_MODEL,
    temperature: 0,
    max_tokens: 2000,
    reasoning_effort: "low",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: text.slice(0, 8000) },
    ],
  });
  const d = JSON.parse(res.choices[0].message.content ?? "{}");
  const profile: Profile = {
    name: String(d.name ?? ""),
    email: String(d.email ?? ""),
    phone: String(d.phone ?? ""),
    location: String(d.location ?? ""),
    designation: String(d.designation ?? ""),
    totalExperienceYears:
      d.totalExperienceYears === null || d.totalExperienceYears === undefined
        ? null
        : Number(d.totalExperienceYears) || 0,
    skills: Array.isArray(d.skills) ? d.skills.map(String) : [],
    targetRoles: Array.isArray(d.targetRoles) ? d.targetRoles.map(String).slice(0, 6) : [],
    education: Array.isArray(d.education) ? d.education : [],
    projects: Array.isArray(d.projects) ? d.projects : [],
  };
  if (!profile.name && !profile.designation && profile.skills.length === 0) {
    throw new Error("NOT_A_RESUME");
  }
  return profile;
}