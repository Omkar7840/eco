export interface User {
  id: string;
  email: string;
  username: string;
  avatar_url?: string;
  total_points: number;
  level: number;
  created_at: string;
}

export interface Activity {
  id: string;
  user_id: string;
  category: 'transport' | 'energy' | 'food' | 'waste';
  type: string;
  value: number;
  impact_score: number;
  date: string;
  notes?: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  category: string;
  target_value: number;
  points_reward: number;
  start_date: string;
  end_date: string;
  participants: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  points_required: number;
  category: string;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  earned_at: string;
  achievement: Achievement;
}

export interface DashboardData {
  totalImpact: number;
  weeklyProgress: Array<{
    date: string;
    transport: number;
    energy: number;
    food: number;
    waste: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    value: number;
    change: number;
  }>;
  recentActivities: Activity[];
  achievements: UserAchievement[];
}