import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Dimensions,
  StyleSheet,
  FlatList,
  PanGestureHandler,
  State as GestureState,
} from 'react-native';
import { BlurView } from '@react-native-community/blur';
import Video from 'react-native-video';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { LineChart } from 'react-native-chart-kit';
import Slider from '@react-native-community/slider';
import firestore from '@react-native-firebase/firestore';
import auth, { onAuthStateChanged } from '@react-native-firebase/auth';
import storage from '@react-native-firebase/storage';
// Removed i18n import
import Icon from 'react-native-vector-icons/MaterialIcons';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// MARK: - Helper Types
const TimeRange = {
  WEEK: { key: 'week', value: 'Past Week' },
  MONTH: { key: 'month', value: 'Past Month' },
  ALL: { key: 'all', value: 'All Time' },
};

const TIME_RANGES = [TimeRange.WEEK, TimeRange.MONTH, TimeRange.ALL];

// MARK: - Glass Panel Component
const GlassPanel = ({ children, style }) => (
  <BlurView
    style={[styles.glassPanel, style]}
    blurType="light"
    blurAmount={10}
    reducedTransparencyFallbackColor="rgba(255, 255, 255, 0.1)"
  >
    {children}
  </BlurView>
);

// MARK: - Stat Row Component
const StatRow = ({ label, value }) => {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
};

// MARK: - History Row Component
const HistoryRow = ({ result, onDelete }) => {
  const hasVideo = result.videoURL && result.frameData;

  const handleDelete = () => {
    Alert.alert(
      'Delete Result',
      'Are you sure you want to delete this result?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: () => onDelete(result)
        }
      ]
    );
  };

  const content = (
    <View style={styles.historyRowContent}>
      {hasVideo && (
        <Icon name="play-circle-filled" size={24} color="#007AFF" />
      )}
      <View style={styles.historyRowDate}>
        <Text style={styles.historyRowDateText}>
          {new Date(result.date.seconds * 1000).toLocaleDateString()}
        </Text>
        <Text style={styles.historyRowTimeText}>
          {new Date(result.date.seconds * 1000).toLocaleTimeString()}
        </Text>
      </View>
      <Text style={styles.historyRowSpeed}>{result.formattedSpeed}</Text>
    </View>
  );

  return (
    <TouchableOpacity
      style={styles.historyRow}
      onPress={hasVideo ? () => {/* Navigate to detail */} : undefined}
      onLongPress={handleDelete}
    >
      <GlassPanel style={styles.historyRowPanel}>
        {content}
      </GlassPanel>
    </TouchableOpacity>
  );
};

// MARK: - Chart Component
const ProgressChart = ({ data, selectedRange, onDataPointSelect }) => {
  const [selectedPoint, setSelectedPoint] = useState(null);

  if (!data || data.length <= 1) {
    return (
      <View style={styles.noDataContainer}>
        <Text style={styles.noDataText}>Not enough data to display chart</Text>
      </View>
    );
  }

  const chartData = {
    labels: data.map(point => {
      const date = new Date(point.date);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }),
    datasets: [{
      data: data.map(point => point.topSpeed),
      color: (opacity = 1) => `rgba(0, 122, 255, ${opacity})`,
      strokeWidth: 3,
    }],
  };

  const chartConfig = {
    backgroundColor: 'transparent',
    backgroundGradientFrom: 'transparent',
    backgroundGradientTo: 'transparent',
    decimalPlaces: 1,
    color: (opacity = 1) => `rgba(0, 122, 255, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(60, 60, 67, ${opacity})`,
    style: { borderRadius: 16 },
    propsForDots: {
      r: '6',
      strokeWidth: '2',
      stroke: '#007AFF'
    }
  };

  return (
    <View style={styles.chartContainer}>
      <LineChart
        data={chartData}
        width={screenWidth - 80}
        height={200}
        chartConfig={chartConfig}
        bezier
        onDataPointClick={({ index }) => {
          setSelectedPoint(data[index]);
          onDataPointSelect(data[index]);
        }}
      />
    </View>
  );
};

