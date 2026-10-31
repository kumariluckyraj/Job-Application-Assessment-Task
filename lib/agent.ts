import { groqChat, MODEL } from "./groq";
import { getJobById } from "./jobs";
import { matchJobs } from "./matching";
import { parseResume } from "./resume";
import { applyToJob, listApplications } from "./db";
import type { AppRow, Job, JobFilters, MatchedJob, Profile } from "./types";

type Ctx = {
  profile: Profile | null;
  userId: string;
  shown: number[];
  filters: JobFilters;
  cards: MatchedJob[] | null;
  applications: AppRow[] | null;
  lastUser: string;
  resumeText: string | null;
  resumeName: string;
  parseTried: boolean;
  parsedNow: Profile | null;
};

const tools: any[] = [
  {
    type: "function",
    function: {
      name: "parse_resume",
      description:
        "Parse the resume file the user uploaded with this message into a structured profile (name, contact, designation, skills, experience, education, projects). Takes no arguments: the file text is handled server-side. Call this FIRST when a resume was uploaded, then call search_jobs with {} in the same step.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_jobs",
      description:
        "Find/recommend/refine jobs for the user's resume. The matching engine ALREADY ranks jobs using the resume's skills, designation and experience, so for plain recommendations call this with {} (no filters). Only add filters the user explicitly asked for in this or an earlier message, and keep earlier active filters unless the user changes or removes them. Omit parameters you don't need; never pass null.",
      parameters: {
        type: "object",
        properties: {
          remote: { type: ["boolean", "null"], description: "true = remote only, false = non-remote only" },
          skills: {
            type: ["array", "null"],
            items: { type: "string" },
            description: "ONLY skills the user explicitly named in their request, e.g. 'jobs needing React' -> ['React']. NEVER copy skills from the resume.",
          },
          location: { type: ["string", "null"] },
          titleKeyword: { type: ["string", "null"], description: "word that must be in the job title, e.g. 'backend'" },
          maxExperience: { type: ["number", "null"], description: "max years of experience the job may require. Only if the user stated a number." },
          company: { type: ["string", "null"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_to_job",
      description:
        "Apply to a job and save the application. Use position for 'job 3' (position in the shown list) or jobId when the user says 'job ID 412'. Omit the one you don't use; never pass null.",
      parameters: {
        type: "object",
        properties: { position: { type: ["integer", "null"] }, jobId: { type: ["integer", "null"] } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_applications",
      description: "Show all jobs the user has applied to with date and status.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_job_details",
      description: "Get the full details of one job (position in shown list or jobId). Omit the one you don't use; never pass null.",
      parameters: {
        type: "object",
        properties: { position: { type: ["integer", "null"] }, jobId: { type: ["integer", "null"] } },
      },
    },
  },
];

// null / undefined / "" -> not provided
const has = (v: any) => v !== null && v !== undefined && v !== "";

function resolveJob(args: any, ctx: Ctx): { job?: Job; error?: string } {
  let id: number | undefined;
  if (has(args.position) && Number.isInteger(Number(args.position))) {
    const pos = Number(args.position);
    id = ctx.shown[pos - 1];
    if (id === undefined)
      return { error: `There is no job at position ${pos}. The current list has ${ctx.shown.length} jobs.` };
  } else if (has(args.jobId) && Number.isInteger(Number(args.jobId))) {
    id = Number(args.jobId);
  } else {
    return { error: "Please tell me which job: a list number or a job ID." };
  }
  const job = getJobById(id);
  if (!job) return { error: `Job ID ${id} does not exist.` };
  return { job };
}

function cleanFilters(a: any): JobFilters {
  const f: JobFilters = {};
  if (typeof a.remote === "boolean") f.remote = a.remote;
  if (Array.isArray(a.skills) && a.skills.length) f.skills = a.skills.map(String);
  if (typeof a.location === "string" && a.location) f.location = a.location;
  if (typeof a.titleKeyword === "string" && a.titleKeyword) f.titleKeyword = a.titleKeyword;
  if (has(a.maxExperience) && !Number.isNaN(Number(a.maxExperience))) f.maxExperience = Number(a.maxExperience);
  if (typeof a.company === "string" && a.company) f.company = a.company;
  return f;
}

async function runTool(name: string, args: any, ctx: Ctx): Promise<any> {
  switch (name) {
    case "parse_resume": {
      if (!ctx.resumeText) return { error: "No resume file was uploaded with this message. Ask the user to upload a PDF or DOCX." };
      ctx.parseTried = true;
      try {
        const p = await parseResume(ctx.resumeText);
        ctx.profile = p;
        ctx.parsedNow = p;
        ctx.shown = [];
        ctx.filters = {};
        return {
          success: true,
          name: p.name,
          designation: p.designation,
          yearsOfExperience: p.totalExperienceYears,
          targetRoles: p.targetRoles,
          skillCount: p.skills.length,
          educationCount: p.education.length,
          projectCount: p.projects.length,
        };
      } catch (e: any) {
        console.error("parse_resume failed:", e?.status, e?.message ?? e);
        if (e?.message === "NOT_A_RESUME")
          return { error: "This file does not look like a resume. Ask the user to upload their resume." };
        return { error: "I could not parse the resume right now. Ask the user to try uploading again." };
      }
    }
    case "search_jobs": {
      if (!ctx.profile) return { error: "No resume uploaded yet. Ask the user to upload a PDF or DOCX resume first." };
      const filters = cleanFilters(args);
      console.log("search_jobs args:", JSON.stringify(args), "| user said:", ctx.lastUser);

      // Guard: keep only skill filters the user actually asked for (now or earlier)
      if (filters.skills) {
        const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
        const said = (ctx.lastUser.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [])
          .map(squash)
          .filter((w) => w.length >= 3);
        const before = (ctx.filters.skills ?? []).map(squash);
        filters.skills = filters.skills.filter((s) => {
          const k = squash(s);
          return before.includes(k) || said.some((w) => w.startsWith(k) || k.startsWith(w));
        });
        if (!filters.skills.length) delete filters.skills;
      }

      // Guard: only keep a max-experience filter if the user actually said that number
      if (filters.maxExperience !== undefined) {
        const nums = (ctx.lastUser.match(/\d+/g) ?? []).map(Number);
        if (!nums.includes(filters.maxExperience) && ctx.filters.maxExperience !== filters.maxExperience) {
          delete filters.maxExperience;
        }
      }

      const { results, total, hiddenByExperience } = await matchJobs(ctx.profile, filters);
      if (!results.length)
        return {
          count: 0,
          appliedFilters: filters,
          hiddenByExperience,
          message:
            hiddenByExperience > 0
              ? `${hiddenByExperience} jobs matched but require more experience than the candidate has. Tell the user, and offer to show them anyway if they raise the limit (for example "jobs up to 5 years").`
              : "No jobs matched ALL of these filters. Tell the user which filters were applied and offer to drop or relax one. Do not ask for their skills again.",
        };
      ctx.cards = results;
      ctx.shown = results.map((r) => r.id);
      ctx.filters = filters;
      return {
        count: results.length,
        totalMatches: total,
        appliedFilters: filters,
        jobs: results.map((r) => ({ position: r.position, title: r.title, company: r.company, remote: r.remote, score: r.score })),
      };
    }
    case "apply_to_job": {
      if (!ctx.profile) return { error: "No resume uploaded yet. Ask the user to upload one first." };
      const { job, error } = resolveJob(args, ctx);
      if (!job) return { success: false, error };
      const r = await applyToJob(ctx.userId, job.id);
      return r === "created"
        ? { success: true, status: "Applied", message: `Applied to ${job.title} at ${job.company} (job ID ${job.id}).` }
        : { success: false, duplicate: true, message: `You already applied to ${job.title} at ${job.company}.` };
    }
    case "list_applications": {
      const rows = await listApplications(ctx.userId);
      ctx.applications = rows.map((r) => {
        const j = getJobById(r.jobId);
        return { ...r, title: j?.title ?? "Unknown job", company: j?.company ?? "Unknown" };
      });
      return { count: ctx.applications.length, applications: ctx.applications };
    }
    case "get_job_details": {
      const { job, error } = resolveJob(args, ctx);
      if (!job) return { error };
      return {
        title: job.title, company: job.company, location: job.location, remote: job.remote,
        experience: job.experience, skills: job.skills, url: job.sourceUrl,
        description: job.description.slice(0, 1500),
      };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

// one retry if Groq rejects a malformed tool call (400); 429s are retried inside groqChat
async function callModel(convo: any[], toolList: any[]) {
  const make = () =>
    groqChat({
      model: MODEL,
      messages: convo,
      tools: toolList,
      tool_choice: "auto",
      temperature: 0.2,
      max_tokens: 1500,
      reasoning_effort: "low",
    });
  try {
    return await make();
  } catch (e: any) {
    if (e?.status === 400) {
      console.warn("Tool call rejected, retrying once:", String(e?.message).slice(0, 200));
      return await make();
    }
    throw e;
  }
}

export async function runAgent(input: {
  messages: { role: "user" | "assistant"; content: string }[];
  profile: Profile | null;
  userId: string;
  shownJobIds: number[];
  filters: JobFilters;
  resume?: { name: string; text: string } | null;
}) {
  const ctx: Ctx = {
    profile: input.profile,
    userId: input.userId,
    shown: input.shownJobIds,
    filters: input.filters,
    cards: null,
    applications: null,
    lastUser: [...input.messages].reverse().find((m) => m.role === "user")?.content ?? "",
    resumeText: input.resume?.text ?? null,
    resumeName: input.resume?.name ?? "",
    parseTried: false,
    parsedNow: null,
  };

  const p = input.profile;
  const uploadNote = ctx.resumeText
    ? `\n- A resume file ("${ctx.resumeName}") was uploaded with this message. Call parse_resume FIRST, then call search_jobs with {} in the same step. Ignore any "NO RESUME UPLOADED" line below; it is out of date.`
    : "";

  const system = `You are a friendly job-search assistant. You orchestrate tools; never invent jobs, IDs or application status.
Rules:${uploadNote}
- For the first recommendation, call search_jobs with {} (no filters): the matching engine already uses the resume. Only pass skills as filters when the user names them in their latest request.
- When calling a tool, OMIT parameters you don't need. Never pass null.
- Job recommendations, refinements ("only remote", "needing React"), applying and application status MUST go through tools.
- If the user asks to remove, clear or reset filters (or one specific filter), call search_jobs with only the filters they want to KEEP ({} to clear everything).
- The UI already renders the resume details and job cards from tool results. Reply with 1-3 plain sentences. Write plain text only: no markdown, no asterisks, no tables, no lists of jobs.
- "apply to job 3" means list position 3. "job ID 412" means jobId 412.
- If a tool returns an error, no results, or a duplicate, explain it clearly and suggest what to do next.
- If there is no resume yet, ask the user to upload one (PDF or DOCX).

Candidate: ${p ? `${p.name || "unknown"}, ${p.designation || "no designation"}, ~${p.totalExperienceYears ?? "?"} yrs, skills: ${p.skills.slice(0, 20).join(", ")}` : "NO RESUME UPLOADED"}
Currently shown jobs (position -> job ID): ${ctx.shown.length ? ctx.shown.map((id, i) => `${i + 1}->${id}`).join(", ") : "none"}
Active filters: ${JSON.stringify(ctx.filters)}`;

  const toolList = ctx.resumeText ? tools : tools.filter((t) => t.function.name !== "parse_resume");
  const convo: any[] = [{ role: "system", content: system }, ...input.messages.slice(-8)];

  const finish = async (reply: string) => {
    // safety net: a resume was uploaded but the model never parsed it
    if (ctx.resumeText && !ctx.parseTried) {
      const r = await runTool("parse_resume", {}, ctx);
      if (r.error) reply = r.error;
      else {
        await runTool("search_jobs", {}, ctx);
        reply = "I read your resume and found these matches.";
      }
    }
    return {
      reply,
      profile: ctx.parsedNow,
      jobs: ctx.cards,
      applications: ctx.applications,
      shownJobIds: ctx.shown,
      filters: ctx.filters,
    };
  };

  for (let step = 0; step < 6; step++) {
    const res = await callModel(convo, toolList);
    const msg = res.choices[0].message;
    if (!msg.tool_calls?.length) return finish(msg.content ?? "");

    convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let args: any = {};
      try { args = JSON.parse(call.function.arguments || "{}") ?? {}; } catch {}
      console.log("tool:", call.function.name);
      const result = await runTool(call.function.name, args, ctx);
      convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return finish("Sorry, I couldn't finish that request. Could you rephrase it?");
}