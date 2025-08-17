module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // ... any other plugins you have go here
    'react-native-reanimated/plugin', // This MUST be the last plugin
  ],
};