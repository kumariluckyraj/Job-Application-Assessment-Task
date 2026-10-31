
import fs from "node:fs";
import path from "node:path";

const MAX_JOBS = 1800; 
const TECH_ONLY = true; 
const DESCRIPTION_LIMIT = 3000; 
const PAUSE_MS = 300; 


const GREENHOUSE_BOARDS = [
  "stripe", "airbnb", "cloudflare", "datadog", "discord", "dropbox", "figma",
  "gitlab", "instacart", "lyft", "pinterest", "reddit", "robinhood", "twilio",
  "asana", "brex", "coinbase", "databricks", "duolingo", "elastic", "fastly",
  "mongodb", "okta", "pagerduty", "samsara", "toast", "vercel", "webflow",
  "zscaler", "grammarly", "intercom", "mixpanel", "airtable", "amplitude",
  "carta", "chime", "gusto", "anthropic", "squarespace", "affirm", "benchling",
  "calendly", "checkr", "dbtlabs", "retool", "scaleai", "sentry", "gleanwork",
];
const LEVER_COMPANIES = ["spotify", "palantir", "mistral", "binance", "zopa"];


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "job-assistant-assessment/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function stripHtml(html) {
  let t = decodeEntities(html || ""); // Greenhouse sends HTML escaped, so decode first
  t = t
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  return t.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

const titleCase = (s) =>
  s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// skills
// canonical name -> extra spellings to also match
const SKILLS = {
  JavaScript: [], TypeScript: [], Python: [], Java: [], "C++": [], "C#": [],
  Go: ["golang"], Rust: [], Ruby: [], PHP: [], Swift: [], Kotlin: [], Scala: [],
  SQL: [], NoSQL: [], React: ["react.js", "reactjs"], "React Native": [],
  "Next.js": ["nextjs"], "Node.js": ["nodejs", "node js"], Express: ["express.js"],
  Angular: [], "Vue.js": ["vue", "vuejs"], Svelte: [], HTML: [], CSS: [],
  Tailwind: ["tailwindcss"], Redux: [], GraphQL: [], REST: ["restful"],
  Django: [], Flask: [], FastAPI: [], Spring: ["spring boot"], ".NET": ["dotnet"],
  Rails: ["ruby on rails"], Laravel: [], PostgreSQL: ["postgres"], MySQL: [],
  MongoDB: [], Redis: [], Elasticsearch: [], Kafka: [], RabbitMQ: [],
  AWS: ["amazon web services"], Azure: [], GCP: ["google cloud"],
  Docker: [], Kubernetes: ["k8s"], Terraform: [], Ansible: [], Jenkins: [],
  "CI/CD": ["cicd"], Git: [], GitHub: [], Linux: [], Bash: [], Microservices: [],
  "Machine Learning": ["ml"], "Deep Learning": [], NLP: ["natural language processing"],
  LLM: ["llms", "large language models"], "Generative AI": ["genai"],
  TensorFlow: [], PyTorch: [], "scikit-learn": ["sklearn"], Pandas: [], NumPy: [],
  Spark: ["pyspark"], Hadoop: [], Airflow: [], Snowflake: [], BigQuery: [], dbt: [],
  Tableau: [], "Power BI": ["powerbi"], Excel: [], "Data Analysis": [],
  "Data Engineering": [], ETL: [], Android: [], iOS: [], Flutter: [],
  Selenium: [], Cypress: [], Jest: [], Testing: ["unit testing"], Agile: [], Scrum: [],
  Jira: [], Figma: [], "UI/UX": ["ux design", "ui design"], Cybersecurity: [],
  "Computer Vision": [], "System Design": [], "Data Structures": [],
  Algorithms: [], OOP: ["object-oriented", "object oriented"],
  WebSockets: ["websocket"], Prometheus: [], Grafana: [], Splunk: [],
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SKILL_MATCHERS = Object.entries(SKILLS).map(([name, aliases]) => {
  const forms = [name, ...aliases].map(escapeRegex).join("|");
  
  return { name, re: new RegExp(`(?<![A-Za-z0-9])(?:${forms})(?![A-Za-z0-9])`, "i") };
});

function extractSkills(text, tags = []) {
  const haystack = `${text}\n${tags.join(" ")}`;
  const found = new Set();
  for (const { name, re } of SKILL_MATCHERS) {
   
    if (name === "Go" || name === "Express" || name === "Spring" || name === "Rails") {
      if (new RegExp(`(?<![A-Za-z0-9])${name}(?![A-Za-z0-9])`).test(haystack)) found.add(name);
      else if (name === "Go" && /golang/i.test(haystack)) found.add(name);
      continue;
    }
    if (re.test(haystack)) found.add(name);
  }
  return [...found];
}

// experience
function extractExperience(title, text) {
  const near = (idx) => {
    const around = text.slice(Math.max(0, idx - 60), idx + 100).toLowerCase();
    return around.includes("experience");
  };

 
  const range = /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi;
  for (const m of text.matchAll(range)) {
    const lo = Number(m[1]), hi = Number(m[2]);
    if (lo <= hi && hi <= 25 && near(m.index ?? 0)) return { label: `${lo}-${hi} years`, min: lo };
  }
  
  const single = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi;
  for (const m of text.matchAll(single)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20 && near(m.index ?? 0)) return { label: `${n}+ years`, min: n };
  }

  if (/\b(intern|internship|graduate|fresher|trainee|apprentice)\b/i.test(title)) return { label: "0-1 years", min: 0 };
  if (/\b(junior|jr|associate|entry)\b/i.test(title)) return { label: "0-2 years", min: 0 };
  if (/\b(senior|sr|lead|staff|principal|head|manager|director)\b/i.test(title)) return { label: "5+ years", min: 5 };
  return { label: "Not specified", min: null };
}