// MARK: - Filter Controls Component
const FilterControls = ({
  selectedRange,
  onRangeChange,
  speedFilterEnabled,
  onSpeedFilterChange,
  minimumSpeed,
  onMinimumSpeedChange
}) => {
  return (
    <GlassPanel style={styles.filterPanel}>
      <Text style={styles.filterTitle}>Filters</Text>
      
      {/* Time Range Picker */}
      <View style={styles.segmentedControl}>
        {TIME_RANGES.map((range) => (
          <TouchableOpacity
            key={range.key}
            style={[
              styles.segmentedButton,
              selectedRange.key === range.key && styles.segmentedButtonActive
            ]}
            onPress={() => onRangeChange(range)}
          >
            <Text style={[
              styles.segmentedButtonText,
              selectedRange.key === range.key && styles.segmentedButtonTextActive
            ]}>
              {range.value}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.divider} />

      {/* Speed Filter Toggle */}
      <TouchableOpacity
        style={styles.toggleRow}
        onPress={() => onSpeedFilterChange(!speedFilterEnabled)}
      >
        <Text style={styles.toggleLabel}>Filter by Speed</Text>
        <View style={[styles.switch, speedFilterEnabled && styles.switchActive]}>
          <View style={[styles.switchThumb, speedFilterEnabled && styles.switchThumbActive]} />
        </View>
      </TouchableOpacity>

      {/* Speed Slider */}
      {speedFilterEnabled && (
        <View style={styles.sliderContainer}>
          <View style={styles.sliderHeader}>
            <Text style={styles.sliderLabel}>Minimum Speed</Text>
            <Text style={styles.sliderValue}>{Math.round(minimumSpeed)} km/h</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={50}
            maximumValue={400}
            step={5}
            value={minimumSpeed}
            onValueChange={onMinimumSpeedChange}
            minimumTrackTintColor="#007AFF"
            maximumTrackTintColor="#E5E5EA"
            thumbStyle={styles.sliderThumb}
          />
        </View>
      )}
    </GlassPanel>
  );
};

// MARK: - Main History View
const HistoryView = () => {
  // Auth State
  const [user, setUser] = useState(null);
  const [authState, setAuthState] = useState('loading'); // 'loading', 'signedIn', 'signedOut'
  
  // Data State
  const [allResults, setAllResults] = useState([]);
  const [filteredResults, setFilteredResults] = useState([]);
  const [chartData, setChartData] = useState([]);
  
  // Filter State
  const [selectedRange, setSelectedRange] = useState(TimeRange.WEEK);
  const [speedFilterEnabled, setSpeedFilterEnabled] = useState(false);
  const [minimumSpeed, setMinimumSpeed] = useState(150);
  const [selectedDataPoint, setSelectedDataPoint] = useState(null);

  // Auth State Management
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth(), (user) => {
      if (user) {
        setAuthState('signedIn');
        setUser(user);
      } else {
        setAuthState('signedOut');
        setUser(null);
      }
    });

    return unsubscribe;
  }, []);

  // Computed values
  const filteredTopSpeed = filteredResults.length > 0 
    ? Math.max(...filteredResults.map(r => r.peakSpeedKph)) 
    : 0;
  
  const filteredAverageSpeed = filteredResults.length > 0
    ? filteredResults.reduce((sum, r) => sum + r.peakSpeedKph, 0) / filteredResults.length
    : 0;

  // Subscribe to Firestore
  useEffect(() => {
    if (authState !== 'signedIn' || !user?.uid) return;

    const unsubscribe = firestore()
      .collection('detections')
      .where('userID', '==', user.uid)
      .orderBy('date', 'desc')
      .onSnapshot((snapshot) => {
        const results = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          formattedSpeed: `${doc.data().peakSpeedKph.toFixed(1)} km/h`
        }));
        setAllResults(results);
      });

    return unsubscribe;
  }, [authState, user?.uid]);

  // Apply filters
  useEffect(() => {
    applyFilters();
  }, [allResults, selectedRange, speedFilterEnabled, minimumSpeed]);

  const applyFilters = useCallback(() => {
    const now = new Date();
    let timeFiltered = allResults;

    // Apply time filter
    switch (selectedRange.key) {
      case 'week':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        timeFiltered = allResults.filter(r => 
          new Date(r.date.seconds * 1000) >= weekAgo
        );
        break;
      case 'month':
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        timeFiltered = allResults.filter(r => 
          new Date(r.date.seconds * 1000) >= monthAgo
        );
        break;
      case 'all':
      default:
        timeFiltered = allResults;
        break;
    }

    // Apply speed filter
    const speedFiltered = speedFilterEnabled
      ? timeFiltered.filter(r => r.peakSpeedKph >= minimumSpeed)
      : timeFiltered;

    setFilteredResults(speedFiltered);
    updateChartData(speedFiltered);
  }, [allResults, selectedRange, speedFilterEnabled, minimumSpeed]);

  const updateChartData = (results) => {
    const groupedByDay = {};
    
    results.forEach(result => {
      const date = new Date(result.date.seconds * 1000);
      const dayKey = date.toDateString();
      
      if (!groupedByDay[dayKey] || groupedByDay[dayKey].topSpeed < result.peakSpeedKph) {
        groupedByDay[dayKey] = {
          date: date,
          topSpeed: result.peakSpeedKph
        };
      }
    });

    const chartData = Object.values(groupedByDay).sort((a, b) => a.date - b.date);
    setChartData(chartData);
  };

  const deleteResult = async (result) => {
    try {
      // Delete video from storage if exists
      if (result.videoURL) {
        const videoRef = storage().refFromURL(result.videoURL);
        await videoRef.delete();
      }
      
      // Delete document from Firestore
      await firestore().collection('detections').doc(result.id).delete();
    } catch (error) {
      console.error('Error deleting result:', error);
      Alert.alert('Error', 'Failed to delete result');
    }
  };

