"use client";
import { useEffect, useRef, useState } from "react";

const MAX_MB = 4;
const SUGGESTIONS = ["Show only remote roles", "Jobs needing React", "Show my applied jobs"];

const initials = (name = "") =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "U";

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [shownJobIds, setShownJobIds] = useState([]);
  const [filters, setFilters] = useState({});
  const [userId, setUserId] = useState("");
  const [dragging, setDragging] = useState(false);
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
        { role: "assistant", content: data.reply, profile: data.profile ?? undefined, jobs: data.jobs ?? undefined },
      ]);
    } catch (e) {
      setMessages([...base, { role: "assistant", content: e.message || "Couldn't process that file.", isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  // validates in the browser first, so bad files get an instant message
  function handleFile(file) {
    if (!file || loading) return;
    const okType = /\.(pdf|docx)$/i.test(file.name);
    const tooBig = file.size > MAX_MB * 1024 * 1024;
    if (!okType || tooBig) {
      const text = !okType
        ? "That file type isn't supported. Please upload a PDF or DOCX resume."
        : `That file is over ${MAX_MB} MB. Please upload a smaller resume.`;
      setMessages((m) => [...m, { role: "assistant", isError: true, content: text }]);
      return;
    }
    onFile(file);
  }

  function submit(e) {
    e.preventDefault();
    const t = input.trim();
    if (!t || loading || !userId) return;
    setInput("");
    send(t);
  }

  function newChat() {
    if (loading) return;
    setMessages([]); setProfile(null); setShownJobIds([]); setFilters({}); setInput("");
  }

  return (
    <div
      className="relative flex h-dvh flex-col bg-gray-50"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
    >
      {dragging && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-blue-600/10 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-blue-500 bg-white px-8 py-6 text-center text-blue-700 shadow-lg">
            <div className="text-lg font-semibold">Drop your resume here</div>
            <div className="text-sm text-blue-600">PDF or DOCX, up to {MAX_MB} MB</div>
          </div>
        </div>
      )}

      {/* header */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-sm font-bold text-white">J</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-gray-900">Job Assistant</div>
              <div className="text-xs text-gray-500">Resume-matched roles, applied by chat</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {profile && (
              <span className="hidden items-center gap-2 rounded-full bg-gray-100 py-1 pl-1 pr-3 text-xs text-gray-700 sm:flex">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white">{initials(profile.name)}</span>
                {profile.name || "Resume loaded"}
              </span>
            )}
            {messages.length > 0 && (
              <button onClick={newChat} disabled={loading} className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                New chat
              </button>
            )}
          </div>
        </div>
      </header>

      {/* conversation */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {messages.length === 0 && (
            <div className="mx-auto mt-6 max-w-xl text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-2xl text-white shadow-md">✦</div>
              <h1 className="text-2xl font-semibold text-gray-900">Find jobs that fit your resume</h1>
              <p className="mt-2 text-sm text-gray-500">Upload your resume and chat to refine matches, apply and track your applications.</p>
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-6 w-full rounded-2xl border-2 border-dashed border-gray-300 bg-white px-6 py-10 text-center transition hover:border-blue-400 hover:bg-blue-50/40"
              >
                <div className="text-3xl">📄</div>
                <div className="mt-2 text-sm font-medium text-gray-800">Click to upload or drag and drop</div>
                <div className="text-xs text-gray-500">PDF or DOCX, up to {MAX_MB} MB</div>
              </button>
              <div className="mt-6 grid gap-2 text-left text-xs text-gray-500 sm:grid-cols-3">
                {["Show only remote roles", "Jobs needing React", "Apply to job 3"].map((t) => (
                  <div key={t} className="rounded-xl border bg-white px-3 py-2">“{t}”</div>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-blue-600 px-4 py-2 text-sm text-white shadow-sm">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-3">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white">AI</div>
                <div className="min-w-0 flex-1 space-y-3">
                  {m.content && (
                    <p className={`inline-block max-w-full whitespace-pre-wrap rounded-2xl rounded-tl-md px-4 py-2 text-sm shadow-sm ${m.isError ? "border border-red-200 bg-red-50 text-red-700" : "border bg-white text-gray-800"}`}>
                      {m.content}
                    </p>
                  )}
                  {m.profile && <ProfileCard p={m.profile} />}
                  {m.jobs?.map((j) => <JobCard key={j.id} job={j} onApply={() => send(`Apply to job ID ${j.id}`)} disabled={loading} />)}
                  {m.applications && <ApplicationsTable rows={m.applications} />}
                </div>
              </div>
            )
          )}

          {loading && (
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white">AI</div>
              <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border bg-white px-4 py-3 shadow-sm">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* composer */}
      <div className="border-t bg-white">
        <div className="mx-auto max-w-3xl space-y-2 px-4 py-3">
          {filterChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Filters</span>
              {filterChips.map((c) => (
                <span key={c.label} className="flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-blue-700">
                  {c.label}
                  <button
                    disabled={loading}
                    onClick={() => removeFilter(c.key, c.skill)}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-sm leading-none hover:bg-blue-200 disabled:opacity-50"
                    aria-label={`Remove ${c.label}`}
                  >×</button>
                </span>
              ))}
              <button disabled={loading} onClick={() => refilter({}, "All filters cleared.")} className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50">
                Clear all
              </button>
            </div>
          )}

          {profile && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {SUGGESTIONS.map((s) => (
                <button key={s} disabled={loading} onClick={() => send(s)} className="shrink-0 rounded-full border bg-white px-3 py-1 text-xs text-gray-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50">{s}</button>
              ))}
            </div>
          )}

          <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border bg-white p-1.5 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <input ref={fileRef} type="file" accept=".pdf,.docx" hidden
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" disabled={loading} onClick={() => fileRef.current?.click()} title="Upload resume"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-50">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5" /></svg>
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={profile ? "Ask anything… e.g. “apply to job 3”" : "Upload your resume to get started…"}
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-gray-400" />
            <button disabled={loading || !input.trim()} title="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ p }) {
  return (
    <div className="rounded-2xl border bg-white p-4 text-sm shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{initials(p.name)}</div>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-gray-900">{p.name || "Name not found"}</div>
          <div className="truncate text-xs text-gray-500">{[p.email, p.phone, p.location].filter(Boolean).join(" · ") || "No contact details found"}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Designation</div>
          <div className="font-medium text-gray-900">{p.designation || "—"}</div>
        </div>
        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Experience</div>
          <div className="font-medium text-gray-900">{p.totalExperienceYears ?? "—"} years</div>
        </div>
      </div>

      {p.skills.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Skills</div>
          <div className="flex flex-wrap gap-1.5">
            {p.skills.map((s) => <span key={s} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700">{s}</span>)}
          </div>
        </div>
      )}
      {p.education.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Education</div>
          <ul className="space-y-0.5 text-gray-800">
            {p.education.map((e, i) => <li key={i}>{[e.degree, e.institution, e.year].filter(Boolean).join(", ")}</li>)}
          </ul>
        </div>
      )}
      {p.projects.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Projects</div>
          <ul className="space-y-1 text-gray-800">
            {p.projects.map((x, i) => <li key={i}><b>{x.name}</b>{x.description ? <span className="text-gray-600">: {x.description}</span> : null}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function JobCard({ job, onApply, disabled }) {
  const tone = job.score >= 75 ? "bg-green-100 text-green-700" : job.score >= 50 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600";
  const bar = job.score >= 75 ? "bg-green-500" : job.score >= 50 ? "bg-amber-500" : "bg-gray-400";
  return (
    <div className="rounded-2xl border bg-white p-4 text-sm shadow-sm transition hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-sm font-semibold text-gray-600">{(job.company || "?")[0].toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900">
            <span className="mr-1 text-gray-400">#{job.position}</span>{job.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            <span className="font-medium text-gray-700">{job.company}</span>
            <span>· {job.location}</span>
            {job.remote && <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">Remote</span>}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">Experience: {job.experience} · Job ID {job.id}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{job.score}%</span>
      </div>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(job.score, 100)}%` }} />
      </div>

      {job.skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.skills.slice(0, 6).map((s) => <span key={s} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">{s}</span>)}
        </div>
      )}

      <p className="mt-3 rounded-xl bg-blue-50/60 px-3 py-2 text-xs leading-relaxed text-gray-700">
        <span className="font-semibold text-blue-700">Why it fits: </span>{job.reason}
      </p>

      <div className="mt-3 flex gap-2">
        <button onClick={onApply} disabled={disabled} className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">Apply</button>
        <a href={job.sourceUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-4 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">View posting ↗</a>
      </div>
    </div>
  );
}

function ApplicationsTable({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="border-b bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Your applications ({rows.length})</div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-gray-500">
            <tr><th className="px-4 py-2 font-medium">Job ID</th><th className="px-4 py-2 font-medium">Role</th><th className="px-4 py-2 font-medium">Applied</th><th className="px-4 py-2 font-medium">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.jobId} className="border-t">
                <td className="px-4 py-2 text-gray-500">{r.jobId}</td>
                <td className="px-4 py-2"><div className="font-medium text-gray-900">{r.title}</div><div className="text-xs text-gray-500">{r.company}</div></td>
                <td className="px-4 py-2 text-gray-600">{new Date(r.appliedAt).toLocaleDateString()}</td>
                <td className="px-4 py-2"><span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}