import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Subject = {
  id: string;
  name: string;
  color: string;
  coverage: number; // 0-100
};

export type Lecture = {
  id: string;
  subjectId: string;
  title: string;
  examId?: string;
  date: string; // ISO string
  difficulty: number; // 0.0 to 1.0 (S)
  pageCount: number; // Size (C)
  selfExamScore?: number; // 0-100 (Mastery M / Initial Understanding)
  examAttempts: number;
  studyCount: number; // Number of revision sessions (R)
  practiceCount: number; // Number of practice sessions
  practiceDone: boolean;
  lastReviewDate?: string; // ISO string (T_last)
  lastPracticeDate?: string; // ISO string (T_last_solving)
  lastAccuracy?: number; // 0-100 (Accuracy A)
  estimatedStudyTime: number; // minutes
  progress: number; // 0.0 to 1.0
  abandonedSessionsCount: number;
  relatedLectureIds: string[];
};

export type Exam = {
  id: string;
  name: string;
  date: string; // ISO string
  confidence: number; // 0-100
  linkedLectureIds: string[];
};

export type TaskType = 'new' | 'review' | 'solving';

export type Task = {
  id: string;
  title: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  completedDate?: string; // ISO string
  lectureId?: string;
  priorityScore?: number;
  type?: TaskType;
};

export type PriorityWeights = {
  // New Lecture Factors
  newDifficulty: number;
  newSize: number;
  newRecency: number;
  // Review Factors
  reviewMastery: number;
  reviewCount: number;
  reviewStaleness: number;
  // Solving Factors
  solvingAccuracy: number;
  solvingDifficulty: number;
  solvingStaleness: number;
};

export type DailyAllocation = {
  new: number; // e.g. 40
  review: number; // e.g. 30
  solving: number; // e.g. 30
};

export interface CategoryPriorityBreakdown {
  category: TaskType;
  scores: {
    new: number;
    solving: number;
    review: number;
  };
  component1: { label: string, score: number };
  component2: { label: string, score: number };
  component3: { label: string, score: number };
  modifiers: number;
  total: number;
}

export function getCategorizedPriority(
  lecture: Lecture,
  weights: PriorityWeights
): CategoryPriorityBreakdown {
  const now = Date.now();
  
  // Helper to safely get days since a date
  const getDaysSince = (dateStr?: string) => {
    if (!dateStr) return 7;
    const time = new Date(dateStr).getTime();
    if (isNaN(time)) return 7;
    return (now - time) / (1000 * 60 * 60 * 24);
  };

  // 1. NEW LECTURES (S, C, T)
  const daysSinceTaken = getDaysSince(lecture.date);
  const newS = (lecture.difficulty || 0.5) * (weights.newDifficulty || 0);
  const newC = Math.min(1, (lecture.pageCount || 0) / 30) * (weights.newSize || 0);
  const newT = Math.max(0, 1 - (daysSinceTaken / 7)) * (weights.newRecency || 0);
  const newTotal = newS + newC + newT;

  // 2. REVIEW (M, R, T_last)
  const masteryM = ((100 - (lecture.selfExamScore ?? 0)) / 100) * (weights.reviewMastery || 0);
  const reviewR = Math.max(0, 1 - ((lecture.studyCount || 0) / 5)) * (weights.reviewCount || 0);
  const daysSinceLastReview = getDaysSince(lecture.lastReviewDate);
  const reviewTLast = Math.min(1, daysSinceLastReview / 14) * (weights.reviewStaleness || 0);
  const reviewTotal = masteryM + reviewR + reviewTLast;

  // 3. SOLVING (A, S, T_last)
  const accuracyA = ((100 - (lecture.lastAccuracy ?? 80)) / 100) * (weights.solvingAccuracy || 0);
  const solveS = (lecture.difficulty || 0.5) * (weights.solvingDifficulty || 0);
  const daysSinceLastSolve = getDaysSince(lecture.lastPracticeDate);
  const solveTLast = Math.min(1, daysSinceLastSolve / 21) * (weights.solvingStaleness || 0);
  const solveTotal = accuracyA + solveS + solveTLast;

  const scores = {
    new: isFinite(newTotal) ? Math.round(newTotal) : 0,
    solving: isFinite(solveTotal) ? Math.round(solveTotal) : 0,
    review: isFinite(reviewTotal) ? Math.round(reviewTotal) : 0
  };

  const safeVal = (v: number) => isFinite(v) ? v : 0;

  // Determine primary category for UI breakdown
  // Foundation (New): If never studied or progress is very low
  if ((lecture.studyCount || 0) === 0 && (lecture.progress || 0) < 0.5) {
    return {
      category: 'new',
      scores,
      component1: { label: 'Difficulty (S)', score: safeVal(newS) },
      component2: { label: 'Size (C)', score: safeVal(newC) },
      component3: { label: 'Recency (T)', score: safeVal(newT) },
      modifiers: 0,
      total: scores.new
    };
  } 
  
  // Decide between Solving and Review based on practice status and scores
  // If we haven't practiced much yet, or solving score is explicitly higher
  if (!lecture.practiceDone || (lecture.practiceCount || 0) < 1 || solveTotal > reviewTotal) {
    return {
      category: 'solving',
      scores,
      component1: { label: 'Accuracy (A)', score: safeVal(accuracyA) },
      component2: { label: 'Difficulty (S)', score: safeVal(solveS) },
      component3: { label: 'Staleness', score: safeVal(solveTLast) },
      modifiers: 0,
      total: scores.solving
    };
  } else {
    return {
      category: 'review',
      scores,
      component1: { label: 'Mastery (M)', score: safeVal(masteryM) },
      component2: { label: 'Reviews (R)', score: safeVal(reviewR) },
      component3: { label: 'Staleness', score: safeVal(reviewTLast) },
      modifiers: 0,
      total: scores.review
    };
  }
}

