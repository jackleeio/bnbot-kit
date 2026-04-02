"use client";

import { useState, useEffect } from "react";
import TaskCard from "@/components/task/task-card";

interface Task {
  id: string;
  content: string;
  timestamp: string;
}

export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  
  // 模拟从API获取任务数据
  useEffect(() => {
    // 这里可以替换为实际的API调用
    const mockTasks: Task[] = [
      { id: "1", content: "Falcon 9 lifts off from pad 40 in Florida, delivering 23 satellites to the constellation", timestamp: "11小时前" },
      { id: "2", content: "Would be interesting to hear more people weigh in on this for consideration...", timestamp: "46小时前" },
      { id: "3", content: "Um sonho tornado realidade, Portugal vai receber o Mundial 2030 e encher-nos de orgulho. Juntos!", timestamp: "32小时前" },
      { id: "4", content: "Starbase, Texas, rocket factory", timestamp: "2小时前" },
      { id: "5", content: "I love this meme", timestamp: "25小时前" },
      { id: "6", content: "Best fake ad ever. This meme ad was made in 2013 when it was actually vaguely possible that it might be real.", timestamp: "28小时前" },
      { id: "7", content: "Come n get yours n celebrate #missionary", timestamp: "39小时前" },
      { id: "8", content: "I do love this meme", timestamp: "18小时前" },
      { id: "9", content: "Just 13 days til The Tortured Poets Department: The Anthology on vinyl and CD", timestamp: "46小时前" },
      { id: "10", content: "Next target to TSLA: $694.20", timestamp: "15小时前" },
    ];
    
    setTasks(mockTasks);
  }, []);
  
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">任务看板</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tasks.map((task) => (
          <TaskCard 
            key={task.id}
            content={task.content}
            hours={task.timestamp}
          />
        ))}
      </div>
    </div>
  );
}