if (authState !== 'signedIn') {
    return (
        <View style={styles.container}>
            <View style={styles.backgroundCircle1} />
            <View style={styles.backgroundCircle2} />
            
            <View style={styles.emptyStateContainer}>
                <GlassPanel style={styles.emptyStatePanel}>
                    <Icon name="person" size={64} color="#8E8E93" />
                    <Text style={styles.emptyStateTitle}>Sign In Required</Text>
                    <Text style={styles.emptyStateMessage}>Please sign in to view your history</Text>
                </GlassPanel>
            </View>
        </View>
    );
}

  if (allResults.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.backgroundCircle1} />
        <View style={styles.backgroundCircle2} />
        
        <View style={styles.emptyStateContainer}>
          <GlassPanel style={styles.emptyStatePanel}>
            <Icon name="assignment" size={64} color="#8E8E93" />
            <Text style={styles.emptyStateTitle}>No History</Text>
            <Text style={styles.emptyStateMessage}>Start detecting to see your results here</Text>
          </GlassPanel>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.backgroundCircle1} />
      <View style={styles.backgroundCircle2} />
      
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Stats Section */}
        <GlassPanel style={styles.statsPanel}>
          <Text style={styles.sectionTitle}>Statistics</Text>
          <StatRow 
            label="Top Speed" 
            value={`${filteredTopSpeed.toFixed(1)} km/h`} 
          />
          <View style={styles.divider} />
          <StatRow 
            label="Average Speed" 
            value={`${filteredAverageSpeed.toFixed(1)} km/h`} 
          />
          <View style={styles.divider} />
          <StatRow 
            label="Total Detections" 
            value={`${filteredResults.length}`} 
          />
        </GlassPanel>

        {/* Chart Section */}
        <GlassPanel style={styles.chartPanel}>
          <View style={styles.chartHeader}>
            <Text style={styles.sectionTitle}>Progress Chart</Text>
            {selectedDataPoint ? (
              <Text style={styles.chartSubtitle}>
                {`${selectedDataPoint.date.toLocaleDateString()} - ${selectedDataPoint.topSpeed.toFixed(1)} km/h`}
              </Text>
            ) : (
              <Text style={styles.chartSubtitle}>
                {`Showing data for ${selectedRange.value}`}
              </Text>
            )}
          </View>
          <ProgressChart 
            data={chartData}
            selectedRange={selectedRange}
            onDataPointSelect={setSelectedDataPoint}
          />
        </GlassPanel>

        {/* Filter Controls */}
        <FilterControls
          selectedRange={selectedRange}
          onRangeChange={setSelectedRange}
          speedFilterEnabled={speedFilterEnabled}
          onSpeedFilterChange={setSpeedFilterEnabled}
          minimumSpeed={minimumSpeed}
          onMinimumSpeedChange={setMinimumSpeed}
        />

        {/* History List */}
        <GlassPanel style={styles.listPanel}>
          <Text style={[styles.sectionTitle, styles.listTitle]}>
            History
          </Text>
          {filteredResults.length === 0 ? (
            <Text style={styles.noResultsText}>No results match your filters</Text>
          ) : (
            <FlatList
              data={filteredResults}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <HistoryRow result={item} onDelete={deleteResult} />
              )}
              scrollEnabled={false}
            />
          )}
        </GlassPanel>
      </ScrollView>
    </View>
  );
};

