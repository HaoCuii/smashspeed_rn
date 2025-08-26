import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
  SafeAreaView,
  Image,
  ImageBackground,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Video from 'react-native-video';
import { LineChart } from 'react-native-chart-kit';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { BlurView } from 'expo-blur';
import { getFirestore, collection, query, orderBy, onSnapshot } from '@react-native-firebase/firestore';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';

const { width: screenWidth } = Dimensions.get('window');
const db = getFirestore();
const auth = getAuth();

const TimeRange = {
  WEEK: { key: 'week', value: 'Past Week' },
  MONTH: { key: 'month', value: 'Past Month' },
  ALL: { key: 'all', value: 'All Time' },
};

// MARK: - Reusable Components
const GlassPanel = ({ children, style }) => (
  <BlurView intensity={50} tint="light" style={[styles.glassPanelBase, style]}>
    {children}
  </BlurView>
);

const StatRow = ({ label, value }) => (
    <View style={styles.statRow}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
    </View>
);

const HistoryRow = ({ result, onPress }) => {
    const formatDate = (timestamp) => {
        if (!timestamp?.toDate) return { date: 'Unknown', time: '' };
        const date = timestamp.toDate();
        return {
            date: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        };
    };
    const { date, time } = formatDate(result.date);

    return (
        <TouchableOpacity style={styles.historyRow} onPress={() => onPress(result)}>
            <View style={styles.historyPlayIcon}>
                <Icon name="play-arrow" size={16} color="#007AFF"/>
            </View>
            <View style={styles.historyInfo}>
                <Text style={styles.historyDate}>{date}</Text>
                <Text style={styles.historyTime}>{time}</Text>
            </View>
            <Text style={styles.historySpeed}>{result.peakSpeedKph.toFixed(1)} km/h</Text>
            <Icon name="chevron-right" size={22} color="#3C3C43" />
        </TouchableOpacity>
    );
};

