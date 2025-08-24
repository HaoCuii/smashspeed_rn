// App.tsx
import React, { useState } from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';

// Screens
import DetectScreen from './src/screens/DetectScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import TrimScreen from './src/screens/TrimScreen';
import CalibrationScreen from './src/screens/CalibrationScreen';
import AnalyzeScreen from './src/screens/AnalyzeScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import AccountScreen from './src/screens/AccountScreen';
import SpeedResultScreen from './src/screens/SpeedResultScreen';
//import YoloImage from './src/screens/Test';
// ---------- Route types ----------
export type DetectStackParamList = {
  DetectRoot: undefined;
  Trim: { sourceUri: string; duration: number };
  Calibration: { sourceUri: string; duration: number; startSec: number; endSec: number };
  Analyze: { sourceUri: string; startSec: number; endSec: number; metersPerPixel: number };
  SpeedResult: { maxKph: number; angle: number; videoUri: string; startSec: number; endSec: number };
};

const Tab = createBottomTabNavigator();
const DetectStack = createNativeStackNavigator<DetectStackParamList>();
const ResultsStack = createNativeStackNavigator();
const AccountStack = createNativeStackNavigator();

/* ---------------- Stacks ---------------- */

function DetectStackNavigator() {
  return (
    <DetectStack.Navigator screenOptions={{ headerShown: false }}>
      <DetectStack.Screen name="DetectRoot" component={DetectScreen} />
      <DetectStack.Screen name="Trim" component={TrimScreen} />
      <DetectStack.Screen name="Calibration" component={CalibrationScreen} />
      <DetectStack.Screen name="Analyze" component={AnalyzeScreen} />
      <DetectStack.Screen name="SpeedResult" component={SpeedResultScreen} />
    </DetectStack.Navigator>
  );
}

function ResultsStackNavigator() {
  return (
    <ResultsStack.Navigator screenOptions={{ headerShown: false }}>
      <ResultsStack.Screen name="ResultsRoot" component={ResultsScreen} />
    </ResultsStack.Navigator>
  );
}

function AccountStackNavigator() {
  return (
    <AccountStack.Navigator screenOptions={{ headerShown: false }}>
      <AccountStack.Screen name="AccountRoot" component={AccountScreen} />
    </AccountStack.Navigator>
  );
}

/* ---------------- Tabs ---------------- */

function MainTabs() {
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
          if (route.name === 'Detect') iconName = focused ? 'scan' : 'scan-outline';
          else if (route.name === 'Results') iconName = focused ? 'bar-chart' : 'bar-chart-outline';
          else if (route.name === 'Account') iconName = focused ? 'person' : 'person-outline';
          return <Icon name={iconName} size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Detect" component={DetectStackNavigator} />
      <Tab.Screen name="Results" component={ResultsStackNavigator} />
      <Tab.Screen name="Account" component={AccountStackNavigator} />
    </Tab.Navigator>
  );
}

/* ---------------- Root ---------------- */

const App = () => {
  const [showOnboarding, setShowOnboarding] = useState(true);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {showOnboarding ? (
          <OnboardingScreen onComplete={() => setShowOnboarding(false)} />
        ) : (
          <NavigationContainer>
            <MainTabs />
          </NavigationContainer>
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
};

export default App;
