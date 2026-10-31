export type Job = {
  id: number; title: string; company: string; location: string; remote: boolean;
  experience: string; experienceMin: number | null; skills: string[];
  description: string; sourceUrl: string; source: string;
};

export type Profile = {
  name: string; email: string; phone: string; location: string;
  designation: string; totalExperienceYears: number | null;
  skills: string[];
  targetRoles: string[];
  education: { degree: string; institution: string; year: string }[];
  projects: { name: string; description: string }[];
};
export type JobFilters = {
  remote?: boolean; skills?: string[]; location?: string;
  titleKeyword?: string; maxExperience?: number; company?: string;
};

export type MatchedJob = {
  position: number; id: number; title: string; company: string; location: string;
  remote: boolean; experience: string; skills: string[]; sourceUrl: string;
  score: number; reason: string;
};

export type AppRow = {
  jobId: number; title: string; company: string; appliedAt: string; status: string;
};