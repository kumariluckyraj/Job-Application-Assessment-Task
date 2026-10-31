"use client";
import { useEffect, useRef, useState } from "react";

const WELCOME = {
  role: "assistant",
  content: "Hi! Upload your resume (PDF or DOCX) with the 📎 button and I'll find jobs that match you.",
};

export default function Chat() {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [shownJobIds, setShownJobIds] = useState([]);
  const [filters, setFilters] = useState({});
  const [userId, setUserId] = useState("");
  const fileRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    let id = localStorage.getItem("jobassist_uid");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("jobassist_uid", id); }
    setUserId(id);
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function send(text, history = messages, p = profile) {
    const withUser = [...history, { role: "user", content: text }];
    setMessages(withUser);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: withUser.filter((m) => !m.isError).map((m) => ({ role: m.role, content: m.content })),
          profile: p, userId, shownJobIds, filters,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.shownJobIds) setShownJobIds(data.shownJobIds);
      if (data.filters) setFilters(data.filters);
      setMessages([...withUser, { role: "assistant", content: data.reply, jobs: data.jobs ?? undefined, applications: data.applications ?? undefined }]);
    } catch (e) {
      setMessages([...withUser, { role: "assistant", content: e.message || "Something went wrong.", isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  async function refilter(next, note) {
    if (!profile || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, filters: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFilters(next);
      if (data.jobs?.length) {
        setShownJobIds(data.shownJobIds);
        setMessages((m) => [...m, { role: "assistant", content: `${note} Showing ${data.jobs.length} jobs.`, jobs: data.jobs }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: `${note} No jobs match the remaining filters. Try removing another one.` }]);
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: e.message || "Something went wrong.", isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  function removeFilter(key, skill) {
    const next = { ...filters };
    if (key === "skills" && skill) {
      const left = (next.skills ?? []).filter((s) => s !== skill);
      if (left.length) next.skills = left;
      else delete next.skills;
    } else {
      delete next[key];
    }
    refilter(next, "Filter removed.");
  }

  const filterChips = [];
  if (filters.remote !== undefined) filterChips.push({ label: filters.remote ? "Remote only" : "On-site only", key: "remote" });
  filters.skills?.forEach((s) => filterChips.push({ label: `Skill: ${s}`, key: "skills", skill: s }));
  if (filters.location) filterChips.push({ label: `Location: ${filters.location}`, key: "location" });
  if (filters.titleKeyword) filterChips.push({ label: `Title: ${filters.titleKeyword}`, key: "titleKeyword" });
  if (filters.company) filterChips.push({ label: `Company: ${filters.company}`, key: "company" });
  if (filters.maxExperience !== undefined) filterChips.push({ label: `Up to ${filters.maxExperience} yrs`, key: "maxExperience" });

  async function onFile(file) {
    const base = [...messages, { role: "user", content: `📎 ${file.name}` }];
    setMessages(base);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append(
        "payload",
        JSON.stringify({
          messages: base.filter((m) => !m.isError).map((m) => ({ role: m.role, content: m.content })),
          profile,
          userId,
          shownJobIds: [],
          filters: {},
        })
      );
      const res = await fetch("/api/chat", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.profile) setProfile(data.profile);
      setShownJobIds(data.shownJobIds ?? []);
      setFilters(data.filters ?? {});
      setMessages([
        ...base,
        {
          role: "assistant",
          content: data.reply,
          profile: data.profile ?? undefined,
          jobs: data.jobs ?? undefined,
        },
      ]);
    } catch (e) {
      setMessages([...base, { role: "assistant", content: e.message || "Couldn't process that file.", isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    const t = input.trim();
    if (!t || loading || !userId) return;
    setInput("");
    send(t);
  }

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="border-b px-4 py-3 font-semibold">Job Assistant</header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[92%] space-y-3 ${m.role === "user" ? "rounded-2xl bg-blue-600 px-4 py-2 text-white" : ""}`}>
              {m.content && (
                <p className={`whitespace-pre-wrap text-sm ${m.role === "assistant" ? `rounded-2xl px-4 py-2 ${m.isError ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-900"}` : ""}`}>
                  {m.content}
                </p>
              )}
              {m.profile && <ProfileCard p={m.profile} />}
              {m.jobs?.map((j) => <JobCard key={j.id} job={j} onApply={() => send(`Apply to job ID ${j.id}`)} disabled={loading} />)}
              {m.applications && <ApplicationsTable rows={m.applications} />}
            </div>
          </div>
        ))}
        {loading && <p className="text-sm text-gray-400">Thinking…</p>}
        <div ref={bottomRef} />
      </div>

      {filterChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-1">
          <span className="text-xs text-gray-500">Filters:</span>
          {filterChips.map((c) => (
            <span key={c.label} className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              {c.label}
              <button
                disabled={loading}
                onClick={() => removeFilter(c.key, c.skill)}
                className="font-bold hover:text-red-600 disabled:opacity-50"
                aria-label={`Remove ${c.label}`}
              >
                ×
              </button>
            </span>
          ))}
          <button
            disabled={loading}
            onClick={() => refilter({}, "All filters cleared.")}
            className="text-xs text-gray-500 underline disabled:opacity-50"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-4 pb-2">
        {profile && ["Show only remote roles", "Jobs needing React", "Show my applied jobs"].map((s) => (
          <button key={s} disabled={loading} onClick={() => send(s)} className="rounded-full border px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50">{s}</button>
        ))}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t p-3">
        <input ref={fileRef} type="file" accept=".pdf,.docx" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        <button type="button" disabled={loading} onClick={() => fileRef.current?.click()} className="rounded-lg border px-3 py-2 text-lg disabled:opacity-50" title="Upload resume">📎</button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything… e.g. “apply to job 3”"
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500" />
        <button disabled={loading || !input.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">Send</button>
      </form>
    </div>
  );
}

function ProfileCard({ p }) {
  return (
    <div className="rounded-xl border p-4 text-sm">
      <div className="text-base font-semibold">{p.name || "Name not found"}</div>
      <div className="text-gray-600">{[p.email, p.phone, p.location].filter(Boolean).join(" · ") || "No contact details found"}</div>
      <div className="mt-2"><b>Designation:</b> {p.designation || "—"}</div>
      <div><b>Experience:</b> {p.totalExperienceYears ?? "—"} years</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {p.skills.map((s) => <span key={s} className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{s}</span>)}
      </div>
      {p.education.length > 0 && (
        <div className="mt-2"><b>Education</b>
          <ul className="list-disc pl-5">{p.education.map((e, i) => <li key={i}>{[e.degree, e.institution, e.year].filter(Boolean).join(", ")}</li>)}</ul>
        </div>
      )}
      {p.projects.length > 0 && (
        <div className="mt-2"><b>Projects</b>
          <ul className="list-disc pl-5">{p.projects.map((x, i) => <li key={i}><b>{x.name}</b>{x.description ? `: ${x.description}` : ""}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function JobCard({ job, onApply, disabled }) {
  return (
    <div className="rounded-xl border p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">#{job.position} · {job.title}</div>
          <div className="text-gray-600">{job.company} · {job.location} {job.remote && <span className="ml-1 rounded bg-green-100 px-1.5 text-xs text-green-700">Remote</span>}</div>
          <div className="text-xs text-gray-500">Experience: {job.experience} · Job ID {job.id}</div>
        </div>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{job.score}% match</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {job.skills.slice(0, 6).map((s) => <span key={s} className="rounded bg-gray-100 px-2 py-0.5 text-xs">{s}</span>)}
      </div>
      <p className="mt-2 text-gray-700"><b>Why:</b> {job.reason}</p>
      <div className="mt-3 flex gap-2">
        <button onClick={onApply} disabled={disabled} className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50">Apply</button>
        <a href={job.sourceUrl} target="_blank" rel="noreferrer" className="rounded border px-3 py-1 text-xs">View posting</a>
      </div>
    </div>
  );
}

function ApplicationsTable({ rows }) {
  if (!rows.length) return null;
  return (
    <table className="w-full overflow-hidden rounded-xl border text-left text-sm">
      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
        <tr><th className="p-2">Job ID</th><th className="p-2">Role</th><th className="p-2">Applied</th><th className="p-2">Status</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.jobId} className="border-t">
            <td className="p-2">{r.jobId}</td>
            <td className="p-2">{r.title}<div className="text-xs text-gray-500">{r.company}</div></td>
            <td className="p-2">{new Date(r.appliedAt).toLocaleDateString()}</td>
            <td className="p-2">{r.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}