// MARK: - Smash Details Modal
const SmashDetailsModal = ({ result, onClose }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [currentFrame, setCurrentFrame] = useState(null);
    const [videoSize, setVideoSize] = useState({ width: 1, height: 1 });

    useEffect(() => {
        if (!result) return;
        setIsLoading(true);
        setCurrentTime(0);
        setCurrentFrame(null);
    }, [result]);

    useEffect(() => {
        if (!result?.frameData || result.frameData.length === 0) {
            setCurrentFrame(null);
            return;
        };

        let frameToShow = null;
        for (const frame of result.frameData) {
            if (frame.timestamp <= currentTime) {
                frameToShow = frame;
            } else {
                break;
            }
        }
        setCurrentFrame(frameToShow);
    }, [currentTime, result]);

    if (!result) return null;

    const mapVideoToScreen = (box) => {
        const viewSize = { width: screenWidth - 32, height: 250 };
        const videoAspectRatio = videoSize.width / videoSize.height;
        const viewAspectRatio = viewSize.width / viewSize.height;
        let scale = 1, offsetX = 0, offsetY = 0;

        if (videoAspectRatio > viewAspectRatio) {
            scale = viewSize.width / videoSize.width;
            offsetY = (viewSize.height - (videoSize.height * scale)) / 2;
        } else {
            scale = viewSize.height / videoSize.height;
            offsetX = (viewSize.width - (videoSize.width * scale)) / 2;
        }
        
        return {
            left: box.x * scale + offsetX,
            top: box.y * scale + offsetY,
            width: box.width * scale,
            height: box.height * scale,
        };
    };

    const onScreenBox = currentFrame ? mapVideoToScreen(currentFrame.boundingBox) : null;
    
    const timestampData = result.frameData && result.frameData.length > 0 
        ? result.frameData.map(f => ({
            time: `${f.timestamp.toFixed(2)} s`,
            speed: `${f.speedKPH.toFixed(1)} km/h`
          }))
        : [ { time: "N/A", speed: "No frame data found" } ];

    const liveSpeed = currentFrame ? `${currentFrame.speedKPH.toFixed(1)} km/h` : '-- km/h';
    const smashAngle = result.angle != null ? `${result.angle.toFixed(0)}° downward` : '--';

    return (
        <Modal visible={!!result} animationType="slide" onRequestClose={onClose}>
            <ImageBackground source={require('../../assets/aurora_background.png')} style={styles.container}>
                <SafeAreaView style={{flex: 1}}>
                    <View style={styles.modalHeader}>
                        <TouchableOpacity onPress={onClose}>
                            <Icon name="keyboard-arrow-down" size={30} color="#000" />
                        </TouchableOpacity>
                        <Text style={styles.modalTitle}>Smash Details</Text>
                        <View style={{width: 30}}/>
                    </View>
                    <ScrollView contentContainerStyle={styles.scrollContent}>
                        <View style={styles.videoContainer}>
                            <Video
                                source={{ uri: result.videoURL }}
                                style={styles.videoPlayer}
                                resizeMode="contain"
                                repeat={false}
                                controls={true}
                                progressUpdateInterval={50}
                                onProgress={({ currentTime: time }) => setCurrentTime(time)}
                                onLoad={() => setIsLoading(false)}
                                onLoadStart={() => setIsLoading(true)}
                                onError={() => {
                                    setIsLoading(false);
                                    Alert.alert("Video Error", "Could not load video.");
                                }}
                            />
                            {isLoading && (
                                <View style={styles.videoOverlay}><ActivityIndicator size="large" color="#FFFFFF" /></View>
                            )}
                            {onScreenBox && (
                                <View style={[styles.boundingBox, { top: onScreenBox.top, left: onScreenBox.left, width: onScreenBox.width, height: onScreenBox.height }]}>
                                    <View style={styles.speedTag}>
                                      <Text style={styles.speedText}>{currentFrame.speedKPH.toFixed(0)} km/h</Text>
                                    </View>
                                </View>
                            )}
                        </View>
                        <GlassPanel style={styles.panel}>
                            <Text style={styles.sectionTitle}>Peak Speed</Text>
                            <Text style={styles.peakSpeed}>{result.peakSpeedKph.toFixed(1)} km/h</Text>
                            <View style={styles.divider} />
                            <StatRow label="Smash Angle" value={smashAngle} />
                            <View style={styles.divider} />
                            <StatRow label="Live Speed" value={liveSpeed} />
                        </GlassPanel>
                        <GlassPanel style={styles.panel}>
                            <Text style={styles.sectionTitle}>Timestamp Data</Text>
                            {timestampData.map((item, index) => (
                                <React.Fragment key={index}>
                                    <View style={styles.timestampRow}>
                                        <Text style={styles.timestampText}>{item.time}</Text>
                                        <Text style={styles.timestampText}>{item.speed}</Text>
                                    </View>
                                    {index < timestampData.length - 1 && <View style={styles.divider} />}
                                </React.Fragment>
                            ))}
                        </GlassPanel>
                    </ScrollView>
                </SafeAreaView>
            </ImageBackground>
        </Modal>
    );
};

