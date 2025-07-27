import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Trophy, Calendar, Target, TrendingUp } from 'lucide-react';

const Community: React.FC = () => {
  const [activeTab, setActiveTab] = useState('challenges');

  const challenges = [
    {
      id: 1,
      title: 'Bike to Work Week',
      description: 'Use your bike for commuting instead of driving',
      category: 'Transport',
      participants: 234,
      daysLeft: 5,
      progress: 68,
      reward: 25,
    },
    {
      id: 2,
      title: 'Zero Waste Challenge',
      description: 'Reduce household waste to zero for one week',
      category: 'Waste',
      participants: 156,
      daysLeft: 12,
      progress: 45,
      reward: 30,
    },
    {
      id: 3,
      title: 'Vegetarian Month',
      description: 'Eat vegetarian meals for 30 days',
      category: 'Food',
      participants: 89,
      daysLeft: 18,
      progress: 23,
      reward: 50,
    },
  ];

  const leaderboard = [
    { rank: 1, name: 'EcoWarrior23', points: 2847, avatar: '🌱' },
    { rank: 2, name: 'GreenThumb', points: 2634, avatar: '🌿' },
    { rank: 3, name: 'SustainableSam', points: 2456, avatar: '♻️' },
    { rank: 4, name: 'ClimateChamp', points: 2234, avatar: '🌍' },
    { rank: 5, name: 'EcoFriendly', points: 2156, avatar: '🌳' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Community</h1>
        <p className="text-gray-600 mt-1">Join challenges and compete with eco-warriors worldwide</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
        {[
          { id: 'challenges', label: 'Challenges', icon: Target },
          { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-md font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-green-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Challenges Tab */}
      {activeTab === 'challenges' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="grid gap-6">
            {challenges.map((challenge) => (
              <motion.div
                key={challenge.id}
                whileHover={{ y: -2 }}
                className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-xl font-bold text-gray-900">{challenge.title}</h3>
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                        {challenge.category}
                      </span>
                    </div>
                    <p className="text-gray-600 mb-4">{challenge.description}</p>
                    
                    <div className="flex items-center space-x-6 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <Users className="w-4 h-4" />
                        <span>{challenge.participants} participants</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Calendar className="w-4 h-4" />
                        <span>{challenge.daysLeft} days left</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Trophy className="w-4 h-4" />
                        <span>{challenge.reward} points reward</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Progress</span>
                    <span className="font-semibold text-gray-900">{challenge.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${challenge.progress}%` }}
                      transition={{ duration: 1, delay: 0.2 }}
                      className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full"
                    />
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full mt-4 bg-gradient-to-r from-green-500 to-blue-500 text-white py-3 rounded-lg font-medium hover:shadow-lg transition-shadow"
                >
                  Join Challenge
                </motion.button>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Leaderboard Tab */}
      {activeTab === 'leaderboard' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-blue-500 p-6 text-white">
              <h3 className="text-xl font-bold mb-2">Global Leaderboard</h3>
              <p className="opacity-90">Top eco-warriors this month</p>
            </div>

            <div className="p-6">
              <div className="space-y-4">
                {leaderboard.map((user, index) => (
                  <motion.div
                    key={user.rank}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`flex items-center space-x-4 p-4 rounded-lg ${
                      user.rank <= 3 ? 'bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200' : 'bg-gray-50'
                    }`}
                  >
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${
                      user.rank === 1 ? 'bg-yellow-500 text-white' :
                      user.rank === 2 ? 'bg-gray-400 text-white' :
                      user.rank === 3 ? 'bg-orange-500 text-white' :
                      'bg-gray-200 text-gray-700'
                    }`}>
                      {user.rank}
                    </div>
                    
                    <div className="text-2xl">{user.avatar}</div>
                    
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{user.name}</p>
                      <p className="text-sm text-gray-500">Eco Warrior</p>
                    </div>
                    
                    <div className="text-right">
                      <p className="font-bold text-gray-900">{user.points.toLocaleString()}</p>
                      <p className="text-sm text-gray-500">points</p>
                    </div>
                    
                    {user.rank <= 3 && (
                      <Trophy className={`w-5 h-5 ${
                        user.rank === 1 ? 'text-yellow-500' :
                        user.rank === 2 ? 'text-gray-400' :
                        'text-orange-500'
                      }`} />
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          </div>

          {/* Your Rank */}
          <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Your Rank</h3>
                <p className="text-gray-600">Keep going to climb higher!</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-gray-900">#142</p>
                <div className="flex items-center space-x-1 text-green-600">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm font-medium">+23 this week</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default Community;