// MARK: - Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  backgroundCircle1: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(0, 122, 255, 0.8)',
    top: -100,
    left: -150,
    opacity: 0.3,
  },
  backgroundCircle2: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(0, 122, 255, 0.5)',
    bottom: -100,
    right: -150,
    opacity: 0.3,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  glassPanel: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 25,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#1C1C1E',
  },
  // Stats
  statsPanel: {
    marginBottom: 20,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  statLabel: {
    fontSize: 16,
    color: '#1C1C1E',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(60, 60, 67, 0.18)',
    marginVertical: 8,
  },
  // Chart
  chartPanel: {
    marginBottom: 20,
    paddingHorizontal: 25,
    paddingVertical: 25,
  },
  chartHeader: {
    marginBottom: 15,
  },
  chartSubtitle: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 4,
  },
  chartContainer: {
    alignItems: 'center',
  },
  noDataContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  // Filters
  filterPanel: {
    marginBottom: 20,
  },
  filterTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#1C1C1E',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(118, 118, 128, 0.12)',
    borderRadius: 8,
    padding: 2,
    marginBottom: 15,
  },
  segmentedButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentedButtonActive: {
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentedButtonText: {
    fontSize: 13,
    color: '#1C1C1E',
  },
  segmentedButtonTextActive: {
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  toggleLabel: {
    fontSize: 16,
    color: '#1C1C1E',
  },
  switch: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(118, 118, 128, 0.32)',
    padding: 2,
    justifyContent: 'center',
  },
  switchActive: {
    backgroundColor: '#34C759',
  },
  switchThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  switchThumbActive: {
    transform: [{ translateX: 20 }],
  },
  sliderContainer: {
    marginTop: 15,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderLabel: {
    fontSize: 16,
    color: '#1C1C1E',
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderThumb: {
    backgroundColor: 'white',
    width: 24,
    height: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  // History List
  listPanel: {
    marginBottom: 20,
  },
  listTitle: {
    marginBottom: 10,
  },
  noResultsText: {
    textAlign: 'center',
    color: '#8E8E93',
    fontSize: 16,
    paddingVertical: 20,
  },
  historyRow: {
    marginBottom: 10,
  },
  historyRowPanel: {
    padding: 15,
    margin: 0,
  },
  historyRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyRowDate: {
    flex: 1,
    marginLeft: 12,
  },
  historyRowDateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  historyRowTimeText: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  historyRowSpeed: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  // Empty State
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStatePanel: {
    alignItems: 'center',
    width: '100%',
    paddingVertical: 40,
  },
  emptyStateTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1C1C1E',
    marginTop: 20,
    marginBottom: 8,
  },
  emptyStateMessage: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default HistoryView;