export function getLecturePriorityScore(
  lecture: Lecture,
  lectures: Lecture[],
  exams: Exam[],
  weights: PriorityWeights
): number {
  const breakdown = getCategorizedPriority(lecture, weights);
  return Math.round(breakdown.total);
}

export function calculateFocusScore(
  tasks: Task[],
  lectures: Lecture[]
): number {
  if (tasks.length === 0 && lectures.length === 0) return 0;

  // 1. Task Completion Rate (40%)
  const completedTasks = tasks.filter(t => t.completed).length;
  const taskRate = tasks.length > 0 ? (completedTasks / tasks.length) : 0;

  // 2. Mastery Level (40%)
  const totalProgress = lectures.reduce((acc, l) => {
    const p = l.progress ?? 0;
    return acc + (isFinite(p) ? p : 0);
  }, 0);
  const masteryRate = lectures.length > 0 ? (totalProgress / lectures.length) : 0;

  // 3. Consistency (20%)
  // Check last 7 days for completion activity
  const now = new Date();
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(now.getDate() - i);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });

  const activeDays = last7Days.filter(dayTimestamp => {
    const nextDay = dayTimestamp + (24 * 60 * 60 * 1000);
    return tasks.some(t => {
      const completionDate = t.completedDate ? new Date(t.completedDate).getTime() : NaN;
      return t.completed && 
             isFinite(completionDate) && 
             completionDate >= dayTimestamp && 
             completionDate < nextDay;
    });
  }).length;
  const consistencyRate = activeDays / 7;

  const score = (taskRate * 40) + (masteryRate * 40) + (consistencyRate * 20);
  return isFinite(score) ? Math.round(score) : 0;
}

// --- SCORING SYSTEM RESTORE PLAN ---
// The priority system uses a Non-Linear Contrast Enhancement Equation to "spread" scores.
// If the distribution feels too aggressive or "broken":
// 1. To Linearize: Set CONTRAST_FACTOR to 1.0.
// 2. To Compress: Set CONTRAST_FACTOR between 0.5 and 0.9.
// 3. To Restore Legacy: Revert to returning rawScore directly.
const CONTRAST_FACTOR = 1.25;

export function calculatePriorityScore(
  task: Task,
  lectures: Lecture[],
  exams: Exam[],
  weights: PriorityWeights = {
    newDifficulty: 35,
    newSize: 30,
    newRecency: 35,
    reviewMastery: 40,
    reviewCount: 30,
    reviewStaleness: 30,
    solvingAccuracy: 40,
    solvingDifficulty: 30,
    solvingStaleness: 30
  }
): number {
  let rawScore = 0;

  if (task.lectureId) {
    const lecture = lectures.find(l => l.id === task.lectureId);
    if (lecture) {
      const breakdown = getCategorizedPriority(lecture, weights);
      rawScore = breakdown.total;
    }
  } else {
    // Fallback for non-lecture tasks
    const daysUntilDue = (new Date(task.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    const urgency = Math.max(0, 1 - (daysUntilDue / 14));
    const manualPriorityMap = { high: 0.8, medium: 0.5, low: 0.2 };
    rawScore = (urgency * 0.7 + manualPriorityMap[task.priority] * 0.3) * 100;
  }

  // --- THE SPREAD EQUATION ---
  // Transforms the linear score [0-100] into a curved distribution to exaggerate differences.
  // Formula: f(x) = 100 * (x/100)^power
  const scoreBase = isFinite(rawScore) ? rawScore : 0;
  const spreadScore = 100 * Math.pow(Math.max(0, scoreBase) / 100, CONTRAST_FACTOR);
  
  return isFinite(spreadScore) ? Math.round(spreadScore) : 0;
}