// MARK: - Main Results Screen
const ResultsScreen = () => {
  const [user, setUser] = useState(null);
  const [authState, setAuthState] = useState('loading');
  const [allResults, setAllResults] = useState([]);
  const [filteredResults, setFilteredResults] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [selectedRange, setSelectedRange] = useState(TimeRange.WEEK);
  const [selectedResult, setSelectedResult] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthState(user ? 'signedIn' : 'signedOut');
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    const detectionsRef = collection(db, 'users', user.uid, 'detections');
    const q = query(detectionsRef, orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllResults(results);
    });
    return unsubscribe;
  }, [user?.uid]);

  const applyFilters = useCallback(() => {
    let timeFiltered = allResults;
    if (selectedRange.key !== 'all') {
        const now = new Date();
        const days = selectedRange.key === 'week' ? 7 : 30;
        const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        timeFiltered = allResults.filter(r => r.date?.toDate() >= cutoffDate);
    }
    setFilteredResults(timeFiltered);
    updateChartData(timeFiltered);
  }, [allResults, selectedRange]);

  useEffect(() => {
    applyFilters();
  }, [allResults, selectedRange, applyFilters]);

  const updateChartData = (results) => {
    const groupedByDay = results.reduce((acc, result) => {
      if(!result.date?.toDate) return acc;
      const date = result.date.toDate();
      const dayKey = date.toISOString().split('T')[0];
      if (!acc[dayKey] || acc[dayKey].topSpeed < result.peakSpeedKph) {
        acc[dayKey] = { date, topSpeed: result.peakSpeedKph };
      }
      return acc;
    }, {});
    const sortedChartData = Object.values(groupedByDay).sort((a, b) => a.date - b.date);
    setChartData(sortedChartData);
  };

  const filteredTopSpeed = filteredResults.length > 0 ? Math.max(...filteredResults.map(r => r.peakSpeedKph)) : 0;
  const filteredAverageSpeed = filteredResults.length > 0 ? filteredResults.reduce((sum, r) => sum + r.peakSpeedKph, 0) / filteredResults.length : 0;

  if (authState !== 'signedIn' || allResults.length === 0) {
    // ... (Empty state view remains the same)
  }

  return (
    <ImageBackground source={require('../../assets/aurora_background.png')} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
            <Image
                source={require('../../assets/AppLabel.png')}
                style={styles.headerLogo}
            />
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.largeTitle}>Results</Text>
          
          <GlassPanel style={styles.panel}>
            <Text style={styles.sectionTitle}>Filtered Stats</Text>
            <StatRow label="Top Speed" value={`${filteredTopSpeed.toFixed(1)} km/h`} />
            <View style={styles.divider} />
            <StatRow label="Average Speed" value={`${filteredAverageSpeed.toFixed(1)} km/h`} />
            <View style={styles.divider} />
            <StatRow label="Total Smashes" value={filteredResults.length} />
          </GlassPanel>

          <GlassPanel style={styles.panel}>
            <Text style={styles.sectionTitle}>Progress Over Time</Text>
            <Text style={styles.sectionSubtitle}>Top Speed per Day ({selectedRange.value})</Text>
            {chartData.length > 1 ? (
                <LineChart
                    data={{
                        labels: chartData.map(p => { const d = p.date; return `${d.getMonth() + 1}/${d.getDate()}`; }),
                        datasets: [{ data: chartData.map(p => p.topSpeed) }]
                    }}
                    width={screenWidth - 72}
                    height={220}
                    chartConfig={{
                        backgroundColor: "transparent", backgroundGradientFromOpacity: 0, backgroundGradientToOpacity: 0,
                        color: (opacity = 1) => `rgba(0, 122, 255, ${opacity})`,
                        labelColor: (opacity = 1) => `rgba(60, 60, 67, ${opacity * 0.8})`,
                        propsForDots: { r: "4", strokeWidth: "2", stroke: "#007AFF" },
                        propsForBackgroundLines: { stroke: "rgba(60, 60, 67, 0.1)" }
                    }}
                    bezier style={{ marginLeft: -10, paddingVertical: 10 }}
                />
            ) : (
                <View style={styles.noDataContainer}><Text style={styles.noDataText}>Not enough data to draw a chart.</Text></View>
            )}
          </GlassPanel>

          <GlassPanel style={styles.panel}>
            <Text style={styles.sectionTitle}>Filters</Text>
            <View style={styles.filterRow}>
                <Text style={styles.filterLabel}>Time Range</Text>
                <TouchableOpacity style={styles.filterButton}>
                    <Text style={styles.filterButtonText}>{selectedRange.value}</Text>
                    <Icon name="expand-more" size={20} color="#3C3C43"/>
                </TouchableOpacity>
            </View>
          </GlassPanel>
          
          <GlassPanel style={styles.panel}>
            <Text style={styles.sectionTitle}>History</Text>
            {filteredResults.length > 0 ? (
                filteredResults.map((result, index) => (
                    <React.Fragment key={result.id}>
                        <HistoryRow result={result} onPress={setSelectedResult} />
                        {index < filteredResults.length - 1 && <View style={styles.divider} />}
                    </React.Fragment>
                ))
            ) : (
                <Text style={styles.noDataText}>No results for this period.</Text>
            )}
          </GlassPanel>

        </ScrollView>
        <SmashDetailsModal result={selectedResult} onClose={() => setSelectedResult(null)} />
      </SafeAreaView>
    </ImageBackground>
  );
};


