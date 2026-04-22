import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  Library, 
  Target, 
  Route, 
  Settings as SettingsIcon,
  Milestone,
  Plus,
  Sparkles,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock,
  Calendar,
  BookOpen,
  Trophy,
  Sliders,
  Zap,
  X,
  Brain,
  TrendingUp,
  History,
  Pause,
  Search,
  Edit2,
  Trash2,
  Check,
  AlertCircle,
  Upload,
  Inbox,
  ArrowRight,
  ArrowLeft,
  CheckSquare,
  Square,
  ListFilter
} from 'lucide-react';
import { cn, Subject, Lecture, Exam, Task, calculatePriorityScore, getLecturePriorityScore, getCategorizedPriority, PriorityWeights, TaskType, DailyAllocation, calculateFocusScore } from './lib/utils';
import { MOCK_SUBJECTS, MOCK_LECTURES, MOCK_EXAMS, MOCK_TASKS } from './constants';
import { generateNarrative, processPulsePrompt } from './services/geminiService';

import { translations, Language } from './lib/translations';

// --- Components ---

const NavItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex flex-col items-center gap-1 transition-all duration-300",
      active ? "text-focus-cyan scale-110 drop-shadow-[0_0_8px_rgba(0,242,255,0.4)]" : "text-focus-slate hover:text-focus-text"
    )}
  >
    <Icon size={24} />
    <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
  </button>
);

const GlassCard = ({ children, className, ...props }: { children: React.ReactNode, className?: string, [key: string]: any }) => (
  <div className={cn("glass rounded-2xl p-6", className)} {...props}>
    {children}
  </div>
);

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass w-full max-w-lg rounded-3xl overflow-hidden border-focus-border shadow-2xl"
      >
        <div className="flex justify-between items-center p-6 border-b border-white/10">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="text-focus-slate hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </div>
  );
};

// --- Screens ---

