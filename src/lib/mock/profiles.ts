import type { TopicScore } from "@/lib/mock/data";

export type ProfileId = "student" | "professional";

export interface Profile {
  id: ProfileId;
  name: string;
  persona: "student" | "professional";
  username: string;
  password: string;
  tagline: string;
  avatar: string; // pose webp in /public
  selectedCourses: string[];
  selectedInterests: string[];
  xp: number;
  level: number;
  streak: number;
  hearts: number;
  maxHearts: number;
  dailyXp: number;
  dailyGoal: number;
  completedNodes: string[];
  topicScores: TopicScore[];
}

export const PROFILES: Record<ProfileId, Profile> = {
  student: {
    id: "student",
    name: "Raj Patel",
    persona: "student",
    username: "anjan",
    password: "hope",
    tagline: "MS Software Engineering · CMPE",
    avatar: "/mascot/poses/happy.webp",
    selectedCourses: ["cmpe277", "cmpe273"],
    selectedInterests: [],
    xp: 240,
    level: 3,
    streak: 12,
    hearts: 5,
    maxHearts: 5,
    dailyXp: 10,
    dailyGoal: 40,
    completedNodes: ["a1"],
    topicScores: [
      { topic: "Android Fundamentals", mastery: 72, currency: 64 },
      { topic: "Distributed Systems", mastery: 38, currency: 80 },
      { topic: "AI / LLMs", mastery: 21, currency: 95 },
    ],
  },
  professional: {
    id: "professional",
    name: "Maya Chen",
    persona: "professional",
    username: "maya",
    password: "hope",
    tagline: "Senior Backend Engineer",
    avatar: "/mascot/poses/cheer.webp",
    selectedCourses: [],
    selectedInterests: ["System Design", "AI / LLMs", "Databases"],
    xp: 880,
    level: 6,
    streak: 34,
    hearts: 4,
    maxHearts: 5,
    dailyXp: 25,
    dailyGoal: 50,
    completedNodes: ["p0-0"],
    topicScores: [
      { topic: "System Design", mastery: 81, currency: 70 },
      { topic: "AI / LLMs", mastery: 64, currency: 92 },
      { topic: "Databases", mastery: 55, currency: 60 },
    ],
  },
};

export const PROFILE_LIST = Object.values(PROFILES);
