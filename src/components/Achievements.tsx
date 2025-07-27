import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Award, Lock, CheckCircle, Star } from 'lucide-react';

const Achievements: React.FC = () => {
  const [filter, setFilter] = useState('all');

  const achievements = [
    {
      id: 1,
      title: 'First Steps',
      description: 'Log your first environmental activity',
      icon: '🌱',
      points: 10,
      category: 'general',
      earned: true,
      earnedAt: '2024-01-15',
      progress: 100,
    },
    {
      id: 2,
      title: 'Week Warrior',
      description: 'Complete 7 days of consistent tracking',
      icon: '🗓️',
      points: 50,
      category: 'general',
      earned: true,
      earnedAt: '2024-01-22',
      progress: 100,
    },
    {
      id: 3,
      title: 'Transport Hero',
      description: 'Use sustainable transport 10 times',
      icon: '🚲',
      points: 30,
      category: 'transport',
      earned: false,
      progress: 70,
    },
    {
      id: 4,
      title: 'Energy Saver',
      description: 'Save 100 kWh through sustainable choices',
      icon: '⚡',
      points: 80,
      category: 'energy',
      earned: false,
      progress: 45,
    },
    {
      id: 5,
      title: 'Green Eater',
      description: 'Log 20 sustainable food choices',
      icon: '🥗',
      points: 60,
      category: 'food',
      earned: true,
      earnedAt: '2024-01-28',
      progress: 100,
    },
    {
      id: 6,
      title: 'Waste Reducer',
      description: 'Recycle or compost 50kg of waste',
      icon: '♻️',
      points: 100,
      category: 'waste',
      earned: false,
      progress: 20,
    },
    {
      id: 7,
      title: 'Community Champion',
      description: 'Complete 3 community challenges',
      icon: '🏆',
      points: 150,
      category: 'community',
      earned: false,
      progress: 33,
    },
    {
      id: 8,
      title: 'Eco Master',
      description: 'Reach 500 total impact points',
      icon: '🌍',
      points: 500,
      category: 'general',
      earned: false,
      progress: 87,
    },
  ];

  const categories = [
    { id: 'all', name: 'All', count: achievements.length },
    { id: 'earned', name: 'Earned', count: achievements.filter(a => a.earned).length },
    { id: 'general', name: 'General', count: achievements.filter(a => a.category === 'general').length },
    { id: 'transport', name: 'Transport', count: achievements.filter(a => a.category === 'transport').length },
    { id: 'energy', name: 'Energy', count: achievements.filter(a => a.category === 'energy').length },
    { id: 'food', name: 'Food', count: achievements.filter(a => a.category === 'food').length },
    { id: 'waste', name: 'Waste', count: achievements.filter(a => a.category === 'waste').length },
    { id: 'community', name: 'Community', count: achievements.filter(a => a.category === 'community').length },
  ];

  const filteredAchievements = achievements.filter(achievement => {
    if (filter === 'all') return true;
    if (filter === 'earned') return achievement.earned;
    return achievement.category === filter;
  });

  const totalEarned = achievements.filter(a => a.earned).length;
  const totalPoints = achievements.filter(a => a.earned).reduce((sum, a) => sum + a.points, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Achievements</h1>
        <p className="text-gray-600 mt-1">Track your progress and unlock eco-badges</p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
        >
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-green-100 rounded-lg">
              <Award className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalEarned}</p>
              <p className="text-sm text-gray-600">Achievements Earned</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
        >
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Star className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalPoints}</p>
              <p className="text-sm text-gray-600">Points Earned</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
        >
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-purple-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {Math.round((totalEarned / achievements.length) * 100)}%
              </p>
              <p className="text-sm text-gray-600">Completion Rate</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setFilter(category.id)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              filter === category.id
                ? 'bg-gradient-to-r from-green-500 to-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {category.name} ({category.count})
          </button>
        ))}
      </div>

      {/* Achievements Grid */}
      <motion.div
        layout
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {filteredAchievements.map((achievement, index) => (
          <motion.div
            key={achievement.id}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ y: -5 }}
            className={`bg-white rounded-xl p-6 shadow-lg border transition-all ${
              achievement.earned
                ? 'border-green-200 bg-gradient-to-br from-green-50 to-blue-50'
                : 'border-gray-100 hover:border-gray-200'
            }`}
          >
            <div className="text-center">
              {/* Achievement Icon */}
              <div className={`relative mx-auto mb-4 ${
                achievement.earned ? '' : 'filter grayscale opacity-50'
              }`}>
                <div className="text-4xl mb-2">{achievement.icon}</div>
                {achievement.earned && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center"
                  >
                    <CheckCircle className="w-4 h-4 text-white" />
                  </motion.div>
                )}
                {!achievement.earned && (
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center">
                    <Lock className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>

              {/* Achievement Info */}
              <h3 className={`text-lg font-bold mb-2 ${
                achievement.earned ? 'text-gray-900' : 'text-gray-500'
              }`}>
                {achievement.title}
              </h3>
              <p className={`text-sm mb-4 ${
                achievement.earned ? 'text-gray-600' : 'text-gray-400'
              }`}>
                {achievement.description}
              </p>

              {/* Progress Bar */}
              {!achievement.earned && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span>{achievement.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${achievement.progress}%` }}
                      transition={{ duration: 1, delay: 0.2 }}
                      className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full"
                    />
                  </div>
                </div>
              )}

              {/* Points and Date */}
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${
                  achievement.earned ? 'text-green-600' : 'text-gray-400'
                }`}>
                  {achievement.points} points
                </span>
                {achievement.earned && achievement.earnedAt && (
                  <span className="text-xs text-gray-500">
                    Earned {new Date(achievement.earnedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {filteredAchievements.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🏆</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No achievements found</h3>
          <p className="text-gray-600">Try adjusting your filter to see more achievements.</p>
        </div>
      )}
    </div>
  );
};

export default Achievements;