const Dashboard = ({ 
  narrative, 
  tasks, 
  subjects, 
  lectures, 
  exams, 
  weights,
  allocation,
  onToggleTask,
  onPartialTask,
  onViewAllTasks,
  onViewFocusIntelligence,
  onOpenBulkImport,
  focusScore,
  dailyTaskLimit,
  t,
  language
}: { 
  narrative: string, 
  tasks: Task[], 
  subjects: Subject[], 
  lectures: Lecture[], 
  exams: Exam[],
  weights: PriorityWeights,
  allocation: DailyAllocation,
  onToggleTask: (id: string) => void,
  onPartialTask: (lectureId: string) => void,
  onViewAllTasks: () => void,
  onViewFocusIntelligence: () => void,
  onOpenBulkImport: () => void,
  focusScore: number,
  dailyTaskLimit: number,
  t: any,
  language: Language
}) => {
  const [selectedDay, setSelectedDay] = useState<'yesterday' | 'today' | 'tomorrow' | 'after'>('today');

  const getTasksForDay = (day: 'yesterday' | 'today' | 'tomorrow' | 'after') => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const targetDate = new Date(now);
    if (day === 'yesterday') targetDate.setDate(now.getDate() - 1);
    if (day === 'tomorrow') targetDate.setDate(now.getDate() + 1);
    if (day === 'after') targetDate.setDate(now.getDate() + 2);

    const nextDay = new Date(targetDate);
    nextDay.setDate(targetDate.getDate() + 1);

    // 1. Handle Completed Tasks (Strictly by date)
    if (day === 'yesterday') {
      return tasks.filter(t => t.completed && t.completedDate && new Date(t.completedDate) >= targetDate && new Date(t.completedDate) < nextDay);
    }

    // 2. Handle Incomplete Tasks (Dynamic Priority Queue)
    const incompleteTasks = tasks
      .filter(t => !t.completed)
      .map(t => {
        const lecture = t.lectureId ? lectures.find(l => l.id === t.lectureId) : null;
        let score = calculatePriorityScore(t, lectures, exams, weights);
        let type = t.type;
        
        if (lecture) {
           const breakdown = getCategorizedPriority(lecture, weights);
           score = breakdown.total;
           if (!type) {
             type = breakdown.category;
           }
        }
        
        // Final fallback if still no type
        const finalType: TaskType = type || 'new';
        
        return { ...t, priorityScore: score, type: finalType };
      });

    // Get tasks completed TODAY
    const completedToday = tasks.filter(t => 
      t.completed && 
      t.completedDate && 
      new Date(t.completedDate) >= now && 
      new Date(t.completedDate) < nextDay
    );

    const sortedIncomplete = [...incompleteTasks].sort((a,b) => (b.priorityScore || 0) - (a.priorityScore || 0));

    // Helper to pick tasks based on quota and allocation
    const getSelectedForQuota = (pool: any[], quota: number) => {
      if (quota <= 0) return [];
      const newTasks = pool.filter(p => p.type === 'new');
      const reviewTasks = pool.filter(p => p.type === 'review');
      const solvingTasks = pool.filter(p => p.type === 'solving');
      
      const newQuota = Math.max(0, Math.round(quota * (allocation.new / 100)));
      const reviewQuota = Math.max(0, Math.round(quota * (allocation.review / 100)));
      const solvingQuota = Math.max(0, Math.round(quota * (allocation.solving / 100)));

      const selected = [
        ...newTasks.slice(0, newQuota),
        ...reviewTasks.slice(0, reviewQuota),
        ...solvingTasks.slice(0, solvingQuota)
      ];
      
      const extraNeeded = quota - selected.length;
      if (extraNeeded > 0) {
        const alreadySelectedIds = new Set(selected.map(s => s.id));
        const leftovers = pool.filter(p => !alreadySelectedIds.has(p.id));
        selected.push(...leftovers.slice(0, extraNeeded));
      }
      return selected.slice(0, quota);
    };

    // Today: Balanced Daily Quota
    if (day === 'today') {
      const remainingFill = Math.max(0, dailyTaskLimit - completedToday.length);
      const selected = getSelectedForQuota(sortedIncomplete, remainingFill);
      return [...completedToday, ...selected];
    }
    
    // Tomorrow: The "Next" tasks after Today's projection
    if (day === 'tomorrow') {
      const remainingTodayCount = Math.max(0, dailyTaskLimit - completedToday.length);
      const todaySelected = getSelectedForQuota(sortedIncomplete, remainingTodayCount);
      const todaySelectedIds = new Set(todaySelected.map(s => s.id));
      
      const poolForTomorrow = sortedIncomplete.filter(p => !todaySelectedIds.has(p.id));
      return getSelectedForQuota(poolForTomorrow, dailyTaskLimit);
    }

    // After Tomorrow: The batch after Tomorrow's projection
    if (day === 'after') {
      const remainingTodayCount = Math.max(0, dailyTaskLimit - completedToday.length);
      const todaySelected = getSelectedForQuota(sortedIncomplete, remainingTodayCount);
      const todaySelectedIds = new Set(todaySelected.map(s => s.id));
      
      const poolForTomorrow = sortedIncomplete.filter(p => !todaySelectedIds.has(p.id));
      const tomorrowSelected = getSelectedForQuota(poolForTomorrow, dailyTaskLimit);
      const tomorrowSelectedIds = new Set(tomorrowSelected.map(s => s.id));

      const poolForAfter = poolForTomorrow.filter(p => !tomorrowSelectedIds.has(p.id));
      return getSelectedForQuota(poolForAfter, dailyTaskLimit);
    }
    
    return sortedIncomplete.slice(0, 5);
  };

  const dayTasks = getTasksForDay(selectedDay);

  return (
    <div id="nexus-dashboard" className="space-y-8 animate-in fade-in duration-700 w-full mx-auto">
      <header className="flex justify-between items-center px-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{language === 'ar' ? 'صباح الخير، أليكس.' : 'Good Morning, Alex.'}</h1>
        </div>
        <button 
          id="focus-score-btn"
          onClick={onViewFocusIntelligence}
          className="flex items-center gap-3 glass px-4 py-2 rounded-full border-focus-border hover:bg-white/5 transition-colors"
        >
          <div className={cn(
            "w-3 h-3 rounded-full transition-all duration-500",
            focusScore > 80 ? "bg-focus-cyan glow-cyan" : focusScore > 50 ? "bg-focus-gold glow-gold" : "bg-red-400"
          )} />
          <span className="text-sm font-semibold">{t.focus_score}: {focusScore}</span>
        </button>
      </header>

      {/* Temporal Navigation */}
      <div className="flex gap-2 p-1 glass rounded-2xl">
        {(['yesterday', 'today', 'tomorrow', 'after'] as const).map((day) => {
          const count = getTasksForDay(day).length;
          return (
            <button
              key={day}
              onClick={() => setSelectedDay(day)}
              className={cn(
                "flex-1 py-2 px-3 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all relative",
                selectedDay === day 
                  ? "bg-focus-cyan text-focus-bg shadow-[0_0_15px_rgba(0,242,255,0.3)]" 
                  : "text-focus-slate hover:text-focus-text hover:bg-white/5"
              )}
            >
              <span className="relative z-10">
                {day === 'after' ? t.next_day : day === 'yesterday' ? t.yesterday : day === 'tomorrow' ? t.tomorrow : t.today}
              </span>
              {count > 0 && (
                <span className={cn(
                  "absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] border transition-colors",
                  selectedDay === day ? "bg-focus-bg text-focus-cyan border-focus-cyan" : "bg-focus-cyan text-focus-bg border-transparent"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={selectedDay}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start"
        >
          {/* Intelligence Column */}
          <div className="space-y-6 lg:sticky lg:top-0">
            {selectedDay === 'today' && (() => {
              const nextExam = [...exams]
                .filter(e => new Date(e.date).getTime() > Date.now())
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
              
              if (!nextExam) return null;
              
              const days = Math.ceil((new Date(nextExam.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              if (days > 7) return null;

              return (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-2xl bg-focus-gold/10 border border-focus-gold/30 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-focus-gold/20 flex items-center justify-center text-focus-gold">
                      <Trophy size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-focus-gold">{language === 'ar' ? 'المرحلة التالية' : 'Next Milestone'}</p>
                      <p className="text-sm font-bold text-white">{nextExam.name} {language === 'ar' ? 'خلال' : 'in'} {days} {days === 1 ? t.day_left : t.days_left}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-focus-slate">{t.readiness}</p>
                    <p className="text-sm font-mono font-bold text-focus-gold">{nextExam.confidence}%</p>
                  </div>
                </motion.div>
              );
            })()}

            {selectedDay === 'today' && (
              <GlassCard className="relative overflow-hidden group p-10 border-focus-border shadow-2xl">
                <div className="relative space-y-4">
                  <div className="flex items-center gap-2 text-focus-slate text-[11px] font-bold uppercase tracking-[2px]">
                    {language === 'ar' ? 'ملخص اليوم' : "Today's Narrative"}
                  </div>
                  <p className="text-xl lg:text-[28px] lg:leading-[1.6] leading-[1.5] text-focus-slate font-light" 
                     dangerouslySetInnerHTML={{ 
                       __html: narrative
                         .replace(/\*\*(.*?)\*\*/g, (match, p1) => {
                           const isGold = p1.toLowerCase().includes('task') || p1.toLowerCase().includes('exam');
                           return `<span class="${isGold ? 'text-focus-gold border-b-2 border-focus-gold' : 'text-focus-cyan border-b-2 border-focus-cyan'} font-semibold cursor-pointer">${p1}</span>`;
                         }) 
                     }} 
                  />
                </div>
              </GlassCard>
            )}

            {selectedDay === 'today' && (
              <div className="grid grid-cols-2 gap-4">
                <GlassCard 
                  onClick={onViewFocusIntelligence}
                  className="p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/10 transition-colors"
                >
                  <span className={cn(
                    "text-3xl font-bold",
                    focusScore > 80 ? "text-focus-cyan" : focusScore > 50 ? "text-focus-gold" : "text-red-400"
                  )}>{focusScore}</span>
                  <span className="text-[10px] uppercase tracking-widest text-focus-slate">{t.focus_score}</span>
                </GlassCard>

                <GlassCard 
                  onClick={onOpenBulkImport}
                  className="p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/10 transition-colors"
                >
                  <Upload size={20} className="text-focus-cyan" />
                  <span className="text-[10px] uppercase tracking-widest text-white">{t.bulk_import}</span>
                </GlassCard>
              </div>
            )}

            {selectedDay === 'today' && (
              <GlassCard className="p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-focus-slate">{t.time_allocation || 'Strategy Balance'}</span>
                <div className="flex gap-4">
                    <div className="flex items-center gap-1.5" title={t.foundation}>
                      <div className="w-2 h-2 rounded-full bg-focus-cyan" />
                      <span className="text-[10px] font-mono text-white">{allocation.new}%</span>
                    </div>
                    <div className="flex items-center gap-1.5" title={t.revision}>
                      <div className="w-2 h-2 rounded-full bg-focus-gold" />
                      <span className="text-[10px] font-mono text-white">{allocation.review}%</span>
                    </div>
                    <div className="flex items-center gap-1.5" title={t.solving}>
                      <div className="w-2 h-2 rounded-full bg-purple-400" />
                      <span className="text-[10px] font-mono text-white">{allocation.solving}%</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-white/5">
                  <div className="bg-focus-cyan shadow-[0_0_10px_rgba(0,242,255,0.3)] transition-all duration-1000" style={{ width: `${allocation.new}%` }} />
                  <div className="bg-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.3)] transition-all duration-1000" style={{ width: `${allocation.solving}%` }} />
                  <div className="bg-focus-gold shadow-[0_0_10px_rgba(255,215,0,0.3)] transition-all duration-1000" style={{ width: `${allocation.review}%` }} />
                </div>
              </GlassCard>
            )}
          </div>

          <section id="study-stream-section" className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">
                  {selectedDay === 'yesterday' ? t.completed_yesterday : 
                   selectedDay === 'today' ? t.priority_stream : 
                   selectedDay === 'tomorrow' ? t.planned_for : t.planned_for}
                </h2>
                {selectedDay === 'today' && (
                  <button 
                    onClick={onOpenBulkImport}
                    className="px-2 py-1 rounded-lg bg-focus-cyan/10 border border-focus-cyan/20 text-focus-cyan text-[10px] font-bold uppercase tracking-wider hover:bg-focus-cyan hover:text-focus-bg transition-all"
                  >
                    {t.bulk_import}
                  </button>
                )}
              </div>
              <button onClick={onViewAllTasks} className="text-focus-cyan text-sm font-medium">{t.view_all}</button>
            </div>
            
            <div className="space-y-6">
              {dayTasks.length > 0 ? (
                <>
                  {/* High Priority Group */}
                  {dayTasks.filter(t_task => (t_task.priorityScore || 0) > 70).length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 px-1">
                        <Zap size={12} className="text-focus-gold" />
                        <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-focus-gold">{t.critical_focus}</span>
                      </div>
                      {dayTasks.filter(t_task => (t_task.priorityScore || 0) > 70).map(task => (
                        <div key={task.id} className="flex items-center gap-4 p-4 glass rounded-xl group hover:bg-white/10 transition-colors relative overflow-hidden">
                          <div className={cn(
                            "absolute left-0 top-0 bottom-0 w-1 shadow-lg transition-all duration-500",
                            task.type === 'review' ? "bg-focus-gold shadow-[0_0_10px_rgba(255,215,0,0.4)]" : 
                            task.type === 'solving' ? "bg-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.4)]" : 
                            "bg-focus-cyan shadow-[0_0_10px_rgba(0,242,255,0.4)]"
                          )} />
                          <button onClick={() => onToggleTask(task.id)} className="text-focus-slate group-hover:text-focus-cyan">
                            {task.completed ? <CheckCircle2 size={20} className="text-focus-cyan" /> : <Circle size={20} />}
                          </button>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{task.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-[10px] text-focus-slate uppercase tracking-wider">{new Date(task.dueDate).toLocaleDateString()}</p>
                              <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 text-focus-slate font-mono">Score: {task.priorityScore}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {task.lectureId && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPartialTask(task.lectureId!);
                                }}
                                className="p-1.5 rounded-lg bg-focus-gold/10 text-focus-gold hover:bg-focus-gold hover:text-focus-bg transition-all"
                                title="Register Partial Progress"
                              >
                                <Pause size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Standard Group */}
                  {dayTasks.filter(t_task => (t_task.priorityScore || 0) <= 70).length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 px-1">
                        <Target size={12} className="text-focus-cyan" />
                        <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-focus-slate">{t.standard_stream}</span>
                      </div>
                      {dayTasks.filter(t_task => (t_task.priorityScore || 0) <= 70).map(task => (
                        <div key={task.id} className="flex items-center gap-4 p-4 glass rounded-xl group hover:bg-white/10 transition-colors relative overflow-hidden">
                          <div className={cn(
                            "absolute left-0 top-0 bottom-0 w-1 transition-all duration-500",
                            selectedDay === 'yesterday' ? "bg-green-400" : 
                            task.type === 'review' ? "bg-focus-gold" : 
                            task.type === 'solving' ? "bg-purple-400" : 
                            "bg-focus-cyan"
                          )} />
                          <button onClick={() => onToggleTask(task.id)} className={cn("transition-colors", selectedDay === 'yesterday' ? "text-green-400" : "text-focus-slate group-hover:text-focus-cyan")}>
                            {task.completed ? <CheckCircle2 size={20} className="text-focus-cyan" /> : <Circle size={20} />}
                          </button>
                          <div className="flex-1">
                            <p className={cn("text-sm font-medium", task.completed && "line-through text-focus-slate")}>{task.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-[10px] text-focus-slate uppercase tracking-wider">
                                {selectedDay === 'yesterday' ? `Completed ${new Date(task.completedDate!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : new Date(task.dueDate).toLocaleDateString()}
                              </p>
                              {selectedDay !== 'yesterday' && <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 text-focus-slate font-mono">Score: {task.priorityScore}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {task.lectureId && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPartialTask(task.lectureId!);
                                }}
                                className="p-1.5 rounded-lg bg-focus-gold/10 text-focus-gold hover:bg-focus-gold hover:text-focus-bg transition-all"
                                title="Register Partial Progress"
                              >
                                <Pause size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="py-12 text-center glass rounded-xl border-dashed border-white/10 space-y-4">
                  <div className="mx-auto w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-focus-slate">
                    <Inbox size={24} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-white">{t.empty_stream}</p>
                    <p className="text-xs text-focus-slate max-w-[200px] mx-auto">{t.empty_stream_desc}</p>
                  </div>
                  {selectedDay === 'today' && (
                    <button 
                      onClick={onOpenBulkImport}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-focus-cyan text-focus-bg text-[10px] font-bold uppercase tracking-widest hover:bg-white transition-all shadow-lg shadow-focus-cyan/20"
                    >
                      <Upload size={14} />
                      {t.import_syllabus}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </motion.div>
      </AnimatePresence>

      {selectedDay === 'today' && (
        <div className="grid grid-cols-2 gap-4">
          <GlassCard 
            onClick={onViewFocusIntelligence}
            className="p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/10 transition-colors"
          >
            <span className={cn(
              "text-3xl font-bold",
              focusScore > 80 ? "text-focus-cyan" : focusScore > 50 ? "text-focus-gold" : "text-red-400"
            )}>{focusScore}</span>
            <span className="text-[10px] uppercase tracking-widest text-focus-slate">{t.focus_score}</span>
          </GlassCard>
          <GlassCard className="p-4 flex flex-col items-center justify-center gap-2 relative group">
            <span className="text-3xl font-bold text-focus-gold">
              {exams.filter(e => {
                const days = (new Date(e.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                return days >= 0 && days <= 7;
              }).length}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-focus-slate">{t.milestones}</span>
            
            {/* Milestone Explanation Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 glass rounded-lg text-[8px] text-focus-slate opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center border border-white/10">
              {language === 'ar' ? 'المراحل هي الاختبارات القادمة أو المواعيد النهائية الكبرى خلال الـ 7 أيام القادمة.' : 'Milestones are upcoming exams or major deadlines within the next 7 days.'}
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
};

const PriorityBreakdown = ({ lecture, weights, t, language }: { 
  lecture: Lecture, 
  weights: PriorityWeights, 
  t: any, 
  language: Language 
}) => {
  const breakdown = getCategorizedPriority(lecture, weights);
  
  return (
    <div className="glass p-4 rounded-xl space-y-3 border border-white/5">
      <div className="flex justify-between items-end">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-focus-slate">{t.focus_objective}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className={cn(
              "w-1.5 h-1.5 rounded-full",
              breakdown.category === 'new' ? "bg-focus-cyan" : breakdown.category === 'solving' ? "bg-purple-400" : "bg-focus-gold"
            )} />
            <span className="text-xs font-bold uppercase tracking-wider text-white">
              {breakdown.category === 'new' ? t.foundation : breakdown.category === 'solving' ? t.solving : t.revision}
            </span>
          </div>
        </div>
        <p className="text-2xl font-mono font-bold text-focus-cyan">{breakdown.total}</p>
      </div>
      <div className="space-y-2 pt-2 border-t border-white/5">
        {[
          { item: breakdown.component1, color: 'bg-focus-gold' },
          { item: breakdown.component2, color: 'bg-focus-cyan' },
          { item: breakdown.component3, color: 'bg-blue-400' },
        ].map(({ item, color }) => (
          <div key={item.label} className="space-y-1">
            <div className="flex justify-between text-[9px] font-mono uppercase tracking-wider">
              <span className="text-focus-slate">
                {item.label === 'Difficulty' ? t.difficulty : 
                 item.label === 'Size' ? t.size : 
                 item.label === 'Recency' ? t.recency : 
                 item.label === 'Mastery' ? t.mastery : 
                 item.label === 'Reviews' ? t.reviews : 
                 item.label === 'Staleness' ? t.staleness : 
                 item.label === 'Accuracy' ? t.accuracy : 
                 item.label === 'Complexity' ? t.complexity : 
                 item.label === 'Gap Time' ? t.gap_time : item.label}
              </span>
              <span className="text-white">{Math.round(item.score)}</span>
            </div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div 
                className={cn("h-full rounded-full transition-all duration-500", color)} 
                style={{ width: `${Math.min(100, item.score * 2.5)}%` }} 
              />
            </div>
          </div>
        ))}
        {breakdown.modifiers > 0 && (
          <div className="flex justify-between text-[9px] font-mono uppercase tracking-wider pt-1">
            <span className="text-focus-slate">{language === 'ar' ? 'مكافأة الزخم' : 'Momentum Bonus'}</span>
            <span className="text-focus-cyan">+{breakdown.modifiers}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const LectureIntelligenceForm = ({ 
  lecture, 
  subjects, 
  lectures,
  exams,
  weights,
  onSave, 
  onDelete,
  t,
  language
}: { 
  lecture: Lecture, 
  subjects: Subject[], 
  lectures: Lecture[],
  exams: Exam[],
  weights: PriorityWeights,
  onSave: (updated: Lecture) => void, 
  onDelete: (id: string) => void,
  t: any,
  language: Language
}) => {
  const [formData, setFormData] = useState<Lecture>(lecture);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let val: string | number = value;
    if (type === 'number' || type === 'range') {
      const parsed = parseFloat(value);
      val = isFinite(parsed) ? parsed : 0;
    }
    
    setFormData(prev => {
      const next = { ...prev, [name]: val };
      
      // If studyCount increased, it means a session just happened
      if (name === 'studyCount' && (val as number) > prev.studyCount) {
        next.lastReviewDate = new Date().toISOString();
      }
      if (name === 'practiceCount' && (val as number) > prev.practiceCount) {
        next.lastPracticeDate = new Date().toISOString();
        next.practiceDone = true;
      }
      
      return next;
    });
  };

  const adjustCount = (field: 'studyCount' | 'practiceCount', delta: number) => {
    setFormData(prev => {
      const current = (prev[field] as number) || 0;
      const newVal = Math.max(0, current + delta);
      const next = { ...prev, [field]: newVal };
      
      const currentProgress = prev.progress || 0;
      
      if (delta > 0) {
        if (field === 'studyCount') {
          next.lastReviewDate = new Date().toISOString();
          if (next.studyCount === 1 && currentProgress < 0.25) next.progress = 0.25;
        }
        if (field === 'practiceCount') {
          next.lastPracticeDate = new Date().toISOString();
          next.practiceDone = true;
          if (currentProgress < 0.5) next.progress = 0.5;
        }
      }
      return next;
    });
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave(formData);
    }} className="space-y-6">
      <PriorityBreakdown lecture={formData} weights={weights} t={t} language={language} />

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">{t.topic_title}</label>
          <input 
            name="title" 
            type="text" 
            value={formData.title} 
            onChange={handleChange}
            required 
            className="w-full glass border-focus-border rounded-xl p-3 text-sm focus:ring-1 focus:ring-focus-cyan outline-none" 
          />
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">{t.subject_category}</label>
            <select 
              name="subjectId" 
              value={formData.subjectId} 
              onChange={handleChange}
              className="w-full bg-focus-bg border border-focus-border rounded-xl p-3 text-sm text-white outline-none"
            >
              {subjects.map(s => (
                <option key={s.id} value={s.id} className="bg-focus-bg text-white">{s.name}</option>
              ))}
            </select>
          </div>
          <div className="relative group">
            <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">Date</label>
            <div className="relative h-[46px]">
              {/* Display Layer */}
              <div className="absolute inset-0 glass border flex items-center justify-between px-4 border-focus-border rounded-xl pointer-events-none group-hover:bg-white/5 transition-colors">
                <span className={formData.date ? "text-white text-sm" : "text-focus-slate text-sm"}>
                  {formData.date ? new Date(formData.date).toLocaleDateString() : t.select_date}
                </span>
                <Calendar className="w-4 h-4 text-focus-cyan" />
              </div>
              {/* Hidden Native Trigger */}
              <input 
                name="date" 
                type="date" 
                value={formData.date} 
                onChange={handleChange}
                onKeyDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  try {
                    (e.currentTarget as any).showPicker?.();
                  } catch (err) {}
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-4">
            <div className="p-4 glass rounded-xl border border-white/5 space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-focus-slate">{t.activity_tracking}</p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-focus-cyan">
                    <span>{t.revision || 'Revision'}</span>
                    <span>{formData.studyCount}</span>
                  </div>
                  <div className="flex gap-1">
                    <button 
                      type="button" 
                      onClick={() => adjustCount('studyCount', -1)}
                      className="flex-1 glass border-white/5 py-2 rounded-lg text-xs hover:bg-white/10"
                    >
                      -1
                    </button>
                    <button 
                      type="button" 
                      onClick={() => adjustCount('studyCount', 1)}
                      className="flex-1 bg-focus-cyan/20 border border-focus-cyan/30 text-focus-cyan py-2 rounded-lg text-xs hover:bg-focus-cyan/30"
                    >
                      +1
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-focus-gold">
                    <span>{t.solving || 'Practice'}</span>
                    <span>{formData.practiceCount}</span>
                  </div>
                  <div className="flex gap-1">
                    <button 
                      type="button" 
                      onClick={() => adjustCount('practiceCount', -1)}
                      className="flex-1 glass border-white/5 py-2 rounded-lg text-xs hover:bg-white/10"
                    >
                      -1
                    </button>
                    <button 
                      type="button" 
                      onClick={() => adjustCount('practiceCount', 1)}
                      className="flex-1 bg-focus-gold/20 border border-focus-gold/30 text-focus-gold py-2 rounded-lg text-xs hover:bg-focus-gold/30"
                    >
                      +1
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">{t.page_count}</label>
              <input 
                name="pageCount" 
                type="number" 
                value={formData.pageCount} 
                onChange={handleChange}
                required 
                className="w-full glass border-focus-border rounded-xl p-3 text-sm outline-none" 
              />
            </div>
          </div>
          <div className="flex flex-col justify-end">
            <div className="p-4 glass rounded-xl border border-white/5 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-focus-slate">{t.quick_actions}</p>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ 
                  ...prev, 
                  progress: 1,
                  lastReviewDate: new Date().toISOString()
                }))}
                className={cn(
                  "w-full flex items-center justify-center gap-2 p-2 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all",
                  formData.progress === 1 
                    ? "bg-focus-cyan/10 border-focus-cyan text-focus-cyan" 
                    : "bg-white/5 border-white/5 text-focus-slate hover:bg-white/10"
                )}
              >
                <CheckCircle2 size={12} />
                {t.mark_mastered}
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2 flex justify-between">
            Progress <span className="text-focus-gold font-mono">{Math.round((isFinite(formData.progress) ? formData.progress : 0) * 100)}%</span>
          </label>
          <input 
            name="progress" 
            type="range" 
            min="0" 
            max="1" 
            step="0.05" 
            value={formData.progress} 
            onChange={handleChange}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-focus-gold" 
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2 flex justify-between">
            Difficulty <span className="text-focus-cyan font-mono">{formData.difficulty.toFixed(1)}</span>
          </label>
          <input 
            name="difficulty" 
            type="range" 
            min="0.1" 
            max="1.0" 
            step="0.1" 
            value={formData.difficulty} 
            onChange={handleChange}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-focus-cyan" 
          />
          <div className="flex justify-between text-[8px] text-focus-slate mt-1 uppercase tracking-widest">
            <span>Easy</span>
            <span>Hard</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">Self-Exam Score (%)</label>
          <input 
            name="selfExamScore" 
            type="number" 
            min="0" 
            max="100" 
            value={formData.selfExamScore || ''} 
            onChange={handleChange}
            className="w-full glass border-focus-border rounded-xl p-3 text-sm outline-none" 
            placeholder="Not tested" 
          />
        </div>
      </div>

      <div className="flex items-center justify-between p-3 glass rounded-xl border border-focus-gold/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-focus-gold/10 flex items-center justify-center text-focus-gold">
            <History size={16} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white">Partial Sessions</p>
            <p className="text-[10px] text-focus-slate">{(isFinite(formData.abandonedSessionsCount) ? formData.abandonedSessionsCount : 0)} registered</p>
          </div>
        </div>
        <button 
          type="button"
          onClick={() => setFormData(prev => ({ 
            ...prev, 
            abandonedSessionsCount: prev.abandonedSessionsCount + 1, 
            lastReviewDate: new Date().toISOString() // Reset decay because we just studied
          }))}
          className="px-3 py-1.5 rounded-lg bg-focus-gold text-focus-bg text-[10px] font-bold uppercase tracking-widest hover:bg-white transition-colors"
        >
          + Register
        </button>
      </div>

      <div className="flex gap-3 pt-4">
        <button 
          type="button"
          onClick={() => onDelete(formData.id)}
          className="flex-1 bg-red-500/10 text-red-500 py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-red-500 hover:text-white transition-colors"
        >
          Delete
        </button>
        <button 
          type="submit" 
          className="flex-[2] bg-focus-cyan text-focus-bg py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-white transition-colors shadow-[0_8px_24px_rgba(0,242,255,0.2)]"
        >
          Save Intelligence
        </button>
      </div>
    </form>
  );
};

const LibraryScreen = ({ 
  subjects, 
  lectures, 
  exams,
  weights,
  onAddSubject, 
  onAddLecture, 
  onEditLecture,
  onEditSubject,
  onBulkUpdateLectures,
  t,
  language
}: { 
  subjects: Subject[], 
  lectures: Lecture[], 
  exams: Exam[],
  weights: PriorityWeights,
  onAddSubject: () => void, 
  onAddLecture: () => void, 
  onEditLecture: (lecture: Lecture) => void,
  onEditSubject: (subject: Subject) => void,
  onBulkUpdateLectures: (ids: string[], updates: Partial<Lecture>) => void,
  t: any,
  language: Language
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'unstudied' | 'unpracticed'>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLectureIds, setSelectedLectureIds] = useState<string[]>([]);

  const filteredSubjects = subjects.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lectures.some(l => l.subjectId === s.id && l.title.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredLectures = lectures.filter(l => {
    const matchesSearch = l.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         subjects.find(s => s.id === l.subjectId)?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSubject = selectedSubjectId ? l.subjectId === selectedSubjectId : true;
    const matchesTab = 
      activeTab === 'all' ? true :
      activeTab === 'unstudied' ? (l.studyCount || 0) === 0 :
      (l.practiceCount || 0) === 0 && (l.studyCount || 0) > 0;
    
    return matchesSearch && matchesSubject && matchesTab;
  });

  const toggleLectureSelection = (id: string, e?: React.MouseEvent) => {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    setSelectedLectureIds(prev => 
      prev.includes(id) ? prev.filter(lid => lid !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    setSelectedLectureIds(filteredLectures.map(l => l.id));
  };

  const handleBulkStudied = () => {
    onBulkUpdateLectures(selectedLectureIds, { 
      studyCount: 1, 
      lastReviewDate: new Date().toISOString(),
      progress: 0.25 
    });
    setSelectedLectureIds([]);
    setSelectionMode(false);
  };

  const handleBulkPracticed = () => {
    onBulkUpdateLectures(selectedLectureIds, { 
      practiceCount: 1, 
      practiceDone: true,
      lastPracticeDate: new Date().toISOString(),
      progress: 0.5 
    });
    setSelectedLectureIds([]);
    setSelectionMode(false);
  };

  return (
    <div id="library-screen" className="space-y-8 animate-in slide-in-from-right duration-500 pb-24">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{t.study_library}</h1>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => {
              setSelectionMode(!selectionMode);
              setSelectedLectureIds([]);
            }}
            className={cn(
              "w-10 h-10 rounded-xl border transition-all flex items-center justify-center",
              selectionMode ? "bg-focus-cyan text-black border-focus-cyan" : "glass border-white/10 text-focus-slate hover:text-white"
            )}
            title={language === 'ar' ? 'تعديل جماعي' : 'Bulk Edit'}
          >
            <CheckSquare size={18} />
          </button>
          <button 
            id="add-subject-btn"
            onClick={onAddSubject} 
            className="w-10 h-10 rounded-xl glass border border-white/10 flex items-center justify-center text-focus-cyan hover:bg-focus-cyan/10 transition-all"
          >
            <Plus size={20} />
          </button>
          <button 
            id="add-topic-btn"
            onClick={onAddLecture} 
            className="h-10 px-4 rounded-xl bg-focus-cyan text-focus-bg text-xs font-bold uppercase tracking-widest hover:bg-white transition-all shadow-[0_8px_20px_rgba(0,242,255,0.15)]"
          >
            {t.new_topic}
          </button>
        </div>
      </header>

      {/* Library Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {(['all', 'unstudied', 'unpracticed'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "whitespace-nowrap px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all",
              activeTab === tab 
                ? "bg-white text-black shadow-lg" 
                : "glass text-focus-slate hover:text-white"
            )}
          >
            {tab === 'all' ? (language === 'ar' ? 'الكل' : 'All') : 
             tab === 'unstudied' ? (language === 'ar' ? 'غير مدروس' : 'Unstudied') : 
             (language === 'ar' ? 'غير متدرب' : 'Unpracticed')}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="relative group">
        <div className="absolute inset-0 bg-focus-cyan/5 blur-xl rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-focus-slate group-focus-within:text-focus-cyan transition-colors" size={20} />
        <input 
          type="text" 
          placeholder={t.search_placeholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full glass border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm focus:border-focus-cyan/50 outline-none transition-all placeholder:text-focus-slate/50"
        />
      </div>

      {/* Subject Cards Grid */}
      <div className="space-y-4">
        <div className="flex justify-between items-center px-1">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-focus-slate">{t.dashboard.includes('لوحة') ? 'المواد' : 'Subjects'}</h2>
          <span className="text-[10px] font-mono text-focus-slate">{subjects.length} {t.dashboard.includes('لوحة') ? 'الإجمالي' : 'Total'}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <button 
            onClick={onAddSubject}
            className="glass p-4 rounded-2xl border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-focus-slate hover:text-focus-cyan hover:bg-white/5 transition-all min-h-[140px]"
          >
            <Plus size={24} />
            <span className="text-xs font-medium">{t.new_subject}</span>
          </button>
          {filteredSubjects.map(subject => {
            const subjectLectures = lectures.filter(l => l.subjectId === subject.id);
            const totalProgress = subjectLectures.reduce((acc, l) => acc + (isFinite(l.progress) ? l.progress : 0), 0);
            const progress = subjectLectures.length > 0 ? (totalProgress / subjectLectures.length) : 0;
            const isSelected = selectedSubjectId === subject.id;
            
            return (
              <div 
                key={subject.id} 
                onClick={() => setSelectedSubjectId(isSelected ? null : subject.id)}
                className={cn(
                  "relative p-4 rounded-2xl cursor-pointer transition-all duration-300 border group overflow-hidden",
                  isSelected 
                    ? "bg-white/[0.05] border-white/20 shadow-lg" 
                    : "glass border-white/5 hover:border-white/10 hover:bg-white/[0.02]"
                )}
              >
                {/* Background Accent */}
                <div 
                  className="absolute top-0 right-0 w-24 h-24 blur-[40px] opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none"
                  style={{ backgroundColor: subject.color }}
                />
                
                <div className="flex justify-between items-start relative z-10">
                  <div 
                    className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                    style={{ backgroundColor: `${subject.color}20`, border: `1px solid ${subject.color}40` }}
                  >
                    <BookOpen size={18} style={{ color: subject.color }} />
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onEditSubject(subject); }}
                    className="p-1.5 text-focus-slate hover:text-white transition-colors"
                  >
                    <Plus size={14} className="rotate-45" />
                  </button>
                </div>

                <div className="mt-4 relative z-10">
                  <h3 className="text-sm font-bold text-white group-hover:text-focus-cyan transition-colors truncate">{subject.name}</h3>
                  <p className="text-[10px] font-mono text-focus-slate mt-0.5">
                    {subjectLectures.length} {t.total_lectures}
                  </p>
                </div>

                {/* Progress Section */}
                <div className="mt-4 space-y-1.5 relative z-10">
                  <div className="flex justify-between text-[8px] font-bold uppercase tracking-widest text-focus-slate">
                    <span>{t.mastery}</span>
                    <span className="text-white">{Math.round(progress * 100)}%</span>
                  </div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-1000 ease-out" 
                      style={{ width: `${progress * 100}%`, backgroundColor: subject.color }} 
                    />
                  </div>
                </div>

                {isSelected && (
                  <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-focus-cyan animate-pulse" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Lecture Stream */}
      <div id="lecture-list-container" className="space-y-4 pt-4">
        <div className="flex justify-between items-center px-1">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-focus-slate">
            {selectedSubjectId ? `${subjects.find(s => s.id === selectedSubjectId)?.name} ${t.stream}` : t.full_stream}
          </h2>
          <span className="text-[10px] font-mono text-focus-slate">{filteredLectures.length} {t.results}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredLectures.length > 0 ? (
            filteredLectures.map(lecture => {
              const score = getLecturePriorityScore(lecture, lectures, exams, weights);
              const subject = subjects.find(s => s.id === lecture.subjectId);
              const isSelected = selectedLectureIds.includes(lecture.id);

              return (
                <GlassCard 
                  key={lecture.id} 
                  onClick={(e) => selectionMode ? toggleLectureSelection(lecture.id, e) : onEditLecture(lecture)}
                  className={cn(
                    "p-4 flex items-center justify-between group cursor-pointer transition-all border",
                    isSelected ? "bg-focus-cyan/10 border-focus-cyan/40" : "hover:bg-white/10 border-white/5 hover:border-white/20"
                  )}
                >
                  <div className="flex items-center gap-4 overflow-hidden">
                    {selectionMode && (
                      <button 
                        onClick={(e) => toggleLectureSelection(lecture.id, e)}
                        className={cn(
                          "shrink-0 p-1 transition-colors",
                          isSelected ? "text-focus-cyan" : "text-white/10"
                        )}
                      >
                        {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                      </button>
                    )}
                    <div 
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${subject?.color}10`, border: `1px solid ${subject?.color}20` }}
                    >
                      <BookOpen size={18} style={{ color: subject?.color }} />
                    </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-white truncate group-hover:text-focus-cyan transition-colors">{lecture.title}</h3>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: subject?.color }}>{subject?.name}</span>
                          <span className="text-[10px] text-focus-slate font-mono">{lecture.pageCount}{language === 'ar' ? 'ص' : 'p'} • {new Date(lecture.date).toLocaleDateString(language === 'ar' ? 'ar-EG' : undefined, { month: 'short', day: 'numeric' })}</span>
                            <div className="flex items-center gap-2 ml-1">
                              <div className="flex items-center gap-0.5" title={t.revision}>
                                <History size={10} className="text-focus-gold" />
                                <span className="text-[10px] font-mono text-focus-gold">{lecture.studyCount || 0}</span>
                              </div>
                              <div className="flex items-center gap-0.5" title={t.solving}>
                                <Target size={10} className="text-purple-400" />
                                <span className="text-[10px] font-mono text-purple-400">{lecture.practiceCount || 0}</span>
                              </div>
                            </div>
                        </div>
                      </div>
                  </div>
                  
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-[8px] uppercase tracking-widest text-focus-slate">{t.priority}</p>
                      <p className={cn(
                        "text-xs font-mono font-bold",
                        score > 70 ? "text-red-400" : score > 40 ? "text-focus-gold" : "text-focus-cyan"
                      )}>
                        {score}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-focus-slate group-hover:text-white group-hover:translate-x-1 transition-all" />
                  </div>
                </GlassCard>
              );
            })
          ) : (
            <div className="py-20 text-center glass rounded-3xl border-dashed border-white/10">
              <Search size={40} className="mx-auto text-white/5 mb-4" />
              <p className="text-focus-slate text-sm">No lectures found.</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Bulk Action Bar */}
      <AnimatePresence>
        {selectionMode && selectedLectureIds.length > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-24px)] max-w-lg"
          >
            <div className="glass p-4 rounded-2xl border border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-focus-cyan">
                  {selectedLectureIds.length} {language === 'ar' ? 'تم اختيارها' : 'Selected'}
                </span>
                <button 
                  onClick={selectAll} 
                  className="text-[10px] text-white/40 hover:text-white transition-colors text-left"
                >
                  {language === 'ar' ? 'اختيار الكل بالتبويب' : 'Select all in tab'}
                </button>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={handleBulkStudied}
                  className="px-3 py-2 rounded-xl bg-white text-black text-[10px] font-bold uppercase tracking-wider hover:bg-focus-cyan transition-colors"
                >
                  {language === 'ar' ? 'تمت الدراسة' : 'Mark Studied'}
                </button>
                <button 
                  onClick={handleBulkPracticed}
                  className="px-3 py-2 rounded-xl bg-focus-gold text-black text-[10px] font-bold uppercase tracking-wider hover:bg-yellow-400 transition-colors"
                >
                  {language === 'ar' ? 'تم التدريب' : 'Mark Practiced'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ExamHub = ({ 
  exams, 
  lectures, 
  onAddExam, 
  onEditExam,
  onUpdateExam,
  onEditLecture,
  t,
  language
}: { 
  exams: Exam[], 
  lectures: Lecture[],
  onAddExam: () => void,
  onEditExam: (exam: Exam) => void,
  onUpdateExam: (exam: Exam) => void,
  onEditLecture: (lecture: Lecture) => void,
  t: any,
  language: Language
}) => {
  return (
    <div id="exam-hub-screen" className="space-y-8 animate-in slide-in-from-bottom duration-500 pb-20">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.exam_hub}</h1>
          <p className="text-focus-slate text-sm">{t.active_missions}</p>
        </div>
        <button 
          id="add-exam-btn"
          onClick={onAddExam}
          className="w-10 h-10 rounded-full glass border-white/10 flex items-center justify-center text-focus-cyan hover:bg-focus-cyan hover:text-focus-bg transition-all"
        >
          <Plus size={20} />
        </button>
      </header>

      {exams.length > 0 ? (
        exams.map(exam => {
          const linkedLectures = lectures.filter(l => exam.linkedLectureIds.includes(l.id));
          const totalProgress = linkedLectures.reduce((acc, l) => acc + (isFinite(l.progress) ? l.progress : 0), 0);
          const readiness = linkedLectures.length > 0 
            ? Math.round((totalProgress / linkedLectures.length) * 100)
            : 0;
          
          const studyFocus = [...linkedLectures].sort((a, b) => a.progress - b.progress)[0];
          const examTime = new Date(exam.date).getTime();
          const daysRemaining = isNaN(examTime) ? 0 : Math.ceil((examTime - Date.now()) / (1000 * 60 * 60 * 24));

          return (
            <div key={exam.id} className="space-y-6">
              <GlassCard className="relative overflow-hidden p-8 border-focus-border shadow-xl">
                <div className="absolute inset-0 bg-gradient-to-b from-focus-cyan/5 to-transparent pointer-events-none" />
                
                <div className="flex justify-between items-start relative z-10">
                  <div className="text-left space-y-1">
                    <h2 className="text-2xl font-bold">{exam.name}</h2>
                    <p className={cn(
                      "text-sm font-medium",
                      daysRemaining < 3 ? "text-red-400" : daysRemaining < 7 ? "text-focus-gold" : "text-focus-cyan"
                    )}>
                      {daysRemaining <= 0 ? (language === 'ar' ? 'يوم الامتحان' : "Exam Day") : `${daysRemaining} ${t.days_left}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => onEditExam(exam)}
                      className="p-2 rounded-lg bg-white/5 text-focus-slate hover:text-white transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mt-8">
                  <div className="relative w-32 h-32 mx-auto">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                      <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" 
                        strokeDasharray={364} strokeDashoffset={364 - (364 * exam.confidence) / 100}
                        className="text-focus-cyan transition-all duration-1000 ease-out" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold">{exam.confidence}%</span>
                      <span className="text-[8px] uppercase tracking-widest text-focus-slate">{t.confidence}</span>
                    </div>
                  </div>

                  <div className="flex flex-col justify-center space-y-4">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-focus-slate">
                        <span>Readiness</span>
                        <span className="text-focus-cyan">{readiness}%</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-focus-cyan rounded-full transition-all duration-1000" 
                          style={{ width: `${readiness}%` }} 
                        />
                      </div>
                    </div>

                    <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                      <p className="text-[8px] uppercase tracking-widest text-focus-slate mb-1">Study Focus</p>
                      {studyFocus ? (
                        <p className="text-xs font-medium truncate">{studyFocus.title}</p>
                      ) : (
                        <p className="text-xs text-focus-slate italic">{t.no_lectures_linked}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-white/5">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-focus-slate mb-3 text-left">{t.update_confidence}</label>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={exam.confidence} 
                    onChange={(e) => onUpdateExam({ ...exam, confidence: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-focus-cyan" 
                  />
                </div>
              </GlassCard>

              <section className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-focus-slate">{t.required_knowledge}</h3>
                  <span className="text-[10px] font-mono text-focus-slate">{linkedLectures.length} {t.lectures_plural}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {linkedLectures.length > 0 ? (
                    linkedLectures.map(lecture => (
                      <GlassCard 
                        key={lecture.id} 
                        onClick={() => onEditLecture(lecture)}
                        className="p-4 flex items-center justify-between group hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-focus-cyan/10 transition-colors">
                            <BookOpen size={16} className="text-focus-cyan" />
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-medium">{lecture.title}</p>
                            <p className="text-[10px] text-focus-slate font-mono">{Math.round((isFinite(lecture.progress) ? lecture.progress : 0) * 100)}% {t.mastered}</p>
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          <div className="flex items-center gap-1">
                            <History size={8} className="text-focus-cyan" />
                            <span className="text-[8px] font-mono text-focus-cyan">{lecture.studyCount || 0}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Target size={8} className="text-focus-gold" />
                            <span className="text-[8px] font-mono text-focus-gold">{lecture.practiceCount || 0}</span>
                          </div>
                        </div>
                      </GlassCard>
                    ))
                  ) : (
                    <div className="p-8 text-center glass rounded-2xl border-dashed border-white/10">
                      <AlertCircle size={24} className="mx-auto text-focus-slate mb-2" />
                      <p className="text-xs text-focus-slate">{t.no_exam_lectures}</p>
                      <button 
                        onClick={() => onEditExam(exam)}
                        className="mt-3 text-[10px] font-bold uppercase tracking-widest text-focus-cyan hover:underline"
                      >
                        {t.link_lectures}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            </div>
          );
        })
      ) : (
        <div className="py-20 text-center glass rounded-3xl border-dashed border-white/10">
          <Target size={48} className="mx-auto text-white/5 mb-4" />
          <p className="text-focus-slate text-sm mb-4">{t.no_exams_yet}</p>
          <button 
            onClick={onAddExam}
            className="px-6 py-3 bg-focus-cyan text-focus-bg rounded-xl font-bold uppercase tracking-widest text-xs"
          >
            {t.add_first_exam}
          </button>
        </div>
      )}
    </div>
  );
};

const ExamForm = ({ 
  exam, 
  lectures, 
  onSave, 
  onDelete,
  t,
  language
}: { 
  exam: Exam, 
  lectures: Lecture[],
  onSave: (updated: Exam) => void, 
  onDelete: (id: string) => void,
  t: any,
  language: Language
}) => {
  const [formData, setFormData] = useState<Exam>(exam);

  const toggleLecture = (lectureId: string) => {
    setFormData(prev => {
      const linked = prev.linkedLectureIds.includes(lectureId)
        ? prev.linkedLectureIds.filter(id => id !== lectureId)
        : [...prev.linkedLectureIds, lectureId];
      return { ...prev, linkedLectureIds: linked };
    });
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave(formData);
    }} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">{t.exam_name}</label>
          <input 
            type="text" 
            value={formData.name} 
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required 
            className="w-full glass border-focus-border rounded-xl p-3 text-sm focus:ring-1 focus:ring-focus-cyan outline-none" 
          />
        </div>
        
        <div className="relative group">
          <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">{t.exam_date}</label>
          <div className="relative h-[46px]">
            {/* Display Layer */}
            <div className="absolute inset-0 glass border flex items-center justify-between px-4 border-focus-border rounded-xl pointer-events-none group-hover:bg-white/5 transition-colors">
              <span className={formData.date ? "text-white text-sm" : "text-focus-slate text-sm"}>
                {formData.date ? new Date(formData.date).toLocaleDateString(language === 'ar' ? 'ar-EG' : undefined) : t.select_date}
              </span>
              <Calendar className="w-4 h-4 text-focus-gold" />
            </div>
            {/* Hidden Native Trigger */}
            <input 
              type="date" 
              value={formData.date.split('T')[0]} 
              onChange={(e) => setFormData({ ...formData, date: new Date(e.target.value).toISOString() })}
              onKeyDown={(e) => e.preventDefault()}
              onClick={(e) => {
                try {
                  (e.currentTarget as any).showPicker?.();
                } catch (err) {}
              }}
              required
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2 flex justify-between">
            {t.confidence} <span className="text-focus-cyan font-mono">{formData.confidence}%</span>
          </label>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={formData.confidence} 
            onChange={(e) => setFormData({ ...formData, confidence: parseInt(e.target.value) })}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-focus-cyan" 
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-4">{t.link_lectures}</label>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
            {lectures.map(lecture => (
              <button
                key={lecture.id}
                type="button"
                onClick={() => toggleLecture(lecture.id)}
                className={cn(
                  "w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left",
                  formData.linkedLectureIds.includes(lecture.id)
                    ? "bg-focus-cyan/10 border-focus-cyan text-focus-cyan"
                    : "bg-white/5 border-white/5 text-focus-slate hover:bg-white/10"
                )}
              >
                <span className="text-xs font-medium truncate">{lecture.title}</span>
                {formData.linkedLectureIds.includes(lecture.id) && <CheckCircle2 size={14} />}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-4">
        <button 
          type="button"
          onClick={() => onDelete(formData.id)}
          className="flex-1 bg-red-500/10 text-red-500 py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-red-500 hover:text-white transition-colors"
        >
          {t.delete}
        </button>
        <button 
          type="submit" 
          className="flex-[2] bg-focus-cyan text-focus-bg py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-white transition-colors shadow-[0_8px_24px_rgba(0,242,255,0.2)]"
        >
          {t.save_exam}
        </button>
      </div>
    </form>
  );
};

const Roadmap = ({ exams, tasks, lectures, t, language }: { 
  exams: Exam[], 
  tasks: Task[], 
  lectures: Lecture[],
  t: any,
  language: Language
}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Strictly focuses on Major Strategic Milestones (Exams)
  const roadmapItems = [
    ...exams.map(e => ({ type: 'exam', date: new Date(e.date), title: e.name, id: e.id })),
  ].filter(item => item.date.getTime() >= today.getTime())
   .sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <div id="roadmap-screen" className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t.roadmap}</h1>
        <p className="text-focus-slate text-sm">{t.roadmap_journey}</p>
      </header>

      <div className="relative min-h-[600px] py-10 px-4 md:px-0">
        {/* The Winding Path SVG */}
        <div className="absolute left-6 md:left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-focus-cyan via-focus-gold to-transparent opacity-20" />
        
        <div className="space-y-12 md:space-y-16 relative">
          {/* Today */}
          <div className="flex items-center md:justify-center relative">
            <div className="absolute left-6 md:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-focus-bg border-2 border-focus-cyan glow-cyan z-10" />
            <div className="ml-14 md:ml-40 glass p-4 rounded-2xl text-xs w-full md:w-48 border-focus-cyan/30">
              <p className="font-bold text-focus-cyan uppercase tracking-widest text-[10px] mb-1">{t.today}</p>
              <p className="text-white font-medium">{language === 'ar' ? 'فترة التركيز النشطة' : 'Active Focus Period'}</p>
              <p className="text-focus-slate mt-1 italic">"{language === 'ar' ? 'أفضل وقت للدراسة هو الآن.' : 'The best time to study is now.'}"</p>
            </div>
          </div>

          {roadmapItems.length > 0 ? (
            roadmapItems.map((item, index) => {
              const daysAway = Math.ceil((item.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              const isLeft = index % 2 === 0;
              
              return (
                <div key={`${item.type}-${item.id}`} className="flex items-center md:justify-center relative">
                  <motion.div 
                    initial={{ scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    className={cn(
                      "absolute left-6 md:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-focus-bg border-2 z-10",
                      item.type === 'exam' ? "border-focus-gold glow-gold" : "border-focus-cyan/50"
                    )}
                  />
                  
                  <div className={cn(
                    "glass p-4 rounded-2xl text-xs w-full md:w-48 border-white/5 transition-all hover:border-white/20",
                    "ml-14 md:ml-0",
                    isLeft ? "md:mr-40 md:text-right" : "md:ml-40 md:text-left"
                  )}>
                    <p className={cn(
                      "font-bold uppercase tracking-widest text-[10px] mb-1",
                      item.type === 'exam' ? "text-focus-gold" : "text-focus-cyan"
                    )}>
                      {daysAway === 0 ? t.today : daysAway === 1 ? t.tomorrow : `${daysAway} ${t.days_left}`}
                    </p>
                    <p className="text-white font-medium line-clamp-2">{item.title}</p>
                    <p className="text-focus-slate mt-1 font-mono text-[9px]">
                      {item.date.toLocaleDateString(language === 'ar' ? 'ar-EG' : undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex items-center md:justify-center relative">
              <div className="absolute left-6 md:left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white/10 z-10" />
              <div className="ml-14 md:ml-40 glass p-4 rounded-2xl text-xs w-full md:w-48 border-white/5">
                <p className="text-focus-slate italic">{t.upcoming_events}</p>
              </div>
            </div>
          )}

          {/* End of Path */}
          <div className="flex items-center md:justify-center relative pt-10">
            <div className="w-2 h-2 rounded-full bg-white/5 ml-6 md:ml-0" />
          </div>
        </div>
      </div>
    </div>
  );
};

const PriorityEngine = ({ 
  weights, 
  onWeightChange,
  allocation,
  onAllocationChange,
  profiles,
  onSaveProfile,
  onLoadProfile,
  onDeleteProfile,
  onRenameProfile,
  isAIEnabled,
  onToggleAI,
  dailyTaskLimit,
  onDailyTaskLimitChange,
  language,
  onLanguageChange,
  onOpenTutorial,
  t
}: { 
  weights: PriorityWeights, 
  onWeightChange: (key: keyof PriorityWeights, val: number) => void,
  allocation: DailyAllocation,
  onAllocationChange: (key: keyof DailyAllocation, val: number) => void,
  profiles: { name: string, weights: PriorityWeights }[],
  onSaveProfile: (name: string) => void,
  onLoadProfile: (weights: PriorityWeights, name: string) => void,
  onDeleteProfile: (name: string) => void,
  onRenameProfile: (oldName: string, newName: string) => void,
  isAIEnabled: boolean,
  onToggleAI: (val: boolean) => void,
  dailyTaskLimit: number,
  onDailyTaskLimitChange: (val: number) => void,
  language: Language,
  onLanguageChange: (val: Language) => void,
  onOpenTutorial: () => void,
  t: any
}) => {
  const factorGroups = [
    {
      title: t.foundation,
      factors: [
        { key: 'newDifficulty', label: `${t.difficulty} (S)`, description: t.tech_desc, icon: Target, color: 'text-focus-cyan' },
        { key: 'newSize', label: `${t.size} (C)`, description: t.page_desc, icon: LayoutDashboard, color: 'text-focus-cyan' },
        { key: 'newRecency', label: `${t.recency} (T)`, description: t.time_desc, icon: Clock, color: 'text-focus-cyan' },
      ]
    },
    {
      title: t.solving,
      factors: [
        { key: 'solvingAccuracy', label: `${t.accuracy} (A)`, description: t.solver_desc, icon: Trophy, color: 'text-purple-400' },
        { key: 'solvingDifficulty', label: `${t.complexity} (S)`, description: t.boost_desc, icon: Zap, color: 'text-purple-400' },
        { key: 'solvingStaleness', label: t.gap_time, description: t.attempt_desc, icon: Calendar, color: 'text-purple-400' },
      ]
    },
    {
      title: t.revision,
      factors: [
        { key: 'reviewMastery', label: `${t.mastery} (M)`, description: t.mastery_desc, icon: Brain, color: 'text-focus-gold' },
        { key: 'reviewCount', label: `${t.reviews} (R)`, description: t.freq_desc, icon: History, color: 'text-focus-gold' },
        { key: 'reviewStaleness', label: t.staleness, description: t.period_desc, icon: TrendingUp, color: 'text-focus-gold' },
      ]
    }
  ] as const;

  const [newProfileName, setNewProfileName] = useState('');
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState<string | null>(null); // Current profile being renamed
  const [tempRenameValue, setTempRenameValue] = useState(""); // The actual input value
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const handleFinishRename = (oldName: string) => {
    const finalName = tempRenameValue.trim();
    if (finalName && finalName !== oldName) {
      onRenameProfile(oldName, finalName);
      setSelectedProfileName(finalName);
    }
    setRenamingName(null);
    setTempRenameValue("");
  };

  return (
    <div id="architecture-screen" className="space-y-8 animate-in slide-in-from-left duration-500 pb-24">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{t.architecture_title}</h1>
          <p className="text-focus-slate text-sm">{t.architecture_desc}</p>
        </div>
        <button 
          onClick={onOpenTutorial}
          className="w-10 h-10 rounded-xl glass border border-white/10 flex items-center justify-center text-focus-cyan hover:bg-focus-cyan/10 transition-all"
        >
          <BookOpen size={20} />
        </button>
      </header>

      {/* Daily Volume Allocation */}
      <section className="space-y-6">
        <h3 className="text-sm font-bold uppercase tracking-widest text-focus-slate">{t.task_quota}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <GlassCard className="p-6 space-y-6">
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-focus-slate">
              <span>{t.time_allocation}</span>
            </div>
            <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-white/5">
              <div className="bg-focus-cyan transition-all duration-300" style={{ width: `${allocation.new}%` }} />
              <div className="bg-purple-400 transition-all duration-300" style={{ width: `${allocation.solving}%` }} />
              <div className="bg-focus-gold transition-all duration-300" style={{ width: `${allocation.review}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              {(['new', 'solving', 'review'] as const).map(key => (
                <div key={key} className="space-y-2">
                  <div className="flex flex-col items-center gap-1 min-h-[3rem] justify-end">
                    <span className="text-[8px] font-bold uppercase text-focus-slate text-center leading-tight">
                      {key === 'new' ? t.foundation : key === 'solving' ? t.solving : t.revision}
                    </span>
                    <span className={cn(
                      "text-xs font-mono",
                      key === 'new' ? "text-focus-cyan" : key === 'solving' ? "text-purple-400" : "text-focus-gold"
                    )}>{allocation[key]}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="100" step="5"
                    value={allocation[key]}
                    onChange={(e) => onAllocationChange(key, parseInt(e.target.value))}
                    className={cn(
                      "w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer",
                      key === 'new' ? "accent-focus-cyan" : key === 'solving' ? "accent-purple-400" : "accent-focus-gold"
                    )}
                  />
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard id="daily-quota-card" className="p-6 space-y-6">
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-focus-slate">
              <span>{t.task_quota}</span>
              <span className="text-focus-cyan">{dailyTaskLimit} {t.tasks_count}</span>
            </div>
            <div className="space-y-4">
              <input 
                type="range" min="1" max="15" step="1"
                value={dailyTaskLimit}
                onChange={(e) => onDailyTaskLimitChange(parseInt(e.target.value))}
                className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-focus-cyan"
              />
              <p className="text-[10px] text-focus-slate text-center">{t.quota_hint}</p>
            </div>
          </GlassCard>
        </div>
      </section>

      {/* Rest of presets and factors */}
      <section className="space-y-6">
        <h3 className="text-sm font-bold uppercase tracking-widest text-focus-slate">{t.intelligence_presets}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {profiles.map(profile => {
            const isSelected = selectedProfileName === profile.name;
            const isRenaming = renamingName === profile.name;
            
            return (
              <div key={profile.name} className="relative group">
                <div 
                  onClick={() => {
                    if (isRenaming) return;
                    onLoadProfile(profile.weights, profile.name);
                    setSelectedProfileName(profile.name);
                    setRenamingName(null);
                    setIsConfirmingDelete(false);
                  }}
                  className={cn(
                    "w-full h-full glass p-4 rounded-xl text-left border transition-all cursor-pointer",
                    isSelected ? "border-focus-cyan ring-1 ring-focus-cyan/30" : "border-white/5 hover:border-focus-cyan/30",
                    isRenaming && "cursor-default"
                  )}
                >
                  {isRenaming ? (
                    <div className="flex items-center gap-1">
                      <input 
                        autoFocus
                        className="bg-transparent border-b border-focus-cyan text-xs font-bold text-white w-full focus:outline-none"
                        value={tempRenameValue}
                        onChange={(e) => setTempRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFinishRename(profile.name);
                          if (e.key === 'Escape') setRenamingName(null);
                        }}
                        onBlur={() => {
                          // Short delay to allow button click if needed
                          setTimeout(() => {
                            if (renamingName === profile.name) handleFinishRename(profile.name);
                          }, 150);
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFinishRename(profile.name);
                        }}
                        className="p-1 text-focus-cyan hover:text-white"
                      >
                        <Check size={12} />
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs font-bold text-white truncate">{profile.name}</p>
                  )}
                  <p className="text-[8px] text-focus-slate uppercase tracking-widest mt-1">{t.activate_model}</p>
                </div>
                {isSelected && !isRenaming && (
                  <div className="absolute -top-2 -right-2 flex gap-1 animate-in zoom-in-50 duration-200">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingName(profile.name);
                        setTempRenameValue(profile.name);
                      }}
                      className="w-6 h-6 rounded-full bg-focus-cyan text-focus-bg flex items-center justify-center hover:bg-white transition-colors shadow-lg"
                    >
                      <Edit2 size={10} />
                    </button>
                    {isConfirmingDelete ? (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteProfile(profile.name);
                          setSelectedProfileName(null);
                          setIsConfirmingDelete(false);
                        }}
                        className="h-6 px-2 rounded-full bg-red-500 text-white text-[8px] font-bold uppercase tracking-tighter flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg animate-in fade-in slide-in-from-right-2"
                      >
                        {t.delete}?
                      </button>
                    ) : (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsConfirmingDelete(true);
                        }}
                        className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Create New Preset UI - Limited to 4 */}
          {profiles.length < 4 && (
            <div className="glass p-3 rounded-xl border border-dashed border-white/10 hover:border-focus-cyan/30 transition-all flex items-center gap-2">
              <input 
                type="text"
                placeholder={t.preset_name}
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                className="flex-1 bg-transparent border-none focus:ring-0 text-[10px] text-white placeholder:text-focus-slate p-1"
              />
              <button 
                onClick={() => {
                  if (newProfileName.trim()) {
                    onSaveProfile(newProfileName);
                    setNewProfileName('');
                  }
                }}
                className="w-7 h-7 shrink-0 rounded-lg bg-focus-cyan text-focus-bg flex items-center justify-center hover:bg-white transition-all shadow-lg"
                title={t.save_preset}
              >
                <Plus size={14} />
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-12">
        {factorGroups.map(group => (
          <div key={group.title} className="space-y-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-focus-slate">{group.title}</h3>
            <GlassCard className="p-6 space-y-8">
              {group.factors.map(factor => (
                <div key={factor.key} className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <factor.icon size={16} className={factor.color} />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-white">{factor.label}</span>
                        <span className="text-[10px] text-focus-slate">{factor.description}</span>
                      </div>
                    </div>
                    <span className="text-focus-cyan font-mono text-xs">
                      {isFinite((weights as any)[factor.key]) ? (weights as any)[factor.key] : 0}%
                    </span>
                  </div>
                  <input 
                    type="range" 
                    min="0"
                    max="50"
                    value={isFinite((weights as any)[factor.key]) ? (weights as any)[factor.key] : 0} 
                    onChange={(e) => onWeightChange(factor.key as any, parseInt(e.target.value) || 0)}
                    className="w-full accent-focus-cyan" 
                  />
                </div>
              ))}
            </GlassCard>
          </div>
        ))}
      </div>

      {/* Intelligence Mode & Maintenance */}
      <section className="space-y-6 pb-24">
        <h3 className="text-sm font-bold uppercase tracking-widest text-focus-slate">{t.maintenance}</h3>
        <GlassCard className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className={cn(isAIEnabled ? "text-focus-cyan" : "text-focus-slate")} size={20} />
              <div>
                <p className="text-sm font-bold text-white">{t.intelligence_mode}</p>
                <p className="text-[10px] text-focus-slate">{t.ai_mode_hint}</p>
              </div>
            </div>
            <button 
              onClick={() => onToggleAI(!isAIEnabled)}
              className={cn(
                "w-10 h-5 rounded-full transition-all relative",
                isAIEnabled ? "bg-focus-cyan" : "bg-white/10"
              )}
            >
              <div className={cn(
                "absolute top-1 w-3 h-3 rounded-full bg-white transition-all",
                isAIEnabled ? "right-1" : "left-1"
              )} />
            </button>
          </div>

          {/* Language Selection moved to the end */}
          <div className="pt-4 border-t border-white/5 space-y-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-focus-slate">{t.language}</p>
            <div className="grid grid-cols-2 gap-3">
              {(['en', 'ar'] as const).map(lang => (
                <button
                  key={lang}
                  onClick={() => onLanguageChange(lang)}
                  className={cn(
                    "p-3 rounded-xl border transition-all text-[10px] font-bold uppercase tracking-widest",
                    language === lang ? "border-focus-cyan bg-focus-cyan/10 text-focus-cyan" : "border-white/5 text-focus-slate hover:bg-white/5"
                  )}
                >
                  {lang === 'en' ? 'English' : 'العربية'}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <button
              onClick={() => {
                if (confirm(t.reset_confirm)) {
                  localStorage.clear();
                  window.location.reload();
                }
              }}
              className="w-full p-4 rounded-xl border border-red-500/20 text-red-500 flex items-center justify-center gap-2 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={16} />
              <span className="text-[10px] font-bold uppercase tracking-widest">{t.reset_data}</span>
            </button>
          </div>
        </GlassCard>
      </section>
    </div>
  );
};

const TutorialModal = ({ isOpen, onClose, t, onTabChange, language }: { 
  isOpen: boolean, 
  onClose: () => void, 
  t: any, 
  onTabChange: (tab: string) => void,
  language: string 
}) => {
  const [step, setStep] = useState(0);
  const [highlightRect, setHighlightRect] = useState<{ top: number, left: number, width: number, height: number } | null>(null);

  const isRTL = language === 'ar';

  const steps = [
    {
      title: t.tut_nexus_title,
      desc: t.tut_nexus_desc,
      icon: Sparkles,
      color: "text-focus-cyan",
      page: t.dashboard,
      tab: 'dashboard',
      selector: '#nexus-dashboard'
    },
    {
      title: t.focus_score,
      desc: t.tut_active_focus_score,
      icon: Zap,
      color: "text-focus-gold",
      page: t.dashboard,
      tab: 'dashboard',
      selector: '#focus-score-btn'
    },
    {
      title: t.task_stream,
      desc: t.tut_active_stream,
      icon: LayoutDashboard,
      color: "text-focus-cyan",
      page: t.dashboard,
      tab: 'dashboard',
      selector: '#study-stream-section'
    },
    {
      title: "Pulse AI",
      desc: t.tut_active_click_pulse,
      icon: Sparkles,
      color: "text-focus-cyan",
      page: t.dashboard,
      tab: 'dashboard',
      selector: '#pulse-trigger-btn'
    },
    {
      title: t.tut_library_title,
      desc: t.tut_library_desc,
      icon: BookOpen,
      color: "text-focus-cyan",
      page: t.library,
      tab: 'library',
      selector: '#library-screen'
    },
    {
      title: t.tut_active_add_sub.split(':')[0],
      desc: t.tut_active_add_sub.split(':')[1]?.trim() || t.tut_active_add_sub,
      icon: Plus,
      color: "text-focus-cyan",
      page: t.library,
      tab: 'library',
      selector: '#add-subject-btn'
    },
    {
      title: t.tut_active_add_topic.split(':')[0],
      desc: t.tut_active_add_topic.split(':')[1]?.trim() || t.tut_active_add_topic,
      icon: Plus,
      color: "text-focus-cyan",
      page: t.library,
      tab: 'library',
      selector: '#add-topic-btn'
    },
    {
      title: t.tut_exams_title,
      desc: t.tut_exams_desc,
      icon: Target,
      color: "text-focus-gold",
      page: t.exam_hub,
      tab: 'exams',
      selector: '#exam-hub-screen'
    },
    {
      title: t.tut_roadmap,
      desc: t.tut_roadmap_desc,
      icon: Milestone,
      color: "text-green-400",
      page: t.roadmap,
      tab: 'roadmap',
      selector: '#roadmap-screen'
    },
    {
      title: t.tut_arch_title,
      desc: t.tut_arch_desc,
      icon: SettingsIcon,
      color: "text-focus-cyan",
      page: t.architecture,
      tab: 'settings',
      selector: '#architecture-screen'
    },
    {
      title: t.task_quota,
      desc: t.tut_active_quota,
      icon: Sliders,
      color: "text-focus-cyan",
      page: t.architecture,
      tab: 'settings',
      selector: '#daily-quota-card'
    }
  ];

  useEffect(() => {
    const update = () => {
      const el = document.querySelector(steps[step].selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        setHighlightRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        });
      }
    };

    if (isOpen) {
      onTabChange(steps[step].tab);
      
      const el = document.querySelector(steps[step].selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      window.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update, { passive: true });
      const timer = setInterval(update, 200);
      update();
      
      return () => {
        window.removeEventListener('scroll', update);
        window.removeEventListener('resize', update);
        clearInterval(timer);
      };
    }
  }, [step, isOpen]);

  if (!isOpen) return null;

  const currentStep = steps[step];

  return (
    <div className="fixed inset-0 z-[110] pointer-events-none overflow-hidden select-none" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* High-Contrast Navigator Spotlight */}
      <AnimatePresence>
        {highlightRect && step > 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute z-[111] pointer-events-none"
            style={{
              top: highlightRect.top - 8,
              left: highlightRect.left - 8,
              width: highlightRect.width + 16,
              height: highlightRect.height + 16,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.6), 0 0 20px rgba(0,242,255,0.5)',
              borderRadius: '16px',
              border: '2px solid #00f2ff'
            }}
          >
            <motion.div 
              animate={{ opacity: [1, 0, 1] }} 
              transition={{ duration: 1, repeat: Infinity }}
              className="absolute -top-10 left-1/2 -translate-x-1/2 flex flex-col items-center whitespace-nowrap"
            >
               <span className="text-[10px] font-black bg-focus-cyan text-focus-bg px-2 py-0.5 rounded mb-1 uppercase tracking-tighter">Target</span>
               <div className="w-0.5 h-4 bg-focus-cyan shadow-[0_0_8px_#00f2ff]" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Narrative Guide Interface - Responsive Positioning */}
      <div className="absolute inset-0 flex flex-col items-center justify-end md:justify-center p-4 md:p-8 pointer-events-none">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="pointer-events-auto w-full max-w-[380px] mb-4 md:mb-0 z-[112]"
          >
            <GlassCard className="p-5 border-white/20 shadow-[0_32px_64px_rgba(0,0,0,0.6)] relative overflow-hidden backdrop-blur-3xl">
              {/* Top Progress Indicator */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-white/5">
                 <motion.div 
                   initial={{ width: 0 }}
                   animate={{ width: `${((step + 1) / steps.length) * 100}%` }}
                   className={cn("h-full", currentStep.color.replace('text-', 'bg-'))}
                 />
              </div>

              <div className="flex items-center gap-3 mb-4 mt-2">
                <div className={cn("p-2 rounded-xl bg-white/5 border border-white/10 shrink-0", currentStep.color)}>
                  <currentStep.icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-base font-bold text-white truncate leading-none mb-1">{currentStep.title}</h4>
                  <p className="text-[9px] font-bold text-focus-cyan/70 uppercase tracking-widest">{currentStep.page}</p>
                </div>
                <button 
                  onClick={onClose} 
                  className="p-1 text-white/30 hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 mb-5">
                <p className="text-[13px] leading-relaxed text-slate-200">
                  {currentStep.desc}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-[10px] font-bold text-white/30 tracking-tighter">
                  {step + 1} / {steps.length}
                </span>

                <div className="flex gap-2">
                  {step > 0 && (
                    <button 
                      onClick={() => setStep(s => s - 1)}
                      className="px-4 py-2 text-[10px] font-black uppercase text-focus-slate hover:text-white"
                    >
                      {t.back}
                    </button>
                  )}
                  <button 
                    onClick={() => step < steps.length - 1 ? setStep(s => s + 1) : onClose()}
                    className="px-6 py-2.5 rounded-xl bg-white text-focus-bg text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-focus-cyan transition-all active:scale-95 flex items-center gap-2"
                  >
                    {step < steps.length - 1 ? t.next : t.close}
                    {step < steps.length - 1 && (
                      isRTL ? <ArrowLeft size={14} /> : <ArrowRight size={14} />
                    )}
                  </button>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [narrative, setNarrative] = useState("Loading your daily narrative...");
  const [isPulseOpen, setIsPulseOpen] = useState(false);
  const [pulseInput, setPulseInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAddSubjectOpen, setIsAddSubjectOpen] = useState(false);
  const [isAddLectureOpen, setIsAddLectureOpen] = useState(false);
  const [isAddExamOpen, setIsAddExamOpen] = useState(false);
  const [quickAddDate, setQuickAddDate] = useState("");
  const [isTasksModalOpen, setIsTasksModalOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [importResults, setImportResults] = useState<{type: string, title: string}[] | null>(null);
  const [isFocusModalOpen, setIsFocusModalOpen] = useState(false);
  const [isAIEnabled, setIsAIEnabled] = useState(() => {
    const saved = localStorage.getItem('focus_ai_enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [taskFilter, setTaskFilter] = useState<'active' | 'completed'>('active');
  const [taskSearch, setTaskSearch] = useState('');
  const [editingLecture, setEditingLecture] = useState<Lecture | null>(null);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('focus_language');
    return (saved as Language) || 'en';
  });

  const t = translations[language];

  // App State
  const [subjects, setSubjects] = useState<Subject[]>(() => {
    const saved = localStorage.getItem('focus_subjects');
    return saved ? JSON.parse(saved) : [];
  });
  const [lectures, setLectures] = useState<Lecture[]>(() => {
    const saved = localStorage.getItem('focus_lectures');
    const data = saved ? JSON.parse(saved) : [];
    return Array.isArray(data) ? data.map(l => ({
      ...l,
      progress: isFinite(l.progress) ? l.progress : 0,
      studyCount: isFinite(l.studyCount) ? l.studyCount : 0,
      practiceCount: isFinite(l.practiceCount) ? l.practiceCount : 0,
      difficulty: isFinite(l.difficulty) ? l.difficulty : 0.5,
      pageCount: isFinite(l.pageCount) ? l.pageCount : 0,
    })) : [];
  });
  const [exams, setExams] = useState<Exam[]>(() => {
    const saved = localStorage.getItem('focus_exams');
    return saved ? JSON.parse(saved) : [];
  });
  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem('focus_tasks');
    const data = saved ? JSON.parse(saved) : [];
    return Array.isArray(data) ? data.map(t => ({
      ...t,
      priorityScore: isFinite(t.priorityScore) ? t.priorityScore : 0
    })) : [];
  });
  const [weights, setWeights] = useState<PriorityWeights>(() => {
    const saved = localStorage.getItem('focus_weights');
    const defaultWeights = {
      newDifficulty: 35,
      newSize: 30,
      newRecency: 35,
      reviewMastery: 40,
      reviewCount: 30,
      reviewStaleness: 30,
      solvingAccuracy: 40,
      solvingDifficulty: 30,
      solvingStaleness: 30
    };
    if (!saved) return defaultWeights;
    try {
      const parsed = JSON.parse(saved);
      const sanitized: any = {};
      Object.keys(defaultWeights).forEach(key => {
        const val = parsed[key];
        sanitized[key] = isFinite(val) ? val : (defaultWeights as any)[key];
      });
      return sanitized as PriorityWeights;
    } catch (e) {
      return defaultWeights;
    }
  });
  
  const [allocation, setAllocation] = useState<DailyAllocation>(() => {
    try {
      const saved = localStorage.getItem('focus_allocation');
      const parsed = saved ? JSON.parse(saved) : null;
      return {
        new: isFinite(parsed?.new) ? parsed.new : 40,
        review: isFinite(parsed?.review) ? parsed.review : 30,
        solving: isFinite(parsed?.solving) ? parsed.solving : 30
      };
    } catch {
      return { new: 40, review: 30, solving: 30 };
    }
  });

  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);

  const [dailyTaskLimit, setDailyTaskLimit] = useState<number>(() => {
    const saved = localStorage.getItem('focus_task_limit');
    const parsed = saved ? JSON.parse(saved) : 5;
    return isFinite(parsed) ? parsed : 5;
  });

  const [profiles, setProfiles] = useState<{ name: string, weights: PriorityWeights }[]>(() => {
    const saved = localStorage.getItem('focus_profiles');
    const defaultWeights = {
      newDifficulty: 35, newSize: 30, newRecency: 35,
      reviewMastery: 40, reviewCount: 30, reviewStaleness: 30,
      solvingAccuracy: 40, solvingDifficulty: 30, solvingStaleness: 30
    };
    const defaultProfiles = [
      { name: 'Balanced', weights: defaultWeights },
      { name: 'Learning Heavy', weights: { ...defaultWeights, newDifficulty: 50, newSize: 20 } },
      { name: 'Review/Solving', weights: { ...defaultWeights, reviewMastery: 50, solvingAccuracy: 50 } }
    ];
    if (!saved) return defaultProfiles;
    try {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return defaultProfiles;
      
      return parsed.map(p => {
        const pWeights: any = {};
        Object.keys(defaultWeights).forEach(key => {
          const val = p.weights?.[key];
          pWeights[key] = isFinite(val) ? val : (defaultWeights as any)[key];
        });
        return {
          name: p.name || 'Unnamed',
          weights: pWeights as PriorityWeights
        };
      });
    } catch (e) {
      return defaultProfiles;
    }
  });

  useEffect(() => {
    localStorage.setItem('focus_subjects', JSON.stringify(subjects));
    localStorage.setItem('focus_lectures', JSON.stringify(lectures));
    localStorage.setItem('focus_exams', JSON.stringify(exams));
    localStorage.setItem('focus_tasks', JSON.stringify(tasks));
    localStorage.setItem('focus_weights', JSON.stringify(weights));
    localStorage.setItem('focus_allocation', JSON.stringify(allocation));
    localStorage.setItem('focus_task_limit', JSON.stringify(dailyTaskLimit));
    localStorage.setItem('focus_profiles', JSON.stringify(profiles));
    localStorage.setItem('focus_language', language);
    localStorage.setItem('focus_ai_enabled', JSON.stringify(isAIEnabled));
  }, [subjects, lectures, exams, tasks, weights, allocation, dailyTaskLimit, profiles, isAIEnabled, language]);

  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const generateStaticNarrative = () => {
    const incompleteTasks = tasks.filter(t => !t.completed).length;
    const nextExam = [...exams]
      .filter(e => new Date(e.date).getTime() > Date.now())
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
    
    let text = `${t.tasks_remaining.replace('{count}', incompleteTasks.toString())}. `;
    if (nextExam) {
      const examTime = new Date(nextExam.date).getTime();
      const days = isNaN(examTime) ? 0 : Math.ceil((examTime - Date.now()) / (1000 * 60 * 60 * 24));
      text += `${t.milestone_countdown.replace('{name}', nextExam.name).replace('{days}', days.toString())}. `;
    }
    
    const activeLectures = lectures.filter(l => l.progress > 0 && l.progress < 1).length;
    const backlogLectures = lectures.filter(l => (l.studyCount || 0) > 0 && (l.practiceCount || 0) === 0).length;

    if (backlogLectures > 5) {
      text += language === 'ar' 
        ? `لديك ${backlogLectures} محاضرات تمت دراستها وتحتاج إلى تدريب استراتيجي.` 
        : `You have ${backlogLectures} studied topics waiting for Strategic Practice.`;
    } else if (activeLectures > 0) {
      text += t.active_focus_on.replace('{count}', activeLectures.toString());
    } else {
      text += t.new_lecture_suggestion;
    }
    
    return text;
  };

  // Automatic Task Generation
  // 1. Refresh logic: Clear suggested tasks when core parameters change to allow re-selection
  useEffect(() => {
    // When the user changes allocation, weights, or limit, we "clear the deck"
    // so the auto-generation effect can refill it with tasks that match the new constraints.
    setTasks(prev => prev.filter(t => t.completed || !t.id.startsWith('auto-')));
  }, [allocation, weights, dailyTaskLimit]);

  // 2. Generation logic: Refill the dashboard based on Current State
  useEffect(() => {
    const autoGenerateTasks = () => {
      const newTasks: Task[] = [];
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      lectures.forEach(lecture => {
        const breakdown = getCategorizedPriority(lecture, weights);
        const { scores } = breakdown;
        
        // Helper to check if a task of a certain type already exists for this lecture
        const hasExisting = (type: TaskType) => {
          return tasks.some(t => 
            t.lectureId === lecture.id && 
            t.type === type && 
            (!t.completed || (t.completedDate && new Date(t.completedDate).getTime() > Date.now() - 24 * 60 * 60 * 1000))
          );
        };

        // 1. FOUNDATION (New Topics) - Focus: Study
        // Only trigger if we have NEVER studied it
        if (lecture.progress < 1 && scores.new > 10 && (lecture.studyCount || 0) === 0) {
          if (!hasExisting('new')) {
            newTasks.push({
              id: `auto-new-${lecture.id}-${Date.now()}`,
              title: `${t.study_prefix || 'Study'}: ${lecture.title}`,
              dueDate: new Date().toISOString(),
              priority: scores.new > 80 ? 'high' : 'medium',
              completed: false,
              lectureId: lecture.id,
              priorityScore: scores.new,
              type: 'new'
            });
          }
        } 
        
        // 2. STRATEGIC SOLVE (Practice) - Focus: Practice
        // Now triggers if we've studied at least once, or have manual progress
        if ((lecture.studyCount > 0 || lecture.progress > 0.3) && scores.solving > 10) {
          if (!hasExisting('solving')) {
            newTasks.push({
              id: `auto-solve-${lecture.id}-${Date.now()}`,
              title: `${t.practice_prefix || 'Practice'}: ${lecture.title}`,
              dueDate: new Date().toISOString(),
              priority: scores.solving > 75 ? 'high' : 'medium',
              completed: false,
              lectureId: lecture.id,
              priorityScore: scores.solving,
              type: 'solving'
            });
          }
        }

        // 3. DEEP REVIEW (Revision) - Focus: Revision
        // Now triggers if we've studied at least once
        if (lecture.studyCount > 0 && scores.review > 10) {
          if (!hasExisting('review')) {
            newTasks.push({
              id: `auto-review-${lecture.id}-${Date.now()}`,
              title: `${t.revision_prefix || 'Revision'}: ${lecture.title}`,
              dueDate: new Date().toISOString(),
              priority: scores.review > 85 ? 'high' : 'medium',
              completed: false,
              lectureId: lecture.id,
              priorityScore: scores.review,
              type: 'review'
            });
          }
        }
      });

      if (newTasks.length > 0) {
        // We now generate ALL valid tasks discovered (up to a safe buffer) 
        // and let the Dashboard UI handle the specific daily quota slicing.
        // This ensures "View All" shows the full roadmap and future days are populated.
        const pool = [...newTasks].sort((a,b) => (b.priorityScore || 0) - (a.priorityScore || 0));
        
        // Safety cap: Never auto-generate more than 60 tasks at once to keep state lean
        const finalSelection = pool.slice(0, 60);
        setTasks(prev => [...finalSelection, ...prev]);
      }
    };

    const timer = setTimeout(autoGenerateTasks, 1500); // 1.5s delay to avoid race conditions
    return () => clearTimeout(timer);
  }, [lectures, exams, weights, tasks, allocation, dailyTaskLimit]);

  const toggleTask = (id: string) => {
    setTasks(prev => {
      const updatedTasks = prev.map(t => {
        if (t.id === id) {
          const completed = !t.completed;
          
          // Side Effect: Update Lecture progress/study count if it's an auto-task
          if (completed && t.lectureId) {
            setLectures(prevLectures => prevLectures.map(l => {
              if (l.id === t.lectureId) {
                const now = new Date().toISOString();
                const currentProgress = l.progress || 0;

                if (t.type === 'review') {
                  const nextStudyCount = (l.studyCount || 0) + 1;
                  return { 
                    ...l, 
                    studyCount: nextStudyCount, 
                    lastReviewDate: now,
                    progress: (nextStudyCount === 1 && currentProgress < 0.25) ? 0.25 : currentProgress
                  };
                }
                if (t.type === 'solving') {
                  return { 
                    ...l, 
                    practiceDone: true, 
                    practiceCount: (l.practiceCount || 0) + 1, 
                    lastPracticeDate: now,
                    progress: currentProgress < 0.5 ? 0.5 : currentProgress
                  };
                }
                if (t.type === 'new') {
                  const nextStudyCount = (l.studyCount || 0) + 1;
                  return { 
                    ...l, 
                    studyCount: nextStudyCount, 
                    lastReviewDate: now,
                    progress: (nextStudyCount === 1 && currentProgress < 0.25) ? 0.25 : currentProgress
                  };
                }
              }
              return l;
            }));
          }

          return {
            ...t,
            completed,
            completedDate: completed ? new Date().toISOString() : undefined
          };
        }
        return t;
      });
      return updatedTasks;
    });
  };

  const handleWeightChange = (key: keyof PriorityWeights, val: number) => {
    setWeights(prev => {
      const updated = { ...prev, [key]: isFinite(val) ? val : 0 };
      if (activeProfileName) {
        setProfiles(pPrev => pPrev.map(p => p.name === activeProfileName ? { ...p, weights: updated } : p));
      }
      return updated;
    });
  };

  const handleAllocationChange = (key: keyof DailyAllocation, val: number) => {
    setAllocation(prev => {
      // Align with UI order: Foundation (new) -> Practice (solving) -> Revision (review)
      const keys = ['new', 'solving', 'review'] as const;
      const others = keys.filter(k => k !== key);
      const newVal = Math.min(100, Math.max(0, val));
      const remaining = 100 - newVal;
      
      const prevOthersTotal = others.reduce((sum, k) => sum + prev[k], 0);
      
      const next = { ...prev, [key]: newVal };
      
      if (prevOthersTotal === 0) {
        // Equal split if others were zero
        const share = Math.floor(remaining / others.length);
        others.forEach(k => { next[k] = share; });
      } else {
        // Proportional split
        others.forEach(k => {
          next[k] = Math.round((prev[k] / prevOthersTotal) * remaining);
        });
      }
      
      // Final adjustment for rounding precision - apply to the largest 'other' for stability
      const finalTotal = next.new + next.review + next.solving;
      if (finalTotal !== 100) {
        const adjustment = 100 - finalTotal;
        const targetKey = others.sort((a, b) => next[b] - next[a])[0];
        next[targetKey] += adjustment;
      }
      
      return next;
    });
  };

  const addSubject = (name: string) => {
    const colors = ['#00F2FF', '#FFD700', '#FF4D4D', '#4DFF4D', '#FF4DFF', '#FFA500'];
    const color = colors[subjects.length % colors.length];
    const newSubject: Subject = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      color,
      coverage: 0
    };
    setSubjects(prev => [...prev, newSubject]);
    setIsAddSubjectOpen(false);
  };

  const updateSubject = (updated: Subject) => {
    setSubjects(prev => prev.map(s => s.id === updated.id ? updated : s));
    setEditingSubject(null);
  };

  const deleteSubject = (id: string) => {
    setSubjects(prev => prev.filter(s => s.id !== id));
    setLectures(prev => prev.filter(l => l.subjectId !== id));
    setEditingSubject(null);
  };

  const addLecture = (subjectId: string, title: string) => {
    const newLecture: Lecture = {
      id: Math.random().toString(36).substr(2, 9),
      subjectId,
      title,
      date: new Date().toISOString().split('T')[0],
      practiceCount: 0,
      practiceDone: false,
      difficulty: 0.5,
      pageCount: 10,
      examAttempts: 0,
      studyCount: 0,
      estimatedStudyTime: 30,
      progress: 0,
      abandonedSessionsCount: 0,
      relatedLectureIds: []
    };
    setLectures(prev => [...prev, newLecture]);
    setIsAddLectureOpen(false);
    setEditingLecture(newLecture); // Spontaneous properties
  };

  const updateLecture = (updated: Lecture) => {
    setLectures(prev => prev.map(l => l.id === updated.id ? updated : l));
    
    // Sync tasks: If lecture is manually updated to be studied/practiced, remove relevant suggested tasks
    setTasks(prev => prev.filter(t => {
      const isTarget = t.lectureId && String(t.lectureId) === String(updated.id);
      if (isTarget && !t.completed) {
        if ((updated.studyCount || 0) > 0 && t.type === 'new') {
          return false;
        }
        if (((updated.practiceCount || 0) > 0 || updated.practiceDone) && t.type === 'solving') {
          return false;
        }
      }
      return true;
    }));
    
    setEditingLecture(null);
  };

  const deleteLecture = (id: string) => {
    setLectures(prev => prev.filter(l => l.id !== id));
    setExams(prev => prev.map(e => ({
      ...e,
      linkedLectureIds: e.linkedLectureIds.filter(lid => lid !== id)
    })));
    setTasks(prev => prev.filter(t => t.lectureId !== id));
    setEditingLecture(null);
  };

  const bulkUpdateLectures = (ids: string[], updates: Partial<Lecture>) => {
    setLectures(prev => prev.map(l => {
      if (ids.includes(l.id)) {
        return { ...l, ...updates };
      }
      return l;
    }));

    // Sync tasks: If lectures are updated with study/practice info, remove relevant suggested tasks
    setTasks(prev => prev.filter(t => {
      // Use string comparison for IDs to handle mixed types (numeric vs string)
      const isAffected = t.lectureId && ids.some(id => String(id) === String(t.lectureId));
      
      if (isAffected && !t.completed) {
        // If marking as studied, remove Study (new) tasks
        if (updates.studyCount !== undefined && t.type === 'new') {
          return false;
        }
        // If marking as practiced, remove Solving tasks
        if ((updates.practiceCount !== undefined || updates.practiceDone !== undefined) && t.type === 'solving') {
          return false;
        }
        // If marking either, and it's 100%, remove Review too
        if (updates.progress === 1 && t.type === 'review') {
          return false;
        }
      }
      return true;
    }));
  };

  const addExam = (name: string, date: string) => {
    const newExam: Exam = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      date,
      confidence: 50,
      linkedLectureIds: []
    };
    setExams(prev => [...prev, newExam]);
    setIsAddExamOpen(false);
    setEditingExam(newExam);
  };

  const updateExam = (updated: Exam) => {
    setExams(prev => prev.map(e => e.id === updated.id ? updated : e));
    setEditingExam(null);
  };

  const deleteExam = (id: string) => {
    setExams(prev => prev.filter(e => e.id !== id));
    setEditingExam(null);
  };

  useEffect(() => {
    const fetchNarrative = async () => {
      if (!isAIEnabled) {
        setNarrative(generateStaticNarrative());
        return;
      }
      
      const text = await generateNarrative({
        userName: "Alex",
        subjects,
        lectures,
        exams,
        tasks,
        weights
      });
      setNarrative(text);
    };
    fetchNarrative();
  }, [subjects, lectures, exams, tasks, isAIEnabled]);

  const handlePulseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pulseInput.trim()) return;

    setIsProcessing(true);
    
    let result;
    if (isAIEnabled) {
      result = await processPulsePrompt(pulseInput);
    } else {
      // Local Command Parser (Standard Mode)
      const input = pulseInput.toLowerCase();
      if (input.startsWith('add task ')) {
        result = { intent: 'add_task', title: pulseInput.substring(9) };
      } else if (input.startsWith('add lecture ')) {
        result = { intent: 'add_lecture', title: pulseInput.substring(12) };
      } else if (input.startsWith('add exam ')) {
        result = { intent: 'add_exam', name: pulseInput.substring(9) };
      } else if (input.startsWith('import ') || input.startsWith('syllabus ')) {
        const raw = pulseInput.substring(pulseInput.indexOf(' ') + 1);
        const lines = raw.split('\n').filter(l => l.trim());
        const items: any[] = [];
        let currentSubjectId = subjects.length > 0 ? subjects[0].id : '';
        lines.forEach(line => {
          const lower = line.toLowerCase();
          if (lower.startsWith('subject:') || lower.startsWith('s:')) {
            const name = line.split(':')[1].trim();
            const id = Math.random().toString(36).substr(2, 9);
            items.push({ type: 'subject', name, id });
            currentSubjectId = id;
          } else if (lower.startsWith('exam:') || lower.startsWith('e:')) {
            const name = line.split(':')[1].trim();
            items.push({ type: 'exam', name });
          } else {
            items.push({ type: 'lecture', title: line.trim(), subjectId: currentSubjectId });
          }
        });
        result = { intent: 'bulk_import', items };
      } else {
        result = { intent: 'unknown' };
      }
    }
    
    // Process intent
    if (result.intent === 'bulk_import' && result.items) {
      const newLectures: Lecture[] = [];
      const newTasks: Task[] = [];
      const newSubjects: Subject[] = [];
      const newExams: Exam[] = [];
      let firstSubjectIdInBatch = '';

      result.items.forEach((item: any) => {
        const id = item.id || Math.random().toString(36).substr(2, 9);
        if (item.type === 'lecture') {
          let sId = item.subjectId;
          if (!sId) sId = firstSubjectIdInBatch;
          if (!sId && subjects.length > 0) sId = subjects[0].id;
          
          if (!sId) {
            const genId = Math.random().toString(36).substr(2, 9);
            newSubjects.push({ id: genId, name: 'General', color: 'bg-focus-cyan', coverage: 0 });
            firstSubjectIdInBatch = genId;
            sId = genId;
          }

          newLectures.push({
            id,
            subjectId: sId,
            title: item.title,
            date: item.date || new Date().toISOString(),
            pageCount: item.pageCount || 10,
            progress: 0,
            difficulty: 0.5,
            studyCount: 0,
            practiceCount: 0,
            lastReviewDate: new Date().toISOString(),
            abandonedSessionsCount: 0,
            practiceDone: false,
            examAttempts: 0,
            estimatedStudyTime: 30,
            relatedLectureIds: []
          });
        } else if (item.type === 'task') {
          newTasks.push({
            id,
            title: item.title,
            dueDate: item.dueDate || new Date().toISOString(),
            priority: 'medium',
            completed: false,
            lectureId: item.lectureId
          });
        } else if (item.type === 'subject') {
          newSubjects.push({
            id,
            name: item.name,
            color: 'bg-focus-cyan',
            coverage: 0
          });
          if (!firstSubjectIdInBatch) firstSubjectIdInBatch = id;
        } else if (item.type === 'exam') {
          newExams.push({
            id,
            name: item.name,
            date: item.date || new Date().toISOString(),
            confidence: 50,
            linkedLectureIds: []
          });
        }
      });

      if (newLectures.length) setLectures(prev => [...prev, ...newLectures]);
      if (newTasks.length) setTasks(prev => [...prev, ...newTasks]);
      if (newSubjects.length) setSubjects(prev => [...prev, ...newSubjects]);
      if (newExams.length) setExams(prev => [...prev, ...newExams]);

    } else if (result.intent === 'add_task') {
      const newTask: Task = {
        id: Math.random().toString(36).substr(2, 9),
        title: result.title || pulseInput,
        dueDate: result.dueDate || new Date().toISOString(),
        priority: 'medium',
        completed: false,
        lectureId: result.lectureId
      };
      setTasks([newTask, ...tasks]);
    } else if (result.intent === 'add_lecture') {
      const sId = result.subjectId || (subjects.length > 0 ? subjects[0].id : '');
      if (sId) {
        const newLecture: Lecture = {
          id: Math.random().toString(36).substr(2, 9),
          subjectId: sId,
          title: result.title || pulseInput,
          date: result.date || new Date().toISOString(),
          pageCount: result.pageCount || 10,
          progress: 0,
          difficulty: 0.5,
          studyCount: 0,
          practiceCount: 0,
          lastReviewDate: new Date().toISOString(),
          abandonedSessionsCount: 0,
          practiceDone: false,
          examAttempts: 0,
          estimatedStudyTime: 30,
          relatedLectureIds: []
        };
        setLectures([...lectures, newLecture]);
      }
    } else if (result.intent === 'add_subject') {
      const newSubject: Subject = {
        id: Math.random().toString(36).substr(2, 9),
        name: result.name || pulseInput,
        color: 'bg-focus-cyan',
        coverage: 0
      };
      setSubjects([...subjects, newSubject]);
    } else if (result.intent === 'add_exam') {
      const newExam: Exam = {
        id: Math.random().toString(36).substr(2, 9),
        name: result.name || pulseInput,
        date: result.date || new Date().toISOString(),
        confidence: 50,
        linkedLectureIds: []
      };
      setExams([...exams, newExam]);
    }

    setPulseInput("");
    setIsProcessing(false);
    setIsPulseOpen(false);
    
    // Refresh narrative
    const text = await generateNarrative({
      userName: "Alex",
      subjects,
      lectures,
      exams,
      tasks
    });
    setNarrative(text);
  };

  const handleBulkImport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!bulkInput.trim()) return;

    setIsBulkProcessing(true);
    setImportResults(null);
    
    try {
      let result;
      if (isAIEnabled) {
        result = await processPulsePrompt(`This is a bulk import of a syllabus or list. Parse everything in here: ${bulkInput}`);
      } else {
        // Enhanced line-by-line import for No-AI mode
        const lines = bulkInput.split('\n').filter(l => l.trim());
        const items: any[] = [];
        let currentSubjectId = subjects.length > 0 ? subjects[0].id : '';

        lines.forEach(line => {
          const lower = line.toLowerCase();
          if (lower.startsWith('subject:') || lower.startsWith('s:')) {
            const name = line.split(':')[1].trim();
            const id = Math.random().toString(36).substr(2, 9);
            items.push({ type: 'subject', name, id });
            currentSubjectId = id;
          } else if (lower.startsWith('exam:') || lower.startsWith('e:')) {
            const name = line.split(':')[1].trim();
            items.push({ type: 'exam', name });
          } else if (lower.startsWith('task:') || lower.startsWith('t:')) {
            const title = line.split(':')[1].trim();
            items.push({ type: 'task', title });
          } else {
            // Default to lecture
            items.push({ 
              type: 'lecture', 
              title: line.trim(), 
              subjectId: currentSubjectId,
              pageCount: 10 
            });
          }
        });

        result = {
          intent: 'bulk_import',
          items
        };
      }
      
      if (result.intent === 'bulk_import' && result.items) {
        const newLectures: Lecture[] = [];
        const newTasks: Task[] = [];
        const newSubjects: Subject[] = [];
        const newExams: Exam[] = [];

        // Track subjects in this batch
        let firstSubjectIdInBatch = '';

        result.items.forEach((item: any) => {
          const id = item.id || Math.random().toString(36).substr(2, 9);
          if (item.type === 'lecture') {
            // Priority: item.subjectId > firstSubjectIdInBatch > existing subjects > fallback creator
            let sId = item.subjectId;
            if (!sId) sId = firstSubjectIdInBatch;
            if (!sId && subjects.length > 0) sId = subjects[0].id;
            
            // If still no subject, create a default "General" one
            if (!sId) {
              const genId = Math.random().toString(36).substr(2, 9);
              newSubjects.push({ id: genId, name: 'General', color: 'bg-focus-cyan', coverage: 0 });
              firstSubjectIdInBatch = genId;
              sId = genId;
            }

            newLectures.push({
              id,
              subjectId: sId,
              title: item.title,
              date: item.date || new Date().toISOString(),
              pageCount: item.pageCount || 10,
              progress: 0,
              difficulty: 0.5,
              studyCount: 0,
              practiceCount: 0,
              lastReviewDate: new Date().toISOString(),
              abandonedSessionsCount: 0,
              practiceDone: false,
              examAttempts: 0,
              estimatedStudyTime: 30,
              relatedLectureIds: []
            });
          } else if (item.type === 'task') {
            newTasks.push({
              id,
              title: item.title,
              dueDate: item.dueDate || new Date().toISOString(),
              priority: 'medium',
              completed: false,
              lectureId: item.lectureId
            });
          } else if (item.type === 'subject') {
            newSubjects.push({
              id,
              name: item.name,
              color: 'bg-focus-cyan',
              coverage: 0
            });
            if (!firstSubjectIdInBatch) firstSubjectIdInBatch = id;
          } else if (item.type === 'exam') {
            newExams.push({
              id,
              name: item.name,
              date: item.date || new Date().toISOString(),
              confidence: 50,
              linkedLectureIds: []
            });
          }
        });

        if (newLectures.length) setLectures(prev => [...prev, ...newLectures]);
        if (newTasks.length) setTasks(prev => [...prev, ...newTasks]);
        if (newSubjects.length) setSubjects(prev => [...prev, ...newSubjects]);
        if (newExams.length) setExams(prev => [...prev, ...newExams]);

        setImportResults(result.items.map((i: any) => ({ type: i.type, title: i.title || i.name })));
        setBulkInput('');
      } else {
        setImportResults([]);
      }
    } catch (err) {
      console.error("Bulk Import Error:", err);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const focusScore = calculateFocusScore(tasks, lectures);

  return (
    <div className="max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto min-h-screen bg-focus-bg relative flex flex-col transition-all duration-500">
      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-6 md:p-10 lg:p-16 pb-32 overflow-y-auto transition-all duration-300">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="dash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Dashboard 
                narrative={narrative} 
                tasks={tasks} 
                subjects={subjects} 
                lectures={lectures} 
                exams={exams}
                weights={weights}
                allocation={allocation}
                onToggleTask={toggleTask}
                onPartialTask={(lectureId) => {
                  const lecture = lectures.find(l => l.id === lectureId);
                  if (lecture) {
                    setEditingLecture(lecture);
                  }
                }}
                onViewAllTasks={() => setIsTasksModalOpen(true)}
                onViewFocusIntelligence={() => setIsFocusModalOpen(true)}
                onOpenBulkImport={() => setIsBulkImportOpen(true)}
                focusScore={focusScore}
                dailyTaskLimit={dailyTaskLimit}
                t={t}
                language={language}
              />
            </motion.div>
          )}
          {activeTab === 'library' && (
            <motion.div key="lib" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LibraryScreen 
                subjects={subjects} 
                lectures={lectures} 
                exams={exams}
                weights={weights}
                onAddSubject={() => setIsAddSubjectOpen(true)}
                onAddLecture={() => setIsAddLectureOpen(true)}
                onEditLecture={(lecture) => setEditingLecture(lecture)}
                onEditSubject={(subject) => setEditingSubject(subject)}
                onBulkUpdateLectures={bulkUpdateLectures}
                t={t}
                language={language}
              />
            </motion.div>
          )}
          {activeTab === 'exams' && (
            <motion.div key="exams" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ExamHub 
                exams={exams} 
                lectures={lectures} 
                onAddExam={() => setIsAddExamOpen(true)}
                onEditExam={(exam) => setEditingExam(exam)}
                onUpdateExam={updateExam}
                onEditLecture={(lecture) => setEditingLecture(lecture)}
                t={t}
                language={language}
              />
            </motion.div>
          )}
          {activeTab === 'roadmap' && (
            <motion.div key="road" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Roadmap exams={exams} tasks={tasks} lectures={lectures} t={t} language={language} />
            </motion.div>
          )}
          {activeTab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <PriorityEngine 
                weights={weights} 
                onWeightChange={handleWeightChange} 
                allocation={allocation}
                onAllocationChange={handleAllocationChange}
                profiles={profiles}
                onSaveProfile={(name) => {
                  if (profiles.length < 4) {
                    setProfiles(prev => [...prev, { name, weights }]);
                  }
                }}
                onLoadProfile={(w, name) => {
                  setWeights(w);
                  setActiveProfileName(name);
                }}
                onDeleteProfile={(name) => {
                  setProfiles(prev => prev.filter(p => p.name !== name));
                  if (activeProfileName === name) setActiveProfileName(null);
                }}
                onRenameProfile={(oldName, newName) => {
                  setProfiles(prev => prev.map(p => p.name === oldName ? { ...p, name: newName } : p));
                  if (activeProfileName === oldName) setActiveProfileName(newName);
                }}
                isAIEnabled={isAIEnabled}
                onToggleAI={setIsAIEnabled}
                dailyTaskLimit={dailyTaskLimit}
                onDailyTaskLimitChange={setDailyTaskLimit}
                language={language}
                onLanguageChange={setLanguage}
                onOpenTutorial={() => setIsTutorialOpen(true)}
                t={t}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Pulse Button */}
      <div className="fixed bottom-24 right-6 lg:right-[calc(50%-2.5rem)] lg:translate-x-[calc(320px)] xl:translate-x-[calc(400px)] z-50 transition-all">
        <button 
          id="pulse-trigger-btn"
          onClick={() => setIsPulseOpen(true)}
          className="w-14 h-14 rounded-full bg-focus-cyan text-focus-bg flex items-center justify-center shadow-[0_8px_24px_rgba(0,242,255,0.4)] hover:scale-110 active:scale-95 transition-all"
        >
          <Plus size={28} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl mx-auto glass border-t border-white/5 px-4 py-4 flex justify-between items-center z-40 transition-all duration-500">
        <NavItem icon={LayoutDashboard} label={t.dashboard} active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
        <NavItem icon={Library} label={t.library} active={activeTab === 'library'} onClick={() => setActiveTab('library')} />
        <NavItem icon={Target} label={t.exam_hub} active={activeTab === 'exams'} onClick={() => setActiveTab('exams')} />
        <NavItem icon={Route} label={t.roadmap} active={activeTab === 'roadmap'} onClick={() => setActiveTab('roadmap')} />
        <NavItem icon={Sliders} label={t.architecture} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
      </nav>

      <TutorialModal isOpen={isTutorialOpen} onClose={() => setIsTutorialOpen(false)} t={t} onTabChange={setActiveTab} language={language} />

      {/* Pulse Overlay */}
      <AnimatePresence>
        {isPulseOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end justify-center p-6 bg-focus-bg/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="w-full max-w-xl glass rounded-3xl p-8 space-y-6 shadow-2xl border-white/20"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'بماذا تفكر؟' : "What's on your mind?"}</h3>
                <button onClick={() => setIsPulseOpen(false)} className="text-focus-slate">{t.close}</button>
              </div>
              <form onSubmit={handlePulseSubmit} className="relative">
                <input 
                  autoFocus
                  value={pulseInput}
                  onChange={(e) => setPulseInput(e.target.value)}
                  placeholder={language === 'ar' ? 'مثال: اربط ورقة التاريخ بمادة التاريخ' : "e.g. History Paper link to History Subject"}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-focus-cyan/50 transition-colors"
                />
                <button 
                  type="submit"
                  disabled={isProcessing}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-focus-cyan text-focus-bg flex items-center justify-center disabled:opacity-50"
                >
                  {isProcessing ? <div className="w-4 h-4 border-2 border-focus-bg border-t-transparent rounded-full animate-spin" /> : <ChevronRight size={18} />}
                </button>
              </form>
              <p className="text-[10px] text-focus-slate text-center uppercase tracking-widest">Nexus will process your intent</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tasks View All Modal */}
      <Modal 
        isOpen={isTasksModalOpen} 
        onClose={() => setIsTasksModalOpen(false)} 
        title={t.task_stream}
      >
        <div className="space-y-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-focus-slate" size={14} />
            <input 
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              placeholder={t.search_placeholder}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs outline-none focus:border-focus-cyan/30"
            />
          </div>

          <div className="flex gap-2 p-1 glass rounded-xl">
            <button 
              onClick={() => setTaskFilter('active')}
              className={cn(
                "flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                taskFilter === 'active' ? "bg-focus-cyan text-focus-bg" : "text-focus-slate"
              )}
            >
              {t.active}
            </button>
            <button 
              onClick={() => setTaskFilter('completed')}
              className={cn(
                "flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                taskFilter === 'completed' ? "bg-focus-cyan text-focus-bg" : "text-focus-slate"
              )}
            >
              {t.completed}
            </button>
          </div>
          
          <div className="space-y-3">
            {tasks
              .filter(t => taskFilter === 'active' ? !t.completed : t.completed)
              .filter(t => t.title.toLowerCase().includes(taskSearch.toLowerCase()))
              .map(t => ({ ...t, score: calculatePriorityScore(t, lectures, exams, weights) }))
              .sort((a, b) => (b.score || 0) - (a.score || 0))
              .map(task => (
                <div key={task.id} className="flex items-center gap-4 p-4 glass rounded-xl border border-white/5">
                  <button 
                    onClick={() => toggleTask(task.id)}
                    className={cn("transition-colors", task.completed ? "text-focus-cyan" : "text-focus-slate")}
                  >
                    {task.completed ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium truncate", task.completed && "line-through text-focus-slate")}>{task.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 text-focus-slate font-mono">
                        {t.score}: {task.score}
                      </span>
                      {task.lectureId && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-focus-cyan/10 text-focus-cyan font-mono truncate">
                          {lectures.find(l => l.id === task.lectureId)?.title}
                        </span>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={() => setTasks(prev => prev.filter(t => t.id !== task.id))}
                    className="p-1.5 text-focus-slate hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
          </div>
        </div>
      </Modal>

      <Modal 
        isOpen={isFocusModalOpen} 
        onClose={() => setIsFocusModalOpen(false)} 
        title={t.focus_intelligence}
      >
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <div className={cn(
              "text-6xl font-bold transition-colors",
              focusScore > 80 ? "text-focus-cyan" : focusScore > 50 ? "text-focus-gold" : "text-red-400"
            )}>{focusScore}</div>
            <p className="text-xs text-focus-slate uppercase tracking-[0.2em]">{t.focus_index}</p>
          </div>

          <div className="space-y-4">
            <div className="glass p-4 rounded-xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white">Task Momentum</span>
                <span className="text-xs font-mono text-focus-cyan">{Math.round((tasks.filter(t => t.completed).length / Math.max(1, tasks.length)) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-focus-cyan transition-all duration-1000" 
                  style={{ width: `${(tasks.filter(t => t.completed).length / Math.max(1, tasks.length)) * 100}%` }} 
                />
              </div>
              <p className="text-[10px] text-focus-slate">Measures your ability to close open loops.</p>
            </div>

            <div className="glass p-4 rounded-xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white">Mastery Depth</span>
                <span className="text-xs font-mono text-focus-gold">{Math.round((lectures.reduce((acc, l) => acc + (isFinite(l.progress) ? l.progress : 0), 0) / Math.max(1, lectures.length)) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-focus-gold transition-all duration-1000" 
                  style={{ width: `${(lectures.reduce((acc, l) => acc + (isFinite(l.progress) ? l.progress : 0), 0) / Math.max(1, lectures.length)) * 100}%` }} 
                />
              </div>
              <p className="text-[10px] text-focus-slate">Measures the quality of your understanding.</p>
            </div>

            <div className="glass p-4 rounded-xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white">Consistency</span>
                <span className="text-xs font-mono text-green-400">High</span>
              </div>
              <p className="text-[10px] text-focus-slate">Measures your daily engagement over the last 7 days.</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white/5 border border-white/10 italic text-[11px] text-focus-slate text-center">
            "Focus is not about doing more, but about doing what matters most."
          </div>
        </div>
      </Modal>

      {/* Modals */}
      <Modal isOpen={isAddExamOpen} onClose={() => {
        setIsAddExamOpen(false);
        setQuickAddDate("");
      }} title={t.add_exam}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value;
          addExam(name, new Date(quickAddDate).toISOString());
          setQuickAddDate("");
        }} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">{t.exam_name}</label>
            <input name="name" type="text" required className="w-full glass border-focus-border rounded-xl p-3 text-sm focus:ring-1 focus:ring-focus-cyan outline-none" placeholder={language === 'ar' ? 'نموذج: نهاية الأحياء' : "e.g. Biology Finals"} />
          </div>
          <div className="relative group">
            <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">{t.exam_date}</label>
            <div className="relative h-[46px]">
              {/* Display Layer */}
              <div className="absolute inset-0 glass border flex items-center justify-between px-4 border-focus-border rounded-xl pointer-events-none group-hover:bg-white/5 transition-colors">
                <span className={quickAddDate ? "text-white text-sm" : "text-focus-slate text-sm"}>
                  {quickAddDate ? new Date(quickAddDate).toLocaleDateString(language === 'ar' ? 'ar-EG' : undefined) : t.select_date}
                </span>
                <Calendar className="w-4 h-4 text-focus-cyan" />
              </div>
              {/* Hidden Native Trigger */}
              <input 
                name="date" 
                type="date" 
                required 
                value={quickAddDate}
                onChange={(e) => setQuickAddDate(e.target.value)}
                onKeyDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  try {
                    (e.currentTarget as any).showPicker?.();
                  } catch (err) {}
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
              />
            </div>
          </div>
          <button type="submit" className="w-full bg-focus-cyan text-focus-bg py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-white transition-colors">{t.save_exam}</button>
        </form>
      </Modal>

      <Modal isOpen={!!editingExam} onClose={() => setEditingExam(null)} title={t.exam_hub}>
        {editingExam && (
          <ExamForm 
            exam={editingExam} 
            lectures={lectures} 
            onSave={updateExam} 
            onDelete={(id) => deleteExam(id)} 
            t={t}
            language={language}
          />
        )}
      </Modal>
      <Modal isOpen={isAddSubjectOpen} onClose={() => setIsAddSubjectOpen(false)} title="Add New Subject">
        <form onSubmit={(e) => {
          e.preventDefault();
          const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value;
          addSubject(name);
        }} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">Subject Name</label>
            <input name="name" type="text" required className="w-full glass border-focus-border rounded-xl p-3 text-sm focus:ring-1 focus:ring-focus-cyan outline-none" placeholder="e.g. Computer Science" />
          </div>
          <button type="submit" className="w-full bg-focus-cyan text-focus-bg py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-white transition-colors">Create Subject</button>
        </form>
      </Modal>

      <Modal isOpen={isAddLectureOpen} onClose={() => setIsAddLectureOpen(false)} title={t.add_lecture}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const subjectId = (e.currentTarget.elements.namedItem('subjectId') as HTMLSelectElement).value;
          const title = (e.currentTarget.elements.namedItem('title') as HTMLInputElement).value;
          if (!subjectId) return;
          addLecture(subjectId, title);
        }} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">{t.subject_category}</label>
            <select 
              name="subjectId" 
              required 
              className="w-full bg-focus-bg border border-focus-border rounded-xl p-3 text-sm text-white focus:ring-1 focus:ring-focus-cyan outline-none"
            >
              <option value="" className="bg-focus-bg text-focus-slate">{language === 'ar' ? 'اختر مادة...' : "Select a subject..."}</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id} className="bg-focus-bg text-white">{s.name}</option>
              ))}
            </select>
            {subjects.length === 0 && (
              <p className="text-[10px] text-red-400 mt-1">{t.create_subject_first}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">{t.topic_title}</label>
            <input name="title" type="text" required className="w-full glass border-focus-border rounded-xl p-3 text-sm focus:ring-1 focus:ring-focus-cyan outline-none" placeholder={language === 'ar' ? 'نموذج: مقدمة في علم الوراثة' : "e.g. Intro to Genetics"} />
          </div>
          <button 
            type="submit" 
            disabled={subjects.length === 0}
            className="w-full bg-focus-cyan text-focus-bg py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-white transition-colors disabled:opacity-50"
          >
            {t.add_lecture}
          </button>
        </form>
      </Modal>

      <Modal isOpen={!!editingLecture} onClose={() => setEditingLecture(null)} title={t.study_topic_details}>
        {editingLecture && (
          <LectureIntelligenceForm 
            lecture={editingLecture} 
            subjects={subjects}
            lectures={lectures}
            exams={exams}
            weights={weights}
            onSave={(updated) => {
              updateLecture(updated);
              setEditingLecture(null);
            }}
            onDelete={(id) => {
              deleteLecture(id);
              setEditingLecture(null);
            }}
            t={t}
            language={language}
          />
        )}
      </Modal>

      <Modal isOpen={isBulkImportOpen} onClose={() => { setIsBulkImportOpen(false); setImportResults(null); }} title={t.nexus_syllabus_importer}>
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-focus-cyan/5 border border-focus-cyan/20 space-y-2">
            <p className="text-xs text-focus-cyan leading-relaxed">
              {t.nexus_importer_desc} 
              {isAIEnabled ? ` ${t.ai_detect_desc}` : ` ${t.structured_import_desc}`}
            </p>
            {!isAIEnabled && (
              <div className="grid grid-cols-2 gap-2 text-[9px] font-mono text-focus-slate">
                <div>Subject: Physics</div>
                <div>Exam: Final Exam</div>
                <div>Task: Order Book</div>
                <div>General Topic Title</div>
              </div>
            )}
          </div>

          <textarea
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            disabled={isBulkProcessing}
            placeholder={isAIEnabled ? "Lecture 1: Intro to Physics (Oct 10)..." : "Subject: Biology\nCell Structure\nGenetics\nExam: Midterm"}
            className="w-full h-48 glass border-focus-border rounded-xl p-4 text-sm focus:ring-1 focus:ring-focus-cyan outline-none resize-none font-mono"
          />

          {importResults && (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-focus-gold">
                {importResults.length > 0 ? t.imported_success.replace('{count}', importResults.length.toString()) : t.imported_none}
              </p>
              {importResults.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/5">
                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-focus-cyan/20 text-focus-cyan uppercase font-bold tracking-tighter">
                    {item.type}
                  </span>
                  <span className="text-[11px] text-focus-text truncate">{item.title}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button 
              onClick={() => { setIsBulkImportOpen(false); setImportResults(null); }}
              className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-focus-slate text-xs font-bold uppercase tracking-widest hover:bg-white/5 transition-all"
            >
              Close
            </button>
            <button 
              onClick={() => handleBulkImport()}
              disabled={isBulkProcessing || !bulkInput.trim()}
              className="flex-[2] bg-focus-cyan text-focus-bg px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isBulkProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-focus-bg/30 border-t-focus-bg rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload size={14} />
                  Initiate Import
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editingSubject} onClose={() => setEditingSubject(null)} title="Subject Settings">
        {editingSubject && (
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            updateSubject({
              ...editingSubject,
              name: formData.get('name') as string,
              color: formData.get('color') as string
            });
          }} className="space-y-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">Subject Name</label>
              <input name="name" type="text" defaultValue={editingSubject.name} required className="w-full glass border-focus-border rounded-xl p-3 text-sm focus:ring-1 focus:ring-focus-cyan outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-focus-slate mb-2">Theme Color</label>
              <div className="flex gap-3">
                <input name="color" type="color" defaultValue={editingSubject.color} className="w-12 h-12 rounded-xl bg-transparent border-none cursor-pointer" />
                <input type="text" value={editingSubject.color} readOnly className="flex-1 glass border-focus-border rounded-xl p-3 text-sm outline-none font-mono" />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <button 
                type="button"
                onClick={() => deleteSubject(editingSubject.id)}
                className="flex-1 bg-red-500/10 text-red-500 py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-red-500 hover:text-white transition-colors"
              >
                Delete
              </button>
              <button 
                type="submit" 
                className="flex-[2] bg-focus-cyan text-focus-bg py-3 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-white transition-colors"
              >
                Save Settings
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
