import { getJobs } from "./jobs";
import { groqChat, LIGHT_MODEL } from "./groq";

//  tuning parameters (not domain knowledge)
const POOL_SIZE = 20;            // candidates sent to the LLM re-ranker
const EXPERIENCE_TOLERANCE = 2;  // allowed gap between a job's stated minimum and the candidate's years
const K1 = 1.2, B = 0.75;        // BM25 constants
const FILTER_BOOST = 6;          // how strongly user-named skills steer ranking

const tokenize = (s) =>
  s.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 1);

//  search index built from the dataset itself 
let index = null;

function getIndex() {
  if (index) return index;
  const jobs = getJobs();
  const df = new Map();
  const tf = [];
  const len = [];

  for (const j of jobs) {
    const title = tokenize(j.title);
    const toks = [...title, ...title, ...title, ...tokenize(j.description)]; // title counts 3x
    const m = new Map();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    tf.push(m);
    len.push(toks.length);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const N = jobs.length;
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
  index = { tf, len, avgLen: len.reduce((a, b) => a + b, 0) / Math.max(N, 1), idf };
  return index;
}

function buildQuery(p, boost = []) {
  const q = new Map();
  const add = (text, w) => {
    for (const t of tokenize(text)) q.set(t, (q.get(t) ?? 0) + w);
  };
  add(p.designation, 2);
  (p.targetRoles ?? []).forEach((r) => add(r, 2));
  p.skills.forEach((s) => add(s, 2));
  p.projects.forEach((x) => add(`${x.name} ${x.description}`, 1));
  boost.forEach((s) => add(s, FILTER_BOOST)); // skills the user explicitly asked for
  return q;
}

function bm25(i, q) {
  const { tf, len, avgLen, idf } = getIndex();
  let s = 0;
  for (const [t, qw] of q) {
    const f = tf[i].get(t);
    if (!f) continue;
    s += qw * (idf.get(t) ?? 0) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * len[i]) / avgLen)));
  }
  return s;
}

// a resume skill "matches" a job if the skill's rarest word appears in the job
function matchedSkills(profile, i) {
  const { tf, idf } = getIndex();
  return profile.skills.filter((skill) => {
    const toks = tokenize(skill);
    if (!toks.length) return false;
    const rarest = toks.reduce((a, t) => ((idf.get(t) ?? 99) > (idf.get(a) ?? 99) ? t : a));
    return tf[i].has(rarest);
  });
}

//  term helpers 
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRegex = (term, flags = "") =>
  new RegExp(`(?<![a-z0-9+#])${esc(term.toLowerCase())}(?![a-z0-9+#])`, flags);
const jobText = (j) => `${j.title} ${j.description}`.toLowerCase();
const mentions = (j, term) => termRegex(term).test(jobText(j));
const countMentions = (j, term) => (jobText(j).match(termRegex(term, "g")) ?? []).length;

//  filters the user asked for 
function passesFilters(j, f) {
  if (f.remote !== undefined && j.remote !== f.remote) return false;
  if (f.location && !j.location.toLowerCase().includes(f.location.toLowerCase())) return false;
  if (f.company && !j.company.toLowerCase().includes(f.company.toLowerCase())) return false;
  if (f.titleKeyword && !j.title.toLowerCase().includes(f.titleKeyword.toLowerCase())) return false;
  if (f.maxExperience !== undefined && j.experienceMin !== null && j.experienceMin > f.maxExperience) return false;
  if (f.skills?.length && !f.skills.every((s) => mentions(j, s))) return false;
  return true;
}

