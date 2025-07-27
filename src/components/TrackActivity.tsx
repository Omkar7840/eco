import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Car, Zap, Utensils, Trash2, Save, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface ActivityType {
  id: string;
  category: string;
  name: string;
  description: string;
  base_impact_score: number;
  unit: string;
}

const TrackActivity: React.FC = () => {
  const { user } = useAuth();
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('transport');
  const [selectedType, setSelectedType] = useState<ActivityType | null>(null);
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const categories = [
    { id: 'transport', name: 'Transport', icon: Car, color: 'red' },
    { id: 'energy', name: 'Energy', icon: Zap, color: 'yellow' },
    { id: 'food', name: 'Food', icon: Utensils, color: 'green' },
    { id: 'waste', name: 'Waste', icon: Trash2, color: 'blue' },
  ];

  useEffect(() => {
    fetchActivityTypes();
  }, []);

  const fetchActivityTypes = async () => {
    const { data, error } = await supabase
      .from('activity_types')
      .select('*')
      .order('category', { ascending: true });

    if (!error && data) {
      setActivityTypes(data);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !value || !user) return;

    setLoading(true);
    const impactScore = parseFloat(value) * selectedType.base_impact_score;

    const { error } = await supabase
      .from('activities')
      .insert({
        user_id: user.id,
        activity_type_id: selectedType.id,
        value: parseFloat(value),
        impact_score: impactScore,
        notes: notes || null,
      });

    if (!error) {
      setValue('');
      setNotes('');
      setSelectedType(null);
      setShowForm(false);
    }

    setLoading(false);
  };

  const filteredTypes = activityTypes.filter(type => type.category === selectedCategory);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Track Your Impact</h1>
          <p className="text-gray-600 mt-1">Log your daily environmental activities</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowForm(true)}
          className="bg-gradient-to-r from-green-500 to-blue-500 text-white px-6 py-3 rounded-lg font-medium shadow-lg hover:shadow-xl transition-shadow flex items-center space-x-2"
        >
          <Plus className="w-5 h-5" />
          <span>Add Activity</span>
        </motion.button>
      </div>

      {/* Category Selection */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {categories.map((category) => {
          const Icon = category.icon;
          const isActive = selectedCategory === category.id;
          
          return (
            <motion.button
              key={category.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedCategory(category.id)}
              className={`p-6 rounded-xl border-2 transition-all ${
                isActive
                  ? `border-${category.color}-500 bg-${category.color}-50`
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Icon className={`w-8 h-8 mx-auto mb-3 ${
                isActive ? `text-${category.color}-600` : 'text-gray-600'
              }`} />
              <h3 className="font-semibold text-gray-900">{category.name}</h3>
            </motion.button>
          );
        })}
      </div>

      {/* Activity Form Modal */}
      {showForm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-xl p-6 w-full max-w-md"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Log Activity</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Activity Type
                </label>
                <select
                  value={selectedType?.id || ''}
                  onChange={(e) => {
                    const type = filteredTypes.find(t => t.id === e.target.value);
                    setSelectedType(type || null);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  required
                >
                  <option value="">Select an activity</option>
                  {filteredTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedType && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Value ({selectedType.unit})
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder={`Enter ${selectedType.unit}`}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Notes (optional)
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      rows={3}
                      placeholder="Add any additional details..."
                    />
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm text-gray-600">
                      Impact Score: <span className="font-semibold">
                        {value ? (parseFloat(value) * selectedType.base_impact_score).toFixed(1) : '0'} points
                      </span>
                    </p>
                  </div>
                </>
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !selectedType || !value}
                  className="flex-1 bg-gradient-to-r from-green-500 to-blue-500 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Save Activity</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}

      {/* Recent Activities */}
      <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activities</h3>
        <div className="space-y-3">
          {[1, 2, 3].map((_, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Car className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Bike to work</p>
                  <p className="text-sm text-gray-500">5 km • 2 hours ago</p>
                </div>
              </div>
              <span className="text-green-600 font-semibold">+15 pts</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TrackActivity;