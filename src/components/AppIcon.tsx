// AppIcon.tsx
import React from 'react';
import { Platform, StyleProp, View, ViewStyle, TextStyle } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { SFSymbol } from 'react-native-sfsymbols';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

type Props = {
  name?: string;                // SF Symbol (iOS)
  fallbackName: FeatherName;    // Feather icon (Android / fallback)
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle | TextStyle>;
  accessibilityLabel?: string;  // we'll use this on Feather or a wrapper View
};

export default function AppIcon({
  name,
  fallbackName,
  size = 18,
  color = '#000',
  style,
  accessibilityLabel,
}: Props) {
  if (Platform.OS === 'ios' && name) {
    // Build the SFSymbol element WITHOUT accessibilityLabel (prop not supported)
    const symbol = (
      <SFSymbol
        name={name}
        size={size}
        color={color as string}
        multicolor={false}
        // Some versions size via style width/height as well:
        style={[{ width: size, height: size }, style] as StyleProp<ViewStyle>}
      />
    );

    // If you still want an a11y label on iOS, wrap it:
    return accessibilityLabel ? (
      <View accessible accessibilityLabel={accessibilityLabel}>{symbol}</View>
    ) : (
      symbol
    );
  }

  // Feather supports accessibilityLabel directly
  return (
    <Feather
      name={fallbackName}
      size={size}
      color={color}
      style={style}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
