import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  StyleSheet,
  SafeAreaView,
  Image,
  ImageBackground,
  Modal,
} from 'react-native';
import { 
  getAuth, 
  onAuthStateChanged, 
  signOut as firebaseSignOut,
  deleteUser
} from '@react-native-firebase/auth';
import { 
  getFirestore,
  doc,
  deleteDoc,
} from '@react-native-firebase/firestore';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// MARK: - Reusable Components
const GlassPanel = ({ children, style }) => (
  <BlurView intensity={50} tint="light" style={[styles.glassPanelBase, style]}>
    {children}
  </BlurView>
);

// MARK: - Settings Menu Component
const SettingsMenu = ({ visible, onClose }) => {
    const insets = useSafeAreaInsets();
    const menuItems = [
        { name: 'Change Language', icon: 'language', action: () => Alert.alert('Change Language', 'This feature is coming soon!') },
        { name: 'Contact Us', icon: 'person', action: () => Linking.openURL('https://example.com/contact') },
        { name: 'FAQ', icon: 'help-outline', action: () => Linking.openURL('https://example.com/faq') },
        { name: 'Terms of Service', icon: 'description', action: () => Linking.openURL('https://example.com/terms') },
        { name: 'Privacy Policy', icon: 'shield', action: () => Linking.openURL('https://example.com/privacy') },
    ];

    const handlePress = (action) => {
        action();
        onClose();
    };

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
                <View style={[styles.menuContainer, { top: insets.top + 50 }]}>
                    {menuItems.map((item, index) => (
                        <React.Fragment key={item.name}>
                            <TouchableOpacity style={styles.menuItem} onPress={() => handlePress(item.action)}>
                                <Text style={styles.menuItemText}>{item.name}</Text>
                                <Icon name={item.icon} size={22} color="#3C3C43" />
                            </TouchableOpacity>
                            {index < menuItems.length - 1 && <View style={styles.menuDivider} />}
                        </React.Fragment>
                    ))}
                </View>
            </TouchableOpacity>
        </Modal>
    );
};


// MARK: - Firebase & Context Initialization
const auth = getAuth();
const db = getFirestore();
const AuthContext = React.createContext();

// MARK: - Main Account Screen Component
const AccountView = () => {
  const [authState, setAuthState] = useState('unknown');
  const [user, setUser] = useState(null);
  const [menuVisible, setMenuVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthState(user ? 'signedIn' : 'signedOut');
      setUser(user);
    });
    return unsubscribe;
  }, []);
  
  const contextValue = { authState, user };

  return (
    <AuthContext.Provider value={contextValue}>
      <ImageBackground
        source={require('../../assets/aurora_background.png')}
        style={styles.container}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <Image
                source={require('../../assets/AppLabel.png')}
                style={styles.headerLogo}
            />
            <TouchableOpacity style={styles.settingsButton} onPress={() => setMenuVisible(true)}>
                <Icon name="settings" size={24} color="#3C3C43" />
            </TouchableOpacity>
          </View>

          {authState === 'unknown' && <View style={styles.loadingContainer}><Text>Loading...</Text></View>}
          {authState === 'signedIn' && user && <LoggedInView user={user} />}
          {authState === 'signedOut' && <AuthView />}

        </SafeAreaView>
        <SettingsMenu visible={menuVisible} onClose={() => setMenuVisible(false)} />
      </ImageBackground>
    </AuthContext.Provider>
  );
};

