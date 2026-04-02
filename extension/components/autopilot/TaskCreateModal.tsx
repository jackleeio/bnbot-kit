import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
  TaskType,
  TaskFrequency,
  NotificationType,
  ScheduledTaskCreate,
  scheduledTaskService,
  TASK_TYPE_ICONS,
  TASK_TYPE_LABELS,
  FREQUENCY_LABELS,
  DAY_OF_WEEK_LABELS
} from '../../services/scheduledTaskService';
import { useLanguage } from '../LanguageContext';

interface TaskCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  existingTaskTypes?: TaskType[];  // Already created task types
}

export const TaskCreateModal: React.FC<TaskCreateModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  existingTaskTypes = []
}) => {
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';

  // Task types that can only have one instance
  const singletonTaskTypes = [TaskType.AUTO_REPLY, TaskType.HANDLE_NOTIFICATION, TaskType.FOLLOW_DIGEST];

  // Task types to hide temporarily
  const hiddenTaskTypes = [TaskType.GENERATE_TWEET, TaskType.CUSTOM_TASK, TaskType.FOLLOW_DIGEST];

  // Filter out task types that already exist (for singleton types) or are hidden
  const availableTaskTypes = Object.values(TaskType).filter(type => {
    // Hide GENERATE_TWEET temporarily
    if (hiddenTaskTypes.includes(type)) {
      return false;
    }
    // Singleton types can only have one instance
    if (singletonTaskTypes.includes(type)) {
      return !existingTaskTypes.includes(type);
    }
    return true;
  });

  // Default to first available type
  const defaultTaskType = availableTaskTypes[0] || TaskType.FEED_REPORT;

  const [name, setName] = useState('');
  const [taskType, setTaskType] = useState<TaskType>(defaultTaskType);
  const [prompt, setPrompt] = useState('');
  const [frequency, setFrequency] = useState<TaskFrequency>(TaskFrequency.DAILY);
  const [executionTime, setExecutionTime] = useState('09:00');
  const [intervalHours, setIntervalHours] = useState<number>(2);
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [monthOfYear, setMonthOfYear] = useState<number>(1);
  const [notificationType, setNotificationType] = useState<NotificationType>(NotificationType.NONE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update taskType when availableTaskTypes changes (e.g., when modal opens with new existingTaskTypes)
  useEffect(() => {
    if (isOpen && availableTaskTypes.length > 0 && !availableTaskTypes.includes(taskType)) {
      setTaskType(availableTaskTypes[0]);
    }
  }, [isOpen, availableTaskTypes, taskType]);

  // Lower sidebar z-index when modal is open so modal covers it
  useEffect(() => {
    if (isOpen) {
      const style = document.createElement('style');
      style.id = 'task-modal-sidebar-fix';
      style.textContent = `
        [data-testid="bnbot-sidebar"] {
          z-index: 0 !important;
        }
        [data-testid="bnbot-sidebar"] * {
          z-index: 0 !important;
        }
      `;
      const shadowContainer = document.getElementById('x-sidekick-container');
      const target = shadowContainer?.shadowRoot || document.head;
      target.appendChild(style);

      return () => {
        const existingStyle = (shadowContainer?.shadowRoot || document).getElementById('task-modal-sidebar-fix');
        existingStyle?.remove();
      };
    }
  }, [isOpen]);

  // Singleton types use default name
  const isSingletonType = singletonTaskTypes.includes(taskType);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Name is optional — falls back to task type label
    // Prompt is only required for non-singleton task types
    if (taskType !== TaskType.AUTO_REPLY && taskType !== TaskType.HANDLE_NOTIFICATION && !prompt.trim()) {
      setError(lang === 'en' ? 'Prompt is required' : '请输入提示词');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const defaultName = TASK_TYPE_LABELS[taskType]?.[lang] || taskType;
      const taskData: ScheduledTaskCreate = {
        name: name.trim() || defaultName,
        task_type: taskType,
        prompt: prompt.trim(),
        frequency,
        execution_time: executionTime,
        notification_type: notificationType
      };

      if (frequency === TaskFrequency.HOURLY) {
        taskData.interval_hours = intervalHours;
      } else if (frequency === TaskFrequency.WEEKLY) {
        taskData.day_of_week = dayOfWeek;
      } else if (frequency === TaskFrequency.MONTHLY) {
        taskData.day_of_month = dayOfMonth;
      } else if (frequency === TaskFrequency.YEARLY) {
        taskData.month_of_year = monthOfYear;
        taskData.day_of_month = dayOfMonth;
      }

      const newTask = await scheduledTaskService.createTask(taskData);
      await scheduledTaskService.notifyAlarmSync(newTask.id);
      onCreated();
      onClose();
      // Reset form
      setName('');
      setPrompt('');
      setTaskType(TaskType.AUTO_REPLY);
      setFrequency(TaskFrequency.DAILY);
      setExecutionTime('09:00');
    } catch (err: any) {
      console.error('[TaskCreateModal] Failed to create task:', err);
      setError(err.message || (lang === 'en' ? 'Failed to create task' : '创建任务失败'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="flex items-center justify-center p-4"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '486px',
        height: '100vh',
        zIndex: 9999,
        pointerEvents: 'auto',
        backgroundColor: 'rgba(128, 128, 128, 0.25)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-md bg-[var(--bg-primary)] rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {lang === 'en' ? 'Create Task' : '创建任务'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Task Name - hidden for singleton types */}
          {!isSingletonType && (
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                {lang === 'en' ? 'Task Name' : '任务名称'}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={TASK_TYPE_LABELS[taskType]?.[lang] || ''}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                maxLength={100}
              />
            </div>
          )}

          {/* Task Type & Frequency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                {lang === 'en' ? 'Task Type' : '任务类型'}
              </label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as TaskType)}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                {availableTaskTypes.map((type) => (
                  <option key={type} value={type}>
                    {TASK_TYPE_LABELS[type][lang]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                {lang === 'en' ? 'Frequency' : '执行频率'}
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as TaskFrequency)}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                <option value={TaskFrequency.HOURLY}>{FREQUENCY_LABELS[TaskFrequency.HOURLY][lang]}</option>
                <option value={TaskFrequency.DAILY}>{FREQUENCY_LABELS[TaskFrequency.DAILY][lang]}</option>
                <option value={TaskFrequency.WEEKLY}>{FREQUENCY_LABELS[TaskFrequency.WEEKLY][lang]}</option>
                <option value={TaskFrequency.MONTHLY}>{FREQUENCY_LABELS[TaskFrequency.MONTHLY][lang]}</option>
              </select>
            </div>
          </div>

          {/* Interval Hours (for hourly) */}
          {frequency === TaskFrequency.HOURLY && (
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                {lang === 'en' ? 'Every N Hours' : '每隔N小时'}
              </label>
              <select
                value={intervalHours}
                onChange={(e) => setIntervalHours(parseInt(e.target.value))}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                <option value={1}>{lang === 'en' ? 'Every 1 hour' : '每1小时'}</option>
                <option value={2}>{lang === 'en' ? 'Every 2 hours' : '每2小时'}</option>
                <option value={3}>{lang === 'en' ? 'Every 3 hours' : '每3小时'}</option>
                <option value={4}>{lang === 'en' ? 'Every 4 hours' : '每4小时'}</option>
                <option value={6}>{lang === 'en' ? 'Every 6 hours' : '每6小时'}</option>
                <option value={8}>{lang === 'en' ? 'Every 8 hours' : '每8小时'}</option>
                <option value={12}>{lang === 'en' ? 'Every 12 hours' : '每12小时'}</option>
              </select>
            </div>
          )}

          {/* Prompt - Hide for AUTO_REPLY and HANDLE_NOTIFICATION */}
          {taskType !== TaskType.AUTO_REPLY && taskType !== TaskType.HANDLE_NOTIFICATION && (
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                {lang === 'en' ? 'Prompt / Instructions' : '提示词 / 指令'} *
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={lang === 'en' ? 'Custom instructions for this task...' : '自定义任务指令...'}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-24"
                maxLength={8000}
              />
            </div>
          )}

          {/* Day of Week (for weekly) */}
          {frequency === TaskFrequency.WEEKLY && (
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                {lang === 'en' ? 'Day of Week' : '星期几'}
              </label>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(parseInt(e.target.value))}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                {DAY_OF_WEEK_LABELS[lang].map((day, idx) => (
                  <option key={idx} value={idx}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Day of Month (for monthly) */}
          {frequency === TaskFrequency.MONTHLY && (
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                {lang === 'en' ? 'Day of Month' : '每月几号'}
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(parseInt(e.target.value) || 1)}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          )}

          {/* Execution Time */}
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              {lang === 'en' ? 'Execution Time' : '执行时间'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={executionTime.split(':')[0]}
                onChange={(e) => setExecutionTime(`${e.target.value}:${executionTime.split(':')[1] || '00'}`)}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map((hour) => (
                  <option key={hour} value={hour}>{hour}:00</option>
                ))}
              </select>
              <select
                value={executionTime.split(':')[1] || '00'}
                onChange={(e) => setExecutionTime(`${executionTime.split(':')[0]}:${e.target.value}`)}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                <option value="00">00 {lang === 'en' ? 'min' : '分'}</option>
                <option value="15">15 {lang === 'en' ? 'min' : '分'}</option>
                <option value="30">30 {lang === 'en' ? 'min' : '分'}</option>
                <option value="45">45 {lang === 'en' ? 'min' : '分'}</option>
              </select>
            </div>
          </div>

          {/* Notification Type - Hide for AUTO_REPLY and HANDLE_NOTIFICATION */}
          {taskType !== TaskType.AUTO_REPLY && taskType !== TaskType.HANDLE_NOTIFICATION && (
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                {lang === 'en' ? 'Notification' : '通知方式'}
              </label>
              <select
                value={notificationType}
                onChange={(e) => setNotificationType(e.target.value as NotificationType)}
                className="w-full p-3 rounded-xl bg-[var(--bg-secondary)] border-none text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                <option value={NotificationType.NONE}>
                  {lang === 'en' ? 'None' : '无'}
                </option>
                <option value={NotificationType.EMAIL_ONLY}>
                  {lang === 'en' ? 'Email Only' : '仅邮件'}
                </option>
                <option value={NotificationType.TELEGRAM_ONLY}>
                  {lang === 'en' ? 'Telegram Only' : '仅 Telegram'}
                </option>
                <option value={NotificationType.BOTH}>
                  {lang === 'en' ? 'Email & Telegram' : '邮件和 Telegram'}
                </option>
              </select>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-black text-white font-medium text-sm hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting
              ? (lang === 'en' ? 'Creating...' : '创建中...')
              : (lang === 'en' ? 'Create Task' : '创建任务')}
          </button>
        </form>
      </div>
    </div>
  );
};
