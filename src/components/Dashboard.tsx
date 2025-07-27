import React from 'react';
import { motion } from 'framer-motion';
import { 
  TrendingUp, 
  TrendingDown, 
  Car, 
  Zap, 
  Utensils, 
  Trash2,
  Award,
  Target
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const weeklyData = [
  { day: 'Mon', transport: 8, energy: 12, food: 6, waste: 4 },
  { day: 'Tue', transport: 6, energy: 10, food: 8, waste: 3 },
  { day: 'Wed', transport: 4, energy: 11, food: 7, waste: 5 },
  { day: 'Thu', transport: 5, energy: 9, food: 5, waste: 4 },
  { day: 'Fri', transport: 7, energy: 13, food: 9, waste: 6 },
  { day: 'Sat', transport: 3, energy: 8, food: 4, waste: 2 },
  { day: 'Sun', transport: 2, energy: 7, food: 6, waste: 3 },
];

const categoryData = [
  { name: 'Transport', value: 35, color: '#ef4444' },
  { name: 'Energy', value: 30, color: '#f59e0b' },
  { name: 'Food', value: 20, color: '#10b981' },
  { name: 'Waste', value: 15, color: '#6366f1' },
];

const stats = [
  {
    title: 'Total Impact Score',
    value: '87.2',
    change: -12.5,
    icon: TrendingUp,
    color: 'green',
  },
  {
    title: 'Weekly Progress',
    value: '76%',
    change: 8.2,
    icon: Target,
    color: 'blue',
  },
  {
    title: 'Community Rank',
    value: '#142',
    change: 23,
    icon: Award,
    color: 'purple',
  },
];

const Dashboard: React.FC = () => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: 'spring',
        stiffness: 100,
      },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Welcome back, Alex!</h1>
          <p className="text-gray-600 mt-1">Here's your environmental impact overview</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="bg-gradient-to-r from-green-500 to-blue-500 text-white px-6 py-3 rounded-lg font-medium shadow-lg hover:shadow-xl transition-shadow"
        >
          Log New Activity
        </motion.button>
      </div>

      {/* Stats Grid */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          const isPositive = stat.change > 0;
          
          return (
            <motion.div
              key={stat.title}
              whileHover={{ y: -5 }}
              className="bg-white rounded-xl p-6 shadow-lg border border-gray-100"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-lg bg-${stat.color}-100`}>
                  <Icon className={`w-6 h-6 text-${stat.color}-600`} />
                </div>
              </div>
              <div className="flex items-center mt-4">
                {isPositive ? (
                  <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-500 mr-1" />
                )}
                <span className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                  {Math.abs(stat.change)}%
                </span>
                <span className="text-sm text-gray-500 ml-1">from last week</span>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly Trend Chart */}
        <motion.div variants={itemVariants} className="lg:col-span-2 bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Weekly Impact Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="colorTransport" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1}/>
                  </linearGradient>
                  <linearGradient id="colorEnergy" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                  }} 
                />
                <Area type="monotone" dataKey="transport" stackId="1" stroke="#ef4444" fill="url(#colorTransport)" />
                <Area type="monotone" dataKey="energy" stackId="1" stroke="#f59e0b" fill="url(#colorEnergy)" />
                <Area type="monotone" dataKey="food" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
                <Area type="monotone" dataKey="waste" stackId="1" stroke="#6366f1" fill="#6366f1" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Category Breakdown */}
        <motion.div variants={itemVariants} className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Impact by Category</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3 mt-4">
            {categoryData.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: item.color }}
                  ></div>
                  <span className="text-sm font-medium text-gray-700">{item.name}</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">{item.value}%</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Quick Actions & Recent Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <motion.div variants={itemVariants} className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: Car, label: 'Log Transport', color: 'red' },
              { icon: Zap, label: 'Track Energy', color: 'yellow' },
              { icon: Utensils, label: 'Food Impact', color: 'green' },
              { icon: Trash2, label: 'Waste Log', color: 'blue' },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <motion.button
                  key={action.label}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`p-4 rounded-lg border-2 border-${action.color}-200 hover:border-${action.color}-300 hover:bg-${action.color}-50 transition-all`}
                >
                  <Icon className={`w-6 h-6 text-${action.color}-600 mx-auto mb-2`} />
                  <p className="text-sm font-medium text-gray-700">{action.label}</p>
                </motion.button>
              );
            })}
          </div>
        </motion.div>

        {/* Recent Activities */}
        <motion.div variants={itemVariants} className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activities</h3>
          <div className="space-y-4">
            {[
              { type: 'Bike to work', category: 'Transport', impact: '+5 points', time: '2 hours ago', color: 'green' },
              { type: 'Solar energy used', category: 'Energy', impact: '+8 points', time: '5 hours ago', color: 'yellow' },
              { type: 'Vegetarian lunch', category: 'Food', impact: '+3 points', time: '1 day ago', color: 'green' },
              { type: 'Recycled bottles', category: 'Waste', impact: '+4 points', time: '2 days ago', color: 'blue' },
            ].map((activity, index) => (
              <div key={index} className="flex items-center space-x-4 p-3 rounded-lg bg-gray-50">
                <div className={`w-10 h-10 rounded-full bg-${activity.color}-100 flex items-center justify-center`}>
                  <div className={`w-3 h-3 rounded-full bg-${activity.color}-500`}></div>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{activity.type}</p>
                  <p className="text-xs text-gray-500">{activity.category} • {activity.time}</p>
                </div>
                <span className="text-sm font-semibold text-green-600">{activity.impact}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default Dashboard;