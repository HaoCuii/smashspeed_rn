import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Linking,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import auth, { onAuthStateChanged } from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { GoogleSignin, GoogleSigninButton } from '@react-native-google-signin/google-signin';
import appleAuth, { AppleButton } from '@invertase/react-native-apple-authentication';
import Icon from 'react-native-vector-icons/MaterialIcons';
import LinearGradient from 'react-native-linear-gradient';

// Configure Google Sign In - Call this before using
GoogleSignin.configure({
  webClientId: '848530128344-0ob2umvug1emgm29r33o6vrmnd314582.apps.googleusercontent.com', // Replace with your actual web client ID
});

const { width, height } = Dimensions.get('window');

// Context for authentication state
const AuthContext = React.createContext();

// Main Account View Component
const AccountView = () => {
  const [authState, setAuthState] = useState('unknown'); // 'unknown', 'signedIn', 'signedOut'
  const [user, setUser] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth(), (user) => {
      if (user) {
        setAuthState('signedIn');
        setUser(user);
        // Save user data to Firestore
        //saveUserToFirestore(user);
      } else {
        setAuthState('signedOut');
        setUser(null);
      }
    });

    return unsubscribe;
  }, []);

  const saveUserToFirestore = async (user) => {
    try {
      await firestore().collection('users').doc(user.uid).set({
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: firestore.FieldValue.serverTimestamp(),
        lastLoginAt: firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.error('Error saving user to Firestore:', error);
    }
  };

  const signOut = async () => {
    try {
      await auth().signOut();
      setInfoMessage('Signed out successfully');
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const deleteAccount = async () => {
    try {
      const currentUser = auth().currentUser;
      if (currentUser) {
        // Delete user data from Firestore
        await firestore().collection('users').doc(currentUser.uid).delete();
        // Delete the user account
        await currentUser.delete();
        setInfoMessage('Account deleted successfully');
      }
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const signInWithGoogle = async () => {
    try {
      // Check if your device supports Google Play
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      
      // Get the users ID token
      const userInfo = await GoogleSignin.signIn();
      
      // Create a Google credential with the token
      const googleCredential = auth.GoogleAuthProvider.credential(userInfo.data.idToken);
      
      // Sign-in the user with the credential
      return auth().signInWithCredential(googleCredential);
    } catch (error) {
      console.error('Google Sign-In Error:', error);
      setErrorMessage(error.message);
    }
  };

  const signInWithApple = async () => {
    try {
      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
      });

      const { identityToken, nonce } = appleAuthRequestResponse;
      const appleCredential = auth.AppleAuthProvider.credential(identityToken, nonce);
      await auth().signInWithCredential(appleCredential);
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const signIn = async (email, password) => {
    try {
      await auth().signInWithEmailAndPassword(email, password);
      setInfoMessage('Signed in successfully');
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const signUp = async (email, password) => {
    try {
      await auth().createUserWithEmailAndPassword(email, password);
      setInfoMessage('Account created successfully');
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const sendPasswordReset = async (email) => {
    try {
      await auth().sendPasswordResetEmail(email);
      setInfoMessage('Password reset email sent');
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const updatePassword = async (newPassword, callback) => {
    try {
      const currentUser = auth().currentUser;
      if (currentUser) {
        await currentUser.updatePassword(newPassword);
        callback(true, 'Password updated successfully');
      }
    } catch (error) {
      callback(false, error.message);
    }
  };

  const contextValue = {
    authState,
    user,
    errorMessage,
    infoMessage,
    signOut,
    deleteAccount,
    signInWithGoogle,
    signInWithApple,
    signIn,
    signUp,
    sendPasswordReset,
    updatePassword,
    setErrorMessage,
    setInfoMessage,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#007AFF" />
        
        {/* Background Gradient */}
        <LinearGradient
          colors={['rgba(0, 122, 255, 0.1)', 'rgba(0, 122, 255, 0.05)', 'transparent']}
          style={styles.backgroundGradient}
        />
        
        {/* Floating Circles */}
        <View style={[styles.floatingCircle, styles.circle1]} />
        <View style={[styles.floatingCircle, styles.circle2]} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {authState === 'signedIn' ? 'My Account' : 'Welcome'}
          </Text>
          <TouchableOpacity style={styles.menuButton}>
            <Icon name="settings" size={24} color="#666" />
          </TouchableOpacity>
        </View>

        {/* Main Content */}
        <View style={styles.content}>
          {authState === 'unknown' && (
            <View style={styles.loadingContainer}>
              <Text>Loading...</Text>
            </View>
          )}
          
          {authState === 'signedIn' && user && (
            <LoggedInView user={user} />
          )}
          
          {authState === 'signedOut' && <AuthView />}
        </View>
      </SafeAreaView>
    </AuthContext.Provider>
  );
};

// Logged In View Component
const LoggedInView = ({ user }) => {
  const { signOut, deleteAccount } = useContext(AuthContext);
  const [appearanceMode, setAppearanceMode] = useState('system');
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const memberSince = user.metadata?.creationTime 
    ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { 
        year: 'numeric', month: 'long', day: 'numeric' 
      })
    : 'Not Available';

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: signOut },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This action cannot be undone. All your data will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteAccount },
      ]
    );
  };

  return (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
      {/* Profile Header */}
      <View style={styles.glassPanel}>
        <View style={styles.profileHeader}>
          <Icon name="account-circle" size={60} color="#4CAF50" />
          <View style={styles.profileInfo}>
            <Text style={styles.emailText}>{user.email || 'No Email'}</Text>
            <Text style={styles.memberSinceText}>Member since {memberSince}</Text>
          </View>
        </View>
      </View>

      {/* App Settings */}
      <View style={styles.glassPanel}>
        <Text style={styles.sectionTitle}>Settings</Text>
        
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Appearance</Text>
          <View style={styles.segmentedControl}>
            {['System', 'Light', 'Dark'].map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.segmentButton,
                  appearanceMode.toLowerCase() === mode.toLowerCase() && styles.segmentButtonActive
                ]}
                onPress={() => setAppearanceMode(mode.toLowerCase())}
              >
                <Text style={[
                  styles.segmentText,
                  appearanceMode.toLowerCase() === mode.toLowerCase() && styles.segmentTextActive
                ]}>
                  {mode}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.divider} />
        
        <TouchableOpacity
          style={styles.settingButton}
          onPress={() => setShowOnboarding(true)}
        >
          <Icon name="help" size={20} color="#007AFF" />
          <Text style={styles.settingButtonText}>View Tutorial</Text>
        </TouchableOpacity>
      </View>

      {/* Community & Support */}
      <View style={styles.glassPanel}>
        <Text style={styles.sectionTitle}>Community & Support</Text>
        
        <TouchableOpacity
          style={styles.settingButton}
          onPress={() => Linking.openURL('https://smashspeed.ca')}
        >
          <Icon name="public" size={20} color="#007AFF" />
          <Text style={styles.settingButtonText}>Official Website</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.settingButton}
          onPress={() => Linking.openURL('https://instagram.com/smashspeedai')}
        >
          <Icon name="camera-alt" size={20} color="#007AFF" />
          <Text style={styles.settingButtonText}>Follow on Instagram</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.settingButton}
          onPress={() => Linking.openURL('mailto:smashspeedai@gmail.com')}
        >
          <Icon name="mail" size={20} color="#007AFF" />
          <Text style={styles.settingButtonText}>Contact Support</Text>
        </TouchableOpacity>
      </View>

      {/* Account Actions */}
      <View style={styles.glassPanel}>
        <Text style={styles.sectionTitle}>Account Actions</Text>
        
        <TouchableOpacity
          style={styles.settingButton}
          onPress={() => setShowChangePasswordModal(true)}
        >
          <Icon name="lock" size={20} color="#007AFF" />
          <Text style={styles.settingButtonText}>Change Password</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.settingButton} onPress={handleSignOut}>
          <Icon name="exit-to-app" size={20} color="#FF3B30" />
          <Text style={[styles.settingButtonText, { color: '#FF3B30' }]}>Sign Out</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.settingButton} onPress={handleDeleteAccount}>
          <Icon name="delete-forever" size={20} color="#FF3B30" />
          <Text style={[styles.settingButtonText, { color: '#FF3B30' }]}>Delete Account</Text>
        </TouchableOpacity>
      </View>

      {/* Change Password Modal */}
      <ChangePasswordModal
        visible={showChangePasswordModal}
        onClose={() => setShowChangePasswordModal(false)}
      />
    </ScrollView>
  );
};

