// App.tsx

import React, { useState } from 'react';
import { View, Text } from 'react-native';

import DetectScreen from './src/screens/DetectScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';

const App = () => {
  const [showOnboarding, setShowOnboarding] = useState(true);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  if (showOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  return <DetectScreen />;
};

export default App;