//sources
async function fromGreenhouse() {
  const out = [];
  for (const board of GREENHOUSE_BOARDS) {
    const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
    await sleep(PAUSE_MS);
    if (!data?.jobs) { console.log(`  greenhouse/${board}: skipped`); continue; }
    for (const j of data.jobs.slice(0, 150)) {
      const location = j.location?.name || "Not specified";
      out.push({
        title: j.title,
        company: j.company_name || titleCase(board),
        location,
        remote: /remote/i.test(location),
        description: stripHtml(j.content),
        sourceUrl: j.absolute_url,
        source: "greenhouse",
      });
    }
    console.log(`  greenhouse/${board}: ${Math.min(data.jobs.length, 150)}`);
  }
  return out;
}

async function fromLever() {
  const out = [];
  for (const co of LEVER_COMPANIES) {
    const data = await fetchJson(`https://api.lever.co/v0/postings/${co}?mode=json`);
    await sleep(PAUSE_MS);
    if (!Array.isArray(data)) { console.log(`  lever/${co}: skipped`); continue; }
    for (const j of data.slice(0, 150)) {
      const location = j.categories?.location || "Not specified";
      const listText = (j.lists || []).map((l) => `${l.text}\n${stripHtml(l.content)}`).join("\n");
      out.push({
        title: j.text,
        company: titleCase(co),
        location,
        remote: j.workplaceType === "remote" || /remote/i.test(location),
        description: `${j.descriptionPlain || ""}\n${listText}\n${j.additionalPlain || ""}`.trim(),
        sourceUrl: j.hostedUrl,
        source: "lever",
      });
    }
    console.log(`  lever/${co}: ${Math.min(data.length, 150)}`);
  }
  return out;
}

async function fromRemotive() {
  const data = await fetchJson("https://remotive.com/api/remote-jobs?limit=500");
  if (!data?.jobs) { console.log("  remotive: skipped"); return []; }
  console.log(`  remotive: ${data.jobs.length}`);
  return data.jobs.map((j) => ({
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || "Remote",
    remote: true,
    description: stripHtml(j.description),
    sourceUrl: j.url,
    source: "remotive",
    tags: j.tags || [],
  }));
}

async function fromArbeitnow() {
  const out = [];
  for (let page = 1; page <= 6; page++) {
    const data = await fetchJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
    await sleep(PAUSE_MS);
    if (!data?.data?.length) break;
    for (const j of data.data) {
      out.push({
        title: j.title,
        company: j.company_name,
        location: j.location || "Not specified",
        remote: Boolean(j.remote),
        description: stripHtml(j.description),
        sourceUrl: j.url,
        source: "arbeitnow",
        tags: j.tags || [],
      });
    }
    console.log(`  arbeitnow page ${page}: ${data.data.length}`);
  }
  return out;
}

//  main
const TECH_TITLE =
  /engineer|developer|software|devops|sre|reliability|data |machine learning|\bml\b|\bai\b|scientist|analyst|architect|\bqa\b|quality|security|full.?stack|front.?end|back.?end|mobile|android|\bios\b|cloud|platform|product|designer|programmer|intern/i;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  console.log("Fetching jobs...");
  const results = await Promise.all([fromGreenhouse(), fromLever(), fromRemotive(), fromArbeitnow()]);
  const raw = results.flat().filter((j) => j.title && j.company && j.sourceUrl);
  console.log(`\nFetched ${raw.length} raw listings`);

  // de-duplicate on title + company + location
  const seen = new Set();
  const unique = raw.filter((j) => {
    const key = `${j.title}|${j.company}|${j.location}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const filtered = TECH_ONLY ? unique.filter((j) => TECH_TITLE.test(j.title)) : unique;
  console.log(`After de-dupe + tech filter: ${filtered.length}`);

  if (filtered.length === 0) {
    console.error("No jobs fetched. Check your internet connection and the endpoints.");
    process.exit(1);
  }

  // shuffle so one big company doesn't dominate, then cap
  const picked = shuffle(filtered).slice(0, MAX_JOBS);

  const jobs = picked.map((j, i) => {
    const description = j.description.slice(0, DESCRIPTION_LIMIT);
    const exp = extractExperience(j.title, j.description);
    return {
      id: i + 1,
      title: j.title.trim(),
      company: j.company.trim(),
      location: j.location.trim(),
      remote: j.remote,
      experience: exp.label,
      experienceMin: exp.min,
      skills: extractSkills(`${j.title}\n${j.description}`, j.tags),
      description,
      sourceUrl: j.sourceUrl,
      source: j.source,
    };
  });

  const outDir = path.join(process.cwd(), "data");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "jobs.json"), JSON.stringify(jobs, null, 2));

  // quality report
  const bySource = {};
  for (const j of jobs) bySource[j.source] = (bySource[j.source] || 0) + 1;
  const pct = (n) => `${Math.round((n / jobs.length) * 100)}%`;
  console.log("\n===== REPORT =====");
  console.log(`Total jobs:          ${jobs.length}`);
  console.log(`By source:           ${JSON.stringify(bySource)}`);
  console.log(`With skills:         ${pct(jobs.filter((j) => j.skills.length > 0).length)}`);
  console.log(`With experience:     ${pct(jobs.filter((j) => j.experienceMin !== null).length)}`);
  console.log(`Remote:              ${pct(jobs.filter((j) => j.remote).length)}`);
  console.log("Saved to data/jobs.json");
  if (jobs.length < 1500) console.log("\nUnder 1,500 jobs: add more company names to the board lists and run again.");
}

main();