// Change Password Modal
const ChangePasswordModal = ({ visible, onClose }) => {
  const { updatePassword } = useContext(AuthContext);
  const [newPassword, setNewPassword] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleUpdatePassword = () => {
    updatePassword(newPassword, (success, message) => {
      setIsSuccess(success);
      setFeedbackMessage(message);
      if (success) {
        setTimeout(() => {
          onClose();
          setNewPassword('');
          setFeedbackMessage('');
        }, 2000);
      }
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Change Password</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.cancelButton}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modalContent}>
          <ModernTextField
            label="New Password"
            placeholder="Enter new password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={true}
          />

          {feedbackMessage ? (
            <Text style={[styles.feedbackMessage, { color: isSuccess ? '#4CAF50' : '#FF3B30' }]}>
              {feedbackMessage}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[
              styles.primaryButton,
              !newPassword && styles.disabledButton
            ]}
            onPress={handleUpdatePassword}
            disabled={!newPassword}
          >
            <Text style={styles.primaryButtonText}>Update Password</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

// Auth View Component
const AuthView = () => {
  const [isSigningUp, setIsSigningUp] = useState(false);

  return (
    <View style={styles.authContainer}>
      <View style={styles.glassPanel}>
        <View style={styles.authFormContainer}>
          {isSigningUp ? (
            <CreateAccountForm isSigningUp={isSigningUp} setIsSigningUp={setIsSigningUp} />
          ) : (
            <SignInForm isSigningUp={isSigningUp} setIsSigningUp={setIsSigningUp} />
          )}
        </View>
      </View>
      
      <Text style={styles.authPrompt}>
        Sign in to sync your data across devices and access premium features.
      </Text>
    </View>
  );
};

// Sign In Form Component
const SignInForm = ({ isSigningUp, setIsSigningUp }) => {
  const { signIn, sendPasswordReset, signInWithGoogle, signInWithApple, errorMessage, infoMessage, setErrorMessage, setInfoMessage } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSignIn = () => {
    signIn(email, password);
  };

  const handleForgotPassword = () => {
    if (email) {
      sendPasswordReset(email);
    } else {
      setErrorMessage('Please enter your email address first');
    }
  };

  return (
    <View style={styles.authForm}>
      <Text style={styles.authTitle}>Sign In</Text>
      
      <ModernTextField
        label="Email"
        placeholder="Enter your email"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setErrorMessage(null);
          setInfoMessage(null);
        }}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      
      <ModernTextField
        label="Password"
        placeholder="Enter your password"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setErrorMessage(null);
          setInfoMessage(null);
        }}
        secureTextEntry={true}
      />

      <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotPasswordButton}>
        <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
      </TouchableOpacity>

      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
      {infoMessage && <Text style={styles.successText}>{infoMessage}</Text>}

      <TouchableOpacity style={styles.primaryButton} onPress={handleSignIn}>
        <Text style={styles.primaryButtonText}>Sign In</Text>
      </TouchableOpacity>

      <View style={styles.dividerContainer}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Apple Sign In Button */}
      <TouchableOpacity style={styles.appleButton} onPress={signInWithApple}>
        <Icon name="apple" size={20} color="white" />
        <Text style={styles.appleButtonText}>Sign in with Apple</Text>
      </TouchableOpacity>

      {/* Google Sign In Button */}
      <TouchableOpacity style={styles.googleButton} onPress={signInWithGoogle}>
        <Text style={styles.googleButtonText}>Sign in with Google</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setIsSigningUp(true)} style={styles.switchAuthButton}>
        <Text style={styles.switchAuthText}>Don't have an account? Sign up</Text>
      </TouchableOpacity>
    </View>
  );
};