// MARK: - Styles
const styles = StyleSheet.create({
  container: { 
    flex: 1 
  },
  safeArea: { 
    flex: 1 
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 30, 
    paddingBottom: 10,
  },
  headerLogo: {
    width: 150,
    height: 35,
    resizeMode: 'contain',
  },
  scrollContent: { 
    paddingTop: 10, 
    paddingHorizontal: 16, 
    paddingBottom: 40 
  },
  detailsScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  largeTitle: { 
    fontSize: 34, 
    fontWeight: 'bold', 
    color: '#000', 
    marginBottom: 20, 
    paddingHorizontal: 4 
  },
  glassPanelBase: { 
    borderRadius: 20, 
    overflow: 'hidden' 
  },
  panel: { 
    marginBottom: 24, 
    paddingVertical: 10 
  },
  sectionTitle: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#000', 
    paddingHorizontal: 20, 
    paddingTop: 10, 
    paddingBottom: 10 
  },
  sectionSubtitle: { 
    fontSize: 15, 
    color: '#3C3C43', 
    paddingHorizontal: 20, 
    marginBottom: 10 
  },
  statRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingVertical: 12 
  },
  statLabel: { 
    fontSize: 16, 
    color: '#000' 
  },
  statValue: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: '#3C3C43' 
  },
  divider: { 
    height: StyleSheet.hairlineWidth, 
    backgroundColor: 'rgba(60, 60, 67, 0.2)', 
    marginHorizontal: 20 
  },
  noDataContainer: { 
    height: 220, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  noDataText: { 
    fontSize: 16, 
    color: '#8E8E93', 
    padding: 20, 
    textAlign: 'center' 
  },
  filterRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingBottom: 10 
  },
  filterLabel: { 
    fontSize: 16, 
    color: '#000' 
  },
  filterButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(120, 120, 128, 0.12)', 
    paddingVertical: 8, 
    paddingHorizontal: 12, 
    borderRadius: 8, 
    gap: 4 
  },
  filterButtonText: { 
    fontSize: 15, 
    fontWeight: '500', 
    color: '#000' 
  },
  emptyStateContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 40 
  },
  emptyStateTitle: { 
    fontSize: 22, 
    fontWeight: 'bold', 
    color: 'rgba(60, 60, 67, 0.8)', 
    marginTop: 16, 
    marginBottom: 8 
  },
  emptyStateMessage: { 
    fontSize: 16, 
    color: 'rgba(60, 60, 67, 0.6)', 
    textAlign: 'center', 
    lineHeight: 22 
  },
  historyRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingVertical: 12, 
    gap: 15 
  },
  historyPlayIcon: { 
    width: 32, 
    height: 32, 
    borderRadius: 16, 
    backgroundColor: 'rgba(0, 122, 255, 0.1)', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  historyInfo: { 
    flex: 1 
  },
  historyDate: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: '#000' 
  },
  historyTime: { 
    fontSize: 13, 
    color: '#3C3C43', 
    marginTop: 2 
  },
  historySpeed: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: '#000', 
    marginRight: 5 
  },
  modalHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    padding: 16, 
    paddingTop: 20 
  },
  modalTitle: { 
    fontSize: 18, 
    fontWeight: '600' 
  },
  videoContainer: { 
    marginHorizontal: 16, 
    backgroundColor: '#000',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    height: 250,
    marginBottom: 24,
  },
  videoPlayer: { 
    width: '100%', 
    height: '100%', 
    borderRadius: 16,
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  boundingBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255, 59, 48, 0.9)',
    borderRadius: 4,
  },
  speedTag: {
    position: 'absolute',
    top: -22,
    left: -2,
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  speedText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  peakSpeed: { 
    fontSize: 48, 
    fontWeight: 'bold', 
    textAlign: 'center', 
    paddingBottom: 20, 
    color: '#000' 
  },
  // Styles added to fix the layout
  timestampRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  timestampText: {
    fontSize: 15,
    color: '#3C3C43',
    fontFamily: 'monospace',
  },
});

export default ResultsScreen;