// MARK: - Logged In View
const LoggedInView = ({ user }) => {
  const [appearance, setAppearance] = useState('light');

  const memberSince = user.metadata?.creationTime 
    ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    : 'N/A';

  const signOut = () => firebaseSignOut(auth).catch(e => Alert.alert("Error", e.message));
  
  const deleteAccount = () => {
    Alert.alert(
      'Delete Account Permanently',
      'This action is irreversible.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const currentUser = auth.currentUser;
            if (currentUser) {
              await deleteDoc(doc(db, 'users', currentUser.uid));
              await deleteUser(currentUser);
            }
          } catch (error) { Alert.alert("Error", error.message); }
        }},
      ]
    );
  };
  
  return (
    <ScrollView contentContainerStyle={styles.scrollViewContent}>
        <Text style={styles.largeTitle}>My Account</Text>
        <GlassPanel style={styles.panel}>
            <View style={styles.profileHeader}>
                <Icon name="check-circle" size={50} color="#34C759" />
                <View style={styles.profileInfo}>
                    <Text style={styles.emailText} numberOfLines={1}>{user.email || 'No Email'}</Text>
                    <Text style={styles.memberSinceText}>Member since {memberSince}</Text>
                </View>
            </View>
        </GlassPanel>

        <GlassPanel style={styles.panel}>
            <Text style={styles.sectionTitle}>Settings</Text>
            <View style={styles.segmentedControl}>
                {['System', 'Light', 'Dark'].map(item => (
                    <TouchableOpacity 
                        key={item} 
                        style={[styles.segment, appearance === item.toLowerCase() && styles.segmentActive]}
                        onPress={() => setAppearance(item.toLowerCase())}
                    >
                        <Text style={[styles.segmentText, appearance === item.toLowerCase() && styles.segmentTextActive]}>{item}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.settingRow}>
                <Icon name="help-outline" size={22} color="#007AFF" />
                <Text style={styles.settingRowText}>View Tutorial</Text>
            </TouchableOpacity>
        </GlassPanel>

        <GlassPanel style={styles.panel}>
            <Text style={styles.sectionTitle}>Community & Support</Text>
            <TouchableOpacity style={styles.settingRow} onPress={() => Linking.openURL('https://smashspeed.ca')}>
                <Icon name="public" size={22} color="#007AFF" />
                <Text style={styles.settingRowText}>Official Website</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.settingRow}>
                <Icon name="camera-alt" size={22} color="#007AFF" />
                <Text style={styles.settingRowText}>Follow on Instagram</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.settingRow} onPress={() => Linking.openURL('mailto:smashspeedai@gmail.com')}>
                <Icon name="mail" size={22} color="#007AFF" />
                <Text style={styles.settingRowText}>Contact Support</Text>
            </TouchableOpacity>
        </GlassPanel>

        <GlassPanel style={styles.panel}>
            <TouchableOpacity style={styles.settingRow} onPress={signOut}>
            <Icon name="exit-to-app" size={22} color="#FF3B30" />
            <Text style={[styles.settingRowText, { color: '#FF3B30' }]}>Sign Out</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.settingRow} onPress={deleteAccount}>
            <Icon name="delete-forever" size={22} color="#FF3B30" />
            <Text style={[styles.settingRowText, { color: '#FF3B30' }]}>Delete Account</Text>
            </TouchableOpacity>
        </GlassPanel>
    </ScrollView>
  );
};

// MARK: - Auth View (Placeholder)
const AuthView = () => (
    <ScrollView contentContainerStyle={styles.scrollViewContent}>
        <Text style={styles.largeTitle}>Welcome</Text>
        <GlassPanel style={styles.panel}>
            <Text style={styles.sectionTitle}>Sign In</Text>
            <Text style={styles.authPrompt}>Please sign in to save results and track your progress.</Text>
        </GlassPanel>
    </ScrollView>
);

// MARK: - Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent', // Ensure background image is visible
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 30,
    paddingBottom: 10,
  },
  headerLogo: {
    width: 150,
    height: 35,
    resizeMode: 'contain',
  },
  settingsButton: {
    padding: 5,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollViewContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 40,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  glassPanelBase: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  panel: {
    marginBottom: 24,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 15,
  },
  profileInfo: {
    flex: 1,
  },
  emailText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  memberSinceText: {
    fontSize: 14,
    color: '#3C3C43',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 15,
  },
  settingRowText: {
    fontSize: 16,
    color: '#000',
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60, 60, 67, 0.2)',
    marginLeft: 55,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(120, 120, 128, 0.12)',
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 2,
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#000',
  },
  segmentTextActive: {
    fontWeight: '600',
  },
  authPrompt: {
    fontSize: 16,
    color: '#3C3C43',
    lineHeight: 22,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  // Styles for Settings Menu
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  menuContainer: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    width: 250,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.1)'
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: 16,
    color: '#000'
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60, 60, 67, 0.29)',
    marginLeft: 16,
  },
});

export default AccountView;