// Create Account Form Component
const CreateAccountForm = ({ isSigningUp, setIsSigningUp }) => {
  const { signUp, errorMessage, setErrorMessage } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);

  const isFormValid = email && password && hasAcceptedTerms;

  const handleSignUp = () => {
    signUp(email, password);
  };

  return (
    <View style={styles.authForm}>
      <Text style={styles.authTitle}>Create Account</Text>
      
      <ModernTextField
        label="Email"
        placeholder="Enter your email"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setErrorMessage(null);
        }}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      
      <ModernTextField
        label="Password"
        placeholder="Enter your password"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setErrorMessage(null);
        }}
        secureTextEntry={true}
      />

      <View style={styles.termsContainer}>
        <TouchableOpacity
          style={styles.checkbox}
          onPress={() => setHasAcceptedTerms(!hasAcceptedTerms)}
        >
          <Icon
            name={hasAcceptedTerms ? "check-box" : "check-box-outline-blank"}
            size={20}
            color={hasAcceptedTerms ? "#007AFF" : "#666"}
          />
        </TouchableOpacity>
        <Text style={styles.termsText}>
          I agree to the Terms of Service and Privacy Policy
        </Text>
      </View>

      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      <TouchableOpacity
        style={[styles.primaryButton, !isFormValid && styles.disabledButton]}
        onPress={handleSignUp}
        disabled={!isFormValid}
      >
        <Text style={styles.primaryButtonText}>Create Account</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          setIsSigningUp(false);
          setErrorMessage(null);
        }}
        style={styles.switchAuthButton}
      >
        <Text style={styles.switchAuthText}>Already have an account? Sign in</Text>
      </TouchableOpacity>
    </View>
  );
};

