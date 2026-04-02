import React, { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { TaskCard } from './TaskCard';
import { localTaskService, LocalTask } from '../../services/localTaskService';
import { useLanguage } from '../LanguageContext';

interface TaskListProps {
  onSettings: (task: LocalTask) => void;
  onPause?: (taskId: string) => void;
  onResume?: (taskId: string) => void;
  onExecute?: (taskId: string) => void;
}

export const TaskList: React.FC<TaskListProps> = ({
  onSettings, onPause, onResume, onExecute
}) => {
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';

  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await localTaskService.getTasks();
      setTasks(data);
    } catch (err) {
      console.error('[TaskList] Failed to load tasks:', err);
      setError(lang === 'en' ? 'Failed to load tasks' : '加载任务失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadTasks(); }, []);

  // Listen for task updates
  useEffect(() => {
    const handler = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.localTasks) {
        setTasks(changes.localTasks.newValue || []);
      }
    };
    chrome.storage.local.onChanged.addListener(handler);
    return () => chrome.storage.local.onChanged.removeListener(handler);
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-red-500">
        <AlertCircle size={24} className="mb-2" />
        <span className="text-sm mb-2">{error}</span>
        <button
          onClick={loadTasks}
          className="px-3 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer"
        >
          {lang === 'en' ? 'Retry' : '重试'}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] animate-pulse">
            <div className="h-4 w-24 bg-[var(--hover-bg)] rounded mb-2" />
            <div className="h-3 w-32 bg-[var(--hover-bg)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onSettings={onSettings}
            onPause={onPause}
            onResume={onResume}
            onExecute={onExecute}
          />
        ))}
      </div>
    </div>
  );
};
