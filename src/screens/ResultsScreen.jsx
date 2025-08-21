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
  Modal,
} from 'react-native';
import { BlurView } from '@react-native-community/blur';
import Video from 'react-native-video';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { LineChart } from 'react-native-chart-kit';
import Slider from '@react-native-community/slider';
import firestore from '@react-native-firebase/firestore';
import auth, { onAuthStateChanged } from '@react-native-firebase/auth';
import storage from '@react-native-firebase/storage';
import Icon from 'react-native-vector-icons/MaterialIcons';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// MARK: - Helper Types
const TimeRange = {
  WEEK: { key: 'week', value: 'Week' },
  MONTH: { key: 'month', value: 'Month' },
  ALL: { key: 'all', value: 'All Time' },
};

const TIME_RANGES = [TimeRange.WEEK, TimeRange.MONTH, TimeRange.ALL];

// MARK: - Glass Panel Component
const GlassPanel = ({ children, style }) => (
  <View style={[styles.glassPanel, style]}>
    {children}
  </View>
);

// MARK: - Stat Card Component
const StatCard = ({ label, value, icon }) => {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIconContainer}>
        <Icon name={icon} size={20} color="#007AFF" />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
};

// MARK: - History Row Component
const HistoryRow = ({ result, onDelete, onVideoPress }) => {
  const hasVideo = result.videoURL;

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

  const handlePress = () => {
    if (hasVideo && onVideoPress) {
      onVideoPress(result);
    }
  };

  return (
    <TouchableOpacity
      style={styles.historyItem}
      onPress={handlePress}
      onLongPress={handleDelete}
      activeOpacity={0.7}
    >
      <View style={styles.historyItemContent}>
        <View style={styles.historyLeftContent}>
          {hasVideo && (
            <View style={styles.videoIndicator}>
              <Icon name="play-arrow" size={16} color="#FFFFFF" />
            </View>
          )}
          <View style={styles.historyDateContainer}>
            <Text style={styles.historyDate}>
              {new Date(result.date.seconds * 1000).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
              })}
            </Text>
            <Text style={styles.historyTime}>
              {new Date(result.date.seconds * 1000).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </Text>
          </View>
        </View>
        
        <View style={styles.historyRightContent}>
          <Text style={styles.historySpeed}>{result.peakSpeedKph.toFixed(1)}</Text>
          <Text style={styles.historySpeedUnit}>km/h</Text>
          {result.angle !== undefined && result.angle !== null && (
            <Text style={styles.historyAngle}>{result.angle.toFixed(0)}°</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

// MARK: - Chart Component
const ProgressChart = ({ data, selectedRange, onDataPointSelect }) => {
  if (!data || data.length <= 1) {
    return (
      <View style={styles.noDataContainer}>
        <Icon name="show-chart" size={48} color="#C7C7CC" />
        <Text style={styles.noDataText}>Not enough data</Text>
        <Text style={styles.noDataSubtext}>Keep detecting to see your progress</Text>
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
    backgroundColor: '#FFFFFF',
    backgroundGradientFrom: '#FFFFFF',
    backgroundGradientTo: '#FFFFFF',
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(0, 122, 255, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(60, 60, 67, ${opacity * 0.6})`,
    style: { 
      borderRadius: 0,
    },
    propsForDots: {
      r: '4',
      strokeWidth: '2',
      stroke: '#007AFF',
      fill: '#FFFFFF'
    },
    propsForBackgroundLines: {
      strokeDasharray: "0",
      stroke: "rgba(0, 0, 0, 0.05)",
      strokeWidth: 1
    }
  };

  return (
    <View style={styles.chartContainer}>
      <LineChart
        data={chartData}
        width={screenWidth - 60}
        height={220}
        chartConfig={chartConfig}
        bezier
        onDataPointClick={({ index }) => {
          onDataPointSelect(data[index]);
        }}
        style={styles.chart}
        withHorizontalLabels={true}
        withVerticalLabels={true}
        withDots={true}
        withShadow={false}
        withScrollableDot={false}
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
    <View style={styles.filtersContainer}>
      {/* Time Range Picker */}
      <View style={styles.filterSection}>
        <Text style={styles.filterSectionTitle}>Time Range</Text>
        <View style={styles.segmentedControl}>
          {TIME_RANGES.map((range) => (
            <TouchableOpacity
              key={range.key}
              style={[
                styles.segmentedButton,
                selectedRange.key === range.key && styles.segmentedButtonActive
              ]}
              onPress={() => onRangeChange(range)}
              activeOpacity={0.7}
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
      </View>

      {/* Speed Filter */}
      <View style={styles.filterSection}>
        <View style={styles.filterHeader}>
          <Text style={styles.filterSectionTitle}>Speed Filter</Text>
          <TouchableOpacity
            style={[styles.toggleButton, speedFilterEnabled && styles.toggleButtonActive]}
            onPress={() => onSpeedFilterChange(!speedFilterEnabled)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.toggleButtonText,
              speedFilterEnabled && styles.toggleButtonTextActive
            ]}>
              {speedFilterEnabled ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>
        </View>

        {speedFilterEnabled && (
          <View style={styles.sliderSection}>
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
      </View>
    </View>
  );
};

// MARK: - Main History View
const HistoryView = () => {
  // Auth State
  const [user, setUser] = useState(null);
  const [authState, setAuthState] = useState('loading');
  
  // Data State
  const [allResults, setAllResults] = useState([]);
  const [filteredResults, setFilteredResults] = useState([]);
  const [chartData, setChartData] = useState([]);
  
  // Filter State
  const [selectedRange, setSelectedRange] = useState(TimeRange.WEEK);
  const [speedFilterEnabled, setSpeedFilterEnabled] = useState(false);
  const [minimumSpeed, setMinimumSpeed] = useState(150);
  const [selectedDataPoint, setSelectedDataPoint] = useState(null);

  // Video State
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [showVideoModal, setShowVideoModal] = useState(false);

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
      .collection('users')
      .doc(user.uid)
      .collection('detections')
      .orderBy('date', 'desc')
      .onSnapshot((snapshot) => {
        const results = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        setAllResults(results);
      }, (error) => {
        console.error('Error fetching detections:', error);
        setAllResults([]);
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
    if (!user?.uid) return;
    
    try {
      if (result.videoURL) {
        const videoRef = storage().refFromURL(result.videoURL);
        await videoRef.delete();
      }
      
      await firestore()
        .collection('users')
        .doc(user.uid)
        .collection('detections')
        .doc(result.id)
        .delete();
        
    } catch (error) {
      console.error('Error deleting result:', error);
      Alert.alert('Error', 'Failed to delete result');
    }
  };

  const handleVideoPress = (result) => {
    setSelectedVideo(result);
    setShowVideoModal(true);
  };

  const closeVideoModal = () => {
    setShowVideoModal(false);
    setSelectedVideo(null);
  };

  // Helper function to safely format data point text
  const getDataPointText = () => {
    if (selectedDataPoint) {
      const dateStr = selectedDataPoint.date.toLocaleDateString();
      const speedStr = selectedDataPoint.topSpeed.toFixed(1);
      return `${dateStr} • ${speedStr} km/h`;
    }
    const rangeText = selectedRange.value || 'Week';
    const resultsCount = filteredResults.length || 0;
    const pluralText = resultsCount !== 1 ? 's' : '';
    return `${rangeText} • ${resultsCount} detection${pluralText}`;
  };

  if (authState !== 'signedIn') {
    return (
      <View style={styles.container}>
        <View style={styles.emptyStateContainer}>
          <Icon name="person-outline" size={64} color="#C7C7CC" />
          <Text style={styles.emptyStateTitle}>Sign In Required</Text>
          <Text style={styles.emptyStateMessage}>Please sign in to view your detection history</Text>
        </View>
      </View>
    );
  }

  if (allResults.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyStateContainer}>
          <Icon name="timeline" size={64} color="#C7C7CC" />
          <Text style={styles.emptyStateTitle}>No History Yet</Text>
          <Text style={styles.emptyStateMessage}>Start detecting to see your results here</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Background decorative shapes */}
      <View style={styles.backgroundDecor1} />
      <View style={styles.backgroundDecor2} />
      <View style={styles.backgroundDecor3} />
      
      <ScrollView 
        style={styles.scrollView} 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Your Stats</Text>
          <Text style={styles.headerSubtitle}>
            {getDataPointText()}
          </Text>
        </View>

        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <StatCard 
            icon="speed"
            label="Top Speed"
            value={`${filteredTopSpeed.toFixed(1)} km/h`}
          />
          <StatCard 
            icon="trending-up"
            label="Average"
            value={`${filteredAverageSpeed.toFixed(1)} km/h`}
          />
          <StatCard 
            icon="assessment"
            label="Total"
            value={`${filteredResults.length}`}
          />
        </View>

        {/* Chart Section */}
        <GlassPanel style={styles.chartPanel}>
          <View style={styles.chartHeader}>
            <Text style={styles.sectionTitle}>Progress Chart</Text>
          </View>
          <ProgressChart 
            data={chartData}
            selectedRange={selectedRange}
            onDataPointSelect={setSelectedDataPoint}
          />
        </GlassPanel>

        {/* Filter Controls */}
        <GlassPanel style={styles.filterPanel}>
          <FilterControls
            selectedRange={selectedRange}
            onRangeChange={setSelectedRange}
            speedFilterEnabled={speedFilterEnabled}
            onSpeedFilterChange={setSpeedFilterEnabled}
            minimumSpeed={minimumSpeed}
            onMinimumSpeedChange={setMinimumSpeed}
          />
        </GlassPanel>

        {/* History List */}
        <GlassPanel style={styles.historyPanel}>
          <View style={styles.historyHeader}>
            <Text style={styles.sectionTitle}>Recent Detections</Text>
            {filteredResults.length > 0 && (
              <Text style={styles.historyCount}>{filteredResults.length} results</Text>
            )}
          </View>
          
          {filteredResults.length === 0 ? (
            <View style={styles.noResultsContainer}>
              <Icon name="filter-list-off" size={32} color="#C7C7CC" />
              <Text style={styles.noResultsText}>No results match your filters</Text>
            </View>
          ) : (
            <View style={styles.historyList}>
              {filteredResults.slice(0, 20).map((item) => (
                <HistoryRow 
                  key={item.id} 
                  result={item} 
                  onDelete={deleteResult}
                  onVideoPress={handleVideoPress}
                />
              ))}
              {filteredResults.length > 20 && (
                <Text style={styles.moreResultsText}>
                  and {filteredResults.length - 20} more results...
                </Text>
              )}
            </View>
          )}
        </GlassPanel>
      </ScrollView>

      {/* Video Modal */}
      <Modal
        visible={showVideoModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeVideoModal}
      >
        <View style={styles.videoModalContainer}>
          <View style={styles.videoModalHeader}>
            <TouchableOpacity 
              onPress={closeVideoModal}
              style={styles.videoModalCloseButton}
            >
              <Icon name="close" size={24} color="#1C1C1E" />
            </TouchableOpacity>
            <Text style={styles.videoModalTitle}>Detection Video</Text>
            <View style={styles.videoModalHeaderSpacer} />
          </View>
          
          {selectedVideo && (
            <View style={styles.videoContainer}>
              <Video
                source={{ uri: selectedVideo.videoURL }}
                style={styles.videoPlayer}
                resizeMode="cover"   // fills without black bars, use "contain" if you want fit
                repeat               // seamless loop
                rate={0.25}           // slow motion (0.5 = half speed, can be 0.25–2.0)
                ignoreSilentSwitch="obey"
                muted={false}
                controls={false}     // ensures native controls are hidden
                paused={false}       // autoplay
                playInBackground={false}
                playWhenInactive={false}
                onError={(error) => {
                  console.log('Video error:', error);
                  Alert.alert('Error', 'Unable to play video');
                }}
              />
              
              <View style={styles.videoInfo}>
                <Text style={styles.videoInfoTitle}>Detection Details</Text>
                <View style={styles.videoInfoRow}>
                  <Text style={styles.videoInfoLabel}>Speed:</Text>
                  <Text style={styles.videoInfoValue}>{selectedVideo.peakSpeedKph.toFixed(1)} km/h</Text>
                </View>
                <View style={styles.videoInfoRow}>
                  <Text style={styles.videoInfoLabel}>Date:</Text>
                  <Text style={styles.videoInfoValue}>
                    {new Date(selectedVideo.date.seconds * 1000).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.videoInfoRow}>
                  <Text style={styles.videoInfoLabel}>Time:</Text>
                  <Text style={styles.videoInfoValue}>
                    {new Date(selectedVideo.date.seconds * 1000).toLocaleTimeString()}
                  </Text>
                </View>
                {selectedVideo.angle !== undefined && selectedVideo.angle !== null && (
                  <View style={styles.videoInfoRow}>
                    <Text style={styles.videoInfoLabel}>Angle:</Text>
                    <Text style={styles.videoInfoValue}>{selectedVideo.angle.toFixed(1)}°</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

// MARK: - Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 30,
  },
  glassPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  
  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1C1C1E',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#8E8E93',
    marginTop: 4,
    fontWeight: '500',
  },

  // Stats Cards
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  statIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0F8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    fontWeight: '500',
  },

  // Chart
  chartPanel: {
    padding: 20,
  },
  chartHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  chartContainer: {
    alignItems: 'center',
    overflow: 'hidden',
  },
  chart: {
    marginLeft: -10,
  },
  noDataContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
    marginTop: 12,
  },
  noDataSubtext: {
    fontSize: 14,
    color: '#C7C7CC',
    marginTop: 4,
  },

  // Filters
  filterPanel: {
    padding: 20,
  },
  filtersContainer: {
    gap: 24,
  },
  filterSection: {
    gap: 12,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 4,
  },
  segmentedButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentedButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentedButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8E8E93',
  },
  segmentedButtonTextActive: {
    color: '#1C1C1E',
    fontWeight: '600',
  },
  toggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
  },
  toggleButtonActive: {
    backgroundColor: '#007AFF',
  },
  toggleButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
  },
  toggleButtonTextActive: {
    color: '#FFFFFF',
  },
  sliderSection: {
    marginTop: 8,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sliderLabel: {
    fontSize: 14,
    color: '#1C1C1E',
    fontWeight: '500',
  },
  sliderValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderThumb: {
    backgroundColor: '#FFFFFF',
    width: 24,
    height: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  // History
  historyPanel: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  historyCount: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  historyList: {
    gap: 1,
  },
  historyItem: {
    backgroundColor: '#FBFBFC',
    borderRadius: 12,
    marginBottom: 8,
  },
  historyItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  historyLeftContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  videoIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  historyDateContainer: {
    flex: 1,
  },
  historyDate: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  historyTime: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
    fontWeight: '500',
  },
  historyRightContent: {
    alignItems: 'flex-end',
  },
  historySpeed: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  historySpeedUnit: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: -2,
    fontWeight: '500',
  },
  historyAngle: {
    fontSize: 11,
    color: '#C7C7CC',
    marginTop: 2,
  },
  noResultsContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noResultsText: {
    fontSize: 16,
    color: '#8E8E93',
    marginTop: 8,
    fontWeight: '500',
  },
  moreResultsText: {
    textAlign: 'center',
    color: '#8E8E93',
    fontSize: 14,
    paddingVertical: 16,
    fontStyle: 'italic',
  },

  // Empty State
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
    marginTop: 20,
    marginBottom: 8,
  },
  emptyStateMessage: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '500',
  },
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  backgroundDecor1: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(0, 122, 255, 0.03)',
    top: -50,
    right: -70,
    zIndex: 0,
  },
  backgroundDecor2: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(0, 122, 255, 0.05)',
    top: 200,
    left: -60,
    zIndex: 0,
  },
  backgroundDecor3: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(0, 122, 255, 0.04)',
    bottom: 150,
    right: -40,
    zIndex: 0,
  },
  scrollView: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    paddingBottom: 30,
  },
  glassPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  
  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 24,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1C1C1E',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#8E8E93',
    marginTop: 4,
    fontWeight: '500',
  },

  // Stats Cards
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  statIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0F8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    fontWeight: '500',
  },

  // Chart
  chartPanel: {
    padding: 20,
  },
  chartHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  chartContainer: {
    alignItems: 'center',
    overflow: 'hidden',
  },
  chart: {
    marginLeft: -10,
  },
  noDataContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
    marginTop: 12,
  },
  noDataSubtext: {
    fontSize: 14,
    color: '#C7C7CC',
    marginTop: 4,
  },

  // Filters
  filterPanel: {
    padding: 20,
  },
  filtersContainer: {
    gap: 24,
  },
  filterSection: {
    gap: 12,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 4,
  },
  segmentedButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentedButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentedButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8E8E93',
  },
  segmentedButtonTextActive: {
    color: '#1C1C1E',
    fontWeight: '600',
  },
  toggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
  },
  toggleButtonActive: {
    backgroundColor: '#007AFF',
  },
  toggleButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
  },
  toggleButtonTextActive: {
    color: '#FFFFFF',
  },
  sliderSection: {
    marginTop: 8,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sliderLabel: {
    fontSize: 14,
    color: '#1C1C1E',
    fontWeight: '500',
  },
  sliderValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderThumb: {
    backgroundColor: '#FFFFFF',
    width: 24,
    height: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  // History
  historyPanel: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  historyCount: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  historyList: {
    gap: 1,
  },
  historyItem: {
    backgroundColor: '#FBFBFC',
    borderRadius: 12,
    marginBottom: 8,
  },
  historyItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  historyLeftContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  videoIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  historyDateContainer: {
    flex: 1,
  },
  historyDate: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  historyTime: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
    fontWeight: '500',
  },
  historyRightContent: {
    alignItems: 'flex-end',
  },
  historySpeed: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  historySpeedUnit: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: -2,
    fontWeight: '500',
  },
  historyAngle: {
    fontSize: 11,
    color: '#C7C7CC',
    marginTop: 2,
  },
  noResultsContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noResultsText: {
    fontSize: 16,
    color: '#8E8E93',
    marginTop: 8,
    fontWeight: '500',
  },
  moreResultsText: {
    textAlign: 'center',
    color: '#8E8E93',
    fontSize: 14,
    paddingVertical: 16,
    fontStyle: 'italic',
  },

  // Video Modal
  videoModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  videoModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    paddingTop: 60, // Account for status bar
  },
  videoModalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  videoModalHeaderSpacer: {
    width: 32,
  },
  videoContainer: {
    flex: 1,
    padding: 20,
  },
  videoPlayer: {
    width: '100%',
    height: 300,
    backgroundColor: '#000000',
    borderRadius: 12,
    marginBottom: 20,
  },
  videoInfo: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 20,
  },
  videoInfoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 16,
  },
  videoInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  videoInfoLabel: {
    fontSize: 16,
    color: '#8E8E93',
    fontWeight: '500',
  },
  videoInfoValue: {
    fontSize: 16,
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
  emptyStateTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
    marginTop: 20,
    marginBottom: 8,
  },
  emptyStateMessage: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '500',
  },
});

export default HistoryView;