// Modern Text Field Component
const ModernTextField = ({ label, placeholder, value, onChangeText, secureTextEntry = false, keyboardType, autoCapitalize }) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.textFieldContainer}>
      {label && (
        <Text style={styles.textFieldLabel}>{label}</Text>
      )}
      <View style={[styles.textFieldWrapper, isFocused && styles.textFieldFocused]}>
        <TextInput
          style={styles.textField}
          placeholder={placeholder}
          placeholderTextColor="#999"
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {secureTextEntry && (
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setIsPasswordVisible(!isPasswordVisible)}
          >
            <Icon
              name={isPasswordVisible ? "visibility-off" : "visibility"}
              size={20}
              color="#666"
            />
          </TouchableOpacity>
        )}
      </View>
      <View style={[styles.textFieldUnderline, isFocused && styles.textFieldUnderlineFocused]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  floatingCircle: {
    position: 'absolute',
    borderRadius: 100,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
  },
  circle1: {
    width: 200,
    height: 200,
    top: -50,
    left: -100,
  },
  circle2: {
    width: 150,
    height: 150,
    bottom: 100,
    right: -75,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  menuButton: {
    padding: 5,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
    paddingTop: 20,
  },
  glassPanel: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 25,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileInfo: {
    marginLeft: 15,
    flex: 1,
  },
  emailText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  memberSinceText: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 15,
  },
  settingRow: {
    marginBottom: 15,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    marginBottom: 10,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#E5E5EA',
    borderRadius: 8,
    padding: 2,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentButtonActive: {
    backgroundColor: '#007AFF',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  segmentTextActive: {
    color: 'white',
  },
  settingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  settingButtonText: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: 10,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E5EA',
    marginVertical: 10,
  },
  authContainer: {
    flex: 1,
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  authFormContainer: {
    // Container for form switching animation
  },
  authForm: {
    // Individual form styling
  },
  authTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#000',
  },
  authPrompt: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    textAlign: 'center',
    marginTop: 20,
    marginHorizontal: 25,
    lineHeight: 20,
  },
  textFieldContainer: {
    marginBottom: 20,
  },
  textFieldLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  textFieldWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  textFieldFocused: {
    // Add focused styling if needed
  },
  textField: {
    flex: 1,
    fontSize: 16,
    color: '#000',
  },
  eyeButton: {
    padding: 5,
  },
  textFieldUnderline: {
    height: 1,
    backgroundColor: '#E5E5EA',
  },
  textFieldUnderlineFocused: {
    backgroundColor: '#007AFF',
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginBottom: 20,
  },
  forgotPasswordText: {
    fontSize: 14,
    color: '#007AFF',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#E5E5EA',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5EA',
  },
  dividerText: {
    marginHorizontal: 15,
    fontSize: 14,
    color: '#666',
  },
  appleButton: {
    backgroundColor: '#000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 8,
    marginBottom: 15,
  },
  appleButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  googleButton: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    alignItems: 'center',
    paddingVertical: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  googleButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '500',
  },
  switchAuthButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  switchAuthText: {
    fontSize: 14,
    color: '#007AFF',
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  checkbox: {
    marginRight: 10,
    marginTop: 2,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
    lineHeight: 18,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 15,
  },
  successText: {
    color: '#4CAF50',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 15,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  cancelButton: {
    fontSize: 16,
    color: '#007AFF',
  },
  modalContent: {
    flex: 1,
    padding: 30,
  },
  feedbackMessage: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
});

export default AccountView;