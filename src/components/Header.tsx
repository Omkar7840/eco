import React from 'react';
import { motion } from 'framer-motion';
import { Bell, Search, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { signOut } from '../lib/supabase';

const Header: React.FC = () => {
  const { user } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <motion.header
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="bg-white shadow-sm border-b border-gray-200 px-6 py-4 ml-64"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search activities, challenges..."
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none w-80"
            />
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="relative p-2 text-gray-600 hover:text-green-600 transition-colors"
          >
            <Bell className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
              3
            </span>
          </motion.button>

          <div className="flex items-center space-x-3">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">
                {user?.user_metadata?.username || 'User'}
              </p>
              <p className="text-xs text-gray-500">Level 5 Eco Warrior</p>
            </div>
            <div className="relative">
              <motion.button
                whileHover={{ scale: 1.05 }}
                onClick={handleSignOut}
                className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white"
              >
                <User className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </motion.header>
  );
};

export default Header;