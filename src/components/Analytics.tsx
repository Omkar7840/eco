import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, TrendingUp, TrendingDown, BarChart3, PieChart } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart as RechartsPieChart, Pie, Cell } from 'recharts';

const Analytics: React.FC = () => {
  const [timeRange, setTimeRange] = useState('month');

  const monthlyData = [
    { month: 'Jan', transport: 45, energy: 32, food: 28, waste: 15, total: 120 },
    { month: 'Feb', transport: 38, energy: 35, food: 32, waste: 18, total: 123 },
    { month: 'Mar', transport: 42, energy: 28, food: 35, waste: 22, total: 127 },
    { month: 'Apr', transport: 35, energy: 40, food: 38, waste: 25, total: 138 },
    { month: 'May', transport: 30, energy: 45, food: 42, waste: 28, total: 145 },
    { month: 'Jun', transport: 28, energy: 48, food: 45, waste: 32, total: 153 },
  ];

  const weeklyData = [
    { week: 'Week 1', transport: 8, energy: 12, food: 10, waste: 6 },
    { week: 'Week 2', transport: 6, energy: 15, food: 12, waste: 8 },
    { week: 'Week 3', transport: 10, energy: 11, food: 14, waste: 7 },
    { week: 'Week 4', transport: 4, energy: 10, food: 9, waste: 11 },
  ];

  const categoryBreakdown = [
    { name: 'Transport', value: 35, color: '#ef4444', improvement: -12 },
    { name: 'Energy', value: 30, color: '#f59e0b', improvement: 8 },
    { name: 'Food', value: 20, color: '#10b981', improvement: 15 },
    { name: 'Waste', value: 15, color: '#6366f1', improvement: 22 },
  ];

  const impactTrends = [
    { category: 'Transport', current: 142, previous: 165, change: -14 },
    { category: 'Energy', current: 98, previous: 87, change: 13 },
    { category: 'Food', current: 76, previous: 68, change: 12 },
    { category: 'Waste', current: 54, previous: 42, change: 29 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-600 mt-1">Deep insights into your environmental impact</p>
        </div>
        
        <div className="flex space-x-2">
          {[
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
            { id: 'year', label: 'Year' },
          ].map((range) => (
            <button
              key={range.id}
              onClick={() => setTimeRange(range.id)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                timeRange === range.id
                  ? 'bg-gradient-to-r from-green-500 to-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {impactTrends.map((trend, index) => {
          const isPositive = trend.change > 0;
          return (
            <motion.div
              key={trend.category}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-600">{trend.category}</h3>
                {isPositive ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                )}
              </div>
              <p className="text-2xl font-bold text-gray-900 mb-1">{trend.current}</p>
              <p className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                {isPositive ? '+' : ''}{trend.change}% from last period
              </p>
            </motion.div>
          );
        })}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Impact Trend Chart */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
        >
          <div className="flex items-center space-x-2 mb-6">
            <BarChart3 className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-900">Impact Trend</h3>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                  }} 
                />
                <Line 
                  type="monotone" 
                  dataKey="total" 
                  stroke="#10b981" 
                  strokeWidth={3}
                  dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Category Breakdown */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
        >
          <div className="flex items-center space-x-2 mb-6">
            <PieChart className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-900">Category Breakdown</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPieChart>
                <Pie
                  data={categoryBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3 mt-4">
            {categoryBreakdown.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm font-medium text-gray-700">{item.name}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-semibold text-gray-900">{item.value}%</span>
                  <span className={`text-xs font-medium ${
                    item.improvement > 0 ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {item.improvement > 0 ? '+' : ''}{item.improvement}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Weekly Comparison */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-6">Weekly Comparison</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" stroke="#666" />
              <YAxis stroke="#666" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }} 
              />
              <Bar dataKey="transport" stackId="a" fill="#ef4444" />
              <Bar dataKey="energy" stackId="a" fill="#f59e0b" />
              <Bar dataKey="food" stackId="a" fill="#10b981" />
              <Bar dataKey="waste" stackId="a" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Insights */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Insights</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <h4 className="font-semibold text-green-800 mb-2">🎉 Great Progress!</h4>
              <p className="text-sm text-green-700">
                Your food impact has improved by 15% this month. Keep choosing sustainable options!
              </p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <h4 className="font-semibold text-blue-800 mb-2">💡 Tip</h4>
              <p className="text-sm text-blue-700">
                Consider biking more often. Your transport impact could improve by 20% with just 2 more bike trips per week.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
              <h4 className="font-semibold text-yellow-800 mb-2">⚠️ Area for Improvement</h4>
              <p className="text-sm text-yellow-700">
                Your transport emissions increased this month. Try using public transport or carpooling more often.
              </p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
              <h4 className="font-semibold text-purple-800 mb-2">🏆 Achievement Unlocked</h4>
              <p className="text-sm text-purple-700">
                You're in the top 25% of users for waste reduction. Amazing work!
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Analytics;