//  LLM re-ranking 
async function llmRank(profile, pool, cap, wantedSkills) {
  const years = profile.totalExperienceYears;
  const candidate = {
    designation: profile.designation,
    years,
    targetRoles: profile.targetRoles ?? [],
    skills: profile.skills.slice(0, 25),
  };
  const jobs = pool.map(({ j }) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    exp: j.experience,
    text: j.description.slice(0, 250),
    ...(wantedSkills.length
      ? { skillMentions: Object.fromEntries(wantedSkills.map((s) => [s, countMentions(j, s)])) }
      : {}),
  }));

  const rules = [
    `The candidate has ${years ?? "an unknown number of"} years of experience.`,
    cap !== null
      ? `Exclude any job that needs more than ${cap} years, and judge seniority from the title and text too (a title implying senior or lead level counts as needing more experience).`
      : `Exclude jobs whose seniority clearly exceeds the candidate's experience.`,
    `Also exclude jobs unrelated to the candidate's target roles and skills.`,
    wantedSkills.length
      ? `The user specifically wants roles that use: ${wantedSkills.join(", ")}. "skillMentions" counts how often each is mentioned in the posting. Prefer postings where these are central (many mentions or in the title) and exclude postings that only mention them in passing.`
      : "",
  ].filter(Boolean).join("\n");

  try {
    const res = await groqChat({
      model: LIGHT_MODEL,
      temperature: 0,
      max_tokens: 1500,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a recruiter matching a candidate to job postings. Use ONLY the information given.
Select the jobs that genuinely fit the candidate (max 8), best first.
${rules}
Return ONLY JSON: {"matches":[{"id":<job id>,"score":<0-100 fit>,"reason":"<one short sentence on role fit, skills and experience>"}]}`,
        },
        { role: "user", content: JSON.stringify({ candidate, jobs }) },
      ],
    });
    const data = JSON.parse(res.choices[0].message.content ?? "{}");
    if (!Array.isArray(data.matches)) return null;
    const valid = new Set(pool.map((p) => p.j.id));
    return data.matches
      .filter((m) => valid.has(Number(m.id)))
      .map((m) => ({
        id: Number(m.id),
        score: Math.max(0, Math.min(99, Math.round(Number(m.score) || 0))),
        reason: String(m.reason ?? ""),
      }));
  } catch (e) {
    console.warn("LLM re-ranking failed, using text-similarity order:", e?.status, String(e?.message ?? e).slice(0, 200));
    return null;
  }
}

// ---------- public API ----------
export async function matchJobs(profile, filters, limit = 8) {
  const jobs = getJobs();
  const wantedSkills = filters.skills ?? [];
  const q = buildQuery(profile, wantedSkills);
  const years = profile.totalExperienceYears;

  let scored = jobs
    .map((j, i) => ({ j, i, s: bm25(i, q) }))
    .filter(({ j, s }) => s > 0 && passesFilters(j, filters));

  // experience gate: always applied (the user can raise it with "jobs up to N years")
  const cap = filters.maxExperience ?? (years === null ? null : years + EXPERIENCE_TOLERANCE);
  const gated =
    cap === null ? scored : scored.filter(({ j }) => j.experienceMin === null || j.experienceMin <= cap);
  const hiddenByExperience = scored.length - gated.length;
  scored = gated;

  scored.sort((a, b) => b.s - a.s);
  const pool = scored.slice(0, POOL_SIZE);
  if (!pool.length) return { results: [], total: 0, hiddenByExperience };

  const byId = new Map(pool.map((p) => [p.j.id, p]));
  const picks = await llmRank(profile, pool, cap, wantedSkills);

  let ordered;
  if (picks) {
    ordered = picks.slice(0, limit);
  } else {
    const top = pool[0].s || 1;
    ordered = pool.slice(0, limit).map((p) => ({
      id: p.j.id,
      score: Math.min(99, Math.round((p.s / top) * 90)),
      reason: "Strong text overlap between your resume and this job",
    }));
  }

  const results = ordered.map((pk, n) => {
    const { j, i } = byId.get(pk.id);
    return {
      position: n + 1,
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      remote: j.remote,
      experience: j.experience,
      // skills the user asked for come first (they are guaranteed to be in the posting), then your matching skills
      skills: [...new Set([...wantedSkills, ...matchedSkills(profile, i)])],
      sourceUrl: j.sourceUrl,
      score: pk.score,
      reason: pk.reason || "Matches your profile",
    };
  });
  return { results, total: scored.length, hiddenByExperience };
}