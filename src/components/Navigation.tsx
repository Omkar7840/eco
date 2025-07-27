import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Home, 
  Activity, 
  Users, 
  Trophy, 
  BarChart3, 
  Settings,
  Leaf
} from 'lucide-react';

const navigationItems = [
  { icon: Home, label: 'Dashboard', id: 'dashboard' },
  { icon: Activity, label: 'Track Impact', id: 'track' },
  { icon: BarChart3, label: 'Analytics', id: 'analytics' },
  { icon: Users, label: 'Community', id: 'community' },
  { icon: Trophy, label: 'Achievements', id: 'achievements' },
  { icon: Settings, label: 'Settings', id: 'settings' },
];

interface NavigationProps {
  currentPage: string;
  setCurrentPage: (page: string) => void;
}

const Navigation: React.FC<NavigationProps> = ({ currentPage, setCurrentPage }) => {

  return (
    <motion.nav
      initial={{ x: -250, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 100 }}
      className="fixed left-0 top-0 h-full w-64 bg-white shadow-lg border-r border-gray-200 z-50"
    >
      <div className="p-6">
        <div className="flex items-center space-x-3 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-blue-500 rounded-lg flex items-center justify-center">
            <Leaf className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">EcoTracker</h1>
            <p className="text-sm text-gray-600">Sustainability Platform</p>
          </div>
        </div>

        <ul className="space-y-2">
          {navigationItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;

            return (
              <li key={item.label}>
                <motion.button
                  whileHover={{ x: 4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setCurrentPage(item.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-r from-green-500 to-blue-500 text-white shadow-md'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </motion.button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-6">
        <div className="bg-gradient-to-r from-green-100 to-blue-100 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-1">
            Weekly Challenge
          </h3>
          <p className="text-xs text-gray-600 mb-3">
            Reduce car trips by 50%
          </p>
          <div className="w-full bg-white rounded-full h-2">
            <div className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full w-3/4"></div>
          </div>
          <p className="text-xs text-gray-600 mt-2">75% Complete</p>
        </div>
      </div>
    </motion.nav>
  );
};

export default Navigation;