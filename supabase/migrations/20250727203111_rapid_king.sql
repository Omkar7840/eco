/*
  # EcoTracker Database Schema

  1. New Tables
    - `profiles` - User profile information with sustainability tracking
    - `activities` - Individual environmental activities logged by users
    - `challenges` - Community challenges for sustainable behavior
    - `achievements` - Available achievements and badges
    - `user_achievements` - Junction table for user-earned achievements
    - `challenge_participants` - Users participating in challenges
    - `activity_types` - Predefined activity types with impact calculations

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
    - Add policies for public read access to challenges and achievements
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  username text UNIQUE NOT NULL,
  avatar_url text,
  total_points bigint DEFAULT 0,
  level integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create activity_types table
CREATE TABLE IF NOT EXISTS activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('transport', 'energy', 'food', 'waste')),
  name text NOT NULL,
  description text,
  base_impact_score numeric DEFAULT 0,
  unit text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create activities table
CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  activity_type_id uuid REFERENCES activity_types(id) NOT NULL,
  value numeric NOT NULL,
  impact_score numeric NOT NULL,
  notes text,
  date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

-- Create challenges table
CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  target_value numeric NOT NULL,
  points_reward integer DEFAULT 0,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create achievements table
CREATE TABLE IF NOT EXISTS achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL,
  points_required integer DEFAULT 0,
  category text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create user_achievements table
CREATE TABLE IF NOT EXISTS user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  achievement_id uuid REFERENCES achievements(id) NOT NULL,
  earned_at timestamptz DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);

-- Create challenge_participants table
CREATE TABLE IF NOT EXISTS challenge_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  challenge_id uuid REFERENCES challenges(id) ON DELETE CASCADE NOT NULL,
  current_progress numeric DEFAULT 0,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(user_id, challenge_id)
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Activities policies
CREATE POLICY "Users can view own activities"
  ON activities FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activities"
  ON activities FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own activities"
  ON activities FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Challenges policies (public read access)
CREATE POLICY "Anyone can view challenges"
  ON challenges FOR SELECT
  TO authenticated
  USING (true);

-- Achievements policies (public read access)
CREATE POLICY "Anyone can view achievements"
  ON achievements FOR SELECT
  TO authenticated
  USING (true);

-- Activity types policies (public read access)
CREATE POLICY "Anyone can view activity types"
  ON activity_types FOR SELECT
  TO authenticated
  USING (true);

-- User achievements policies
CREATE POLICY "Users can view own achievements"
  ON user_achievements FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own achievements"
  ON user_achievements FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Challenge participants policies
CREATE POLICY "Users can view own challenge participation"
  ON challenge_participants FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can join challenges"
  ON challenge_participants FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own challenge progress"
  ON challenge_participants FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Insert sample activity types
INSERT INTO activity_types (category, name, description, base_impact_score, unit) VALUES
('transport', 'Car Drive', 'Driving a gasoline car', -5, 'km'),
('transport', 'Bike Ride', 'Cycling instead of driving', 3, 'km'),
('transport', 'Public Transport', 'Using bus or train', 2, 'km'),
('transport', 'Walking', 'Walking instead of driving', 1, 'km'),
('energy', 'Solar Power', 'Using solar energy', 8, 'kWh'),
('energy', 'Grid Electricity', 'Using standard grid electricity', -3, 'kWh'),
('energy', 'LED Lighting', 'Switching to LED bulbs', 2, 'hours'),
('food', 'Vegetarian Meal', 'Eating vegetarian instead of meat', 4, 'meal'),
('food', 'Local Food', 'Buying locally sourced food', 3, 'meal'),
('food', 'Organic Food', 'Choosing organic options', 2, 'meal'),
('waste', 'Recycling', 'Recycling materials', 5, 'kg'),
('waste', 'Composting', 'Composting organic waste', 4, 'kg'),
('waste', 'Reusing Items', 'Reusing instead of throwing away', 3, 'item');

-- Insert sample achievements
INSERT INTO achievements (title, description, icon, points_required, category) VALUES
('First Steps', 'Log your first environmental activity', '🌱', 0, 'general'),
('Week Warrior', 'Complete 7 days of consistent tracking', '🗓️', 50, 'general'),
('Transport Hero', 'Use sustainable transport 10 times', '🚲', 30, 'transport'),
('Energy Saver', 'Save 100 kWh through sustainable choices', '⚡', 80, 'energy'),
('Green Eater', 'Log 20 sustainable food choices', '🥗', 60, 'food'),
('Waste Reducer', 'Recycle or compost 50kg of waste', '♻️', 100, 'waste'),
('Community Champion', 'Complete 3 community challenges', '🏆', 150, 'community'),
('Eco Master', 'Reach 500 total impact points', '🌍', 500, 'general');

-- Insert sample challenges
INSERT INTO challenges (title, description, category, target_value, points_reward, start_date, end_date) VALUES
('Bike to Work Week', 'Use your bike for commuting instead of driving for one week', 'transport', 50, 25, CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days'),
('Zero Waste Challenge', 'Reduce household waste to zero for one week', 'waste', 0, 30, CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days'),
('Vegetarian Month', 'Eat vegetarian meals for 30 days', 'food', 30, 50, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days'),
('Energy Efficiency Challenge', 'Reduce energy consumption by 20% this month', 'energy', 20, 40, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days');

-- Create function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (user_id, username)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)));
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for profiles updated_at
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();