// App.tsx
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';

import DetectScreen from './src/screens/DetectScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import TrimScreen from './src/screens/TrimScreen';
import CalibrationScreen from './src/screens/CalibrationScreen';

// ---------- Route types (Step 3) ----------
export type RootStackParamList = {
  Tabs: undefined;
  Trim: { sourceUri: string; duration: number };
  Calibration: { sourceUri: string; duration: number; startSec: number; endSec: number };
};

// --- Placeholder Screens ---
function ResultsScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Results</Text>
    </View>
  );
}

function AccountScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Account</Text>
    </View>
  );
}

// --- Navigators ---
const Tab = createBottomTabNavigator();
// Step 3: type the stack with RootStackParamList
const Stack = createNativeStackNavigator<RootStackParamList>();

const MainTabs = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#8e8e93',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 0,
          height: 70,
          paddingBottom: 10,
        },
        tabBarLabel: ({ color }) => (
          <Text style={{ color, fontSize: 10 }}>{route.name}</Text>
        ),
        tabBarIcon: ({ focused, color }) => {
          let iconName = '';
          if (route.name === 'Detect')
            iconName = focused ? 'scan' : 'scan-outline';
          else if (route.name === 'Results')
            iconName = focused ? 'bar-chart' : 'bar-chart-outline';
          else if (route.name === 'Account')
            iconName = focused ? 'person' : 'person-outline';
          return <Icon name={iconName} size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Detect" component={DetectScreen} />
      <Tab.Screen name="Results" component={ResultsScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
};

const RootNavigator = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Tabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Trim"
        component={TrimScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Calibration"
        component={CalibrationScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
};

// --- Main App Component ---
const App = () => {
  const [showOnboarding, setShowOnboarding] = useState(true);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {showOnboarding ? (
          <OnboardingScreen onComplete={handleOnboardingComplete} />
        ) : (
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
};

export default App;
